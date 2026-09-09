import { describe, expect, it } from "vitest";
import { kickoffLocalHour, weatherAtKickoff, weatherConcern, type HourlyForecast } from "./openMeteo";

const forecast: HourlyForecast = {
  tz: "America/Chicago",
  time: ["2026-09-13T11:00", "2026-09-13T12:00", "2026-09-13T13:00", "2026-09-13T14:00"],
  temperature_2m: [70, 72, 74, 75],
  precipitation_probability: [10, 20, 65, 70],
  wind_speed_10m: [5, 8, 18, 20],
  wind_gusts_10m: [9, 12, 27, 30],
};

describe("kickoffLocalHour", () => {
  it("converts a UTC kickoff to the venue's local hour key", () => {
    expect(kickoffLocalHour("2026-09-13T17:00:00Z", "America/Chicago")).toBe("2026-09-13T12:00");
    expect(kickoffLocalHour("2026-09-13T17:00:00Z", "America/New_York")).toBe("2026-09-13T13:00");
    expect(kickoffLocalHour("2026-09-14T00:20:00Z", "America/Los_Angeles")).toBe("2026-09-13T17:00");
  });
});

describe("weatherAtKickoff", () => {
  it("picks the exact kickoff hour", () => {
    const w = weatherAtKickoff(forecast, "2026-09-13T18:00:00Z"); // 1pm Chicago
    expect(w?.localHour).toBe("2026-09-13T13:00");
    expect(w?.windMph).toBe(18);
    expect(w?.precipProb).toBe(65);
  });
  it("returns null when the day is not in the forecast window", () => {
    expect(weatherAtKickoff(forecast, "2026-09-20T18:00:00Z")).toBeNull();
  });
});

describe("weatherConcern", () => {
  const calm = { localHour: "x", tempF: 72, precipProb: 10, windMph: 6, gustMph: 9 };
  const windy = { localHour: "x", tempF: 72, precipProb: 10, windMph: 15, gustMph: 25 };
  const wet = { localHour: "x", tempF: 60, precipProb: 60, windMph: 5, gustMph: 8 };
  const cold = { localHour: "x", tempF: 25, precipProb: 0, windMph: 4, gustMph: 6 };

  it("flags wind ≥15 mph, precip ≥60%, or ≤25°F at an open stadium", () => {
    expect(weatherConcern(windy, "open").concern).toBe(true);
    expect(weatherConcern(wet, "open").concern).toBe(true);
    expect(weatherConcern(cold, "open").concern).toBe(true);
    expect(weatherConcern(calm, "open").concern).toBe(false);
  });
  it("is just below each threshold not a concern", () => {
    expect(weatherConcern({ ...windy, windMph: 14.9 }, "open").concern).toBe(false);
    expect(weatherConcern({ ...wet, precipProb: 59 }, "open").concern).toBe(false);
    expect(weatherConcern({ ...cold, tempF: 26 }, "open").concern).toBe(false);
  });
  it("never flags domes and only reports for retractable roofs", () => {
    expect(weatherConcern(windy, "dome")).toMatchObject({ concern: false, note: expect.stringContaining("Indoor") });
    const r = weatherConcern(windy, "retractable");
    expect(r.concern).toBe(false);
    expect(r.note).toContain("Retractable roof");
  });
  it("writes a factual note with the numbers and a source", () => {
    const r = weatherConcern(windy, "open", { sourceUrl: "https://api.open-meteo.com/x" });
    expect(r.note).toContain("wind 15 mph");
    expect(r.note).toContain("gusts 25");
    expect(r.sourceName).toBe("Open-Meteo");
    expect(r.sourceUrl).toBe("https://api.open-meteo.com/x");
  });
  it("reports missing forecasts honestly", () => {
    expect(weatherConcern(null, "open").note).toContain("No kickoff forecast");
  });
});
