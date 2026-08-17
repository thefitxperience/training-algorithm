# UDRA Training Program Generator

Client-side React app that generates strength-training programs from the JSON data in
`public/data/`. No backend, no router, no auth.

Two views, switched from the header and persisted in the URL (`?view=…`):

- **Simple** (default) — client controls run horizontally across the top of a centred
  page, with the program underneath as day cards in a responsive grid (1 / 2 / 3 columns).
  The table carries exercise, sets × reps and rest only. Fallback warnings, the audit
  panel, allocation keys and per-day set totals are all hidden. The reduced-days notice and
  the "Reduce to 60 min" button are **not** hidden: both are real outcomes the client has to
  see and act on.
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

**Everything in `public/data/` becomes publicly downloadable** — all thirteen JSON files,
including the 3 MB `allocation.json`. It's a static site, so the browser has to be able to
fetch them; there is no way to publish this and keep the data private. GitHub Pages on a
free account also requires a **public repo**. If either matters, this needs a host with
access control rather than Pages.

## Data

Thirteen files in `public/data/`, served as static assets and fetched once at startup:

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
| `amend.json` | the three amend types, four blocks, seven ranking rules, sibling sub-regions for all 47 codes, and the sub-regions each pain empties |
| `timecap.json` | the twelve levers and their costs, the rest floors, the four hard floors, and the session time model |

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
lateral indicators: `?bodydot=S02:60,F05:6:L`. Amends ride along as pins —
`?pins=1|Quads - knee-dominant|0;229;278;;client;1;1755300000000` is slot, from, to, equipment,
actor, accepted, timestamp.

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

## Reading an InBody sheet

The printout goes in as it comes — the PDF export or a photograph of the paper — and the
fourteen figures the layer takes come out of it. Verified against three real sheets: an
InBody270 export, a 270S export, and a photograph of a 270S printout.

| | figures read | what is missing |
| --- | --- | --- |
| InBody270 (PDF) | 10 of 14 | the muscle range, which that model does not print; the fat range, which none do |
| InBody270S (PDF) | 12 of 14 | the fat range |
| InBody270S (photo) | 12 of 14 | the fat range |

### Why it reads coordinates and not labels

An InBody sheet draws almost every label as vector artwork — "Total Body Water", "Skeletal
Muscle Mass", "Segmental Fat Analysis", and the client's sex along with them. A PDF's text
layer is very nearly a bare list of numbers, so anchoring on label text finds nothing.

A photograph fails the other way round: OCR reads the labels perfectly well and mangles the
numbers. On the sample photo it read the weight `71.1` as `TAN` at the picture's own size,
`15.3` as `15:3`, and `36.5` as `365`.

So every figure is looked for **twice** — once by its printed label, once by where it sits —
and each path covers the other's blind spot. The segmental panels are the clearest case: a
photograph tells the fat panel from the lean one by the headings, and a PDF, which has no
headings, tells them apart by arithmetic (see below).

### Everything is cross-checked against something read a different way

- **Weight** from the composition table against the weight printed under the Muscle-Fat bar.
  Nothing in that bar block names itself, so the whole identification is the reading order —
  and it is only believed once its first value matches a figure obtained elsewhere.
- **Percent body fat** against fat mass over weight. The machine's printed figure wins when
  the bars have been vouched for, because InBody computes it from unrounded internals: 17.7
  over 87.4 gives 20.3% where the sheet prints 20.2%. On a photograph, where the bars do not
  survive, the division is the only route and it lands on the sheet's own figure.
- **The segmental fat panel** against whole-body Body Fat Mass. Both panels print the same
  three rows in the same shape, so shape alone cannot say which is which, and reading the
  lean panel as fat would hand the layer entirely wrong figures. Segmental fat masses sum to
  within about 1.2 kg of the printed Body Fat Mass; the lean masses land some 40 kg away.
- **The three masses are one identity.** Fat free mass plus body fat mass is weight, exactly,
  on all three sheets. That is what saves the photograph: OCR read 15.3 kg of fat and 55.8 kg
  of lean cleanly and turned the weight into `a.`, and 71.1 comes straight back out of the
  other two. It is stated in the panel rather than passed off as read.

### What is not invented

**No InBody model prints the percent body fat normal range as text.** It exists on the sheet
only as the grey band across the bar — 10.0 to 20.0 on the male sheets here. The skeletal
muscle range is printed in Research Parameters on the 270S and nowhere on the 270.

Those fields are left **empty and named**, with the reason, and the fields below the card are
there to type them into. A range is the whole of what decides Under / Normal / Over, so a
guessed one does not produce a slightly wrong number — it produces a confident wrong verdict,
and the goal rewrite that follows from it is indistinguishable from a measured one.

### Two OCR repairs, and where they stop

Only where the intended character is not in doubt: punctuation swept up at the end of a word,
and a decimal point read as a colon. The colon repair is limited to a **single** digit after
the separator, which is what keeps the clock out of it — a time is always `16:04`, never
`16:4`. A dropped decimal inside a range is repaired only because an InBody normal range is
narrow: no range on these sheets has an upper end even twice its lower one, so `29.9~365` is
a lost decimal where `1545~1806` kcal passes through untouched.

Everything else is left alone and reported. `readInBodyFile` has a companion
`tokensFromFile` that returns what the page actually said, because "the parser is wrong" and
"OCR turned 71.1 into TAN" are not worth guessing between.

### Costs

pdf.js and Tesseract are both imported at the moment they are needed, so the main bundle
carries neither: a trainer who only ever uploads PDF exports never downloads the OCR engine.
A PDF with a text layer is read in well under a second and needs no download at all.

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

- **`SESSION_CAP` was read as the goal's time ceiling.** It is now switched off: nothing caps
  a session at generation, so `wouldBreachSessionCap` is passed `() => false` and weak-side
  sets are never refused for length. The callback stays on the VALD contract so a caller that
  wants a cap can still impose one. See **Time cap** above.
- **The strong side keeps its DIRECT volume exactly.** Total volume can move up to **1.8
  sets** because step 5's swap replaces the exercise with a one-sided version of the same
  movement, and the replacement carries its own `alsoTrains` — so indirect credit into
  *other* groups shifts. Same phenomenon the Stage 1 week-rotation check exposed.
- **The pass-1 reservation can no longer be starved by budget.** With the confirmed change
  to a per-**sub-region** budget, and all 17 primaries distinct, two findings never share a
  budget. Pass 1's ordering still decides who is served first, and is still implemented and
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

## Reading a DynaMo export

The Excel export goes in whole. Columns are located by **header text, never by position** —
DynaMo reorders them between versions — and the join to `vald.json` needs no lookup table
kept here: the data file's `test` field is literally `"{Body Region} {Movement} Strength
Asymmetry"`, and the export carries both as columns. A movement the data file does not name
is **listed by name**, never approximated onto a neighbouring test.

Measured against a real gym-wide export — 5,229 rows, 548 clients, 47 dates:

| | |
| --- | --- |
| rows read | 5,229 |
| mapped movements | 4,833 |
| tests offered | 622, from 576 athlete-days |
| unmapped | 21 kinds, all named in the panel (Scapula Protraction, Neck Flexion, Ankle Inversion…) |

### One export, many tests

Rows are grouped by **athlete and date**. `Date` and `Time` are separate columns, so two
batteries run hours apart on the same day group together rather than splitting on the clock.
With more than one test in the file the panel shows a **searchable** list — 622 rows is not a
dropdown — and applies nothing until one is picked. One test alone is applied straight away.

### Which battery — upper, lower or full

Read off the movements themselves, using the automator's `detect_test_type` rules: a
full-body test is recognised by its *shape* (elbow with knee, and none of the trunk or hip
flexion/extension work that only a dedicated lower-body test carries), not by a count. On the
real export: **313 upper, 169 lower, 140 full.**

A day holding both halves is **not a fourth kind of test.** It is an upper and a lower run
back to back, so the day splits into two tests and each movement is filed by its own half —
exactly as the automator writes two workbooks. 46 days in the export split this way, and no
movement lands in both halves.

One departure from the automator, which files movements one at a time because each has to
land in a fixed cell of a workbook: a movement its lists do not name is filed **by region**.
Shoulder Adduction is upper-body work whether or not a template has a cell for it, and
without the fallback it belongs to neither half and gets counted in both.

### Using several of one client's tests at once

Splitting a day makes the halves selectable; it should not make them exclusive. The picker
**ticks**, so an upper and a lower are read together as the union of both — 72 of the 548
clients in the export have more than one test on record. Selection is held to **one client**:
ticking someone else's test replaces the selection rather than adding to it, because merging
two people's readings is not something anyone means to do.

Where two chosen tests measure the same movement — an old full-body test alongside a fresh
upper — the **latest** reading wins, by date and then by the time of day the rep was taken,
which is what makes two tests on one date orderable at all. **The merge is per movement, not
per test:** an August upper-body test alongside a July full-body one takes the shoulders from
August and keeps the knees from July, rather than discarding the older test wholesale.

What lost is named, not dropped: *"measured in more than one of those tests, so the latest
reading is used: Shoulder Flexion (upper body, 2026-08-14, over 1 older)…"*. 7 of those 72
clients have an overlap. Merging silently is how a six-month-old shoulder reading ends up
shaping today's program with nothing on screen to say so.

Anything else on record for the client in use is offered inline — *"this client has 1 other
test in the export. Add lower body, 2026-08-13"* — because an upper-body test says nothing
about the legs, and half a picture reads as a whole one unless something says otherwise.

### A movement measured twice

15% of athlete-days in the real export contain a repeated movement — a bad rep, then the
redo. Two rules decide which attempt survives, both the automator's:

1. **An attempt that produced a readable asymmetry beats one that did not.** A cancelled rep
   still writes a row, with `n/a` and a zero on one side.
2. Otherwise the **latest** attempt wins, by the `Time` column.

Row order cannot be used for this. **DynaMo writes newest-first**, so the last row for a
repeated movement is the *first* attempt — the one that was redone. Of 108 repeat cases in
the export, trusting row order keeps the wrong attempt in 71, and in 44 of those it reports
the **opposite weak side**: one client's Shoulder Abduction is either `23% R` or `6.4% L`
depending purely on which row is believed. Verified against all 108: the latest valid attempt
is kept every time, and the panel states how many movements were measured more than once.

### The trunk, which the machine does not score

A side bend loads one side at a time, so DynaMo writes the trunk as two rows — `Lateral
Flexion Left` and `Lateral Flexion Right` — each carrying a neutral force and `n/a` for
asymmetry. Neither row names a test on its own, so reading rows independently **drops the
trunk entirely**: 237 rows, and `AC-ALF` unreachable from any real export. It is assembled
from the pair instead. 109 complete pairs in the export, all scored; 18 one-sided bends
reported as *"left side only"* rather than scored against nothing.

The percentage is **not** the automator's, which divides the spread by the mean of the two
sides. DynaMo divides by the **stronger** side — check any row: Shoulder Adduction at
L 147 N / R 189 N prints `22% R`, and 42/189 is 22.2% where 42/168 would be 25.0%. Every
other percentage in this app comes off that column and every threshold it meets — 8%
weakness, 30% referral — is calibrated on it. Scoring the trunk on the mean would put one
test on a scale of its own, always reading high: 96 N against 155 N comes out at 38%, not
47%, and would otherwise cross the referral line on the strength of the arithmetic alone. It
also means the derived figure agrees with the newton cross-check below instead of tripping it
on every import.

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

## Amend — changing an exercise after the program is generated

**An amend is a pin, not an edit.** It pins a slot to an exercise and the generator re-runs
holding the pin; it never modifies the generated output in place. That is the whole design:
a re-test, a goal change or a new InBody scan re-runs the generator, and an edit would be
silently discarded — the worst failure available here, because the client would never know
their change had been undone.

A slot's identity has to survive that re-run, so it is keyed on the allocation's own
structure (`dayIndex|subRegion|n`) rather than on a position in the output — the session is
re-sorted after selection, so an output index would drift. **No day repeats a sub-region in
any of the 2,205 allocation blocks**, which is what makes that key both unique and readable.

Three types, detected from the two exercises rather than chosen: **A** same exercise on a
different implement, **B** a different exercise in the same primary sub-region
(`to.code === from.code`), **C** a different sub-region. Only C requires acceptance, and it
does nothing at all until accepted — the pin is held in `pending`, not applied.

Four blocks, in the data file's precedence: **injury** (REMOVE or SIDE ONLY — the only hard
refusal), **age**, **main slot** (must hold a compound), **corrective** (BodyDot slots are
prescribed by the screening, so they carry no amend control at all). Everything else is
allowed and merely badged, the same way a split is never refused.

### Pin lifecycle

- **A pin the current injury screen would refuse is never applied.** Re-running with a newly
  reported pain drops it and says so — pinning a lateral-raise variant, then reporting
  shoulder pain, retires the pin with *"ruled out by a pain you reported"*.
- **A pin that outlives its slot is retired.** Moving from 4 days Upper/Lower to 3 days Full
  Body retires it with the slot named.

`actor` and `timestamp` are kept on every pin, so a trainer can see what the client changed
and vice versa. Permissions are **not** enforced — `amend.json` flags them PROPOSED, so any
actor may make any type; that is a decision, not an omission.

### Three corrections to the source spec, implemented as corrected

1. **The main-slot rule reads the library's movement type**, not the Load layer's mechanical
   class. They disagree on exactly one case that matters — **push-up**, which the library
   calls compound and the Load layer calls BODYWEIGHT after the "weighted token reads as
   loadable" fix. The spec's own worked example needs the library reading, and it has to be
   one field rather than two. Asserted both ways.
2. **The chest main-lift count is four**, not two — incline, flat, paused and decline bench
   press. The argument built on it still holds; the number was wrong. Asserted.
3. **Worked example 3 is not achievable and the engine says so.** All eight exercises in the
   lateral-raise sub-region carry `SH_IMPINGE`, which is on the SHOULDER REMOVE list, so the
   real output is **7 REMOVE, 1 SIDE ONLY, zero freely available** — verified exactly. The
   list then widens to sibling delt sub-regions badged ADAPTED, and the reason is stated. The
   one SIDE ONLY exercise is Lean-away single-arm cable lateral raise, and Lu raise is REMOVE,
   both as the correction says.

### Readings the spec left open

- **The cap is applied per group, not to the union.** "Cap the shortlist at 8" sounds like
  one list, but Q-KD alone has more than eight same-sub-region options, so type C would never
  survive a union cap — and the spec's own worked example (leg press → lying leg curl) is a
  type C on a sub-region that is nowhere near empty. Each group is capped at 8 instead, which
  bounds the list while keeping every route reachable. Type A entries sit outside the cap
  entirely: they are the same exercise on a different implement, already bounded by that
  exercise's own equipment list, and four tokens would otherwise crowd out half the real
  alternatives.
- **Blocked entries are not counted against the cap either.** They are the explanation for a
  short list, not choices in it; truncating them leaves the client staring at three options
  with no reason given.
- **Sibling sub-regions are always offered**, ranked below the same-sub-region ones, not only
  when the shortlist is empty. Ranking rule 2 ("type B before type C") only means anything if
  both are in one list. `widened` still marks the case the data file cares about — nothing in
  the sub-region is available, so the siblings are all that is left.
- **SIDE_ONLY blocks alongside REMOVE.** The main program keeps a side-only exercise and
  badges it, but deliberately *choosing* one as a replacement is a different act — and it is
  what makes the shoulder-pain shortlist come back with nothing available, as corrected above.
- **Equipment availability filters the shortlist** although it is not one of the four blocks.
  Offering a barbell to a client with no barbell is noise rather than choice. Level and skill
  caps are *not* applied — the spec blocks age but deliberately not level, so a
  level-inappropriate choice stays the client's to make.
- **Drift is measured per sub-region, off the allocation's own slots.** `targets` in the
  allocation block is per muscle *group*, which is too coarse to see the thing the spec asks
  about: a leg-press-to-leg-curl swap moves two sub-regions inside one group and leaves the
  group total untouched.

### Expect these, they are not bugs

- **A single type C swap moves two sub-regions 50-100% off target.** Swapping the Q-KD slot
  for a lying leg curl reports Q-KD at **−50%** and H-CURL at **+100%**. Reported, never
  blocked — the client asked for this — but it is why unlimited type C amends let someone
  rebuild the program into something the engine never validated. There is no amend budget;
  `amend.json` flags that as open too.
- **17 of the 18 pains leave at least one sub-region with nothing available**, medial elbow
  pain seven of them. The suite checks every pain/sub-region pair the data file lists against
  the engine rather than trusting the list.

## BodyDot posture

Fifth rule layer, and the only one in the stack that **adds slots**. It runs after injury,
InBody and VALD, and appends a corrective block to the end of every session. Only the amend
and time-cap layers come after it, and both of those act on a program that is already
complete.
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

- **The per-session trim is gone, and with it `trimOrder`.** Every session now carries the
  full corrective block, identically. Corrective work is still what gets given up when a
  session is too long, but only when the client presses the time-cap button, at a price the
  file states — 3 points borderline, 12 abnormal — weighed against every other lever rather
  than always going first. `bodydot.trimmed` is still the record of what was dropped and is
  now written by the time cap. See **Time cap** above.
- **`trimOrder`'s own reasoning is superseded on one point.** It held that InBody high-TBW
  filler bouts run *inside* the rest interval and add no session time. `timecap.json`'s
  session model charges them (`fillerBouts × 40`) and prices a lever to remove them, so the
  new file wins. Two of the four steps have also become moot: nothing caps a session at
  generation, so there is no breach for VALD to be the cause of.
- **The two views no longer disagree about session length.** Both now read the length of the
  session with the whole-number sets the client is actually prescribed. The gap that used to
  put the simple view 2–4 minutes higher is measured and asserted at under 5 minutes against
  the raw fractional figure, which is now an engineering number rather than a displayed one.
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

## Time cap — the "Reduce to 60 min" button

Runs **last**, after injury, all three machines, the structure selector and any amends, and
it only ever removes. One button per day, rendered **if and only if that day exceeds 60
minutes**. No slider, no target field. At 60 or under it is not rendered at all — a greyed-out
control invites a question that has no useful answer.

A press is a **per-day pin**, the same model as an amend: `caps=0;client;<ts>` in the URL, and
the generator re-runs holding it rather than editing the output.

### Nothing caps a session at generation any more

Two things were retired to make room for this:

- **The allocator's own trim.** `allocation.json` was regenerated: it guarantees volume only.
  Substantive-group volume agreement improved from 94.9% to 95.6% as a result, because the
  trim had been removing exercises the volume model needed.
- **`config.timeCeiling`.** The goal's ceiling no longer appears anywhere in the app. The
  field is still in `config.json` — data files are never edited here — but nothing reads it.
  Two layers were trimming against it and no longer do:
  - **BodyDot's `trimToCeiling` is deleted.** The corrective block now reaches every session
    intact. `bodydot.trimmed` still exists and is now populated by whatever the time cap
    dropped, at a price the file states (3 points borderline, 12 abnormal), weighed against
    every other lever — rather than silently and always first.
  - **VALD's session-cap guard is switched off.** `wouldBreachSessionCap` stays on the VALD
    contract so a caller that wants a cap can impose one, but the generator passes
    `() => false`. Weak-side sets a real asymmetry earned are no longer refused for length.

Measured across the whole grid — 1,764 programs, 5,922 sessions, `straight`, no scans:

| Goal | avg | median | longest | over 60 min |
|---|---|---|---|---|
| Lose Fat | 29 | 27 | 65 | 1% |
| Build Muscle | 57 | 54 | 132 | 39% |
| Get Stronger | 67 | 65 | **161** | 53% |

31% of all sessions offer the button. The longest is `Get Stronger / Advanced / 18-29 / 5 days`,
which the spec predicted as "a tail to 164 minutes for advanced strength clients at five days"
— the shape matches closely. The averages come in below the spec's 38 / 72 / 83, most likely
because this sweep weights the grid uniformly rather than by a real client population.

### One session length, not two

The header minute in **both** views is now the length of the session with the **whole-number
sets the client is actually prescribed**. A 3.5-set slot is performed as 3 or as 4, never as
3.5, so the raw fractional figure is not a session anyone trains, and a button labelled
"Reduce to 60 min" driving that figure left the client-facing view reading **63 min** — caught
by clicking the button in a real browser, not by the suite. A capped day is resolved to its
whole numbers *before* the search runs, so the two views land on the same minute.

One visible consequence: resolving one day to whole sets takes its picks out of the per-group
rounding carry, so another day's rounded figure can shift by a set — pressing day 1 on the
Reference client moves day 3 from 84 to 86 min. That is the same mechanism, and the same
±0.5-set guarantee, that already governs the uncapped program, and the suite asserts it holds
after a press.

### Correction 1 — the block time formula

The structure layer was charging a paired block as `sets × (n × work + (n−1) × transition +
rest × REST_MULT)` with `sets` as the **max** across the block. Members usually do **not**
share a set count — Stage 1 solves sets per muscle group, so a 3-set row genuinely pairs with
a 2-set curl — and that form invented work for the short member. Replaced with:

```
S = sum of the members' set counts
R = max of the members' set counts          // the number of ROUNDS
block_seconds = work × S + (S − R) × 15 + R × rest × REST_MULT
```

A 3-set row supersetted with a 2-set curl, Build Muscle, 75 s rest: **480 s**, against 540 s
under the old form — a 12% overstatement. Straight sets are unchanged (`S = R`): a single
3-set exercise is `45×3 + 0 + 3×75 = 360 s` either way. Both figures are asserted.

### The search

Uniform-cost search (Dijkstra) over lever states, ordered by **points spent**, then **fewer
steps** — the client reads the steps — then insertion order, so the same day always produces
the same plan. The lever list is rebuilt at **every node**: saving a minute changes what the
next minute costs. States are deduplicated, not paths — the levers commute, so every ordering
of the same multiset of pulls collapses to one node.

Three things were added on top, none of which weaken the guarantee:

- **A reachability pre-check.** Every lever that removes work is monotone, so pulling all of
  them gives the shortest session the day can legally become. If that is still over 60, no
  plan reaches it — decided in one evaluation instead of by exhausting the state space, which
  is the one case where an exhaustive search is genuinely expensive.
- **Branch and bound.** Any state already reaching the target is an upper bound, so nothing
  costing at least as much is ever queued.
- **A greedy seed.** Best-minutes-per-point is the heuristic the spec **rejected as an
  answer** — measured against the exact optimum it overspends by 43% and is optimal on 56% of
  days — and it is never returned as one. It is used only to seed the bound, which on the
  longest sessions is the difference between pruning from the first node and pruning from
  nowhere.

**Budget: 60,000 states or 2 seconds.** A button press must not freeze the page. Across 624
pressed days without readings: median search **2 ms**, p90 **82 ms**, max **2.1 s**; 4.6% run
past a second. Those return a plan that **reaches** 60 but is not proven minimal, labelled
`NOT PROVEN CHEAPEST` in the UI with the reason on hover. Before branch-and-bound and the
greedy seed, three of those days took **24 seconds** each and fell back to the shortest-safe
state — a 24-second freeze on a button press, found by clicking it rather than by the suite.

Optimality is re-proved from outside for every plan the search claims is minimal: the suite
brute-forces every state reachable below the plan's own cost and asserts none of them reaches
60. Days whose sub-budget space passes 400,000 states are counted as **not re-proved** and
reported by name — a check that can go green by running out of room is worse than no check.

### Two of the twelve levers are unreachable, and it is not the engine

`set_accessory` (4 points) and `remove_accessory_exercise` (10) **never fire**. Selection
ranks primary tier first, and all **47 of 47** sub-regions in the library contain a primary
exercise, so a slot asking for one exercise always gets a primary one. Across the preset
sweep the chosen exercises are **339 primary, 27 secondary, 0 accessory**.

The consequence is real: the cheapest set cut actually on offer costs **18**, not 4. That is
why plans are expensive — a 132-minute Build Muscle day needs a dozen 18-point primary cuts —
and it is the main reason the measured lever distribution diverges from the spec's. Closing it
means either seeding sessions with accessory work or repricing `set_primary`; both are product
decisions, not fixes, so nothing has been changed to make the number look better.

### Lever-use distribution

Measured by pressing **every** over-60 day across a goal × level × age × frequency × split ×
structure grid, with an InBody scan, VALD readings and three posture findings on every client
so all twelve levers are actually in play: **2,612 pressed days, 17,988 pulls**. 97% reached
60 minutes; 3% reported a shortfall. Median plan **27 points**, p90 **204**, max **474**.

Counted two ways, because they say different things — share of days is the one comparable
with "supersetting alone solves about a third of days":

| Lever | share of pressed days | share of pulls | spec |
|---|---|---|---|
| Structure step | 55% | 8% | 34% |
| Rest | 27% | 8% | 23% |
| InBody filler | 58% | 22% | 15% |
| Remove exercise | **0%** | **0%** | 11% |
| Set cuts | 43% | 36% | — |
| Correctives | 74% | 26% | — |

Share of pulls is dominated by the long sessions that need a dozen 18-point primary set cuts
each; share of days is not. **The structure step alone solved only 117 of 2,612 days (4%)**,
against the spec's "about a third" — on this grid it is a component of most plans rather than
a whole plan.

Three divergences from the spec's 34 / 23 / 15 / 11, all traceable:

- **Remove exercise at 0%** — the accessory finding above. There is nothing accessory-tier to
  remove, and set cuts beat removal per point until every accessory is at its floor.
- **Correctives at 74% and filler at 58%** are inflated by the sweep itself: every client in
  it has a scan and three posture findings, which a real population would not. On the five
  presets (mostly no readings) they fall to 48% and 30%.
- **Structure at 55%, well under the days it appears on in the preset sweep (87%)**, because
  half the grid already runs supersets and is offered triset or nothing.

Nothing here has been reweighted to close the gap with the spec's figures.

### Floors — all four hold

- **Rest floor** — `REST_FLOOR[age][goal]`, with `beginnerRestFloor` on top; a floor can only
  rise. "Floor the incoming rest before searching" binds in one direction only: where the
  prescribed rest already sits below the floor, the floor becomes that value, so the lever
  cannot move it. This layer only removes, and raising a client's rest to meet a floor would
  lengthen the session they pressed the button to shorten.
- **SESSION_MIN** — every surviving exercise holds ≥ 2 sets, so a muscle group is either out
  of the session entirely (what the 10-point "whole accessory exercise" lever buys) or at 2
  sets or more. Never trained-but-under-two.
- **Main lift** — never removed and never trimmed, for any goal. It is the reason a target
  sometimes cannot be reached, and that is reported rather than cut around.
- **One structure step per day** — straight→superset or superset→triset, never both. If the
  client already picked supersets program-wide, the day is offered triset or nothing.

Rest trims in whole **10 s** steps, except where the last step lands exactly on the floor:
75 s at a 60 s floor goes 75 → 65 → 60. A trimmed rest is displayed as a single number rather
than the prescription's range, because the point is a number the client can follow on a clock.

### Strictly 60, and undershoot is fine

A plan landing at 60.2 is not a success. Levers are discrete, so a plan may land at 54.5, and
it never spends extra points to land closer to 60 — a Youth-strength day comes back at 59 min
having pulled one 12-point lever.

When 60 cannot be reached, the shortest safe version is applied and the shortfall is reported
with the reason. In the preset sweep one day does this: `Youth strength` day 3 with a scan and
posture readings lands at **61.8 min, 1.8 over**, because every lever except the main lift is
already pulled.

### The InBody filler now costs session time

`timecap.json`'s session model is `sum(blocks) + fillerBouts × 40 + warmup`, and the filler
lever saves real minutes — which it could not if filler were free. This **reverses** the
BodyDot-stage reading that "filler runs inside the rest interval, so it adds no session time".
The new file is the authority and the lever only makes sense under it. The seconds come from
InBody's own resolved figure (30 s or 40 s depending on age and level), not from `timecap`'s
40, on the standing rule that the machine's own figure wins; `timecap.timeModel` is the
fallback. Bouts are charged per session, on sessions that have an isolation slot to run them
between.

### One place the structure step can lengthen a day

Superset → triset is **not** monotone. Four exercises pack into two clean supersets, but into
one triset plus one straight exercise — and the triset carries a 1.15 rest multiplier the
pairs do not. On `Reference / superset` day 2 the step comes out **39 s longer**. The search
prunes any pull that does not shorten the session, which is safe here because the step is
capped at one per day and unlocks nothing. Both facts are asserted separately, so a future
change to either fails loudly instead of quietly invalidating the search.

### Volume drift is fed to the amend layer

Cutting sets reduces weekly volume, so a press runs through the same drift check a swap does
and appears in the same panel, badged `N days shortened to 60 min`. Reported, never blocked —
the client asked for this. Pressing day 1 on the Reference client puts five sub-regions more
than 15% below plan, and says so.

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

**The equipment tier is no longer exposed in the client panel.** The field, the library
filter and the whole fallback path below are still live — `ClientInput.equipment` defaults to
`Full gym` from the presets and can still be set through the URL (`?equipment=Bodyweight%20only`)
— but a client is not asked to pick a tier. Everything in this section describes the
mechanism, which is unchanged.

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

`npm run acceptance` → **230 of 230 checks pass**. The five presets all run at `Full gym`, so
the original criteria are unaffected by the equipment feature; the rest cover equipment
tiers, split advice, set rounding, the injury, structure, InBody, VALD, BodyDot, Load, amend
and time-cap layers, and the three importers — the Bodydot session reader, the DynaMo export
reader and the InBody sheet reader. Note the count dropped to 22/22 at one point because the
week criterion was **removed**, not because its failure was fixed — see below.

All three import blocks are **offline**, built from fixtures shaped like the real thing: a
synthetic Bodydot session, DynaMo grids written row by row in the export's own layout
(newest-first, one row per attempt, the trunk as two one-sided bends), and InBody sheets as
positioned words in the same block order and units as the printed page. The real files carry
names, member IDs and health measurements and are not committed.

None of the three exercises its transport — a live service, a browser's
`DecompressionStream`, pdf.js and Tesseract — so all three were also driven end to end in a
real browser against the real data.

The time-cap layer's own criteria, from the spec:

| Criterion | Status |
|---|---|
| The button is rendered if and only if the day exceeds 60 min | **pass** — strictly; days landing on exactly 60.00 exist and correctly get no button |
| A mixed 3-set + 2-set Build Muscle superset computes as 480 s, not 540 s | **pass** — and a single 3-set exercise stays at 360 s |
| Every applied plan lands at or under 60.0 min, or reports a shortfall with a reason | **pass** — 22 of 23 reached; 1 reported 61.8 min |
| No plan drops a muscle below 2 sets, takes rest below its floor, applies two structure steps, or cuts a main lift | **pass** — all four floors, all capped days |
| Supersetting never changes any member's set count | **pass** — checked on the days the structure step solved alone |
| The same day pressed twice produces the same plan | **pass** — byte-identical |
| A Get Stronger day is costed on the total, not on which lever comes first | **pass** — the total is re-proved by brute force, not asserted from the first step |
| A day that cannot reach 60 reports the shortfall rather than cutting the main lift | **pass** — `Youth strength` day 3, 1.8 min over |

Two supporting checks are worth naming because they exist to stop this section lying:

- **Optimality is brute-forced, and vacuous passes are counted as failures.** Days whose
  sub-budget space exceeds 400,000 states are reported as *not re-proved* by name rather
  than passing silently.
- **A plan the search could not prove minimal says so** rather than claiming it — 1 of 23 in
  the preset sweep, labelled in the UI.

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
| Rounding: whole-number sets move session length by under 5 min | **pass** — the two views' figures, now that there is no ceiling to cross |
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
| **BodyDot:** with no cap pressed the corrective block reaches every session intact | **pass** — nothing dropped without the client asking |
| **VALD:** weak-side sets are no longer refused for session length | **pass** — the sets the old guard was refusing now land |
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
| **VALD:** a swapped-in exercise clears injury, age, level and equipment | **pass** — after the fix below; 231 swaps swept |
| **VALD:** a swap records the exercise it replaced, not the replacement | **pass** — after the fix below |
| **Amend:** with no pins the program is identical | **pass** — whole acceptance output byte-identical to the previous commit |
| **Amend:** main slot — Paused bench RECOMMENDED, non-compounds blocked | **pass** — 4 named, 5 in total |
| **Amend:** push-up stays available on a main slot | **pass** — library movement type, one field not two |
| **Amend:** the chest main-lift count is four, not two | **pass** |
| **Amend:** lateral raise, healthy 30-year-old — 7 swaps, none blocked | **pass** |
| **Amend:** shoulder pain empties the sub-region and the list widens | **pass** — 7 REMOVE + 1 SIDE ONLY, widened to D-REAR |
| **Amend:** a widened list still shows the blocked options, never blank | **pass** |
| **Amend:** every sub-region the data says a pain empties really is empty | **pass** — 43 pain/sub-region pairs |
| **Amend:** a type C swap does nothing until accepted | **pass** |
| **Amend:** that swap reports drift on both Q-KD and H-CURL | **pass** — −50% and +100% |
| **Amend:** drift is reported, never blocked | **pass** |
| **Amend:** a pin that becomes injury-blocked is dropped with a reason | **pass** |
| **Amend:** a pin that outlives its slot is retired and reported | **pass** |
| **Amend:** two identical amend sequences produce identical programs | **pass** |
| **Amend:** a pinned exercise is not also selected elsewhere in the week | **pass** — pinned ids reserved before selection |
| **Amend:** a corrective slot is not amendable at all | **pass** |
| **Amend:** the three types are detected, never chosen | **pass** |
| **Amend:** the selectable shortlist is capped at 8 | **pass** — per group, see above |
| **Amend:** the shortlist never offers unavailable equipment | **pass** |

### A Stage 1 criterion that no longer applies, and the ceiling that replaced it

**"Reference: sessions roughly 54–75 min."** The structure layer replaced the
`repsMid * 3 + restMid` session-length formula by instruction, so the same program now
reads **88 / 62 / 86 / 62 min** at `straight`. Nothing about the program changed — only how
its length is computed. The window was an artefact of the retired formula.

It was replaced by a check against the goal's own `timeCeiling`, and **that has now gone
too**: the allocation guarantees volume only, nothing trims a session at generation, and
session length is the client's decision, taken with the time-cap button. The check asserts
the one thing still assertable — that the figure on the day header *is* the day's own time
model, with nothing subtracted behind it — and prints the minutes.

The old ceiling underpinned two more checks, both replaced rather than deleted:

- *"BodyDot: the trim brings every session back inside its ceiling"* → **"with no cap pressed
  the corrective block reaches every session intact"**. There is no trim to test; what has to
  hold now is that nothing is dropped without the client asking.
- *"VALD can never be the cause of a ceiling breach, so trim steps 3–4 stay unreachable"* →
  **"weak-side sets are no longer refused for session length"**. The guard was the reason
  those steps were unreachable; with it gone, the thing worth asserting is that the sets the
  guard was silently refusing now land.

### Two bugs the cross-layer sweep found

Every layer was tested largely on its own, so after the last one landed I ran a **leave-one-out**
sweep — all six on, then each removed in turn — plus a precedence sweep over 40 fully-stacked
programs. All five input layers still moved the program in the stack, and Load still annotated
it. Two real bugs fell out, neither of which the 148 checks in place at the time caught:

1. **VALD's swap reached around the injury layer and the Stage 1 safety rules.** Step 5 searches
   the whole library for a native-unilateral exercise with the same `code`, and filtered on
   nothing but the code and laterality. Across a sweep of 5 presets × 4 pain sets × 3 equipment
   tiers, **343 swaps included 37 injury-REMOVEd exercises, 82 barred by the client's age or
   level, and 154 unavailable at their equipment tier** — a 10-year-old being handed a Kroc row,
   a bodyweight-only client a cable exercise. Every one of the existing VALD checks tested a
   full-gym adult with no pain, which is exactly the client the hole cannot show up on.
   `AllocateContext` now carries a `canSwapIn` predicate and a swapped-in exercise clears
   precisely what a selected one clears; 112 illegal swaps disappear and the count settles at 231.
2. **`swappedFrom` recorded the wrong exercise.** It was read after `slot.exercise` had already
   been reassigned, so it named the exercise swapped *to* under a field meaning swapped *from*.
   Cosmetic — it only feeds a tooltip — but it made the first bug harder to see.

Both are now pinned by checks that sweep pains and equipment tiers rather than testing the
happy path.

### Six display bugs, found by looking rather than by testing

The suite renders nothing, so after the last layer landed I swept the built site across
structures, ages, equipment tiers and every combination of the six layers. Six problems, none
of which any check would have caught, and one of which turned out to be a logic bug too:

1. **Rest was scaled by the program's structure, not the block's.** `blockSeconds` applies the
   rest multiplier only to *paired* blocks, but the table applied the program's to every row.
   On a triset client every exercise that ended up in a straight block displayed rest ×1.15
   against a time model charging ×1.00 — 12 of 23 rows on the reference client, and Youth
   strength showing **138–207s where the model charged 120–180s**.
2. **The same mismatch existed inside the time model.** With InBody active it charged each
   block by its own structure; with InBody off it used the program's for everything. So a
   superset block inside a triset program was charged as a triset — and the figure changed
   depending on whether a body scan happened to be entered. Both now read one resolved figure
   off the block itself, so the model and the table cannot disagree.
3. **Block headers were labelled with the program's figures.** 8 blocks read "superset" while
   showing the triset load (−8% instead of −3%) and rest (×1.15 instead of ×1) — contradicting
   the per-slot load badge on the very same row.
4. **The day header understated the work.** `totalSets` is the planned muscle-group volume,
   which deliberately excludes weak-side and corrective sets so the audit is not inflated — but
   the header printed it as plain "sets". A day reading *26.5 sets* had 40.5 performed. It now
   reads `26.5 + 14 sets`.
5. **"DEEP FIT" was still on the page.** The old working title survives in one `injury.json`
   copy string, the medical disclaimer. The data files are generated upstream and never edited
   here, so the product name is substituted at render time instead.
6. **The Weight column was clipped, not scrollable.** The day card carried `overflow-hidden`
   for its rounded corners; adding a seventh column made that reachable, so at narrower widths
   the weights were simply unreachable. The tables now scroll inside the card.

Items 1–3 share one root cause and are pinned by two checks (a 545-block sweep, 48 of them a
different structure from the program they sit in). Items 4–6 are presentational and remain
verifiable only by looking.

### A display bug the suite structurally cannot catch

VALD's one job is putting extra sets on **one side**, and the program table was hiding it. The
`Sets × reps` column printed the base figure only — `4 × 8–12` — with the extra sets relegated
to a badge and a hover tooltip. A coach reading the column would prescribe 4 sets per side and
miss the weak side's extra work entirely, which is the whole output of the layer. The Load
column had been showing both sides since it was built, so the two disagreed on the same row.

Both sides are now spelled out in the column, weak side first and highlighted:

```
Bulgarian split squat        L 6 × 8–12       L 25–40 · R 32.5–52.5 kg
  ONE SIDE AT A TIME left +2 R 4 × 8–12
```

Sets and weight now tell one story — the weak side gets more sets at less weight.

Worth stating plainly: **`npm run acceptance` runs headless and renders no components, so no
number of checks there would have caught this.** The data was correct the whole time; only the
presentation was wrong. Rendering is verified by screenshotting the built site, not by the suite.

### A gap this surfaced, not yet closed: InBody is age-blind on volume

`inbody.json`'s `baseSets` is keyed **by goal only** — `{"Lose Fat":[3,4], "Build Muscle":[3,4],
"Get Stronger":[4,5]}`. The age bracket is consulted for the rest floor and the filler movement,
and **never for set counts**. Since InBody's resolved sets replace the allocation's age-adjusted
ones wholesale, any scan on a young or older client overrides the volume the age bracket was
holding down:

| Client | Weekly sets, no scan | With a plausible scan | Volume audit |
|---|---|---|---|
| Reference (18-29) | 127.5 | 107 (×0.84) | 10/11 → 9/11 |
| Older adult (65+) | 45.5 | **88.5 (×1.95)** | 10/11 → **1/11** |
| Stress test (6-12) | 25.5 | **82 (×3.22)** | 7/11 → **0/11** |

On the reference adult it behaves — it trims volume slightly and the audit barely moves. On a
68-year-old it **doubles the weekly volume**, and the scan used there is an entirely plausible
one for that client (low muscle, high body fat, normal water), not a nonsense input. Exercise
*selection* stays safe throughout, since the age and load caps run before InBody and are not
touched; this is purely a volume question.

This is left as reported rather than fixed, because the InBody stage specified that the layer
replaces the goal-keyed values and `baseSets` ships with no age dimension to clamp against —
adding one is a design decision, not a bug fix. The options are to key `baseSets` by age
upstream, or to clamp InBody's resolved sets to the allocation's age-derived figure.

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
- **Youth strength, day 3: 137 min.** There is no ceiling to exceed any more — that is a
  real session length, and it is exactly the case the time-cap button exists for. Pressed, it
  comes back inside 60.
