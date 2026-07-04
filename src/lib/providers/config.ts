/** Runtime detection of which data sources are configured/available. */

export interface ProviderContext {
  /** Force deterministic demo research (used for demo props / demo mode). */
  demo: boolean;
  /** Allow live network calls to free public endpoints. */
  enableWebResearch: boolean;
}

export interface ProviderStatus {
  key: string;
  label: string;
  configured: boolean;
  detail: string;
}

export function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1" || v === "yes";
}

export function hasKey(name: string): boolean {
  return Boolean(process.env[name] && process.env[name]!.trim().length > 0);
}

/** Snapshot of provider configuration for the Settings page. */
export function getProviderStatuses(): ProviderStatus[] {
  return [
    {
      key: "espn",
      label: "ESPN public API (no key)",
      configured: envFlag("ENABLE_WEB_RESEARCH"),
      detail: envFlag("ENABLE_WEB_RESEARCH")
        ? "Live research enabled — box scores & schedules via ESPN public endpoints."
        : "Set ENABLE_WEB_RESEARCH=true to fetch live box scores/schedules.",
    },
    {
      key: "sportsdata",
      label: "SportsDataIO",
      configured: hasKey("SPORTSDATA_API_KEY"),
      detail: hasKey("SPORTSDATA_API_KEY") ? "API key detected." : "No key — using manual/demo data.",
    },
    {
      key: "odds",
      label: "The Odds API",
      configured: hasKey("ODDS_API_KEY"),
      detail: hasKey("ODDS_API_KEY") ? "API key detected." : "No key — market comparison limited to manual input.",
    },
    {
      key: "news",
      label: "News API",
      configured: hasKey("NEWS_API_KEY"),
      detail: hasKey("NEWS_API_KEY") ? "API key detected." : "No key — injury/news must be entered manually.",
    },
    {
      key: "search",
      label: "Web search (Tavily/SerpAPI)",
      configured: hasKey("SEARCH_API_KEY"),
      detail: hasKey("SEARCH_API_KEY") ? "API key detected." : "No key — sentiment summaries limited.",
    },
    {
      key: "balldontlie",
      label: "balldontlie (NBA)",
      configured: hasKey("BALLDONTLIE_API_KEY"),
      detail: hasKey("BALLDONTLIE_API_KEY") ? "API key detected." : "Optional free key for richer NBA stats.",
    },
  ];
}
