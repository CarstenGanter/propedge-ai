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
| 3 | Venue-gap and dispersion features in σ units, staleness flags | In progress |
| 3b | Consensus σ for reading the books at another line (inserted after 3) | Next — gated on task 1's metric |
| 4 | Vacated-volume redistribution on injury-report changes | Kept — a news-timing edge, not a player-layer one |
| 5 | Team volume model | Open |
| 6 | Opportunity shares (EB-shrunk EWMA) | **Deferred** |
| 7 | Opponent effect on per-opportunity efficiency | **Deferred** |
| 8 | Game simulator | Kept, **scoped to leg correlation for slips** |
| 9 | Learned market weight per prop type | Open |
| 10 | Alt-ladder audit | Open (feeds 3b) |
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

## Results so far

- **Baseline-v0** (model run walk-forward from nflverse game logs, no context): skill vs market
  −0.01% (−0.23% to +0.19%) on 1,238 props. The baseline *is* the market.
- **CLV**, once entry and close are read at the same line: +0.07 pts over 91 picks (it read +0.45
  while Underdog line changes were being counted as market movement).
- **Books at the Underdog line**: calibration error 1.2 pts within a point of the books' lines;
  beyond them only 17 props so far — too few to judge.

Reproduce with `npm run research:skill`.
