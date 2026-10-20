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
| 4 | Vacated-volume redistribution on injury-report changes | Kept — a news-timing edge, not a player-layer one |
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

## Results so far

- **Baseline-v0** (model run walk-forward from nflverse game logs, no context): skill vs market
  −0.01% (−0.23% to +0.19%) on 1,238 props. The baseline *is* the market.
- **CLV**, once entry and close are read at the same line: +0.07 pts over 91 picks (it read +0.45
  while Underdog line changes were being counted as market movement).
- **Books at the Underdog line**: calibration error 1.2 pts within a point of the books' lines;
  beyond them only 17 props so far — too few to judge.

Reproduce with `npm run research:skill`.
