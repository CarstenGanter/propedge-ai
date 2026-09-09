import type { Roof } from "@/lib/nfl/stadiums";

/**
 * Open-Meteo hourly forecast (free, no key). Times come back in the requested
 * IANA zone without an offset ("2026-09-13T13:00"), so kickoff is converted to
 * that zone's local hour before matching. Pure helpers are exported for tests.
 * Docs: https://open-meteo.com/en/docs
 */

export interface HourlyForecast {
  tz: string;
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
}

export interface KickoffWeather {
  localHour: string; // "2026-09-13T13:00"
  tempF: number;
  precipProb: number;
  windMph: number;
  gustMph: number;
}

export function openMeteoUrl(lat: number, lon: number, tz: string): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    forecast_days: "7",
    timezone: tz,
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export async function fetchHourlyForecast(lat: number, lon: number, tz: string): Promise<HourlyForecast | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(openMeteoUrl(lat, lon, tz), { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { hourly?: Partial<HourlyForecast> };
    const h = data.hourly;
    if (!h?.time || !h.temperature_2m || !h.wind_speed_10m) return null;
    return {
      tz,
      time: h.time,
      temperature_2m: h.temperature_2m,
      precipitation_probability: h.precipitation_probability ?? [],
      wind_speed_10m: h.wind_speed_10m,
      wind_gusts_10m: h.wind_gusts_10m ?? [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** UTC ISO → "YYYY-MM-DDTHH:00" in the given zone (Open-Meteo's hourly key format). */
export function kickoffLocalHour(kickoffISO: string, tz: string): string | null {
  const t = Date.parse(kickoffISO);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:00`;
}

/** Forecast row nearest to kickoff (exact hour when available). */
export function weatherAtKickoff(h: HourlyForecast, kickoffISO: string): KickoffWeather | null {
  const local = kickoffLocalHour(kickoffISO, h.tz);
  if (!local) return null;
  let idx = h.time.indexOf(local);
  if (idx < 0) {
    // Nearest hour by string compare on the same day (forecast may not cover kickoff yet).
    const day = local.slice(0, 10);
    idx = h.time.findIndex((t) => t.startsWith(day));
    if (idx < 0) return null;
  }
  const num = (xs: number[] | undefined) => (xs && Number.isFinite(xs[idx]) ? xs[idx] : NaN);
  const tempF = num(h.temperature_2m);
  const windMph = num(h.wind_speed_10m);
  if (!Number.isFinite(tempF) || !Number.isFinite(windMph)) return null;
  const precipProb = Number.isFinite(num(h.precipitation_probability)) ? num(h.precipitation_probability) : 0;
  const gustMph = Number.isFinite(num(h.wind_gusts_10m)) ? num(h.wind_gusts_10m) : windMph;
  return { localHour: h.time[idx], tempF, precipProb, windMph, gustMph };
}

export interface WeatherAssessment {
  concern: boolean;
  note: string;
  sourceName: string;
  sourceUrl?: string;
}

export const WIND_CONCERN_MPH = 15;
export const PRECIP_CONCERN_PCT = 60;
export const COLD_CONCERN_F = 25;

/**
 * Turn a forecast into a factual note plus a concern flag for the passing game.
 * Domes never raise a concern; retractable roofs are assumed closed in bad
 * weather, so they are reported but not flagged.
 */
export function weatherConcern(
  w: KickoffWeather | null,
  roof: Roof,
  opts?: { sourceUrl?: string },
): WeatherAssessment {
  if (roof === "dome") {
    return { concern: false, note: "Indoor venue — weather is not a factor.", sourceName: "Venue" };
  }
  if (!w) {
    return { concern: false, note: "No kickoff forecast available.", sourceName: "Open-Meteo" };
  }
  const reasons: string[] = [];
  if (w.windMph >= WIND_CONCERN_MPH) reasons.push(`wind ${Math.round(w.windMph)} mph`);
  if (w.precipProb >= PRECIP_CONCERN_PCT) reasons.push(`${Math.round(w.precipProb)}% precipitation chance`);
  if (w.tempF <= COLD_CONCERN_F) reasons.push(`${Math.round(w.tempF)}°F`);
  const base =
    `Open-Meteo forecast at kickoff: ${Math.round(w.tempF)}°F, wind ${Math.round(w.windMph)} mph` +
    ` (gusts ${Math.round(w.gustMph)}), ${Math.round(w.precipProb)}% precipitation chance.`;
  if (roof === "retractable") {
    return {
      concern: false,
      note: `${base} Retractable roof — typically closed in bad weather.`,
      sourceName: "Open-Meteo",
      sourceUrl: opts?.sourceUrl,
    };
  }
  const concern = reasons.length > 0;
  return {
    concern,
    note: concern ? `${base} Flagged for the passing game (${reasons.join(", ")}).` : base,
    sourceName: "Open-Meteo",
    sourceUrl: opts?.sourceUrl,
  };
}
