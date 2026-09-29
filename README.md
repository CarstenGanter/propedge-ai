# PropEdge AI

A local-first sports research dashboard. PropEdge AI helps you **find, analyze, rank, track, and
review** daily player props (built around Underdog Fantasy-style props) across NFL, NBA, NCAAB,
MLB, WNBA, NHL and Soccer (**World Cup + MLS**) — plus a **Team Picks** section that recommends game
winners (moneyline) with value edges across NFL, MLB, NCAA basketball, WNBA, and the top soccer
leagues.

> **PropEdge AI is a research and tracking tool. It does not guarantee outcomes. Sports picks
> involve risk, and past performance does not ensure future results. Confidence scores are model
> estimates — not financial advice.**

**Using it on an NFL game day?** Follow [GAMEDAY.md](GAMEDAY.md) — the weekly routine step by step,
what each step costs, and the decision rules (payouts, stacks, timing, when to skip).

Nothing here is a "lock" or "guaranteed" pick. The app ranks by **model confidence** and always
displays risk. Bankroll tracking is **simulated** unless you explicitly mark an entry as actually
placed.

---

## Features

- **Prop ingestion** — CSV upload, manual entry form, and a provider abstraction for future APIs.
- **Explainable scoring engine** — three profiles (Settings → Scoring model). **Probability**
  (recommended) models each player's per-game distribution — negative binomial for counts, Student-t
  for yardage, with measured dispersion per prop type — anchors it on the de-vigged market, and
  reads P(beats the line) off the tail. **Balanced** and **Market** are 0–100 weighted blends across
  categories (form, baseline, matchup, role/usage, injury/news, market, sentiment, splits). Every pick
  carries a score breakdown, sourced evidence, reasons for/against, warnings and a written verdict.
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
- **Analytics** — judged against what matters for pick'em: a **verdict against the break-even bar**
  ("clears it / below it / not yet provable"), **95% Wilson intervals on every rate**, a count of
  categories that actually separate from chance (instead of a best/worst leaderboard that always
  names a winner), and it defaults to the sport you actually bet. Plus P/L, calibration (probability
  picks only), a trend chart, and a **Model quality** tab with **Closing Line Value (CLV)** and
  **Brier / log-loss / skill-vs-coin-flip**.
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
| `npm run capture` | Capture closing lines for CLV by hand (`npm run capture -- --props` also captures prop lines) |
| `npm run capture:auto` | One pass of the automatic closing-line capture (what the scheduler runs) |
| `npm run lint` | ESLint |
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

| Provider | Live (free, no key) | Wire later via |
| --- | --- | --- |
| `sportsStatsProvider` | **Game logs**: MLB Stats API (MLB) · **ESPN athlete gamelogs** (NBA/WNBA/NFL/NHL/NCAAB, with prior-season blending for early-season NFL). **Matchup**: MLB probable-pitcher hittability · **NFL opponent-defense ranks from aggregated ESPN box scores** · ESPN opponent-defense rank (pts/goals props) | SportsDataIO / balldontlie (`*_API_KEY`) |
| `newsProvider` | MLB injured-list + probable-starter confirmation · **NFL official game injury report + RotoWire notes + headlines** · **ESPN injury feed** (NBA/WNBA/NHL) matched to the player | News API (`NEWS_API_KEY`) |
| `historicalProvider` | **home/away + rest days / back-to-back** (from ESPN game dates) · **NFL kickoff weather via Open-Meteo** · **MLB park factors** (static) | — |
| `oddsProvider` | The Odds API snapshot (`ODDS_API_KEY`) — all sports | The Odds API |
| `sentimentProvider` | demo summary | Tavily/SerpAPI/Reddit (`SEARCH_API_KEY`) |
| `resultsProvider` | ESPN box scores / MLB Stats API | any final-stats API |

**Live scoring coverage** (with **Settings → Enable live web research** on): MLB fills recent form,
season baseline, matchup, role/usage, injuries, and market; NBA/WNBA/NFL/NHL/NCAAB now fill **recent
form, season baseline, matchup (points/goals props), role/usage, injuries, home/away & rest, and
market** — up from market-only. All of this is **free** and spends **no Odds API credits** (ESPN +
statsapi). When a source is missing, the model **discloses it** ("insufficient data", "no market
comparison available", etc.) and tempers confidence — it never fabricates stats, sources, or quotes.

---

## NFL Gameday

The **NFL Gameday** tab (`/nfl`) is the game-day workflow for Underdog-style pick'em: fetch the
slate, get ranked player picks grouped by game with sourced evidence, price them against what
Underdog actually pays, and build slips. The step-by-step routine is in [GAMEDAY.md](GAMEDAY.md).

- **Slate-aware.** Opens on today's games, or the next game day. Slate dates use **US Eastern time**,
  so Sunday Night Football stays on Sunday wherever your machine is.
- **Credit-safe fetching.** Player props are the only paid call. The page shows the estimate first —
  *"14 games × 6 markets = 84 credits, ≈267 left (floor 25)"* — and you confirm. Only that slate's
  games and the markets enabled in **Settings → NFL gameday** are fetched; days without NFL games
  cost nothing.
- **Free research** (no key, no credits), sourced and linked on each pick:

  | Signal | Source |
  | --- | --- |
  | Game logs | ESPN athlete gamelog — blended with **last season** in the first weeks, clearly labeled |
  | Usage: snap share, targets, carries | **nflverse** weekly stats and snap counts (free GitHub-release CSVs) |
  | Opponent defense | **ESPN box scores aggregated** by stat and **by position group** (vs WR/TE/RB), with plays faced for pace |
  | Player status, teammate absences | **ESPN game injury report** (Wed–Sun) + RotoWire notes + headlines |
  | Kickoff weather | **Open-Meteo** at kickoff for outdoor stadiums; domes never flagged |
  | Market probability | The Odds API, de-vigged, with fewer-book markets trusted less |

- **Per-pick pricing.** Underdog prices every pick individually — **1.87× for a standard pick**, less
  for a side it rates likely — and a slip pays the product (same-game slips a few percent under). In
  the line table you enter each pick's **Line** and **Payout**; **Needs** shows `1 ÷ payout` and
  **Books** the sportsbooks' own probability at your line — green when the books already beat the
  price, i.e. Underdog has mispriced the pick relative to the sharp market. **Not offered?** marks a prop Underdog doesn't carry; after 8 empty
  checks of a market the page tells you to stop paying for it.
- **The board.** Under the Probability profile the day's board is a shortlist, not a list of bets:
  props ranked by the value Underdog is expected to leave you — a pricing curve learned from the
  payouts you've entered (it keeps ~6.5% on a coin flip, ~10% on a 65% favourite) — with at most a
  third of the board from any one prop type. The old 55% floor is used only by the other profiles.
- **Suggested slips.** By default built only from picks whose **books' probability × payout ≥ 1**,
  so the edge doesn't rest on the model; when nothing qualifies the panel says to pass. A "The
  model" switch shows model-based slips for comparison, with a warning that the model has scored
  worse than the market so far. Enforces
  Underdog's rules (never the same player twice; at least two teams) and **seeks a QB stacked with
  his own receiver** — measured correlation +0.34, which the fixed payout doesn't fully charge for.
- **All props in this game (free).** The board keeps the day's top 10, so a game can miss it. Each
  game card can score every prop already fetched for that game and **Add** one to the board without
  re-ranking — safe after kickoff, when a re-rank would rebuild everything.
- **Settlement.** NFL box scores are read by stat group and machine key (`passingYards`,
  `rushingYards`, `receivingYards`, `receptions`, `passingTouchdowns`, `completions/passingAttempts`,
  `rushingAttempts`), with suffix-safe name matching, so every NFL prop type settles automatically.

**Credit budget.** The free tier is 500 credits/month. A full Sunday is ~84 credits for props; a
Thursday or Monday game ~6. Closing-line capture adds roughly 1–3 credits per game with picks.

---

## Daily automation (The Odds API)

With `ODDS_API_KEY` set, PropEdge fetches real de-vigged sportsbook player props and ranks them
with the scoring profile chosen in Settings → Scoring model (**Probability** is recommended). For hands-off mornings:

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

  (cron alternative: `0 9 * * * "/absolute/path/scripts/daily-refresh.sh"`.)

  > **Keep the repo out of `~/Documents`, Desktop and Downloads.** macOS privacy controls stop
  > launchd and cron jobs from reading those folders, and the job fails before it starts. This repo
  > lives in `~/Code/propedge-ai` for that reason; the included plist points there.

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

**Capturing closing lines and settling — automatic.** Two schedulers capture prop closing lines
**20–60 minutes before each kickoff** and settle finished picks from ESPN box scores (eligible 3½
hours after kickoff, retried every 30 minutes until final, slips settle with their legs), sharing
locks so neither job is ever done twice:

| | Runs when | Install |
| --- | --- | --- |
| In-app scheduler | whenever the app (`npm run dev`) is running | nothing — starts with the server (`src/instrumentation.ts`) |
| Background job | Mac awake, even with the app closed; Sun/Mon/Tue/Thu/Fri | `zsh scripts/install-auto-capture.sh` (re-run after a node upgrade) |

A capture buys **only games that still hold an uncaptured pick**, only the markets those picks use,
and **each game at most once**. Every other run is a local database read and costs nothing. The
Mac has to be awake at kickoff. Runs are logged to `logs/auto-capture.log`.

By hand: the **Capture closing lines** button (NFL page within 3 hours of kickoff, and Analytics →
Model quality), or `npm run capture -- --props`. Capturing right after generating is pointless — the
closing line just equals the entry line.

---

## Project structure

```
src/
  app/            # App Router pages (dashboard, picks, teams, research, parlays, results, analytics, settings)
  components/     # UI primitives + domain components (cards, badges, charts, forms, modals)
  lib/
    analysis/     # scoringEngine, probabilityModel + distributions, pickemMath (payouts, break-even, correlation),
                  # slipBuilder, availability, lineEdge, teamScoringEngine, parlayCorrelation, calibration, modelQuality
    nfl/          # slate, schedule, gameContext, defense (+ by position), usage, injuryReport, stadiums,
                  # gameday data, autoCapture (window rules) + runAutoCapture (shared capture pass)
    captureLines.ts                                 # closing-line capture for CLV (team + prop)
    addToBoard.ts                                   # score one game's props / add one to the board
    runAutoSettle.ts, settleSchedule.ts             # automatic settlement pass + its timing rules
    providers/    # stats/news/odds/results/historical adapters + live/ (ESPN scores/injuries/gamelogs/matchup, park factors, MLB Stats API, The Odds API) + demo
    ingest/       # CSV parsing & validation
    db/           # Prisma client singleton
    utils/        # csv, dates, format, cn, teamName (shared normalization/matching)
    teamLeagues.ts                                  # league config (Odds API + ESPN mapping)
    settle.ts, settleTeams.ts, generate.ts, generateTeams.ts
    analytics.ts, queries.ts, settings.ts, dto.ts
  server/actions/ # props, picks, teams, results, bankroll, parlays, settings, research, odds, jobs
  jobs/           # dailyRefresh (props + teams: fetch, generate, settle), run-capture, run-auto-capture (capture + settle)
  instrumentation.ts  # starts the in-app closing-line scheduler when the server boots
  types/          # shared domain types & constants
prisma/           # schema.prisma + seed.ts (demo data, incl. team picks)
scripts/          # launchd installers: install-auto-capture.sh, daily-refresh.sh + plist
```

---

## The scoring model

`analyzeProp(prop, researchBundle)` in `src/lib/analysis/scoringEngine.ts` is a pure, deterministic
function returning `{ confidenceScore, edgeScore, riskLevel, scoreBreakdown, evidence, warnings,
reasonsFor, reasonsAgainst, reasoningSummary, deepDiveAnalysis, verdict, tags, dataCompleteness }`.
Each category is scored 0–100 relative to the pick direction; missing inputs contribute a neutral
score **and** a recorded warning, and overall confidence is dampened toward 50 as data completeness
drops — the model is honest about uncertainty.

Under the **Probability** profile the confidence *is* a probability: `probabilityModel.ts` blends the
player's sample with a dispersion prior **measured per prop type** from nflverse (2022–2024), anchors
the mean on the de-vigged market, applies context adjustments (matchup, usage, injuries, weather) to
the model's own share only — the market's price already contains them — and clips to 33–70% because an edge beyond that is far more likely
to be model error. Every pick stamps its `modelVersion` and `scoringProfile`, and calibration only
grades picks whose confidence genuinely is a probability.

---

## Testing

```bash
npm test
```

Covers the prop scoring engine and probability model (distributions verified against closed forms),
pick'em payout math, the slip builder's platform rules and pricing, closing-line capture timing and
de-duplication, NFL settlement and slate logic, availability tracking, Wilson intervals, the **team
scoring engine** (2/3-way de-vig, value edge, draw-risk,
**blended form** from last-10/run-differential/probable-pitcher with a capped swing, and **activated
injuries** with named evidence), settlement logic (hit/miss/push, parlay payout, **moneyline
payout**), CSV parsing, prop ingestion, and analytics/calibration calculations.

---

## Legal

PropEdge AI is for research and personal tracking only. It is **not** betting or financial advice,
makes **no** guarantees, and does not facilitate wagering. Check the laws in your jurisdiction.
Respect the terms of service of any data source you integrate.
