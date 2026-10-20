# Model roadmap

From the research doc *PropEdge AI — NFL Prop Modeling & Market Edge Deep Dive* (2026-10-19).
The order is measurement first, then edges that have already held up, then structure. Each task
ships with tests and its own commit. A change to how probabilities are computed ships only if
task 1's metric — log-loss skill against the de-vigged consensus, walk-forward, on every settled
prop with a market — shows it helping on held-out weeks.

Guardrails kept throughout: the 0.33–0.70 probability clip, the 62% per-leg ceiling, context
adjustments applied only to the model's share (never on top of the market price), and "pass" as
the default when nothing clears the books' price.

## Status

| # | Task | Status |
| --- | --- | --- |
| 1 | Market-relative scoring: log-loss skill vs consensus, game-bootstrap intervals, edge buckets, attribution | Done (`c8392f7`) |
| 2 | Timestamped odds store; consensus as of any time; same-line CLV | Done (`93bc954`) |
| 3 | Venue-gap and dispersion features in σ units, staleness flags | Done |
| 3b | Consensus σ for reading the books at another line (inserted after 3) | **In production for receiving yards**: passes on prices; outcome gate underpowered (+0.0002, CI −0.0014 to +0.0020, n=361) |
| 4 | Vacated-volume redistribution on injury-report changes | Fitted and validated (below); news-latency test built, waiting on data |
| 5 | Team volume model | Open |
| 6 | Opportunity shares (EB-shrunk EWMA) | **Deferred** |
| 7 | Opponent effect on per-opportunity efficiency | **Deferred** |
| 8 | Game simulator | Kept, **scoped to leg correlation for slips** |
| 9 | Learned market weight per prop type | Open |
| 10 | Alt-ladder audit | Partly built for 3b: ladders stored and fitted |
| 11 | Correlated staking | Open |
| 12 | News-latency loop | Open |

## Why tasks 6 and 7 are deferred (2026-10-20)

Both improve the player layer — the model's own projection from the player's history. On the
primary sample (1,238 consensus-priced props, 33 games, each prop seeing only earlier weeks) that
layer carries no information the books don't already price:

- scored alone (market weight 0) against the market: skill **−12.4%** (95% game-bootstrap −19.3% to −6.7%);
- stacked, `outcome ~ logit(p_market) + logit(p_model)`: market coefficient **0.95** (0.27 to 1.70),
  model coefficient **−0.03** (−0.21 to +0.15).

Refining a layer that gets zero weight beside the market cannot move results, so the effort goes
to edges that don't depend on out-projecting the books: news timing (task 4), venue lines
(tasks 3 and 3b) and slip correlation (task 8). Revisit 6 and 7 if task 9's learned weight on the
model ever moves off zero.

## Task 8's scope

Only what slips need: joint outcomes of legs in the same game, replacing the pairwise
QB-to-own-receiver adjustment for three or more legs. Not a replacement for the per-prop
probability, which stays market-anchored.

## Task 3b: the consensus σ (2026-10-20)

Reading the books at an Underdog or PrizePicks line needs the consensus spread. Today it is the
CV prior × the line, damped by a 0.7 trust factor — narrow at low lines, which produced the 85%
alternate-line reading.

- **Fit** (`npm run research:sigma-fit`): the books' own alternate ladders, each book's one-sided
  prices de-vigged with its main-line power exponent. Receiving yards, 132 ladders, 6,286 rungs,
  13 games: σ = 13.5 + 0.27 × line. Error against the ladders falls from 9.51 to 3.30 probability
  points (11.64 → 3.02 more than 20 yards from the main line). Prices only, no outcomes.
- **Gate** (`npm run research:sigma-validate`), stated before running: lower log-loss on graded
  outcomes at venue lines in held-out weeks, interval below zero, calibration no worse. Held-out
  (before 2026-10-15): 361 venue lines, 21 games; log-loss difference +0.0002 (−0.0014 to
  +0.0020); calibration error 4.39 → 3.62 pts. No measurable difference on outcomes either way.
- **Why it can't tell yet:** almost every venue line sits on or within a point of the books' line,
  where σ barely matters; only 5 held-out props lie beyond the books' range. The ladder fit is a
  strong price result; outcomes don't have the power to confirm it.
- **Decision (2026-10-20): adopted for receiving yards** — "passes on prices; outcome gate
  underpowered (+0.0002, CI −0.0014 to +0.0020, n=361)". The "~" guard stays. Horton's alternate
  Under 14.5 off a 3.5 line now reads 73.2% (it read 84.9%). **Revert rule:** re-run
  `npm run research:sigma-validate` as off-line props accumulate; revert if the log-loss
  interval ends up clearly above zero.
- **Next look:** a held-out price test runs automatically once the next slate's ladders are
  stored (receiving yards, ~13 credits a week, approved); the outcome gate is re-run as graded
  off-line props accumulate. Other prop types need their own ladders, at ~13 credits a week each:
  none this month; revisit at the credit reset, rushing yards first.

An observation, not a finding: at venue lines the Over finished 2–8 points below the books'
probability in both periods; no interval excludes zero.

## Task 4: vacated volume and the news edge (2026-10-20)

**Redistribution** (`npm run research:redistribution`). nflverse 2022–25, regular season. "Out" =
listed inactive or on reserve and played in the team's previous game (the first game missed);
vacated share = his mean share over the team's previous four games he played (the production usage
window). Non-negative least squares per destination group, fitted on 2022–24, scored untouched on
2025 against the team's actual volume (MAE per teammate, game-bootstrap 95%):

| | Team-games fitted | vs pro-rata | vs no redistribution |
| --- | --- | --- | --- |
| Carries | 444 | −0.155 (−0.230 to −0.081) | **−0.098 (−0.153 to −0.049)** |
| Targets | 692 | −0.058 (−0.080 to −0.038) | +0.001 (−0.016 to +0.018) |

Carries redistribute predictably (an RB out sends 82% of his share to the other RBs); targets don't
beat leaving shares alone, and pro-rata — the usual assumption — is worse than doing nothing for
both. Tables: `REDISTRIBUTION` in `src/lib/nfl/vacatedVolume.ts`. Not yet wired into scoring: that
would change probabilities and needs task 1's gate (and only carries qualify).

**The news-latency test** (`npm run research:latency`). Every injury-report status change is now
logged with the time first seen (`InjuryStatusChange`, ESPN, free, every 15 minutes with the
schedulers). From a change to Out, the test times when each venue — Underdog, PrizePicks, each
sportsbook group — first moves a teammate's line in the odds store, censoring venues that hadn't
moved by our last look. **No measurements yet:** it needs a change to Out between two stored fetches
of that game, and today the store holds only the gameday fetch and the closing capture of games
with picks. A news-triggered fetch would make it measurable: ~13 games a week have a newly-out
pass-catcher; one fetch of the affected markets after Sunday inactives is ~20–60 credits a week.
Not enabled — the cost needs approval.

## Removing the teammate-out +6% from receiving props (2026-10-20)

Decision: the flat +6% projection boost when a WR/TE teammate is out no longer applies to Receiving
Yards and Receptions (task 4 found redistributed targets no better than leaving shares alone).
Rushing and Rush+Rec keep it. Task 1's gate, run anyway (`gateTeammateBoost.ts`): ESPN's report was
never stored for old props, so "teammate out" is reconstructed from nflverse weekly rosters, picking
the definition whose firing rate is closest to production's (40 of 73 stored receiving picks, 55%):

| Reconstruction | Fires on | Skill vs market with → without | Log-loss without − with, affected props |
| --- | --- | --- | --- |
| **inactive only (used)** | 70% | 0.033% → 0.033% | 0.00000 (−0.00046 to +0.00045), n=568 |
| inactive or reserve, played in last 4 | 79% | 0.032% → 0.033% | −0.00001 (−0.00045 to +0.00048), n=640 |
| inactive or reserve | 100% | 0.023% → 0.033% | −0.00006 (−0.00045 to +0.00031), n=808 |

**No change** on 808 primary-sample receiving props (33 games) — expected, since the boost moves only
the model's small share of a market-dominated blend. Removed on the evidence from task 4, not this gate.

## Results so far

- **Baseline-v0** (model run walk-forward from nflverse game logs, no context): skill vs market
  −0.01% (−0.23% to +0.19%) on 1,238 props. The baseline *is* the market.
- **CLV**, once entry and close are read at the same line: +0.07 pts over 91 picks (it read +0.45
  while Underdog line changes were being counted as market movement).
- **Books at the Underdog line**: calibration error 1.2 pts within a point of the books' lines;
  beyond them only 17 props so far — too few to judge.

Reproduce with `npm run research:skill`.
