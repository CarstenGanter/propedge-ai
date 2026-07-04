# PropEdge AI

A local-first sports research dashboard. PropEdge AI helps you **find, analyze, rank, track, and
review** daily player props (built around Underdog Fantasy-style props) across NFL, NBA, NCAAB,
MLB, WNBA, NHL and Soccer (**World Cup + MLS**) — plus a **Team Picks** section that recommends game
winners (moneyline) with value edges across NFL, MLB, NCAA basketball, WNBA, and the top soccer
leagues.

> **PropEdge AI is a research and tracking tool. It does not guarantee outcomes. Sports picks
> involve risk, and past performance does not ensure future results. Confidence scores are model
> estimates — not financial advice.**

Nothing here is a "lock" or "guaranteed" pick. The app ranks by **model confidence** and always
displays risk. Bankroll tracking is **simulated** unless you explicitly mark an entry as actually
placed.

---

## Features

- **Prop ingestion** — CSV upload, manual entry form, and a provider abstraction for future APIs.
- **Explainable scoring engine** — a deterministic 0–100 confidence model across 9 weighted
  categories (recent form, season baseline, matchup, role/usage, injury/news, market edge,
  sentiment, historical splits, parlay suitability) with a full score breakdown, evidence list,
  reasons for/against, warnings, and a cautious written verdict.
- **Daily pick generation** — ranks all available props and selects the top 5–10, filtering out
  ruled-out players, low-volume/insufficient-data props, and anything below your confidence
  threshold.
- **Results & settlement** — manual hit/miss/push/void entry, plus optional auto-settlement from
  free public box scores. End-of-day report with accuracy, P/L, biggest win, worst miss, lessons.
- **Bankroll tracking** — default $5 stake, single & parlay entries, daily/weekly/monthly/all-time
  P/L, ROI, win rate.
- **Parlay builder** — two kinds: **player-prop parlays** (manual payout multiplier, correlation
  warnings) and **team (moneyline) parlays** where you pick multiple teams to win and the combined
  odds + payout are computed from each team's price (product of decimal odds). Both show combined
  risk, a model estimate of all legs hitting, projected payout, and **auto-settle as their legs
  settle**.
- **Team Picks (game winners)** — auto-discovers today's games across 8 leagues and recommends which
  team wins, from de-vigged market probability + recent form + value (model vs. market), with
  moneyline P/L tracking and ESPN auto-settlement.
- **Analytics** — accuracy by sport/league/prop type/confidence tier/direction, team win-rate by
  league, P/L breakdowns, a **confidence calibration** chart, a rolling performance trend, and a
  **Model quality** tab that scores the model honestly: **Closing Line Value (CLV)**, plus **Brier /
  log-loss / skill-vs-coin-flip** for both props and team picks.
- **Extras** — pick tags, personal notes, an avoid list, model versioning, and CSV export.
- **Demo mode** — clearly-labeled synthetic data so you can explore the whole app offline.

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Radix UI · Prisma + SQLite ·
Recharts · Zod · Vitest.

---

## Getting started

```bash
npm install
cp .env.example .env          # defaults work fully offline
npx prisma migrate dev        # create the local SQLite database
npm run seed                  # optional: load clearly-labeled demo data
npm run dev                   # http://localhost:3000
```

Then open **Settings → Load demo data** at any time to (re)populate the app, or head to the
**Research Lab** to import your own props.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Load labeled demo data |
| `npm run daily` | Headless fetch + generate (props & team picks) |
| `npm run capture` | Capture closing lines for CLV (run near game time; `--props` also captures prop lines) |
| `npm run db:reset` | Reset the SQLite database |

---

## Importing props (CSV)

Required columns: `sport, league, gameDate, playerName, team, opponent, propType, line, overUnder`.
Optional: `startTime, projection, payoutMultiplier, injuryStatus, notes`.

```csv
sport,league,gameDate,playerName,team,opponent,propType,line,overUnder,projection
NBA,NBA,2026-06-30,Jalen Brunson,Knicks,Celtics,Points,25.5,OVER,27.1
```

Download a template from the **Research Lab → Import props from CSV** card. `gameDate` must be
`YYYY-MM-DD`; `overUnder` accepts `OVER`/`UNDER` (or `over`/`under`).

---

## Data sources

The app works **fully offline** with manual/CSV/demo data. Optional live research uses **free,
no-key public endpoints** (ESPN) for schedules and box-score auto-settlement — enable it in
**Settings → Enable live web research** (or set `ENABLE_WEB_RESEARCH=true`). Every provider is a
typed adapter with a demo implementation and a documented seam for keyed APIs:

| Provider | Offline default | Wire later via |
| --- | --- | --- |
| `sportsStatsProvider` | **MLB: live MLB Stats API (free)**; other sports: demo/none | SportsDataIO / balldontlie (`*_API_KEY`) |
| `oddsProvider` | manual projection | The Odds API (`ODDS_API_KEY`) |
| `newsProvider` | manual injury note | News API (`NEWS_API_KEY`) |
| `sentimentProvider` | demo summary | Tavily/SerpAPI/Reddit (`SEARCH_API_KEY`) |
| `resultsProvider` | ESPN box scores / manual | any final-stats API |

When a source is missing, the model **discloses it** ("insufficient data", "no market comparison
available", etc.) and tempers confidence — it never fabricates stats, sources, or quotes.

---

## Daily automation (The Odds API)

With `ODDS_API_KEY` set, PropEdge can fetch real de-vigged sportsbook player props and rank them
using the **Market model** scoring profile (Settings → Scoring model). For hands-off mornings:

- **In-app:** Today's Picks → **Fetch + generate (all sports)**, or Research Lab → **Fetch from The
  Odds API** for a single sport.
- **CLI / headless:** `npm run daily` — fetches every *enabled* sport and generates picks. Runs
  standalone against the local DB; the web app does not need to be open.
- **Scheduled (macOS):** a wrapper (`scripts/daily-refresh.sh`) + LaunchAgent are included:

  ```bash
  cp scripts/com.propedge.daily.plist ~/Library/LaunchAgents/
  launchctl load ~/Library/LaunchAgents/com.propedge.daily.plist   # runs daily at 9:00 AM
  launchctl start com.propedge.daily                                # test run now
  ```

  (cron alternative: `0 9 * * * "/absolute/path/scripts/daily-refresh.sh"`. On modern macOS, grant
  `/usr/sbin/cron` **Full Disk Access** so it can reach `~/Documents`.)

**Soccer competitions:** the **Soccer** category spans multiple competitions — currently **World Cup**
(in season now) and **MLS**. Enabling Soccer pulls player props from both and tags each prop with its
competition; the per-sport event cap is split across them to protect credits. Soccer player-prop
*auto-settlement stays manual* (ESPN box scores don't cleanly expose per-player soccer stats), and the
model discloses that rather than fabricating a grade.

**Credit control:** the job only pulls sports enabled in **Settings → Enabled sports**, capped to a
few games each. The Odds API free tier is 500 credits/month (~2–3 per game), so keep only in-season
sports enabled. Output is logged to `daily-refresh.log`. The same job also refreshes and settles
**Team Picks** (below) — the team form/injury enrichment (MLB standings, probable pitchers, ESPN
injuries) is **free** and spends no Odds API credits.

---

## Team Picks (game winners)

The **Team Picks** tab (`/teams`) recommends **which team wins** each game — moneyline, not
Underdog lines — across **NFL, MLB, NCAA basketball, WNBA, Premier League, Bundesliga, Champions
League, and the World Cup**.

- **Market backbone:** The Odds API `h2h` (moneyline) is de-vigged into a fair win probability per
  side — **2-way** for US sports, **3-way** (home/draw/away) for soccer. This is a cheap **bulk
  fetch (~1 credit per league)**.
- **Form + value:** the engine anchors on the market, nudges modestly by form (home advantage is
  already priced in, so it's *not* double-counted), and surfaces **value = model win % − market
  implied %**. Form/injury inputs are **free, no-key** and cost **0 Odds API credits**:
  - **MLB (rich):** the MLB Stats API standings feed adds **last-10 record, run differential,
    win/streak, and home/away splits**, and the schedule feed adds each game's **probable starting
    pitcher (season ERA/WHIP)** as a matchup edge.
  - **Injuries (cross-league):** the ESPN injuries feed populates **named players on IL / Out** for
    MLB, NFL, NBA, and WNBA (counted per team, with the top names shown as evidence). Leagues ESPN
    doesn't cover (soccer, college) degrade gracefully — the model discloses "injury data
    unavailable" rather than guessing.
  - **Fallback:** where the rich feeds don't apply, ESPN season records still drive the form nudge.

  The blended form signal is **capped (±10 pts of win probability)** so it sharpens — but never
  overwhelms — the market anchor. Each pick shows the recommended team, model vs. market win %, a
  **value badge**, price, confidence, risk, and evidence (record, last-10, run differential, probable
  pitcher, key injuries). High soccer draw risk is flagged (a draw loses a team-to-win pick).
- **Tracking:** settle by final score — **Results → Team games → Settle games (auto)** (ESPN) or
  manual — with a **W-L record + moneyline P/L** into your bankroll and a **Team Picks** analytics
  section (win rate by league).
- **Moneyline parlays:** combine multiple team-to-win picks on the **Parlay Builder** page → *Team
  parlays (game winners)*. Combined odds and payout come from the legs' actual prices (product of
  decimal odds), and the parlay auto-settles as each game finishes (any leg loss loses it; a
  pushed/voided leg drops out and the odds recompute on the survivors).

Usage: **Settings → Team picks** to enable in-season leagues (keep off-season ones off to save
credits), then **Team Picks → Fetch + generate**. The daily job (above) also generates the board
each morning and settles the prior day's games.

> It's a **market-plus-form** model, honest about what it does and doesn't know: MLB gets the richest
> form (standings splits + probable pitcher) and MLB/NFL/NBA/WNBA get ESPN injuries; other leagues
> fall back to season records and the model discloses any missing inputs in its warnings.

---

## Model quality — CLV & calibration

The **Analytics → Model quality** tab measures whether the model is actually good, rather than
assuming it — the honest core of a research tool.

- **Closing Line Value (CLV).** When a pick is generated, PropEdge records the no-vig market
  probability of the side you took (**entry**). Run **Capture closing lines** near game time to record
  the latest market probability (**closing**). `CLV = closing − entry`: if the market moved *toward*
  your side after you took it, that's positive CLV — the strongest leading indicator of real edge,
  independent of any single game's result. Shown as **average CLV** and **beat-the-close rate** for
  both team picks and props.
- **Calibration score.** **Brier score** and **log-loss** grade how well the stated probabilities
  match reality (props use confidence ÷ 100; team picks use the model win probability), plus a
  **skill-vs-coin-flip** number (>0 beats guessing). Lower Brier/log-loss is better.

**Capturing closing lines:**
- **In-app:** Analytics → Model quality → **Capture closing lines** (team lines are a cheap bulk
  fetch; **+ props** also re-fetches player props and costs Odds API credits).
- **CLI:** `npm run capture` (add `--props` to include prop lines). Best scheduled **near game time**,
  *separately* from the morning `npm run daily` — if you capture right after generating, the closing
  line just equals the entry line and CLV is always zero. Regenerating a board resets its entry line.

---

## Project structure

```
src/
  app/            # App Router pages (dashboard, picks, teams, research, parlays, results, analytics, settings)
  components/     # UI primitives + domain components (cards, badges, charts, forms, modals)
  lib/
    analysis/     # scoringEngine, teamScoringEngine, confidenceModel, parlayCorrelation, teamParlay, calibration, modelQuality (Brier/log-loss/CLV), stats
    captureLines.ts                                 # closing-line capture for CLV (team + prop)
    providers/    # stats/news/odds/results adapters + live/ (ESPN scores + injuries, MLB Stats API, The Odds API) + demo
    ingest/       # CSV parsing & validation
    db/           # Prisma client singleton
    utils/        # csv, dates, format, cn, teamName (shared normalization/matching)
    teamLeagues.ts                                  # league config (Odds API + ESPN mapping)
    settle.ts, settleTeams.ts, generate.ts, generateTeams.ts
    analytics.ts, queries.ts, settings.ts, dto.ts
  server/actions/ # props, picks, teams, results, bankroll, parlays, settings, research, odds, jobs
  jobs/           # dailyRefresh (props + teams: fetch, generate, settle)
  types/          # shared domain types & constants
prisma/           # schema.prisma + seed.ts (demo data, incl. team picks)
```

---

## The scoring model

`analyzeProp(prop, researchBundle)` in `src/lib/analysis/scoringEngine.ts` is a pure, deterministic
function returning `{ confidenceScore, edgeScore, riskLevel, scoreBreakdown, evidence, warnings,
reasonsFor, reasonsAgainst, reasoningSummary, deepDiveAnalysis, verdict, tags, dataCompleteness }`.
Each category is scored 0–100 relative to the pick direction; missing inputs contribute a neutral
score **and** a recorded warning, and overall confidence is dampened toward 50 as data completeness
drops — the model is honest about uncertainty. Every generated pick stamps its `modelVersion`.

---

## Testing

```bash
npm test
```

Covers the prop scoring engine, the **team scoring engine** (2/3-way de-vig, value edge, draw-risk,
**blended form** from last-10/run-differential/probable-pitcher with a capped swing, and **activated
injuries** with named evidence), settlement logic (hit/miss/push, parlay payout, **moneyline
payout**), CSV parsing, prop ingestion, and analytics/calibration calculations.

---

## Legal

PropEdge AI is for research and personal tracking only. It is **not** betting or financial advice,
makes **no** guarantees, and does not facilitate wagering. Check the laws in your jurisdiction.
Respect the terms of service of any data source you integrate.
