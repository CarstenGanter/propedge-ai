# NFL Gameday — the weekly routine

Everything needed to go from "there's a game tonight" to a slip, without asking anyone.
Read the [Decision rules](#decision-rules) at least once; the rest is mechanical.

---

## Quick checklist

1. `npm run dev` → open **localhost:3000/nfl**
2. **Load game context (free)**
3. **Fetch props** — confirm the credit estimate
4. **Re-rank picks (free)**
5. **Enter your pick'em lines and Payout × tags** ← the step that matters most
6. Mark anything missing as **Not offered?**
7. Build a **3-leg** slip (never 4)
8. Tick **I actually placed this slip** before saving
9. Leave your Mac awake at kickoff — closing lines capture themselves

---

## Step by step

### 1. Start the app

```bash
npm run dev
```

Open **localhost:3000/nfl**. It resolves to the next slate on its own — you should not need to
pick a date. The header shows the week, the game count, and your remaining Odds API credits.

### 2. Load game context — free

Click **Load game context (free)**.

Pulls injury reports, the DraftKings spread/total, venue and weather from ESPN and Open-Meteo.
Costs **zero credits**, so there is never a reason to skip or delay it.

Weather is only fetched for outdoor stadiums. A dome showing no weather data is correct, not a bug.

### 3. Fetch props — costs credits

Click **Fetch props**. The estimate appears *before* you confirm:

> `N games × 6 markets = N×6 credits`

**Roughly 6 credits per game.** A single Thursday or Monday game is ~6; a full Sunday slate is ~90.
You have 500 per month. The floor setting (25) stops a fetch that would leave you too low.

### 4. Re-rank — free

Click **Re-rank picks (free)**. Scores every stored prop and builds the board. No credits, so run it
again any time you change a line.

### 5. Enter your pick'em lines ⚠️

Open **Enter your pick'em lines** and type the number Underdog actually posts for each pick.

**This is the highest-value step in the whole routine.** Picks are scored against the *sportsbook*
line until you do it. If Underdog posts something different, the model is answering the wrong
question. This is how the James Cook edge was found — 100.5 on Underdog against 102 at the book —
and it hit.

The **Edge** column updates as you type. Positive means Underdog is offering a softer number than
the books, which is the edge actually worth having.

**Also enter the Payout × tag** — the small multiplier Underdog shows under a pick (e.g. `0.85x` on a
side it rates likely, `1.2x` on one it rates unlikely). Leave it blank for standard. It multiplies
the whole entry's payout, so the **Needs** column then shows what each pick must hit to earn a place
on a 3-leg slip — green when the model clears it, red when it doesn't. A 65% pick tagged 0.85× needs
64.7%, which is why the strongest-looking picks are often barely worth taking. Slips are ranked on
this value, not raw probability, once tags are in.

### 6. Mark anything that isn't there

If a recommended prop doesn't exist on Underdog, click **Not offered?** on that row.

It greys out, drops from slip suggestions, and — after the same market comes up empty 8 times — the
app tells you to stop fetching that market and how many credits it's wasting. Props are pulled from
a sportsbook feed, which carries markets pick'em sites don't, so this will keep happening until the
data says which markets to drop.

Entering a line already records the prop as available. You only ever click for the missing ones.

### 7. Build the slip

The **Suggested slips** panel shows a break-even ladder up top. Pick your size from
[the rules below](#slip-size), then **Save slip**.

Tick **I actually placed this slip on Underdog** if you really bet it. Untracked bets are why the
"picks I took" numbers stay thin.

### 8. Closing lines — automatic now

**You don't need to do anything.** Closing lines are captured automatically 20–60 minutes before
each kickoff, once per game, by two schedulers that share a lock so they never pay twice:

| | Runs when | Days |
|---|---|---|
| Background job (launchd) | Mac is awake, even with the app closed | Sun, Mon, Thu |
| In-app scheduler | The app (`npm run dev`) is running | every day |

Each check costs nothing unless a game with uncaptured picks is actually due; the capture itself
costs the same ~6 credits per game as doing it by hand.

**The one requirement: your Mac has to be awake at kickoff.** A sleeping Mac runs neither.

Check it worked: `logs/auto-capture.log` shows a line per run, and captured picks appear under
**Analytics → Model quality → Closing Line Value**. The manual button on the NFL page still works
as a backup.

Why it matters: it compares the market's implied probability when you took the pick against where
the market closed. That converges in *dozens* of bets; win rate takes **thousands**.

---

## Decision rules

### Slip size

Break-even per leg is `multiplier^(-1/legs)` — exact, and depends on nothing but the multiplier.

| Legs | Multiplier | Break-even per leg | |
|---|---|---|---|
| 2 | 3× | 57.7% | worst size |
| **3** | **6×** | **55.0%** | **default** |
| 4 | 10× | 56.2% | **never** |
| 5 | 20× | 54.9% | lowest bar |

**Never play 4 legs.** The 4-leg tier asks more per leg than either 3 or 5. The 3rd leg you add
needs 50% to earn its place, the 5th needs 50% — but the 4th needs **60%**.

> ⚠️ The app assumes 2-leg = 3×. Several sources say Underdog now pays **3.5×**, which would drop the
> 2-leg bar to 53.5%. Underdog's payout pages block automated checking. **Read the multiplier in the
> app** — it's also the only place per-pick boosts and discounts show up.

### Stacking a QB with his own receiver

If the board offers a quarterback's passing prop and one of his own receivers **on the same side**,
that pairing is worth taking. Their outcomes are correlated at **+0.34** (measured, n=3,620), and the
fixed multiplier prices them as if independent — so it raises the odds the whole slip lands for free.

The builder now seeks these automatically and marks them **green** with the uplift shown. Green is
good. It is not a warning.

Legal on Underdog as long as some other leg comes from a different team, which the builder enforces.

Two things that are **not** correlated and need no thought: receivers who share a quarterback
(+0.003), and legs from two different games (−0.002).

### When to enter your picks

**Night games (Thu / Sun / Mon):** late afternoon, **3–5 hours before kickoff**.
**Sunday 1pm slate:** **Sunday morning, 10–11 AM ET**.
**Never before Friday** for a Sunday game.

Two Underdog rules set up the trade-off:

- Your pick **locks at the number you submitted**. Later line moves never touch you — which argues
  for entering early.
- A player who doesn't play **voids that leg and recalculates the entry at the lower payout**. A
  3-leg at 6× becomes a 2-leg at 3× — which argues for entering late.

The second one wins, by a lot:

| | EV at 56% per leg |
|---|---|
| 3-leg @ 6× | **+5.4%** |
| 2-leg @ 3× (what a void leaves) | **−5.9%** |

**One voided leg costs 11.3 points of EV.** Catching a softer line on one leg is worth about 5.6
points — but across 42 entered lines Underdog was softer only twice (and *tougher* four times), so
the expected gain from hunting early lines is about **0.27 points**. Void risk above roughly 2.4%
erases it, and a single questionable tag carries far more than that.

Entering late also makes the picks themselves better: ESPN game injury reports fill in Wednesday
through Sunday, so a Wednesday pick is scored on less information.

Don't cut it too fine either. Entering 20 minutes before kickoff leaves no line movement to measure,
so closing-line value reads zero and you learn nothing that week.

**The one exception is opportunistic.** Browsing Underdog is free. If you happen to see an obviously
stale number, take it — that's a divergence event. Just don't go hunting on a schedule for something
that appears 5% of the time.

> Caveat: every line ever entered here was entered close to game time, so there are **no observations
> of Underdog's early-week numbers**. "Early lines aren't softer" is an inference, not a measurement.

### When to skip

**Skip whenever the board is thin.** A one-game slate often can't produce three picks worth
defending. Reaching for a third leg you don't believe in is exactly how the multiplier wins.

No bet is a free option. There is always next week.

### Weather

Only matters for **outdoor** stadiums with **wind ≥ 15 mph**. At that threshold unders on game
totals historically hit ~57%, but forecasts verify only about 21% of the time at one day out, so most
of that edge is gone by the time you can act on it.

Temperature is **dead** — no usable pattern, including in freezing games. Don't fade a cold game.

Domes: weather never applies. SoFi and Lambeau both look "outdoor" in some feeds; the app's own
stadium table is the authority.

---

## Reading the numbers honestly

**Break-even is exact.** It comes from the multiplier alone. Trust it.

**Expected value is not.** It leans on the confidence score as though it were a probability. Use it to
rank slips against each other, never as a promised return. When the model claims more than 62% per
leg the app greys it out and says so — prop markets aren't loose enough for an edge that size.

**Your record proves nothing yet.** The NFL board is 22-15 (59.5%), and the 95% range runs 43.5% to
73.7% — which contains both a real edge and a coin flip. At a genuine 56% per-leg rate it takes on the
order of a *thousand* 3-leg slips to tell skill from luck. This is why closing-line value matters.

**Confidence score is unproven.** On NFL picks there's no detectable relationship between the score
and outcomes in either direction. It isn't noise-free ranking — treat it as a suggestion.

---

## Credits

- **~6 per game** per prop fetch (6 markets × 1 game)
- **~6 per game** again if you capture closing lines with **+ props**
- Full Sunday ≈ 90; Thursday or Monday ≈ 6
- **500/month.** Non-game days cost nothing — the daily job skips them.
- Check remaining in the `/nfl` header. Floor is 25.

Free forever: ESPN schedule, box scores, injuries, gamelogs; Open-Meteo weather; nflverse stats;
loading game context; re-ranking.

---

## Troubleshooting

**Project location**

The project lives in `~/Code/propedge-ai`. The old Documents path still works (it's a link), but
open the new one in VS Code. Background jobs can't run from Documents, Desktop or Downloads.

**Closing lines didn't capture**

Check `logs/auto-capture.log`. If the background job stopped after a node upgrade, re-run:
```bash
zsh scripts/install-auto-capture.sh
```
Late-season Saturday games are covered by the in-app scheduler only (app must be running), unless
you add Saturday (`6`) to `DAYS` in that script.

**Site won't load / connection refused**
```bash
npm run dev
```

**Every page 500s, usually right after I changed the schema**

A migration stales the running dev server's Prisma client. Restart it:
```bash
pkill -f "next dev" && npm run dev
```

**`/nfl` shows no games**

Use **Next slate**. The schedule comes from ESPN and costs nothing. If a real game is missing, the
date is probably being read in the wrong timezone — slates are keyed to **Eastern**, so a Sunday night
game stays on Sunday.

**Fetch button is disabled**

Either no `ODDS_API_KEY` in `.env`, or the estimate would take you below the credit floor.

**Picks look wrong / stale after changing a line**

Click **Re-rank picks (free)**. Costs nothing.

---

## Health check

```bash
npm test          # should be all green
npx tsc --noEmit  # should print nothing
```

Settings that should stay as they are: scoring profile **distribution**, sports **NFL only**, demo
mode **off**, web research **on**.
