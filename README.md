# UDRA Training Program Generator

Client-side React app that generates strength-training programs from the JSON data in
`public/data/`. No backend, no router, no auth.

Two views, switched from the header and persisted in the URL (`?view=…`):

- **Simple** (default) — client controls run horizontally across the top of a centred
  page, with the program underneath as day cards in a responsive grid (1 / 2 / 3 columns).
  The table carries exercise, sets × reps and rest only. Fallback warnings, the audit
  panel, allocation keys, per-day set totals and the time-ceiling flag are all hidden. The
  reduced-days notice is **not** hidden: it is a real outcome the client has to see.
- **Detailed** — everything above plus the volume audit, the warning banner, muscle group /
  sub-region / equipment columns, REUSED and SUB flags, and the allocation key. This is the
  test-harness view, and the one the acceptance criteria below describe.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run acceptance   # headless run of the acceptance criteria (below)
npm run build        # tsc -b && vite build
```

Vite + React 19 + TypeScript + Tailwind v4.

## Deploying to GitHub Pages

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds and publishes on every
push to `main`. It runs `npm run acceptance` before `npm run build`, so a regression in the
generator fails the deploy instead of shipping.

`vite.config.ts` sets `base: './'`, so the build works at
`https://<user>.github.io/<repo>/` **whatever the repo is called** — no repo name is
hardcoded anywhere. Verified by serving the production build from a subpath.

To publish:

1. Create an empty repo on GitHub (no README, no .gitignore — this repo already has both).
2. `git remote add origin https://github.com/<user>/<repo>.git && git push -u origin main`
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The push triggers the workflow; the URL appears under Actions once the deploy job finishes.

**Everything in `public/data/` becomes publicly downloadable** — all eleven JSON files,
including the 3 MB `allocation.json`. It's a static site, so the browser has to be able to
fetch them; there is no way to publish this and keep the data private. GitHub Pages on a
free account also requires a **public repo**. If either matters, this needs a host with
access control rather than Pages.

## Data

Eleven files in `public/data/`, served as static assets and fetched once at startup:

| File | What it is |
|---|---|
| `config.json` | vocabularies (goals, levels, ages, splits, groups) and constants |
| `allocation.json` | ~3 MB pre-computed skeleton, 2,205 blocks keyed `{split}\|{goal}\|{age}\|{level}\|{days}` |
| `exercises.json` | 315 exercises |
| `prescription.json` | reps/rest keyed `{sex}\|{days}\|{age}\|{level}` then by goal |
| `splits.json` | split badges keyed `{goal}\|{days}\|{level}\|{split}` (age 18-29 only) |
| `injury.json` | 18 pains, their rules, load-tag glossary, per-exercise injury records, and UI copy |
| `structure.json` | joints and antagonists per sub-region, plus the timing, rest and load constants |
| `inbody.json` | scan thresholds, the 8 pre-blended goal vectors, rest floors, region map and filler rules |
| `vald.json` | 6 asymmetry brackets, the 17 tests with their library coverage, and the budget/conversion rules |
| `bodydot.json` | 26 posture indicators with their bands, and 18 arsenal entries covering 13 of them, pre-resolved to library ids |
| `load.json` | 17 newtons-to-kilograms constants, 17 anchors, 30 bridges, and a pre-computed class/modifier/laterality record for all 315 exercises |

They are generated upstream and are **not modified** by this app. `loadData()` in
[src/data/load.ts](src/data/load.ts) caches the fetch promise at module scope, so
`allocation.json` is fetched and parsed exactly once per page load regardless of renders.

Client state and the view mode are mirrored into the query string, so any program is a
linkable regression case: `?preset=Stress%20test&view=detailed`, or
`?sex=Male&age=28&level=Intermediate&…`. Pains ride along too, and layer on top of a preset:
`?preset=Reference&pains=SHOULDER:Left,LOWBACK:Both`. So does a scan —
`?inbody=example` loads the spec's worked client, or pass the values as
`?inbody=smm:30.1,pbf:26.4,…`. VALD readings too, with all four fields positional and optional —
`?vald=Q-KD:25:L:400:380` is percentage, weak side, left newtons and right newtons, and
`?vald=Q-KD:::400:380` is forces only. And posture readings, with the side on the
lateral indicators: `?bodydot=S02:60,F05:6:L`.

## Layout

- [src/lib/generate.ts](src/lib/generate.ts) — age bracketing, key building, eligibility,
  ranking, the fallback cascade, session minutes.
- [src/lib/audit.ts](src/lib/audit.ts) — volume audit, recomputed from the chosen
  exercises rather than read from the allocation's `delivered` field.
- [src/lib/presets.ts](src/lib/presets.ts) — the five regression presets.
- [scripts/acceptance.ts](scripts/acceptance.ts) — headless assertions over the same code.

## Injury / pain filter

The first rule layer on top of the base generator. It wraps the pipeline rather than
changing it: allocation lookup, sets, reps, rest and volume targets are untouched — the
layer only changes **which exercises fill the slots**.

[src/lib/injury.ts](src/lib/injury.ts) is the verdict engine. For each exercise × ticked
pain it evaluates five rules **in order, first match wins**: PRIORITY (in a priority
sub-region *and* flagged corrective), REMOVE (removed sub-region or removed load tag),
SIDE_ONLY (a removal that survives on the pain-free side — sided pain, one side picked,
unilateral exercise), CAUTION (cautioned sub-region, cautioned load tag, or a secondary
muscle landing in a removed/cautioned sub-region), then OK.

Across pains: **any REMOVE wins outright**, then PRIORITY, SIDE_ONLY, CAUTION, OK. A
PRIORITY from one pain never resurrects what another pain removed. (`injury.json`'s
`precedence` array lists PRIORITY first; the written rule takes precedence, since it states
the REMOVE case explicitly.)

Verdicts are **computed, never tabulated** — the library has already grown 307 → 315 once.
`injury.exercises` joins to `exercises.json` on `id`, never on sub-region text, because the
two files spell eight sub-regions differently (`Chest > Mid` vs `Mid (flat)`).

In the pipeline: REMOVE leaves the candidate pool before selection; PRIORITY sorts ahead of
the tier ranking within a sub-region and opens the session; SIDE_ONLY and CAUTION stay in
and are badged. Emptied slots reuse the **existing** fallback cascade — no second mechanism
— but a slot lost to pain is labelled as a removal ("removed because you reported low back
pain"), never as "no eligible exercise found". `injury.json`'s `reroute` table was used to
understand which sub-regions empty, not to route anything.

## Structure (straight / superset / triset)

Second rule layer. It changes **how** the client performs the program, never what the
program is: one setting for the whole program, volume held exactly, nothing ever blocked.
Every structure is selectable; a structure is RECOMMENDED or AVAILABLE, never refused.

[src/lib/structure.ts](src/lib/structure.ts) forms blocks in two passes — anchor every
block on a genuine **antagonist** pair first, across the whole session, then a second pass
on any legal reason, each block filled to size before the next begins. Both details matter:
a single greedy pass lets a merely non-competing partner take a slot an antagonist pair
needed, and pairing everything before growing to three consumes every candidate so trisets
never form.

Rejections are checked before reasons: protected main lifts (Get Stronger), two compounds
sharing a joint, synergists, and correctives (which pair only with correctives).

**The time model replaces the old `repsMid * 3 + restMid` formula everywhere**, per the
spec. Rest is taken once per round for paired work, which is the only reading where a rest
multiplier of 1.00 still produces a real time saving. Where a block's exercises carry
different set counts the block runs for the longest of them, so `sets` is the max across
the block.

### One bug this layer surfaced

The synergist rule compares an exercise's `alsoTrains` against the other's `sub` — but
`alsoTrains` uses the **injury library's** spelling for eight sub-regions while `sub` uses
the skeleton's. A literal string compare therefore missed the spec's own worked example:
`Standing overhead press` lists `Lateral-medial (lockout)` while the pushdown's `sub` is
`Lateral / medial (lockout)`, so the pair came back *non-competing* and would have been
supersetted. Fixed by building an exact alias map from the two files **joined on `id`** — no
fuzzy matching — and both spellings are now checked. The first version of the acceptance
test repeated the same broken comparison and passed for the wrong reason; it now asserts
that named pair directly. Superset coverage on the Reference client dropped from 80% to
**75%** once the rule actually fired.

### Expected behaviour, confirmed

- **Triset is best-effort.** 45% of the Reference client's exercises land in a true triset;
  the rest come out as pairs because no legal third exists. The selector says *"triset where
  legal"*, and a two-exercise block is labelled `superset` even when triset is selected —
  calling it a triset would be untrue.
- **Bench press and row do not pair.** Both are compounds sharing shoulder and elbow, so the
  second rejection fires. This follows the spec verbatim and is asserted by name.
- **The three structures produce similar times for a Lose Fat client** — pairing saves the
  rest you compress, and a fat-loss client resting 30–45 s has little to compress.
- The **New client** preset now defaults to `superset`, since that is `recommendedDefault`
  for Lose Fat; every other preset defaults to `straight`.

## InBody

Third rule layer. It reads a body-composition scan and shifts the program's **values** —
volume, reps, rest, load — and forces a faster structure on body regions carrying high fat.

**The golden rule holds: InBody never changes the requested frequency, the split, the slot
count, or which exercises are selected.** `allocation.json` is still looked up with the
client's *stated* goal; the blend only changes what fills those slots. Asserted across every
preset × four scans.

[src/lib/inbody.ts](src/lib/inbody.ts) applies the ten steps in order. The state space is
factorised, not tabulated — 8 goal vectors × independent modifiers, no 2,187-row lookup.
Sets are solved iteratively against the same delivered calculation the volume audit uses, so
the blended weekly target and the audit agree by construction.

Everything that fires gets a visible line in the panel: what was measured, what changed, and
that it is overridable.

### Three consequences worth knowing

- **A main lift can be prescribed at 1 set.** On the worked example, Lower back has a
  blended target of 5 sets but picks up **3.9 sets of indirect credit** from other
  exercises' `alsoTrains`. With one slot, step 4 solves (5 − 3.9) / 1 = 1.1 → **1 set**, and
  that slot happens to be Rack pull. This follows step 4 verbatim: the solver treats indirect
  credit as fungible with direct work, and the golden rule forbids adding a slot to spread
  the load. Flagged rather than special-cased, since capping it would mean overshooting the
  blended target.
- **Volume undershoots where the sets clamp binds.** Glutes & hips wants 11.5 weekly sets
  but has one slot, and sets are capped at the blended range's top (4.4), so it delivers
  7.2. Again structural: InBody cannot add slots.
- **Rest often looks untouched.** For the worked example the 120s floor absorbs both the
  rule-4 × 0.75 multiplier and the ×1.15 hydration multiplier. Correct, not a bug — a floor
  is never blended.

### Readings the spec left open

1. **Hysteresis needs a previous scan.** The 2% band widens what a value must cross to leave
   an established state; with no scan history stored, a first scan classifies directly. The
   comparison is implemented and honoured whenever a previous state is supplied.
2. **The step 5 floor.** "Re-apply every floor" is read as the blended sets range's lower
   bound, which is what makes the cut "frequently cancelled" as the spec predicts. A group
   already below that bound keeps its own value — a volume *cut* must never push a group
   upward.
3. **Rule-4 load.** A rule-4 slot takes `rule4.loadAdjustment` (−3%) whether or not a legal
   partner was found for it, since the structure is forced by instruction. That is what makes
   the worked example's "rule-4 superset slot −3%" hold even where pairing failed.
4. **Split re-badging** uses the dominant blended goal, and the panel says so when it differs
   from the stated goal.

## VALD DynaMo

Fourth rule layer, and it does one thing: **it adds sets to the weak side.** It never
changes the goal, the split, the frequency, the slot count, or the strong side's volume.

The golden rule drives the whole selection half: **a bilateral exercise cannot carry a
one-side-only set.** A barbell squat or a fixed bilateral machine is skipped — physics, not
policy. Step 5 resolves each bumped slot in strict order: already unilateral → swap in a
native unilateral with the same `code` → convert a convertible exercise → skip. **A main
lift is never swapped and never converted, for any goal.**

Input is per test: an asymmetry percentage **and which side is weak**, stored per test, so
one client can be left-weak on one test and right-weak on another.

Allocation is two passes with **four counters that persist across both** — the weekly
budget per tested sub-region, sets per slot, extra sets per session, and which findings
took their pass-1 reservation. Ordering is fixed and total (severity → asymmetry → canonical
sub-region → session order → last matching slot backwards), so two runs on the same input
are byte-identical. Matching is on `exercise.code === test.code`; `alsoTrains` plays no part.

Volume is tracked per side from here: the audit carries `leftDelivered` and `rightDelivered`
and they diverge as soon as a finding fires.

### Readings and consequences

- **`SESSION_CAP` is read as the goal's time ceiling** — the app's only per-session ceiling.
  Extra weak-side sets count against it in full, and the budget is kept for a later session
  when they would breach it.
- **The strong side keeps its DIRECT volume exactly.** Total volume can move up to **1.8
  sets** because step 5's swap replaces the exercise with a one-sided version of the same
  movement, and the replacement carries its own `alsoTrains` — so indirect credit into
  *other* groups shifts. Same phenomenon the Stage 1 week-rotation check exposed.
- **The pass-1 reservation can no longer be starved by budget.** With the confirmed change
  to a per-**sub-region** budget, and all 17 primaries distinct, two findings never share a
  budget. Pass 1 still matters for the session ceiling, and is still implemented and
  asserted. On the three-glute test G-EXT is the one that goes unserved — because its only
  matching slot is a bilateral main lift, not because the budget ran out.

## VALD inputs — four fields, not two

The panel collects **asymmetry %**, **weak side**, **left newtons** and **right newtons** per
test. All four are independent and all optional. The API supplies the percentage and the raw
forces separately, so **neither is ever derived from the other while both are present** — the
machine's own figure wins. Percentages alone drive VALD with Load sitting at *not estimated*;
forces alone derive the percentage and the weak side as a fallback and everything works.

Independent fields can contradict each other, and the two contradictions are handled
differently on purpose:

- **The percentage disagrees with the forces.** Compared against
  `(stronger − weaker) / stronger × 100`; more than 1 percentage point apart earns a quiet
  amber flag and **the entered percentage is still used.** Reports round, so small gaps are
  normal and this is deliberately not an error.
- **The weak side disagrees with the forces.** The entry says left is weak but the right
  force is lower. **The finding is blocked, not warned** — no sets are added and, because the
  same reading feeds both layers, no weight is estimated from that test either. Acting on it
  would send the extra sets to the wrong limb *and* prescribe each side the wrong weight, and
  nothing downstream would catch either. The panel names both conflicting fields and their
  values. There is a check asserting the same reading with the sides in agreement *does* fire,
  so this is provably a block rather than a silent no-op.

## Load (weight)

The last rule layer, and a pure annotation: it reads the force figures and attaches a working
weight to exercises that already exist. It changes no selection, sets, reps, rest or timing —
the program with forces entered is byte-identical to the one without.

```
load_kg = (newtons / 9.80665) x k[test] x classRatio[class] x modifier
          x laterality x correctionFactor,   then banded by confidence tier
```

Every per-exercise field — class, modifier, laterality, per-hand and anchor status — is
pre-computed for all 315 exercises and is **never re-derived from names or equipment.**
`isAnchor` alone decides MATCHED vs DERIVED.

The reference is kept **per limb** from the first step to the last. A unilateral exercise gets
a load for each side from that side's own reading; a bilateral one is prescribed from the
**weaker** limb, so the number is never heavier than the weak side can carry.

**The band width is the message.** A 60-100 kg bench next to a 42.5-52.5 kg pushdown tells a
coach which number to trust without a word of explanation, so a band is never narrowed to look
more confident and the midpoint is never shown as a target. Every panel carries *"start at the
lower end and work up."*

Four states produce no number, and each says what to do instead rather than falling back to a
tier label: age 6-12 (*"no load at this age"*, absolute, at any tier), `BODYWEIGHT`
(*"reps / RIR"*), `ISOMETRIC_CARRY` (*"time"*), and tier `NONE` (*"not estimated"* — a
designed state, not a failure). Injury outranks the layer completely: a `CAUTION` verdict is
prescribed at **the bottom of the range only** and the range itself is withheld.

### Readings the spec left open

- **"Free-weight compound" is the one field load.json does not ship.** The 0.85 cap is about
  stabilisation demand, so it applies where the lifter carries the load rather than a frame
  guiding it — an exercise qualifies if any equipment option is a free weight (BB, DB, KB, EZ,
  plate, trap bar, weighted, DB between feet, DB on knees). Smith is guided and is not on that
  list, but "BB / Smith" still qualifies through the barbell. Both worked examples that
  exercise this rule land exactly on their published figures.
- **Order of operations in step 4-5**: band → beginner cut → per-hand halve → round. The
  worked example's Tate press lands on 12.5-20.0 kg only under that order; rounding before
  halving gives 12.5-21.25 kg.
- **`SIDE_ONLY` gets a normal prescription.** The spec groups it with `REMOVE` as "no load
  question", which reads as *this layer needs no special handling* rather than *withhold the
  weight* — a side-only exercise still has to be loaded. `REMOVE` needs nothing because the
  exercise is already out of the program.
- **BodyDot correctives are loaded too.** They are real library exercises with ids, so they
  take a weight on the same terms as anything else.

### Expect these, they are not bugs

- **The beginner cut inverts a MATCHED band.** That tier is ±10%, so cutting the top by 20%
  puts it at 0.88× against a bottom of 0.90× — the rule as written says the whole estimate sits
  above what a beginner should attempt. The bottom is left exactly where it is, as specified,
  and the top is held at the bottom rather than printed backwards; the cell says *beginner cap*
  and `flattened` records it. Only the 14 anchor exercises can hit this, and only for
  beginners. On DERIVED and BRIDGED the cut lands clear of the bottom and behaves normally.
- **Three sub-regions name an anchor that no exercise carries.** `anchors` names
  *"Leg extension, torso reclined"* for Q-KD, *"Standing cable oblique crunch"* for AC-ALF and
  *"Straight-arm pulldown"* for L-VERT, but all three of those exercises sit in a neighbouring
  sub-region (Q-STR, AC-OBL, L-STR) and none carries `isAnchor`. So nothing in Q-KD, AC-ALF or
  L-VERT can ever read *Measured*; they top out at *Estimated*. `isAnchor` is authoritative and
  the instruction is not to re-derive it, so this is reported in the panel and asserted in the
  suite rather than patched. Only **14 of 17** anchors are live.
- **With all 17 tests entered, 208 of 315 exercises still have no number.** Neck is deliberately
  unbridged — there is no defensible route from a limb dynamometer to neck loading — and the
  bodyweight and carry classes are excluded by design.
- **The numbers inherit the constants' error.** The 17 k values are seeds, not measurements.
  Every exercise carries a `correctionFactor`, currently 1.00 everywhere; nothing sets it yet.
  The hook is wired and asserted — setting it to `actual / estimated` scales that exercise's
  estimate and everything downstream self-corrects.

### Three deliberate divergences from the source spreadsheet

Each is pinned by a check, so a later "correction" back toward the sheet fails the suite:

1. **Hip Abduction and Hip Flexion have anchors**, where the source marks both
   *"NONE — no loadable exercise"*. Hip Abduction has 7 loadable options and Hip Flexion 2,
   taking two of seventeen tests from dead to working.
2. **Push-up and assisted pull-up are `BODYWEIGHT`.** A "weighted" equipment token made them
   read as loadable — the source's own worked example shows a push-up at 60-100 kg. An
   assistance machine's dial is counterweight, not load.
3. **Floor press and incline hex press are `COMPOUND`**, where the source's name-derived
   classifier called them `ISO_FREE`. Both are multi-joint presses and the library carries an
   explicit compound flag that classifier did not have.

## BodyDot posture

Fifth and last rule layer, and the only one in the stack that **adds slots**. It runs last,
after injury, InBody and VALD, and appends a corrective block to the end of every session.
It never touches the split, the selection, the sets, or anyone else's work — the main
program with a posture reading entered is byte-identical to the one without it.

26 indicators are measured across four views. 13 of them have a corrective protocol; the
other 13 are computed, displayed, and reported as *"measured, no protocol yet."*

**The side rule is the thing this layer is easiest to build backwards.** A left-hiked pelvis
is levelled by training the **right** side to hike; a right-abnormal Kendall Knee prescribes
work on the **left** leg. That is the opposite of VALD, where the side that tested weak is
the side that gets the work. Both conventions are live in the same program, and there is an
acceptance check that runs them together on one client and asserts they point opposite ways.
`{Side}` / `{side}` placeholders are filled from the **resolved** side, never the measured one,
and the panel shows the resolved side for exactly that reason.

Classification is on the **crossed edge**, low or high — not the arithmetic sign of the
reading — and that edge is what selects the arsenal entry. Bands in the file are adjacent
with both ends inclusive, so a value sitting exactly on a boundary takes the **milder** tier.

Allocation is the same two-pass shape as VALD, capped at **3 exercises per session, counting
exercises rather than findings** — one arsenal entry can list three. Pass 1 reserves one
exercise for each finding in rank order; pass 2 spends what is left while holding back a slot
for anything pass 1 could not serve. Without pass 1 a single three-exercise entry swallows
the whole cap and the second finding gets nothing. Ranking is abnormal before borderline,
then distance outside the band as a fraction of that indicator's full range (which is what
lets a reading in degrees be ranked against one in centimetres), then file order so two runs
agree exactly.

Stretches are **timed, not set-counted, and never consume a corrective slot.** They
accompany their block, so a finding that placed nothing brings no stretches with it.

Nothing is dropped silently: partially-placed blocks name the exercises that did not fit,
findings that can prescribe nothing say why, and the time trim reports every exercise it
removed and from which session.

### F06 (HKA) is deliberately not the source spreadsheet

Both F06 rows carry `correctedFromSource: true`. Negative is varus (bow-leg), positive is
valgus (knock-knee). The source arsenal prescribed adduction strengthening with an abductor
stretch on the **positive** edge — bow-leg treatment, which applied to a knock-kneed client
drives the knees further in. The shipped data has them swapped: above the band gets
**abduction** work and an **adductor** stretch, below the band the reverse. Two acceptance
checks pin both edges so a later "fix" back toward the spreadsheet fails the suite rather
than passing quietly.

### Readings the spec left open

- **"Program standard sets"** for a bilateral corrective is read as *the set count the rest
  of this program is already using* — the modal whole-number set count across the week,
  halves up, ties to the larger. A corrective has to be decisive, so it never inherits a
  fractional allocation value. On the reference client that is 4 sets.
- **The tier→exercise-count rule is stated only for the bilateral column**, so it is applied
  only there: borderline bilateral takes the first arsenal exercise, abnormal bilateral takes
  all. A **unilateral** finding takes the whole entry and varies its *sets* instead (+1
  borderline, +2 abnormal), which is what its column actually says.
- **Correctives are excluded from the volume audit and from `totalSets`**, matching how
  VALD's extra weak-side sets are already handled. They are added corrective work, not part
  of the muscle-group allocation, and folding them in would read as volume overshoot.
- **A corrective still has to clear the client's age, level and equipment screen** — the
  spec is silent, but precedence puts BodyDot last, so it does not get to override Stage 1's
  safety rules. Mobility is the one exemption: it is barred from the main pool by design, and
  as corrective work it is the point. Stretches carry no load, so only pain and available
  equipment can rule one out.
- **A mobility-type corrective is timed, never given reps** — `4 × 40s`. Note the time model
  already charges 40s of work per corrective set for *every* corrective, so this changes what
  is printed, not what the session costs. Chin tucks (id 123) are typed `isometric`, not
  `mobility`, so by the criterion as written they still get sets and reps; worth a look.

### Expect these, they are not bugs

- **7 of the 21 live edges have no practical borderline zone** — S08 low/high, T03 high, F05
  low/high, F06 low/high. The zone is 10% of the threshold, so where the threshold is small
  it is a sliver: S08 and T03 are **2.0%** of their abnormal region, F05 **2.6%**, F06
  **4.5%**. Those indicators effectively jump from normal straight to abnormal. The suite
  derives the list from the bands and asserts it matches `deadBorderlineEdges` exactly, so
  the 7 are verified rather than taken on trust. The strip is narrow, not literally empty —
  a 5.2° S08 reading does classify as borderline — so the app surfaces it as
  *"no practical borderline zone"* rather than claiming it can never fire.
- **The 10% rule is 10% of the threshold at the crossed edge, not 10% of the band width.**
  All 43 bands follow it except **S04 low and Q05 low**, where the threshold is `0.0` and the
  rule degenerates; the file falls back to 10% of the band's other threshold. Neither is in
  the arsenal. The suite checks the rule and names those two exceptions rather than widening
  the tolerance to hide them.
- **4 stretches have no library match** (abductor, adductor and hamstring stretches, Garland
  pose). They are prescribed as free text with the timer and consume no slot.
- **13 of 26 indicators can never prescribe anything.** Their bands are still computed and
  shown, reported as *"measured, no protocol yet"*, never as normal.
- **A reading can fall outside a band the file leaves as `-`** — T03 below −5, say. That is
  reported as out of range with no tier claimed, not silently treated as normal.

### Consequences worth knowing

- **The reference client's sessions sit close to their ceiling, so the trim bites.** Days 1
  and 3 run 84 and 82 minutes against a 90 ceiling, leaving room for one corrective; days 2
  and 4 carry all three. So the block genuinely differs between sessions on a full program.
  That is `trimOrder` doing its job, and every dropped exercise is named against its session.
- **`trimOrder` has four steps and only one of them is reachable.** Step 1, InBody high-TBW
  filler bouts, runs *inside* the rest interval and adds no session time, so trimming it
  recovers nothing. Steps 3 and 4, the VALD conversion and its extra weak-side sets, cannot
  be the cause of a breach because VALD refuses any bump that would breach the ceiling in the
  first place — which is asserted, not assumed, so if that invariant ever changes the steps
  come back into play. The loop is still written over all four in order.
- **The simple view's session times read 2–4 minutes higher than the trim's own numbers**, so
  a trimmed session can still show as over the ceiling there — day 1 above reads 89 min in the
  detailed view and 93 in the simple one. This is the pre-existing gap between the two views:
  the simple view re-derives session length from its rounded whole sets, which are on average
  slightly larger. The trim balances against the canonical `day.minutes`, because deciding
  *content* from the simple view's numbers would make the two views prescribe different
  programs.
- **An older or very restricted client can measure a finding and get nothing for it.** The
  Q04 entry is a leg press and a deep barbell squat; for a 68-year-old beginner the first
  exceeds the 65+ load cap and the second is on that bracket's avoid list, so Q04 prescribes
  nothing and says exactly that. Working as intended, but it is the most likely thing to be
  mistaken for a bug.
- **Four arsenal exercises are MEDIUM confidence** — readings of Dr. Raul's shorthand rather
  than exact matches, and the ones to watch:

  | Indicator | Arsenal shorthand | Mapped to | Why it is a judgement call |
  |---|---|---|---|
  | F03 low | "{Side} front single arm pushdown" | Scapular depression pulldown | Read as scapular depression, not triceps — the finding is shoulder-girdle height, which a triceps pushdown would not move |
  | F03 low | "{Side} side single arm pushdown" | Straight-arm pulldown | Same reading on the lateral pull line |
  | S05 high | "Rowing back" | Wide-grip row to sternum | Kyphosis needs retraction and thoracic extension, so a retraction-biased row rather than a lat-biased one |
  | S06 low | "Lower back extension" | Seated back extension | Chosen over the 45° version because low lordosis is a flat lumbar spine and seated is the gentler load |

  Three **stretches** are also MEDIUM: F03's upper-trap stretch → levator stretch-hold, S05's
  "Cobra pose" → thoracic extension over roller, and Q01's bent-over shoulder flexion stretch
  → bench thoracic extension. The remaining 31 mappings are exact or near-exact; all 38
  pre-resolved ids are checked against the library on every run, names included.

## Split recommendation

The split selector stays fully free — every split in `config.splits` is selectable — but the
panel now names the split the data favours for this client, with a **Use** button to apply
it, and each dropdown option carries its badge.

`splits.json` badges only 71 of its 315 rows `Recommended`, and **25 of the 45
goal/days/level combinations have no `Recommended` row at all**. For those, the panel falls
back to the highest-ranked row (`Recommended` → `Available` → `Adjusted`, then `volumePct`)
and labels it *"Best available"* in amber, stating that nothing is badged Recommended and
how many rows tie it. It never presents an `Available` row as a recommendation.

`splits.json` is keyed `{goal}|{days}|{level}|{split}` with **no age component** — its rows
describe age 18-29 only. So for any other bracket the panel drops the per-option badge
suffixes entirely and prints a standing amber caveat that the suggestion is read from the
18-29 reference row and is not age-specific advice. The badge shown next to the *selected*
split is still suppressed outright for non-18-29 clients, as before.

## Equipment

`equipment` in `exercises.json` is a `/`-separated list of **alternatives**
("BB / DB / Smith"), so an exercise is available if any one option is. The 28 distinct
tokens are bucketed in [src/lib/equipment.ts](src/lib/equipment.ts) into three client tiers:

| Tier | Allows | Non-mobility exercises available |
|---|---|---|
| Full gym | everything | 298 of 298 |
| Home (DB, KB, bands) | DB, KB, EZ, plate, bench, bands, bodyweight | 219 |
| Bodyweight only | BW and unloaded variations, no bands | 83 |

Unrecognised tokens fail **closed** (treated as gym-only), so a new token added upstream
can't silently appear in a bodyweight program.

The filter is applied inside `isEligible` alongside the age and level rules, so an
unavailable exercise routes through the same fallback cascade — substitute from a sibling
sub-region in the same muscle group, then drop the slot — and every event is reported in
the warning banner with `(equipment: <tier>)` naming the cause. The program table strikes
through the equipment options the client can't use, so it's clear which one was assumed.

The reference client at bodyweight-only drops from 40 exercises to 30 with 17 fallback
events, and Traps falls to a 0.00 ratio. That is the intended behaviour of the harness:
the volume audit shows what an equipment restriction actually costs rather than hiding it.
The cross-group substitution ban still holds under a starved pool — it's asserted in
`npm run acceptance`.

## Interpretation decisions

Places where the spec left a choice, and what was chosen:

1. **`cap` is not enforced.** The reference block declares `cap: 10` but its Upper days
   carry 12 slots. Enforcing the cap drops 4 slots and produces 36 exercises with 4
   warnings, contradicting the "~40 exercises, no fallback warnings" criterion. The
   algorithm section never lists the cap as an enforcement step, so it is treated as
   metadata and displayed in the program header only.
2. **Get Stronger sessions are ordered main-lifts-first.** Allocation slots arrive sorted
   by sub-region name, so days would otherwise open on whatever sorts first (e.g. "External
   rotation"). For `Get Stronger` the day's picks are stable-sorted with `mainLift` first.
   This reorders the same exercises and does not touch volume.
3. **`prescription.json` is keyed on the *requested* days, not `deliveredDays`** — it is
   keyed by client input, like the allocation lookup.
4. **`alsoTrains` entries are matched to `sub` exactly, never fuzzily.** Five names in
   `exercises.json` (`Lateral-medial (lockout)`, `Mid`, `Lower`, `Stretch`,
   `Abduction (med-min)`, 32 of 264 references) match no `sub` value, so they earn no
   indirect credit. The audit panel names them explicitly rather than guessing at
   `Lateral / medial (lockout)` etc. If these are meant to resolve, the fix belongs
   upstream in the data.
5. **Sex overrides apply to targets with a floor of 2** for every override, which is what
   makes the female `Traps −2` case behave.
6. **The simple view prescribes whole sets via balanced rounding**
   ([src/lib/rounding.ts](src/lib/rounding.ts)). A client-facing program has to be
   decisive, but rounding every fraction the same way drifts hard — all-up is +11% on the
   week (127.5 → 142 sets on the reference client), all-down is −11%. Instead a running
   error is carried **per muscle group**: the first 3.5 rounds to 4, the next 3.5 in that
   group rounds to 3, and so on. Every group lands within **0.5 sets** of its target, and
   the week comes to 132 instead of 127.5 (+3.5%). Within a group the picks are ordered
   heaviest-primary-first, so the extra set goes to the main compound and the shave comes
   off the accessory. The detailed view still prints `3.5` verbatim — the harness has to
   show exactly what the allocation asked for — and the volume audit is computed from the
   raw values, with the rounded week total shown alongside it so the drift stays visible.
7. **Equipment tiers are an addition to the original spec**, not something the data models.
   `exercises.json` has no availability field, so the tiers are a bucketing of its
   equipment tokens; the bucket lists are in one place and are the thing to edit if a token
   is judged wrongly (e.g. whether a bench counts as "home", or whether bands belong in
   bodyweight-only — currently they do not).

## Acceptance criteria — current status

`npm run acceptance` → **148 of 148 checks pass**. The five presets all run at `Full gym`, so
the original criteria are unaffected by the equipment feature; the rest cover equipment
tiers, split advice, set rounding, and the injury, structure, InBody, VALD, BodyDot and Load
layers. Note the count dropped to 22/22 at one point because
the week criterion was **removed**, not because its failure was fixed — see below.

| Criterion | Status |
|---|---|
| Reference: 4 days | **pass** |
| Reference: ~40 exercises | **pass** — 40 |
| Reference: sessions roughly 54–75 min | **pass, marginal** — 74.5 / 54.4 / 72.8 / **53.5** |
| Reference: no fallback warnings | **pass** — 0 |
| Older adult: no ab wheel, deep full-ROM squat, pull-up, Copenhagen plank | **pass** |
| Older adult: machine/cable work, goblet squat, chest-supported row | **pass** — 15/20 picks machine or cable |
| Stress test: 5 requested → 3 delivered, age-cap note shown | **pass** |
| Stress test: no exercise with `load > 3` | **pass** |
| Youth strength: Get Stronger days open on main lifts | **pass** — all 5 days |
| ~~Week change alters selections but not volumes~~ | **dropped** — see below |
| Same client input always produces the same program | **pass** — replaces the week checks |
| No preset prescribes a mobility-type exercise | **pass** — all 5 presets |
| Equipment: nothing outside the tier is ever prescribed | **pass** — all three tiers |
| Equipment: bodyweight-only shrinks the program and reports fallbacks | **pass** — 40 → 30 exercises, 17 warnings |
| Equipment: no substitution crosses a muscle group even at bodyweight | **pass** |
| Rounding: every prescribed set count is a whole number | **pass** — all 5 presets |
| Rounding: no muscle group drifts more than 0.5 sets | **pass** — max 0.5 on every preset |
| Rounding: no session crosses the goal's time ceiling | **pass** — worst is Youth strength day 3 at 103 of 105 min |
| Split advice: reference client gets a Recommended split | **pass** — Upper / Lower |
| Split advice: non-18-29 client is flagged as reading the 18-29 rows | **pass** |
| **Injury:** no pains ticked reproduces the baseline exactly | **pass** — identical fingerprint |
| **Injury:** the five validated spot checks | **pass** — 5/5 |
| **Injury:** SHOULDER removes overhead pressing, flys and dips | **pass** |
| **Injury:** SHOULDER puts corrective work first in sessions containing it | **pass** |
| **Injury:** LOWBACK empties Lower back, shown as removed not failed | **pass, with a caveat** — see below |
| **Injury:** SHOULDER + LOWBACK, neither resurrects the other's removals | **pass** |
| **Injury:** ELBOW_LAT Left keeps unilateral work side-only | **pass, with a caveat** — see below |
| **Injury:** unticking every pain returns to baseline | **pass** |
| **Structure:** straight is the existing program, only the clock changes | **pass** — identical exercises and sets, no blocks |
| **Structure:** volume audit identical across all three | **pass** |
| **Structure:** switching structure changes session time and nothing else | **pass** — 84/61/82/60 → 74/52/68/52 |
| **Structure:** Get Stronger never blocks a main lift | **pass** |
| **Structure:** Build Muscle / Lose Fat do pair main lifts, by design | **pass** |
| **Structure:** no synergist pair (press + pushdown) | **pass** — after the alias fix below |
| **Structure:** a corrective is never blocked with a non-corrective | **pass** |
| **Structure:** two compounds sharing a joint never pair | **pass** |
| **InBody:** no scan entered leaves the program unchanged | **pass** |
| **InBody:** worked example states — SMM Under, PBF Over, TBW High, TRUNK Over | **pass** |
| **InBody:** worked example TBW ratio 1.072 | **pass** — 1.0718 |
| **InBody:** worked example goal vector 30 / 30 / 40 | **pass** |
| **InBody:** worked example rest floor 120s | **pass** |
| **InBody:** TRUNK the only region supersetted | **pass** — 5 slots |
| **InBody:** straight slot 0%, rule-4 slot −3% | **pass** |
| **InBody:** worked example filler 4 × 40s | **pass** |
| **InBody:** rule 4 never touches a main lift or an unowned group | **pass** |
| **InBody:** Get Stronger + TRUNK Over leaves rest at the 120s floor | **pass** |
| **InBody:** slot count and selection identical for every scan | **pass** — 5 presets × 4 scans |
| **InBody:** weights sum to 1.00, stated goal keeps ≥ 0.40 | **pass** — all 27 state combinations |
| **InBody:** injury REMOVE verdicts still hold | **pass** |
| **InBody:** ankle pain + high TBW gives the non-impact filler | **pass** |
| **InBody:** a 6-12 Beginner gets 2 × 30s non-impact | **pass** — fields taken independently |
| **VALD:** no readings leaves the program unchanged | **pass** |
| **VALD:** an asymmetry under 8% changes nothing | **pass** |
| **VALD:** a Major finding adds +2 weak-side sets and makes the slot unilateral | **pass** |
| **VALD:** a 35% reading adds the same +2 as 25%, plus a referral flag | **pass** |
| **VALD:** pass-1 reservation — every servable finding gets one before any gets two | **pass** — see the caveat above |
| **VALD:** two runs on identical input are byte-identical | **pass** |
| **VALD:** a bilateral main lift is never bumped or converted | **pass** — all 17 tests firing, all presets |
| **VALD:** injury SIDE_ONLY right + weak left → no bump, visible note | **pass** |
| **VALD:** slot count unchanged, strong side keeps its direct volume | **pass** — max indirect drift 1.8 sets |
| **VALD:** the audit diverges by side once a finding fires | **pass** |
| **BodyDot:** no readings leaves the program identical | **pass** — and the whole acceptance output is byte-identical to the previous commit's |
| **BodyDot:** a finding adds slots and changes nothing else | **pass** — main program byte-identical |
| **BodyDot:** a LEFT Pelvic Tilt finding prescribes a RIGHT hip hike | **pass** |
| **BodyDot:** a RIGHT Kendall Knee finding prescribes LEFT leg work | **pass** |
| **BodyDot:** the opposite-side rule does not leak into VALD's convention | **pass** — same client, VALD works right, BodyDot left |
| **BodyDot:** HKA above the band (valgus) → abduction work + adductor stretch | **pass** |
| **BodyDot:** HKA below the band (varus) → adduction work + abductor stretch | **pass** |
| **BodyDot:** both F06 rows flagged corrected-from-source with their meaning | **pass** |
| **BodyDot:** never more than 3 correctives in a session | **pass** — 19 sessions swept, worst is 3 |
| **BodyDot:** stretches do not count toward the cap | **pass** — 3 correctives + 1 stretch in one session |
| **BodyDot:** both findings served before the three-exercise entry gets its second | **pass** — S02 2/3, S01 1/1, 1 deferred |
| **BodyDot:** what did not fit is reported by name | **pass** |
| **BodyDot:** correctives appear in every session, tagged and attributed | **pass** |
| **BodyDot:** corrective slots stay out of the main list and the set totals | **pass** |
| **BodyDot:** a mobility corrective is timed, never given sets and reps | **pass** — 90/90 hip lift at 4 × 40s |
| **BodyDot:** a loaded corrective still gets reps | **pass** — 2 examined |
| **BodyDot:** unilateral +2 abnormal / +1 borderline | **pass** |
| **BodyDot:** borderline bilateral takes the first exercise, abnormal takes all | **pass** |
| **BodyDot:** injury REMOVE outranks a corrective | **pass** — rear delt fly prescribed pain-free, absent with shoulder pain |
| **BodyDot:** a stretch removed for a reported pain is not prescribed | **pass** |
| **BodyDot:** a finding whose whole entry is removed prescribes nothing, and says why | **pass** |
| **BodyDot:** a corrective the client cannot safely load is not added, and says why | **pass** — see below |
| **BodyDot:** an indicator with no protocol is reported, never silently skipped | **pass** — all 13 |
| **BodyDot:** a reading outside an undefined edge is reported, not treated as normal | **pass** |
| **BodyDot:** boundary values take the milder tier | **pass** |
| **BodyDot:** every borderline band is 10% of the threshold at its edge | **pass** — 43 bands, 2 named exceptions |
| **BodyDot:** the 7 declared dead borderline edges are exactly the ones under 5% | **pass** — derived from the bands, not trusted |
| **BodyDot:** every arsenal id resolves to the library and matches its name | **pass** — 38 ids |
| **BodyDot:** an unmapped stretch is free text with the timer | **pass** |
| **BodyDot:** the time constants match the formula in the data file | **pass** |
| **BodyDot:** corrective minutes follow the stated formula | **pass** |
| **BodyDot:** the trim recovers the ceiling unless the session was already over | **pass** — 3 sessions trimmed |
| **BodyDot:** VALD can never cause a breach, so trim steps 3–4 stay unreachable | **pass** — 4 bumps, none pushing a session over |
| **BodyDot:** two runs of the same input are identical | **pass** |
| **VALD:** the 17 test codes in vald.json and load.json are the same set | **pass** — joined on the code, never the name |
| **VALD:** newtons alone derive the percentage and the weak side | **pass** — 300/400 N → 25% weak left |
| **VALD:** an entered percentage is used as given, never re-derived | **pass** |
| **VALD:** a percentage >1 point from the forces is flagged and still used | **pass** — 18% vs 15.0% flagged, 25.5% vs 25.0% not |
| **VALD:** a weak side contradicting the forces blocks the finding | **pass** — and the agreeing version does fire |
| **VALD:** a blocked finding estimates no weight either | **pass** |
| **VALD:** percentages with no forces still work | **pass** — Load reads "not estimated" |
| **Load:** Elbow Extension 400 N → 26.1 kg reference | **pass** — 26.10 |
| **Load:** all six Elbow Extension worked-example rows | **pass** — exact, including tiers |
| **Load:** Shoulder Push 900 N → 27.5 kg reference | **pass** — 27.53 |
| **Load:** all five Shoulder Push worked-example rows | **pass** — exact |
| **Load:** the anchor reads Measured, the rest of its sub-region Estimated | **pass** |
| **Load:** per-hand and per-side rows are labelled as such | **pass** |
| **Load:** a 10-year-old gets no weight anywhere, at any tier | **pass** — MATCHED tier present, 0 numbers |
| **Load:** a beginner's top is 20% lower, bottom unchanged | **pass** — 35–57.5 → 35–47.5 kg |
| **Load:** the beginner cut flattens a MATCHED band and says so | **pass** — see below |
| **Load:** no forces → every exercise "not estimated", nothing else changes | **pass** — byte-identical |
| **Load:** a CAUTION verdict caps at the bottom and withholds the range | **pass** — floor press |
| **Load:** bodyweight and carry classes never get a weight | **pass** |
| **Load:** neck stays unestimated with all 17 tests entered | **pass** — 9 exercises, 3 sub-regions |
| **Load:** with all 17 tests the library is still only partly reachable | **pass** — 14 MATCHED, 208 with no number |
| **Load:** the 3 sub-regions naming an absent anchor are reported | **pass** — Q-KD, AC-ALF, L-VERT |
| **Load:** a unilateral exercise gets a load per limb | **pass** |
| **Load:** a bilateral exercise is prescribed from the weaker limb | **pass** |
| **Load:** push-up is BODYWEIGHT, not a loadable compound | **pass** |
| **Load:** floor press and incline hex press are COMPOUND | **pass** |
| **Load:** Hip Abduction and Hip Flexion have anchors | **pass** |
| **Load:** the correction factor defaults to 1.00 and scales when set | **pass** — hook wired, nothing sets it |
| **Load:** all 315 exercises have a pre-computed record, codes matching | **pass** |
| **Load:** every figure lands on a 2.5 kg step | **pass** — awkward inputs still round cleanly |

### A Stage 1 criterion that no longer applies

**"Reference: sessions roughly 54–75 min."** The structure layer replaced the
`repsMid * 3 + restMid` session-length formula by instruction, so the same program now
reads **84 / 61 / 82 / 60 min** at `straight`. Nothing about the program changed — only how
its length is computed. The window was an artefact of the retired formula, so the check now
asserts the sessions stay inside the goal's own 90 min ceiling and prints the superseded
window alongside, rather than quietly widening the range.

### Audit of the acceptance suite itself

After finding the check below, the whole suite was audited for the same class of fault — an
assertion that passes without testing anything. Two mechanisms:

1. **Dangling references.** `scripts/` was outside the TypeScript build, so a check could
   reference a field that no longer existed, evaluate `NaN`, and pass. Fixed at the root:
   [tsconfig.scripts.json](tsconfig.scripts.json) puts `scripts/` under `tsc -b`.
2. **Empty populations.** An `.every()` over an empty array is true, so an "X never happens"
   check passes when it never looked at an X. Every absence-style check now asserts its
   population was non-empty and prints how much it examined: 38 in-block pairs for the
   synergist and shared-joint rules, 8 blocks containing a corrective, 5 rule-4 slots against
   10 main lifts, 12 main-lift slots on VALD-tested sub-regions, 39 VALD bumps.

**One check was genuinely vacuous:** *"a corrective is never blocked with a non-corrective"*
examined 39 multi-exercise blocks, **none of which contained a corrective** — the four
baseline programs simply have no session where two correctives can pair. The rule was never
tested once. It now sweeps all 18 pains and examines 8 such blocks; a wider sweep of 180
programs found 22 and **zero mixed**, so the code was right and only the test was weak.

### A silently-passing check, found and fixed

While wiring VALD I found that `Rounding: no session crosses the ceiling` had been
**passing vacuously since the structure layer**. It multiplied by `program.minutesPerSet`, a
field the structure layer removed when it replaced the time model — so it computed `NaN`,
and `NaN > ceiling` is false. `scripts/` was not in the TypeScript build, so nothing caught
the dangling reference.

Two fixes: the check now runs through the real time model, and
[tsconfig.scripts.json](tsconfig.scripts.json) puts `scripts/` under `tsc -b` so a dangling
reference in a test fails the build.

What it was hiding: **Youth strength day 3 runs 113 min against a 105 min ceiling.** That is
a real outcome, not a rounding artefact — it is 113 min at raw sets too, because the
structure layer's time model is more expensive than the one it replaced. Stage 1's spec says
to *flag* an over-ceiling session, not to prevent one (the allocation fixes the slots and
every layer holds volume), and the app does flag it in red. The check now asserts the flag
is correct and names any session that crosses, rather than asserting none exist.

### The two injury criteria that pass only with a caveat

**"LOWBACK ticked: the Lower back group shows zero delivered."** Direct volume is exactly
zero and the row is flagged *removed* in blue, not red — that part holds. But the total
reads **1.05**, because the audit's `delivered` includes indirect credit and one surviving
exercise (Bird dog, an Abs & core movement) lists Erectors in its `alsoTrains`. That is the
Stage 1 formula working as specified, and it is physiologically true — a bird dog does load
the erectors — so the formula was not changed to force a zero. The audit row now carries
both figures, and the acceptance check asserts direct volume is zero and prints the
indirect residue rather than hiding it.

**"ELBOW_LAT with Left: unilateral gripping exercises are kept with a pain-free-side
badge."** They are kept — removals drop from 36 to 33 and three exercises become SIDE_ONLY
instead of REMOVE. But for the Reference client **none of those three reach the program**:
they rank below unaffected exercises in their sub-regions, and the spec says SIDE_ONLY
exercises stay in the pool and are annotated, not that they get promoted. So the badge is
correct but invisible for this particular pain. It is visible elsewhere — `SHOULDER:Left`
puts "Lean-away single-arm cable lateral raise" and "Single-arm lat pulldown" in the
program with a *Pain-free side only (right)* badge — and that is asserted separately so the
badge itself is not left untested.

### Known data gap — five secondary-muscle names

The CAUTION rule checks each exercise's `alsoTrains` entries after converting them to
`"Group > Sub-region"` keys via `exercises.json`, exactly as specified. Five `alsoTrains`
names (`Lateral-medial (lockout)`, `Mid`, `Lower`, `Stretch`, `Abduction (med-min)`) are
written in the *injury library's* spelling rather than `exercises.json`'s, so no `sub`
matches and they convert to nothing. Measured cost: **2 cells of 5,670** change if they are
resolved — both "Single-leg RDL" moving OK → CAUTION, for GROIN and ANKLE. The spec-literal
conversion was kept, since it is the one validated against the source matrix, and the
unresolved names are named in the audit panel rather than guessed at.

### The dropped criterion — week rotation

The original spec asked for sub-region rotation by week number, and that has been
**removed by decision, not fixed**. The generator now has no week input at all: it produces
one week, and a given client always gets the same program.

Why it was removed:

- Week was never part of the data. Allocation keys are `split|goal|age|level|days` with no
  week component, and `config.json`, `exercises.json` and `prescription.json` never mention
  weeks. Rotation existed only because the spec asked for it.
- **540 of the 2,205 allocation blocks** carry notes reading `(2-week rotation, week 1
  shown)` or `(3-week rotation, week 1 shown)`, as do 72 rows in `splits.json`. Upstream,
  those programs cycle through 2 or 3 *different day patterns* — and only week 1 shipped.
  So a "week 2" in this app was never the same thing as week 2 upstream: it re-picked
  exercises inside week 1's skeleton. Generating one week is the honest claim.
- At week 1 the rotation was already a no-op (`rotate(list, 0)` is the identity), so
  removing it changed no output. Every preset produces exactly the same program as before —
  same exercises, same minutes, same audit figures.

The related finding it used to expose is still true and still worth knowing: *direct* volume
is invariant under any change of pick within a sub-region, but *total* volume including
indirect credit is not, because `alsoTrains` is a property of the individual exercise. If
rotation is ever reintroduced, expect group totals to move by a couple of sets (it was 2.4
on Delts) purely from indirect credit.

### Other things the harness surfaces (not criteria, but worth knowing)

- **Reference audit: 10 of 11 substantive groups within ±25%.** The miss is Triceps at
  0.67, and the allocation's own `delivered` field agrees (11.8 vs a target of 13.5), so
  the shortfall is upstream in the allocation, not in exercise selection.
- **Older adult: Glutes & hips at 0.48.** The female `+3` override raises the target to
  8.4 while the allocation was built against 5.4; the override is applied to targets after
  the fact and nothing re-plans the slots to meet it.
- **Stress test: 7 of 11 within ±25%,** with Chest, Triceps and Delts near 0.5. The 6-12
  bracket's `load <= 3` rule plus a `cap: 7` leaves a thin pool. Again the allocation's own
  `delivered` field tracks the recomputed figure closely (2.0 vs 2.2 on Chest), so the
  pipeline is faithful — the targets are simply not reachable for this client.
- **Youth strength, day 3: 103 min** against a 105 min ceiling for Get Stronger. Nothing
  exceeds a ceiling in any preset, but that one is close.
