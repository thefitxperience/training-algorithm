# Build a DEEP FIT program generator — React test harness

Build a single-page React app that generates strength-training programs from four
JSON data files and shows enough diagnostics to judge whether the output is any good.
This is an internal test harness, not a product. Prioritise correctness and
inspectability over polish. No backend, no database, no auth.

## Stack

Vite + React + TypeScript, Tailwind for styling. Everything client-side. Load the four
JSON files as static assets from `public/data/`. No router — one page.

## Data files

Place these in `public/data/`. Do not modify them; they are generated upstream.

### `config.json`
Vocabularies and constants. Read `goals`, `levels`, `ages`, `splits`, `groups` from here
rather than hardcoding. Also contains `placeholderGroups`, `majorGroups`,
`femaleOverrides`, `maleOverrides`, `timeCeiling`, `warmupMinutes`, `repsMid`, `restMid`,
`indirectCredit`.

### `allocation.json` (~3 MB)
The pre-computed program skeleton. Keyed by
`"{split}|{goal}|{age}|{level}|{days}"` — 2,205 blocks.

```jsonc
{
  "Upper / Lower|Build Muscle|18-29|Intermediate|4": {
    "deliveredDays": 4,          // may be fewer than requested (age cap / split merge)
    "note": "",                  // e.g. "age cap: runs as 3 days"
    "cap": 10,                   // max exercises in a session
    "days": [
      { "label": "Upper",
        "slots": [ ["Extension", 1, 2.5], ["Horizontal pull", 1, 3.5] ] }
      // each slot = [subRegion, exerciseCount, setsPerExercise]
    ],
    "targets":   { "Chest": 12.0, ... },   // weekly sets per muscle group
    "delivered": { "Chest": 11.8, ... }    // what this allocation should achieve
  }
}
```

**Important:** `setsPerExercise` varies by muscle group. Use the value in the slot, not
a global constant.

### `exercises.json`
315 exercises.

```jsonc
{ "id": 2, "name": "Incline bench press 30-45", "group": "Chest",
  "sub": "Upper (incline)", "equipment": "BB / DB / Smith",
  "alsoTrains": ["Front", "Lateral-medial (lockout)"],
  "type": "compound",        // compound | isolation | carry | isometric | mobility
  "tier": "primary",         // primary | secondary | accessory  (within its sub-region)
  "skill": 3,                // 1-5 coaching/coordination demand
  "load": 5,                 // 1-5 how heavily it can be loaded
  "avoidAges": [],           // e.g. ["6-12","65+"]
  "mainLift": true }
```

### `prescription.json`
Reps and rest per client. Keyed `"{sex}|{days}|{age}|{level}"`, then by goal:
`{ "reps": "8-12", "rest": "60-90", "setsRange": "3-4" }`.
Reps and rest are display strings. **Sets come from the allocation, not from here.**

### `splits.json`
Badges, keyed `"{goal}|{days}|{level}|{split}"` (age 18-29 only):
`{ "badge": "Recommended", "majorFreq": 2, "volumePct": 0.95, "pattern": "...", "note": "" }`

## The generation algorithm

Given sex, age (years), level, goal, days, split and week number:

1. Map age in years to a bracket: `6-12, 13-17, 18-29, 30-39, 40-49, 50-64, 65+`.
2. Look up the allocation block. If the key is missing, show a clear error.
3. For each day, for each slot, pick `exerciseCount` real exercises for that sub-region.
4. Attach reps and rest from `prescription.json`, and sets from the slot.

### Exercise eligibility — all must pass

- `type !== "mobility"` — a stretch is never issued as a working set.
- The client's age bracket is not in `avoidAges`.
- Beginner: `skill <= 2`. Intermediate: `skill <= 4`. Advanced: any.
- Age `6-12`: `load <= 3`. Age `65+`: `load <= 4` **and** `skill <= 3`.
- Age `13-17` **and** Beginner: `load <= 4`.

### Ranking among eligible candidates

Sort by, in order:
1. If goal is `Get Stronger`, `mainLift === true` first.
2. Tier: primary, then secondary, then accessory.
3. Higher `load` first.
4. `id` ascending, as a stable tie-break.

### Sub-region rotation by week

Within a muscle group, rotate which sub-region gets the best pick based on the week
number, so a client repeating the program doesn't do identical sessions. Rotating the
candidate ordering by `(week - 1)` is enough.

### Fallback cascade

1. Eligible and not yet used this week → take the top-ranked one.
2. Eligible but already used this week → reuse it, and record a warning.
3. Nothing eligible in this sub-region → substitute from a **sibling sub-region in the
   same muscle group**, and record a warning.
4. Still nothing → drop the slot and record a warning.

**Never substitute across muscle groups.** Volume targets are group-level; a cross-group
swap silently corrupts them.

### Session length

`minutes = sum(sets across the day) * (repsMid[goal] * 3 + restMid[goal]) / 60 + warmupMinutes`

Flag any session exceeding `timeCeiling[goal]`.

## UI

### Left panel — client input
Sex, age (number), level, goal, days per week, split, week number (1-4). Use the
vocabularies from `config.json`. Regenerate on change.

Show the split's badge from `splits.json` next to the split selector, colour-coded
(Recommended green, Available amber, Adjusted grey), with `volumePct` and `majorFreq` on
hover. When the selected level or age has no matching badge row, say so rather than
showing a stale one.

### Main panel — the program
A card per day: label, exercise count, estimated minutes. Then a table: exercise,
muscle group, sub-region, sets × reps, rest, equipment. Mark main lifts with a badge.
Show a warning banner listing any fallback events.

If `deliveredDays < days requested`, show a prominent notice with the `note` explaining
why — this is a real outcome the client must see, not an error to hide.

### Right panel — volume audit
This is the point of the harness. A table of all 15 muscle groups: target sets/week,
delivered, ratio, colour-coded (green 0.75–1.25, amber 0.6–1.5, red outside).
Mark the four `placeholderGroups` visually and note that they're deliberately
deprioritised. Show a summary line: "N of 11 substantive groups within ±25%".

Compute delivered independently from the chosen exercises rather than reading the
`delivered` field — that way the audit actually validates the pipeline. Use:

```
delivered[group] = sum over chosen exercises of:
    (exercise.group === group ? sets : 0)
  + indirectCredit * sets * (count of alsoTrains entries mapping to that group)
```

Map an `alsoTrains` sub-region name to its group using `exercises.json`. Then apply the
sex overrides from `config.json` to the **targets** (female: glutes +3, traps −2 with a
floor of 2; male: chest/lats/delts/triceps +1.5). Display the recomputed delivered
alongside the allocation's expected `delivered` so a divergence is visible.

### Preset buttons
Five presets for regression testing:

| | Sex | Age | Level | Goal | Days | Split |
|---|---|---|---|---|---|---|
| Reference | Male | 28 | Intermediate | Build Muscle | 4 | Upper / Lower |
| New client | Female | 34 | Beginner | Lose Fat | 3 | Full Body |
| Youth strength | Male | 17 | Advanced | Get Stronger | 5 | Push / Pull / Legs |
| Older adult | Female | 68 | Beginner | Get Stronger | 4 | Upper / Lower |
| Stress test | Male | 10 | Beginner | Build Muscle | 5 | Muscle Group Per Day |

## Expected behaviour — treat as acceptance criteria

- **Reference**: 4 days, ~40 exercises, sessions roughly 54–75 min, no fallback warnings.
- **Older adult**: no ab wheel rollout, no deep full-ROM squat, no pull-up, no Copenhagen
  plank. Expect machine and cable work, goblet squats, chest-supported rows.
- **Stress test**: 5 days requested must come back as **3 days delivered** with the age-cap
  note shown, and no exercise with `load > 3`.
- **Youth strength**: Get Stronger days should open on main lifts.
- Changing only the week number must change some exercise selections but not the
  muscle-group volumes.
- No preset should produce a mobility-type exercise prescribed with sets and reps.

## Watch out for

- `allocation.json` is 3 MB. Load it once and memoise; don't refetch per render.
- Keys contain spaces and slashes (`"Upper / Lower|..."`). Build them by joining with `|`,
  don't URL-encode.
- Sub-region names differ slightly between files in eight cases. `exercises.json` has
  already been normalised to the allocation's spelling — join on `sub` directly and don't
  "helpfully" fuzzy-match.
- Sets can be fractional (2.5, 1.5). Display them as-is; don't round to integers.
- Age bracket `65+` ends in a plus. Compare as a string against the bracket list, don't parse.

## Deliverable

Working `npm run dev`. A short README covering how to run it, where the data comes from,
and any acceptance criterion that doesn't currently pass.
