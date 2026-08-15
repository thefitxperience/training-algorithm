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

**Everything in `public/data/` becomes publicly downloadable** — all six JSON files,
including the 3 MB `allocation.json`. It's a static site, so the browser has to be able to
fetch them; there is no way to publish this and keep the data private. GitHub Pages on a
free account also requires a **public repo**. If either matters, this needs a host with
access control rather than Pages.

## Data

Six files in `public/data/`, served as static assets and fetched once at startup:

| File | What it is |
|---|---|
| `config.json` | vocabularies (goals, levels, ages, splits, groups) and constants |
| `allocation.json` | ~3 MB pre-computed skeleton, 2,205 blocks keyed `{split}\|{goal}\|{age}\|{level}\|{days}` |
| `exercises.json` | 315 exercises |
| `prescription.json` | reps/rest keyed `{sex}\|{days}\|{age}\|{level}` then by goal |
| `splits.json` | split badges keyed `{goal}\|{days}\|{level}\|{split}` (age 18-29 only) |
| `injury.json` | 18 pains, their rules, load-tag glossary, per-exercise injury records, and UI copy |

They are generated upstream and are **not modified** by this app. `loadData()` in
[src/data/load.ts](src/data/load.ts) caches the fetch promise at module scope, so
`allocation.json` is fetched and parsed exactly once per page load regardless of renders.

Client state and the view mode are mirrored into the query string, so any program is a
linkable regression case: `?preset=Stress%20test&view=detailed`, or
`?sex=Male&age=28&level=Intermediate&…`. Pains ride along too, and layer on top of a preset:
`?preset=Reference&pains=SHOULDER:Left,LOWBACK:Both`.

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

`npm run acceptance` → **47 of 47 checks pass**. The five presets all run at `Full gym`, so
the original criteria are unaffected by the equipment feature; the rest cover equipment
tiers, split advice, set rounding and the injury layer. Note the count dropped to 22/22 at one point because
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
