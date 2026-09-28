# NFL Gameday — the weekly routine

Everything needed to go from "there's a game tonight" to a slip, without asking anyone.
Read the [Decision rules](#decision-rules) at least once; the rest is mechanical.

---

## Quick checklist

1. `npm run dev` → open **localhost:3000/nfl**
2. **Load game context (free)**
3. **Fetch props** — confirm the credit estimate
4. **Re-rank picks (free)**
5. **Enter your pick'em lines and each pick's Payout** ← the step that matters most
6. Mark anything missing as **Not offered?**
7. Build a slip only from picks where **Books** is green — or pass
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

The board keeps the day's **top 10**, so a whole game — usually the night game — can miss it. Don't
re-rank to get it back once games have started; open that game's card and use **All props in this
game (free)** instead. It scores the game's props (already fetched, no credits) and **Add** puts any
one of them on the board, leaving every other pick alone. A re-rank now keeps closing lines and any
pick you took or put in a slip, but it still rebuilds the rest of the board.

### 5. Enter your pick'em lines ⚠️

Open **Enter your pick'em lines** and type the number Underdog actually posts for each pick.

**This is the highest-value step in the whole routine.** Picks are scored against the *sportsbook*
line until you do it. If Underdog posts something different, the model is answering the wrong
question. This is how the James Cook edge was found — 100.5 on Underdog against 102 at the book —
and it hit.

The **Edge** column updates as you type. Positive means Underdog is offering a softer number than
the books, which is the edge actually worth having.

**Also enter each pick's Payout** — the multiplier Underdog shows for that pick (e.g. `1.71`). A
standard pick pays **1.87×**; Underdog pays less for a side it rates likely and more for one it rates
unlikely. Leave it blank for a standard pick.

**Needs** is then `1 ÷ payout` — the hit rate that pick must reach to be worth taking — green when
the model clears it, red when it doesn't. Real example from 2026-09-27: Kyren Williams Lower 2.5
receptions paid 1.55×, so it needed **64.5%**; the model gave it 55%. It *looked* like a solid pick
and was the worst leg on the slip. Picks priced too short for their probability drop out of the
suggested slips automatically.

**Then read the Books column — this is the one that decides.** It's the sportsbooks' own
probability for that side at your line. When it's **green**, the books already say the pick beats
Underdog's price: Underdog has mispriced it relative to the sharp market, and that edge doesn't
depend on the model being right. When it's red, the books say you're paying too much.

Why the books and not the model: on the first 40 settled picks the model's own probabilities scored
**worse** than the market's, and every pick it rated 8+ points above the market came from
double-counted context (fixed in model v1.5.0). On 2026-09-27 not one pick on the board was green —
the best was Parkinson at exactly break-even — and both slips lost. **Most weeks few or none will be
green. That is the honest answer, not a bug.**

### 6. Mark anything that isn't there

If a recommended prop doesn't exist on Underdog, click **Not offered?** on that row.

It greys out, drops from slip suggestions, and — after the same market comes up empty 8 times — the
app tells you to stop fetching that market and how many credits it's wasting. Props are pulled from
a sportsbook feed, which carries markets pick'em sites don't, so this will keep happening until the
data says which markets to drop.

Entering a line already records the prop as available. You only ever click for the missing ones.

### 7. Build the slip

The **Suggested slips** panel builds slips only from picks the **books** say beat their price (the
default, "The books"). If nothing qualifies it says so — **passing is the +EV play** that week. A
"The model" switch shows model-based slips for comparison, with a warning; don't mistake them for an
edge. Each slip's multiplier
is the product of its picks' payouts. **Same-game slips pay a little under that product** (we've seen
1–7%), so type in the total Underdog shows before saving. See [Slip size](#slip-size).

Tick **I actually placed this slip on Underdog** if you really bet it. Untracked bets are why the
"picks I took" numbers stay thin.

### 8. Closing lines and results — automatic now

**You don't need to do anything.** Closing lines are captured automatically 20–60 minutes before
each kickoff, once per game, by two schedulers that share a lock so they never pay twice:

| | Runs when | Days |
|---|---|---|
| Background job (launchd) | Mac is awake, even with the app closed | Sun, Mon, Tue, Thu, Fri |
| In-app scheduler | The app (`npm run dev`) is running | every day |

The same two schedulers also **settle finished picks** (free, ESPN box scores): a pick becomes
eligible 3½ hours after kickoff, is retried every 30 minutes until ESPN marks the game final, and any
slip it's in settles with it. Tue and Fri are on the schedule for the mornings after the Monday and
Thursday games. A pick ESPN still can't grade after 3 days (usually a name mismatch) is left for the
Results page, and the log says so.

Each check costs nothing unless a game with uncaptured picks is actually due. A capture buys only
the games your picks are in, only the markets they use, and **each game at most once** — typically
1–3 credits per game. (The first version re-bought games it had already done and wasted ~130 credits
on 2026-09-27; that is fixed and was verified live the same night: 3 picks, 1 game, 1 credit.)

**The one requirement: your Mac has to be awake at kickoff.** A sleeping Mac runs neither.

Check it worked: `logs/auto-capture.log` shows a line per run, and captured picks appear under
**Analytics → Model quality → Closing Line Value**. The manual button on the NFL page still works
as a backup.

Why it matters: it compares the market's implied probability when you took the pick against where
the market closed. That converges in *dozens* of bets; win rate takes **thousands**.

---

## Decision rules

### Slip size

**Underdog prices each pick and pays the product.** Confirmed from real entries: three standard picks
at 1.87× each showed as 6.5× (1.87³ = 6.54), and two standard picks are 3.5× (1.87²).

That means **every leg has to beat its own price, whatever the slip size** — `1 ÷ payout`:

| Payout | Needs |
|---|---|
| 1.55× (heavy favourite) | 64.5% |
| 1.71× | 58.5% |
| **1.87× (standard)** | **53.5%** |
| 2.00× | 50.0% |

So size is a question of **how many picks genuinely clear their Needs**, not a bar that changes with
size. Two good legs beat three where the third is marginal. More legs means more variance, not a
lower bar.

> The old "never play 4 legs" rule is **retired**. It came from a fixed 3× / 6× / 10× / 20× ladder,
> where the 4-leg rung was a bad deal. Underdog's per-pick pricing has no such hole.

### Stacking a QB with his own receiver

If the board offers a quarterback's passing prop and one of his own receivers **on the same side**,
that pairing is worth taking. Their outcomes are correlated at **+0.34** (measured, n=3,620). That
lifts the chance both land by roughly 15% relative, while Underdog only trims same-game entries by a
few percent — so the stack still comes out ahead.

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
- A player who doesn't play **voids that leg** and the entry pays on the rest — which argues for
  entering late.

With per-pick pricing a void just removes that leg's payout from the product:

| Standard picks at 56% each | EV |
|---|---|
| 3-leg | **+14.8%** |
| 2-leg (what a void leaves) | **+9.7%** |

**One voided leg costs about 5 points of EV.** (An earlier version of this page said 11, which was
true under the old fixed 6× → 3× ladder, not under per-pick pricing.) Hunting early lines gains about
**0.27 points** — across 42 entered lines Underdog was softer only twice and *tougher* four times —
so void risk above roughly 5% erases it. Healthy starters sit near that line; anyone with a
questionable tag is well past it. Late is still the default, by a smaller margin than it used to be.

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
