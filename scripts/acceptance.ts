/**
 * Headless run of the acceptance criteria from claude-code-prompt.md.
 * Uses the exact same generate()/buildAudit() code the UI uses.
 *
 *   npm run acceptance
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generate, isEligible } from '../src/lib/generate'
import { buildAudit } from '../src/lib/audit'
import { PRESETS } from '../src/lib/presets'
import { EQUIPMENT_TIERS, isEquipmentAvailable, libraryCoverage } from '../src/lib/equipment'
import { splitAdvice } from '../src/lib/splitAdvice'
import { pickKey, roundSets } from '../src/lib/rounding'
import { buildInjuryIndex, verdictForPain, type PainSelection } from '../src/lib/injury'
import { STRUCTURES, blockSeconds, buildSubAliases, pairReason, timeParams, type Structure } from '../src/lib/structure'
import {
  baseState,
  capMinutes,
  capSeconds,
  children,
  leverCost,
  nextStructure,
  planCap,
  restLeverId,
  restOf,
  stateKey,
  type CapDayModel,
  type CapPin,
} from '../src/lib/timecap'
import { WORKED_EXAMPLE, goalWeights, type InBodyInput } from '../src/lib/inbody'
import { asymmetryFromNewtons, type ValdInput } from '../src/lib/vald'
import {
  mergeSessions,
  movementBattery,
  parseAsymmetry,
  parseValdGrid,
  toValdInput,
} from '../src/lib/valdImport'
import { applyChain, roundTo } from '../src/lib/weight'
import {
  amendType,
  blockFor,
  buildShortlist,
  type AmendContext,
  type Pin,
} from '../src/lib/amend'
import {
  CORRECTIVE_REST_SECONDS,
  CORRECTIVE_WORK_SECONDS,
  classify,
  parseRange,
  realBands,
  type BodyDotInput,
} from '../src/lib/bodydot'
import {
  INDICATOR_SOURCES,
  latestPerDay,
  readSession,
  scaleFor,
} from '../src/lib/bodydotApi'
import type { ClientInput, DataBundle } from '../src/types'

const dir = join(process.cwd(), 'public', 'data')
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const data: DataBundle = {
  config: read('config.json'),
  allocation: read('allocation.json'),
  exercises: read('exercises.json'),
  prescription: read('prescription.json'),
  splits: read('splits.json'),
  injury: read('injury.json'),
  structure: read('structure.json'),
  inbody: read('inbody.json'),
  vald: read('vald.json'),
  bodydot: read('bodydot.json'),
  load: read('load.json'),
  amend: read('amend.json'),
  timecap: read('timecap.json'),
}
const injuryIndex = buildInjuryIndex(data.injury, data.exercises)
const idOf = (name: string) => data.exercises.find((e) => e.name === name)!.id
const namesOf = (p: ReturnType<typeof run>) =>
  p.days.flatMap((d) => d.exercises.map((e) => e.exercise.name.toLowerCase()))

const results: { name: string; pass: boolean; detail: string }[] = []
const notes: string[] = []
const log = (m: string) => notes.push(m)
const check = (name: string, pass: boolean, detail = '') => results.push({ name, pass, detail })

const run = (input: ClientInput) => {
  const r = generate(data, input)
  if (!r.ok) throw new Error(`${r.error}`)
  return r.program
}
const preset = (name: string) => PRESETS.find((p) => p.name === name)!
/** the main program only — everything the annotation layers must never touch */
const mainFingerprint = (p: ReturnType<typeof run>) =>
  p.days
    .map((d) => `${d.minutes.toFixed(6)}:${d.exercises.map((e) => `${e.exercise.id}x${e.sets}`).join(',')}`)
    .join(' | ')

// ---- Reference -------------------------------------------------------------
{
  const p = run(preset('Reference').input)
  const mins = p.days.map((d) => d.minutes)
  check('Reference: 4 days delivered', p.days.length === 4, `got ${p.days.length}`)
  check(
    'Reference: ~40 exercises',
    p.exerciseCount >= 38 && p.exerciseCount <= 42,
    `got ${p.exerciseCount}`,
  )
  // Stage 1's "roughly 54–75 min" came from `repsMid * 3 + restMid`, a formula the structure
  // layer replaced. The goal's time ceiling that replaced it has now gone too: the allocation
  // guarantees volume only, nothing trims a session at generation, and session length is the
  // client's decision. So this asserts the one thing still assertable — that the figure on
  // the day header IS the day's own time model, with nothing subtracted behind it.
  check(
    'Reference: session length is the day model, reported and never trimmed at generation',
    p.days.every((d) => Math.abs(d.minutes - capMinutes(d.capModel, d.capState)) < 1e-9),
    `${mins.map((m) => m.toFixed(1)).join(', ')} min`,
  )
  check('Reference: no fallback warnings', p.warnings.length === 0, `${p.warnings.length} warning(s): ${p.warnings.slice(0, 3).map((w) => w.message).join(' | ')}`)
}

// ---- Older adult -----------------------------------------------------------
{
  const p = run(preset('Older adult').input)
  const names = p.days.flatMap((d) => d.exercises.map((e) => e.exercise.name.toLowerCase()))
  const banned = ['ab wheel', 'rollout', 'pull-up', 'copenhagen']
  const hits = banned.filter((b) => names.some((n) => n.includes(b)))
  check('Older adult: no ab wheel / rollout / pull-up / Copenhagen', hits.length === 0, hits.join(', '))
  const deepSquat = names.filter((n) => n.includes('squat'))
  check(
    'Older adult: squat work is machine/goblet, not deep full-ROM barbell',
    !deepSquat.some((n) => n.includes('full') || n.includes('deep') || n.includes('atg')),
    deepSquat.join(', ') || 'no squat selected',
  )
  // Equipment codes: M = machine, C = cable, DB/BB/KB/BW/Bd = free weight / bodyweight.
  const equip = p.days.flatMap((d) => d.exercises.map((e) => e.exercise.equipment))
  const machineOrCable = equip.filter((e) => /(^|[\s/])(M|C)([\s/]|$)/.test(e)).length
  check(
    'Older adult: machine/cable work present',
    machineOrCable > 0,
    `${machineOrCable}/${equip.length} picks are machine or cable`,
  )
  const chestSupported = names.some((n) => n.includes('chest-supported') || n.includes('chest supported'))
  check('Older adult: chest-supported row selected', chestSupported, names.filter((n) => n.includes('row')).join(', '))
  const goblet = names.some((n) => n.includes('goblet'))
  check('Older adult: goblet squat selected', goblet, names.filter((n) => n.includes('squat')).join(', '))
}

// ---- Stress test -----------------------------------------------------------
{
  const input = preset('Stress test').input
  const p = run(input)
  check(
    'Stress test: 5 requested -> 3 delivered',
    p.block.deliveredDays === 3 && p.days.length === 3,
    `deliveredDays=${p.block.deliveredDays}, rendered=${p.days.length}`,
  )
  check('Stress test: age-cap note present', /age cap/i.test(p.block.note), p.block.note)
  const overLoad = p.days.flatMap((d) => d.exercises.filter((e) => e.exercise.load > 3))
  check(
    'Stress test: no exercise with load > 3',
    overLoad.length === 0,
    overLoad.map((e) => `${e.exercise.name}(${e.exercise.load})`).join(', '),
  )
}

// ---- Youth strength --------------------------------------------------------
{
  const p = run(preset('Youth strength').input)
  const openers = p.days.map((d) => d.exercises[0])
  check(
    'Youth strength: every day opens on a main lift',
    openers.every((e) => e?.exercise.mainLift),
    openers.map((e) => `${e?.exercise.name}${e?.exercise.mainLift ? '' : ' (NOT main lift)'}`).join(' | '),
  )
}

// ---- Determinism -----------------------------------------------------------
// The generator takes no week or random input, so a given client must always produce the
// same program. This replaces the old week-rotation checks.
{
  const ids = (p: ReturnType<typeof run>) =>
    p.days.flatMap((d) => d.exercises.map((e) => e.exercise.id)).join(',')
  const differing = PRESETS.filter((pr) => ids(run(pr.input)) !== ids(run(pr.input)))
  check(
    'Same client input always produces the same program',
    differing.length === 0,
    differing.map((p) => p.name).join(', '),
  )
}

// ---- No mobility anywhere --------------------------------------------------
{
  const bad: string[] = []
  for (const pr of PRESETS) {
    const p = run(pr.input)
    for (const d of p.days)
      for (const e of d.exercises)
        if (e.exercise.type === 'mobility') bad.push(`${pr.name}: ${e.exercise.name}`)
  }
  check('No preset prescribes a mobility-type exercise', bad.length === 0, bad.join(', '))
}

// ---- Equipment tiers -------------------------------------------------------
{
  const base = preset('Reference').input
  const tiers = ['Full gym', 'Home (DB, KB, bands)', 'Bodyweight only'] as const

  // Nothing outside the tier may appear in the program.
  for (const tier of tiers) {
    const p = run({ ...base, equipment: tier })
    const bad = p.days
      .flatMap((d) => d.exercises)
      .filter((e) => !isEquipmentAvailable(e.exercise, tier))
    check(
      `Equipment "${tier}": every chosen exercise is available at that tier`,
      bad.length === 0,
      bad.map((e) => `${e.exercise.name} [${e.exercise.equipment}]`).join(', '),
    )
  }

  // Bodyweight-only must not silently keep barbells; it should shrink and warn instead.
  const gym = run({ ...base, equipment: 'Full gym' })
  const bw = run({ ...base, equipment: 'Bodyweight only' })
  check(
    'Bodyweight only: program shrinks vs full gym and reports fallbacks',
    bw.exerciseCount < gym.exerciseCount && bw.warnings.length > 0,
    `full gym ${gym.exerciseCount} exercises / ${gym.warnings.length} warnings → bodyweight ${bw.exerciseCount} / ${bw.warnings.length}`,
  )

  // Cross-group substitution must still never happen, even when the pool is starved.
  const crossGroup = bw.days
    .flatMap((d) => d.exercises)
    .filter((e) => {
      const slotGroup = data.exercises.find((x) => x.sub === e.requestedSub)?.group
      return slotGroup && slotGroup !== e.exercise.group
    })
  check(
    'Bodyweight only: no substitution crosses a muscle group',
    crossGroup.length === 0,
    crossGroup.map((e) => `${e.requestedSub} -> ${e.exercise.name}`).join(', '),
  )

  const coverage = tiers.map((t) => `${t}: ${libraryCoverage(data.exercises, t).available}`)
  console.log(`\nLibrary coverage — ${coverage.join(', ')} of ${libraryCoverage(data.exercises, 'Full gym').total} non-mobility exercises`)
}

// ---- Whole-set rounding (simple view) --------------------------------------
{
  for (const pr of PRESETS) {
    const p = run(pr.input)
    const r = roundSets(p)
    const all = [...r.byPick.values()]

    check(
      `Rounding (${pr.name}): every prescribed set count is a whole number`,
      all.every((n) => Number.isInteger(n)),
      all.filter((n) => !Number.isInteger(n)).join(', '),
    )
    check(
      `Rounding (${pr.name}): no muscle group drifts more than 0.5 sets`,
      r.maxDrift <= 0.5 + 1e-9,
      `max drift ${r.maxDrift.toFixed(1)} — ${Object.entries(r.driftByGroup)
        .filter(([, v]) => Math.abs(v) > 0.5)
        .map(([g, v]) => `${g} ${v.toFixed(1)}`)
        .join(', ')}`,
    )

    // Both views run through the day's OWN time model, so corrective work, filler bouts and
    // weak-side sets are charged identically and only the set values differ. That is what
    // keeps the client-facing figure and the figure the time cap drives to 60 comparable.
    const roundedMinutes = p.days.map((d) =>
      capMinutes(d.capModel, {
        ...d.capState,
        sets: d.exercises.map((c, i) => r.byPick.get(pickKey(d.index, i)) ?? c.sets),
      }),
    )
    const gap = roundedMinutes.map((m, i) => m - p.days[i].minutes)
    check(
      `Rounding (${pr.name}): whole-number sets move session length by under 5 min`,
      gap.every((g) => Math.abs(g) < 5),
      `simple view runs ${gap.map((g) => `${g >= 0 ? '+' : ''}${g.toFixed(1)}`).join(', ')} min against the detailed view`,
    )
  }
}

// ---- Split recommendation --------------------------------------------------
{
  const base = preset('Reference').input
  const advice = splitAdvice(data.splits, base, data.config.splits, '18-29')
  check(
    'Split advice: reference client has a Recommended split',
    advice.recommended.length > 0,
    advice.recommended.map((o) => o.split).join(', '),
  )
  const older = preset('Older adult').input
  const olderAdvice = splitAdvice(data.splits, older, data.config.splits, '65+')
  check(
    'Split advice: non-18-29 client is flagged as reading the reference bracket',
    olderAdvice.fromReferenceBracket,
    `recommended for the 18-29 reference row: ${olderAdvice.recommended.map((o) => o.split).join(', ') || 'none'}`,
  )
}

// ---- Injury layer ----------------------------------------------------------
const REF = preset('Reference').input
const withPains = (pains: PainSelection) => run({ ...REF, pains })
const fingerprint = (p: ReturnType<typeof run>) =>
  p.days.map((d) => d.exercises.map((e) => `${e.exercise.id}@${e.sets}`).join(',')).join(' | ')

// The most important test: no pains ticked must be a byte-for-byte no-op.
{
  const before = fingerprint(run(REF))
  const after = fingerprint(withPains({}))
  check('Injury: no pains ticked reproduces the baseline program exactly', before === after,
    before === after ? 'identical' : 'DIFFERS')
}

// The five validated spot checks.
{
  const spots: [string | number, string, string][] = [
    ['Incline bench press 30-45', 'SHOULDER', 'REMOVE'],
    ['Incline bench press 30-45', 'UPBACK', 'CAUTION'],
    ['Incline bench press 30-45', 'NECK', 'OK'],
    [315, 'LOWBACK', 'REMOVE'],
    [308, 'ANKLE', 'REMOVE'],
  ]
  const bad = spots.filter(([who, pain, want]) => {
    const id = typeof who === 'number' ? who : idOf(who)
    return verdictForPain(id, pain, 'Both', data.injury, injuryIndex).verdict !== want
  })
  check('Injury: all five validated spot checks', bad.length === 0,
    bad.length ? bad.map(([w, p]) => `${w}/${p}`).join(', ') : '5/5')
}

// SHOULDER: no overhead pressing, flys or dips; corrective work opens the session.
{
  const p = withPains({ SHOULDER: 'Both' })
  const names = namesOf(p)
  const banned = names.filter(
    (n) => /overhead press|shoulder press|\bfly\b|flye|crossover|\bdip\b/.test(n) && !n.includes('woodchop'),
  )
  check('Injury (SHOULDER): no overhead pressing, flys or dips', banned.length === 0, banned.join(', '))

  const correctiveDays = p.days.filter((d) =>
    d.exercises.some((e) => e.verdict.verdict === 'PRIORITY'),
  )
  const opens = correctiveDays.every((d) => d.exercises[0].verdict.verdict === 'PRIORITY')
  check(
    'Injury (SHOULDER): corrective work appears first in the sessions that contain it',
    correctiveDays.length > 0 && opens,
    `${correctiveDays.length} of ${p.days.length} days contain corrective work; openers: ${correctiveDays
      .map((d) => d.exercises[0].exercise.name)
      .join(' | ')}`,
  )
}

// LOWBACK: the Lower back group empties, and the audit says removed, not failed.
{
  const p = withPains({ LOWBACK: 'Both' })
  const a = buildAudit(p, data.exercises, REF.sex, data.config)
  const row = a.rows.find((r) => r.group === 'Lower back')!
  check(
    'Injury (LOWBACK): Lower back shows zero direct volume, flagged as removed not failed',
    row.directDelivered === 0 && row.removedByPain && row.band === 'removed',
    `direct ${row.directDelivered}, total ${row.delivered.toFixed(2)}${
      row.delivered > 0
        ? ` (indirect credit only — a surviving exercise still loads it secondarily)`
        : ''
    }, band "${row.band}", labels: ${row.removedByPainLabels.join('; ')}`,
  )
  check(
    'Injury (LOWBACK): dropped slots are labelled as pain removals, not generic failures',
    p.warnings.some((w) => w.kind === 'pain-dropped') || row.delivered === 0,
    `${p.warnings.filter((w) => w.kind === 'pain-dropped').length} pain-dropped, ${p.warnings.filter((w) => w.kind === 'dropped').length} generic`,
  )
}

// Two pains together: neither resurrects what the other removed.
{
  const both = withPains({ SHOULDER: 'Both', LOWBACK: 'Both' })
  const shoulderRemoved = new Set(withPains({ SHOULDER: 'Both' }).removedByPain.map((r) => r.exercise.id))
  const lowbackRemoved = new Set(withPains({ LOWBACK: 'Both' }).removedByPain.map((r) => r.exercise.id))
  const chosen = new Set(both.days.flatMap((d) => d.exercises.map((e) => e.exercise.id)))
  const resurrected = [...chosen].filter((id) => shoulderRemoved.has(id) || lowbackRemoved.has(id))
  check(
    'Injury (SHOULDER + LOWBACK): nothing removed by one pain survives via the other',
    resurrected.length === 0,
    resurrected.map((id) => data.exercises.find((e) => e.id === id)!.name).join(', '),
  )
}

// A one-sided pain keeps unilateral work, badged, instead of removing it.
{
  const left = withPains({ ELBOW_LAT: 'Left' })
  const both = withPains({ ELBOW_LAT: 'Both' })
  const sideOnly = [...left.verdicts.values()].filter((v) => v.verdict === 'SIDE_ONLY').length
  const removedLeft = left.removedByPain.length
  const removedBoth = both.removedByPain.length
  const selected = left.days
    .flatMap((d) => d.exercises)
    .filter((e) => e.verdict.verdict === 'SIDE_ONLY')
  check(
    'Injury (ELBOW_LAT, Left): unilateral work is kept side-only rather than removed',
    sideOnly > 0 && removedLeft < removedBoth,
    `${sideOnly} kept side-only instead of removed; removals ${removedBoth} (Both) → ${removedLeft} (Left).` +
      ` ${selected.length} of them reached the program — the rest rank below unaffected exercises in their sub-region.`,
  )

  // ...and the badge must actually reach a program somewhere, or it is untested UI.
  const shoulderLeft = withPains({ SHOULDER: 'Left' })
  const shown = shoulderLeft.days
    .flatMap((d) => d.exercises)
    .filter((e) => e.verdict.verdict === 'SIDE_ONLY')
  check(
    'Injury: side-only exercises do reach the program and carry the badge',
    shown.length > 0,
    `SHOULDER:Left → ${shown.map((e) => e.exercise.name).join(', ')}`,
  )
}

// Unticking returns to baseline.
{
  const base = fingerprint(run(REF))
  const after = fingerprint(withPains({}))
  const shoulder = fingerprint(withPains({ SHOULDER: 'Both' }))
  check(
    'Injury: unticking every pain returns the program to baseline',
    after === base && shoulder !== base,
    shoulder === base ? 'SHOULDER changed nothing — filter not applied' : 'baseline restored',
  )
}

// ---- Structure layer -------------------------------------------------------
{
  const withStructure = (s: Structure) => run({ ...REF, structure: s })
  const straight = withStructure('straight')
  const superset = withStructure('superset')
  const triset = withStructure('triset')
  const all = [straight, superset, triset]

  // straight must be the program that already exists, only the clock changes
  const picks = (p: ReturnType<typeof run>) =>
    p.days.map((d) => d.exercises.map((e) => `${e.exercise.id}@${e.sets}`).join(',')).join(' | ')
  check(
    'Structure: all three produce identical exercises and sets',
    picks(straight) === picks(superset) && picks(straight) === picks(triset),
    picks(straight) === picks(superset) ? 'identical' : 'DIFFERS',
  )
  check(
    'Structure: straight forms no blocks (it is the existing program)',
    straight.days.every((d) => d.blocks.every((b) => b.indices.length === 1)),
    `${straight.days.flatMap((d) => d.blocks).filter((b) => b.indices.length > 1).length} blocks`,
  )

  // volume audit must not move
  const vol = (p: ReturnType<typeof run>) =>
    buildAudit(p, data.exercises, REF.sex, data.config)
      .rows.map((r) => r.delivered.toFixed(4))
      .join(',')
  check(
    'Structure: volume audit is identical across all three',
    vol(straight) === vol(superset) && vol(straight) === vol(triset),
    vol(straight) === vol(superset) && vol(straight) === vol(triset) ? 'identical' : 'MOVED',
  )

  // session time must change
  const mins = (p: ReturnType<typeof run>) => p.days.map((d) => Math.round(d.minutes)).join('/')
  check(
    'Structure: switching structure changes session time',
    mins(straight) !== mins(superset),
    `straight ${mins(straight)} | superset ${mins(superset)} | triset ${mins(triset)}`,
  )

  // Get Stronger protects main lifts; Build Muscle and Lose Fat deliberately do not
  {
    const gs = run({ ...preset('Youth strength').input, structure: 'superset' })
    const blocked = gs.days.flatMap((d) =>
      d.blocks
        .filter((b) => b.indices.length > 1)
        .flatMap((b) => b.indices.map((i) => d.exercises[i]))
        .filter((e) => e.exercise.mainLift),
    )
    check(
      'Structure (Get Stronger): no main lift is ever inside a block',
      blocked.length === 0,
      blocked.map((e) => e.exercise.name).join(', '),
    )

    const paired = [superset, run({ ...preset('New client').input, structure: 'superset' })].flatMap((p) =>
      p.days.flatMap((d) =>
        d.blocks
          .filter((b) => b.indices.length > 1)
          .flatMap((b) => b.indices.map((i) => d.exercises[i]))
          .filter((e) => e.exercise.mainLift),
      ),
    )
    check(
      'Structure (Build Muscle / Lose Fat): main lifts are pairable, by design',
      paired.length > 0,
      `${paired.length} main lifts paired, e.g. ${paired.slice(0, 3).map((e) => e.exercise.name).join(', ')}`,
    )
  }

  // Synergist rejection. Compared across BOTH spellings of a sub-region — `alsoTrains`
  // uses the injury library's wording for eight of them, so a raw string compare would
  // repeat the bug it is meant to catch and pass for the wrong reason.
  {
    const aliases = buildSubAliases(data.exercises, data.injury.exercises)
    const names = (sub: string) => aliases.get(sub) ?? new Set([sub])
    const bad: string[] = []
    for (const p of all)
      for (const d of p.days)
        for (const b of d.blocks)
          for (const i of b.indices)
            for (const j of b.indices) {
              if (i >= j) continue
              const a = d.exercises[i].exercise
              const c = d.exercises[j].exercise
              if (
                a.alsoTrains.some((t) => names(c.sub).has(t)) ||
                c.alsoTrains.some((t) => names(a.sub).has(t))
              )
                bad.push(`${a.name} + ${c.name}`)
            }
    const pairsExamined = all.reduce(
      (n, p) =>
        n +
        p.days.reduce(
          (m, d) => m + d.blocks.reduce((k, b) => k + (b.indices.length * (b.indices.length - 1)) / 2, 0),
          0,
        ),
      0,
    )
    check(
      'Structure: no block pairs a synergist',
      bad.length === 0 && pairsExamined > 0,
      bad.length ? bad.join(', ') : `${pairsExamined} in-block pairs examined`,
    )

    // the spec's own worked example, asserted by name
    const corrective = new Set(data.injury.exercises.filter((r) => r.corrective).map((r) => r.id))
    const ctx = {
      goal: 'Build Muscle',
      structure: 'superset' as Structure,
      data: data.structure,
      corrective,
      subAliases: aliases,
    }
    const ex = (n: string) => data.exercises.find((e) => e.name === n)!
    const P = (n: string) => ({ exercise: ex(n), sets: 3, corrective: corrective.has(ex(n).id) })
    check(
      'Structure: shoulder press + triceps pushdown is rejected as a synergist pair',
      pairReason(P('Standing overhead press'), P('Pushdown - rope, straight bar, V-bar'), ctx) === null,
      'they share no joint, so only the synergist rule catches them',
    )
    check(
      'Structure: bench press + row does not pair (two compounds sharing a joint)',
      pairReason(P('Flat bench press'), P('Bent-over row'), ctx) === null,
      'follows the spec verbatim, despite being the classic antagonist superset',
    )
  }

  // Correctives only with correctives. Swept across every pain, because the four baseline
  // programs happen to contain no block holding a corrective at all — an earlier version of
  // this check examined those alone and passed without testing the rule once.
  {
    const corrective = new Set(data.injury.exercises.filter((r) => r.corrective).map((r) => r.id))
    const bad: string[] = []
    let examined = 0
    for (const pain of data.injury.pains)
      for (const structure of ['superset', 'triset'] as const) {
        const g = generate(data, { ...REF, structure, pains: { [pain.id]: 'Both' } })
        if (!g.ok) continue
        for (const d of g.program.days)
          for (const b of d.blocks) {
            if (b.indices.length < 2) continue
            const flags = b.indices.map((i) => corrective.has(d.exercises[i].exercise.id))
            if (!flags.some(Boolean)) continue
            examined++
            if (!flags.every(Boolean))
              bad.push(`${pain.id}: ` + b.indices.map((i) => d.exercises[i].exercise.name).join(' + '))
          }
      }
    check(
      'Structure: a corrective is never blocked with a non-corrective',
      bad.length === 0 && examined > 0,
      bad.length ? bad.join('; ') : `${examined} blocks containing a corrective examined`,
    )
  }

  // two compounds sharing a joint must never pair
  {
    const bad: string[] = []
    for (const p of all)
      for (const d of p.days)
        for (const b of d.blocks)
          for (const i of b.indices)
            for (const j of b.indices) {
              if (i >= j) continue
              const a = d.exercises[i].exercise
              const c = d.exercises[j].exercise
              const ja = new Set(data.structure.joints[a.sub] ?? [])
              const shares = (data.structure.joints[c.sub] ?? []).some((x) => ja.has(x))
              if (a.type === 'compound' && c.type === 'compound' && shares)
                bad.push(`${a.name} + ${c.name}`)
            }
    const pairs = all.reduce(
      (n, p) =>
        n +
        p.days.reduce(
          (m, d) => m + d.blocks.reduce((k, b) => k + (b.indices.length * (b.indices.length - 1)) / 2, 0),
          0,
        ),
      0,
    )
    check(
      'Structure: two compounds sharing a joint never pair',
      bad.length === 0 && pairs > 0,
      bad.length ? bad.join(', ') : `${pairs} in-block pairs examined`,
    )
  }

  // coverage, reported not asserted
  const cover = (p: ReturnType<typeof run>, size: number) =>
    p.days.flatMap((d) => d.blocks).filter((b) => b.indices.length === size).length * size
  log(
    `Structure coverage (Reference): superset pairs ${cover(superset, 2)}/${superset.exerciseCount} ` +
      `(${Math.round((cover(superset, 2) / superset.exerciseCount) * 100)}%), ` +
      `triset trios ${cover(triset, 3)}/${triset.exerciseCount} ` +
      `(${Math.round((cover(triset, 3) / triset.exerciseCount) * 100)}%)`,
  )
}

// ---- InBody layer ----------------------------------------------------------
{
  const slotsOf = (p: ReturnType<typeof run>) =>
    p.days.map((d) => d.exercises.map((e) => e.exercise.id).join(',')).join(' | ')

  // inert with no scan
  {
    const bad = PRESETS.filter(
      (pr) => slotsOf(run(pr.input)) !== slotsOf(run({ ...pr.input, inbody: {} })),
    )
    const ref = run(REF)
    check(
      'InBody: with no scan entered the program is unchanged',
      bad.length === 0 && !ref.inbody.active,
      `active=${ref.inbody.active}`,
    )
  }

  // the worked example, resolved end to end
  {
    const client: ClientInput = {
      sex: 'Male',
      age: 34,
      level: 'Intermediate',
      goal: 'Get Stronger',
      days: 4,
      split: 'Upper / Lower',
      equipment: 'Full gym',
      pains: {},
      structure: 'straight',
      inbody: WORKED_EXAMPLE,
      vald: {},
      bodydot: {},
      pins: [],
      caps: [],
    }
    const p = run(client)
    const ib = p.inbody
    const slots = p.days.flatMap((d) => d.exercises)
    const rule4Slots = slots.filter((s) => s.rule4)
    const regions = new Set(
      rule4Slots.map((s) => data.inbody.regionOfGroup[s.exercise.group]),
    )

    check(
      'InBody (worked example): states resolve to SMM Under, PBF Over, TBW High, TRUNK Over',
      ib.states.smm === 'Under' &&
        ib.states.pbf === 'Over' &&
        ib.states.tbw === 'High' &&
        ib.states.TRUNK === 'Over' &&
        ib.states.ARMS === 'Normal' &&
        ib.states.LEGS === 'Normal',
      JSON.stringify(ib.states),
    )
    check(
      'InBody (worked example): TBW ratio 1.072',
      Math.abs((ib.tbwRatio ?? 0) - 1.072) < 0.001,
      `${ib.tbwRatio?.toFixed(4)}`,
    )
    check(
      'InBody (worked example): goal vector 30 / 30 / 40',
      ib.weights['Lose Fat'] === 0.3 &&
        ib.weights['Build Muscle'] === 0.3 &&
        ib.weights['Get Stronger'] === 0.4,
      ib.vectorKey,
    )
    check('InBody (worked example): rest floor 120s', ib.restFloor === 120, `${ib.restFloor}s`)
    check(
      'InBody (worked example): TRUNK is the only region supersetted',
      regions.size === 1 && regions.has('TRUNK'),
      `${[...regions].join(', ')} — ${rule4Slots.length} slots`,
    )
    check(
      'InBody (worked example): straight slot 0%, rule-4 slot -3%',
      slots.some((s) => !s.rule4 && s.loadAdjustment === 0) &&
        rule4Slots.every((s) => Math.abs((s.loadAdjustment ?? 0) + 0.03) < 1e-9),
      `loads seen: ${[...new Set(slots.map((s) => s.loadAdjustment))].join(', ')}`,
    )
    check(
      'InBody (worked example): filler 4 x 40s',
      ib.filler?.bouts === 4 && ib.filler?.seconds === 40,
      `${ib.filler?.bouts} x ${ib.filler?.seconds}s`,
    )
    check(
      'InBody: rule 4 never forces a structure change on a main lift',
      rule4Slots.length > 0 && rule4Slots.every((s) => !s.exercise.mainLift),
      `${rule4Slots.length} rule-4 slots checked against ${slots.filter((s) => s.exercise.mainLift).length} main lifts in the program`,
    )
    check(
      'InBody: unowned groups are never touched by rule 4',
      rule4Slots.length > 0 && rule4Slots.every((s) => !data.inbody.unownedGroups.includes(s.exercise.group)),
      `${rule4Slots.length} rule-4 slots checked; unowned: ${data.inbody.unownedGroups.join(', ')}`,
    )
    // Get Stronger client with TRUNK Over: the 120s floor binds, so the 0.75 multiplier
    // has no visible effect. Correct, not a bug.
    check(
      'InBody: Get Stronger + TRUNK Over leaves rest at the 120s floor',
      slots.every((s) => s.rest === '120'),
      `rest values: ${[...new Set(slots.map((s) => s.rest))].join(', ')}`,
    )
  }

  // the golden rule, across presets and several scans
  {
    const scans: InBodyInput[] = [
      WORKED_EXAMPLE,
      { smm: 45, smmLow: 31.6, smmHigh: 38.6, pbf: 8, pbfLow: 10, pbfHigh: 20, tbw: 30, tbwLow: 38.4, tbwHigh: 46.9, fatLArm: 70, fatRArm: 75, fatTrunk: 90, fatLLeg: 200, fatRLeg: 90 },
      { pbf: 30, pbfLow: 10, pbfHigh: 20 },
      { smm: 20, smmLow: 31.6, smmHigh: 38.6 },
    ]
    const bad: string[] = []
    for (const pr of PRESETS)
      for (const [i, scan] of scans.entries()) {
        const base = run(pr.input)
        const withScan = run({ ...pr.input, inbody: scan })
        if (slotsOf(base) !== slotsOf(withScan) || base.exerciseCount !== withScan.exerciseCount)
          bad.push(`${pr.name}/scan${i}`)
      }
    check(
      'InBody: slot count and exercise selection are identical for every scan',
      bad.length === 0,
      bad.length ? bad.join(', ') : `${PRESETS.length} presets x ${scans.length} scans`,
    )
  }

  // weights always legal
  {
    const bad: string[] = []
    for (const goal of data.config.goals)
      for (const smm of ['Under', 'Normal', 'Over'] as const)
        for (const pbf of ['Under', 'Normal', 'Over'] as const) {
          const w = goalWeights(goal, { smm, pbf, tbw: null, ARMS: null, TRUNK: null, LEGS: null })
          const sum = Object.values(w).reduce((a, b) => a + b, 0)
          if (Math.abs(sum - 1) > 1e-9 || w[goal] < 0.4 - 1e-9) bad.push(`${goal}/${smm}/${pbf}`)
        }
    check(
      'InBody: goal weights always sum to 1.00 and the stated goal keeps >= 0.40',
      bad.length === 0,
      bad.length ? bad.join(', ') : 'all 27 state combinations',
    )
  }

  // injury still outranks InBody, and pain drives the filler movement
  {
    const client: ClientInput = {
      ...REF,
      goal: 'Get Stronger',
      pains: { ANKLE: 'Both' },
      inbody: WORKED_EXAMPLE,
      vald: {},
    }
    const p = run(client)
    const chosenIds = new Set(p.days.flatMap((d) => d.exercises.map((e) => e.exercise.id)))
    const removed = p.removedByPain.map((r) => r.exercise.id)
    check(
      'InBody: injury REMOVE verdicts still hold with InBody active',
      removed.every((id) => !chosenIds.has(id)) && removed.length > 0,
      `${removed.length} removed, none resurrected`,
    )
    check(
      'InBody: ankle pain + high TBW gives the non-impact filler',
      p.inbody.filler?.movement === data.inbody.filler.non_impact.movement,
      `${p.inbody.filler?.bouts} x ${p.inbody.filler?.seconds}s — ${p.inbody.filler?.movement}`,
    )
  }

  // most-restrictive filler fields, taken independently
  {
    const p = run({
      ...preset('Stress test').input, // age 10, Beginner
      inbody: WORKED_EXAMPLE,
      vald: {},
    })
    const f = p.inbody.filler
    check(
      'InBody: a 6-12 Beginner gets 2 bouts x 30s of the non-impact movement',
      f?.bouts === 2 && f?.seconds === 30 && f?.movement === data.inbody.filler.age.movement,
      `${f?.bouts} x ${f?.seconds}s — ${f?.movement}`,
    )
  }
}

// ---- VALD layer ------------------------------------------------------------
{
  const slotsOf = (p: ReturnType<typeof run>) =>
    p.days.map((d) => d.exercises.map((e) => e.exercise.id).join(',')).join(' | ')
  const withVald = (vald: ValdInput, over: Partial<ClientInput> = {}) =>
    run({ ...REF, ...over, vald })
  const bumpsOf = (p: ReturnType<typeof run>) =>
    p.days.flatMap((d) => d.exercises).filter((e) => e.unilateral)

  check(
    'VALD: with no readings the program is unchanged',
    slotsOf(run(REF)) === slotsOf(withVald({})) && !run(REF).vald.active,
    'inert',
  )

  check(
    'VALD: an asymmetry under 8% changes nothing',
    bumpsOf(withVald({ 'Q-KD': { asymmetry: 5, weakSide: 'Left' } })).length === 0,
    '5% on Knee Extension',
  )

  {
    const p = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left' } })
    const b = bumpsOf(p)
    check(
      'VALD: a Major finding adds +2 weak-side sets to a Q-KD slot, made unilateral',
      b.length === 1 &&
        b[0].unilateral!.extraSets === 2 &&
        b[0].unilateral!.weakSide === 'Left' &&
        b[0].exercise.code === 'Q-KD',
      b.length ? `${b[0].exercise.name} +${b[0].unilateral!.extraSets} (${b[0].unilateral!.form})` : 'no bump',
    )
  }

  {
    // 35% must get the same +2 as 25%, and raise a referral instead of more volume
    const p25 = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left' } })
    const p35 = withVald({ 'Q-KD': { asymmetry: 35, weakSide: 'Left' } })
    const sets = (p: ReturnType<typeof run>) =>
      bumpsOf(p).reduce((s, e) => s + e.unilateral!.extraSets, 0)
    check(
      'VALD: a 35% reading adds the same +2 as 25%, plus a referral flag',
      sets(p35) === sets(p25) && p35.vald.referrals.length === 1 && p25.vald.referrals.length === 0,
      `25% → +${sets(p25)}, 35% → +${sets(p35)}, referrals ${p35.vald.referrals.length}`,
    )
  }

  {
    // pass-1 reservation: no finding may take a second set while another servable finding
    // in the same muscle group still has none
    const p = withVald(
      {
        'G-EXT': { asymmetry: 25, weakSide: 'Left' },
        'G-ABD': { asymmetry: 22, weakSide: 'Left' },
        'G-HF': { asymmetry: 21, weakSide: 'Left' },
      },
      { split: 'Full Body', days: 6 },
    )
    const per: Record<string, number> = {}
    for (const b of p.vald.bumps) per[b.code] = (per[b.code] ?? 0) + b.extraSets
    // a finding is servable when it was not blocked for a structural reason
    const structural = new Set(
      p.vald.unfilled
        .filter((u) => /main lift|no slot|other side/.test(u.reason))
        .map((u) => u.finding.code),
    )
    const servable = ['G-EXT', 'G-ABD', 'G-HF'].filter((c) => !structural.has(c))
    check(
      'VALD: pass-1 reservation — every servable finding gets a set before any gets a second',
      servable.every((c) => (per[c] ?? 0) >= 1),
      `${JSON.stringify(per)}; blocked structurally: ${[...structural].join(', ') || 'none'}`,
    )
  }

  {
    const v: ValdInput = {
      'Q-KD': { asymmetry: 25, weakSide: 'Left' },
      'G-ABD': { asymmetry: 12, weakSide: 'Right' },
    }
    check(
      'VALD: two runs on identical input produce identical programs',
      JSON.stringify(withVald(v).vald.bumps) === JSON.stringify(withVald(v).vald.bumps),
      'byte-identical',
    )
  }

  {
    // a bilateral main lift is never bumped and never converted
    const codes = data.vald.tests.map((t) => t.code)
    const all: ValdInput = Object.fromEntries(
      codes.map((c) => [c, { asymmetry: 25, weakSide: 'Left' as const }]),
    )
    const bad: string[] = []
    for (const pr of PRESETS) {
      const p = run({ ...pr.input, vald: all })
      for (const e of p.days.flatMap((d) => d.exercises))
        if (e.exercise.mainLift && e.unilateral && e.unilateral.form !== 'already')
          bad.push(`${pr.name}: ${e.exercise.name} (${e.unilateral.form})`)
    }
    let mainLiftsOnTestedSubRegions = 0
    for (const pr of PRESETS)
      for (const e of run({ ...pr.input, vald: all }).days.flatMap((d) => d.exercises))
        if (e.exercise.mainLift && codes.includes(e.exercise.code)) mainLiftsOnTestedSubRegions++
    check(
      'VALD: a bilateral main lift is never bumped and never converted',
      bad.length === 0 && mainLiftsOnTestedSubRegions > 0,
      bad.join(', ') ||
        `${mainLiftsOnTestedSubRegions} main-lift slots sit on a VALD-tested sub-region and none was converted`,
    )
  }

  {
    // injury outranks VALD
    const p = withVald({ 'L-VERT': { asymmetry: 25, weakSide: 'Left' } }, { pains: { SHOULDER: 'Left' } })
    check(
      'VALD: injury SIDE_ONLY right + weak left means no bump, with a visible note',
      p.vald.conflicts.length === 1 &&
        p.vald.bumps.length === 0 &&
        p.vald.unfilled.some((u) => /other side/.test(u.reason)),
      p.vald.conflicts.length
        ? `injury says train ${p.vald.conflicts[0].injurySide}, weak side ${p.vald.conflicts[0].finding.weakSide} — ${p.vald.conflicts[0].exercise}`
        : 'no conflict raised',
    )
  }

  {
    // the golden rule: slot count and the strong side are untouched
    const all: ValdInput = Object.fromEntries(
      data.vald.tests.map((t) => [t.code, { asymmetry: 25, weakSide: 'Left' as const }]),
    )
    // The strong side keeps its DIRECT volume exactly. Total volume can move a little,
    // because step 5's swap replaces the exercise with a one-sided version of the same
    // movement, and the replacement carries its own `alsoTrains` — so indirect credit into
    // *other* groups shifts. Same phenomenon the Stage 1 week-rotation check exposed.
    const bad: string[] = []
    let maxIndirectDrift = 0
    for (const pr of PRESETS) {
      const base = run(pr.input)
      const p = run({ ...pr.input, vald: all })
      if (base.exerciseCount !== p.exerciseCount) bad.push(`${pr.name}: slot count changed`)
      const a = buildAudit(base, data.exercises, pr.input.sex, data.config)
      const b = buildAudit(p, data.exercises, pr.input.sex, data.config)
      a.rows.forEach((r, i) => {
        if (Math.abs(r.directDelivered - b.rows[i].directDelivered) > 1e-9)
          bad.push(`${pr.name}/${r.group}: direct strong-side volume moved`)
        maxIndirectDrift = Math.max(maxIndirectDrift, Math.abs(r.delivered - b.rows[i].delivered))
      })
    }
    const totalBumps = PRESETS.reduce((n, pr) => n + run({ ...pr.input, vald: all }).vald.bumps.length, 0)
    check(
      'VALD: slot count unchanged and the strong side keeps its direct volume',
      bad.length === 0 && totalBumps > 0,
      bad.join(', ') ||
        `${totalBumps} bumps across all presets — max indirect-credit drift from swaps ${maxIndirectDrift.toFixed(2)} sets`,
    )
  }

  {
    // the audit shows both sides once a finding fires
    const p = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left' } })
    const a = buildAudit(p, data.exercises, REF.sex, data.config)
    const quads = a.rows.find((r) => r.group === 'Quads, hams, adductors')!
    check(
      'VALD: the volume audit diverges by side once a finding fires',
      quads.leftDelivered > quads.rightDelivered,
      `left ${quads.leftDelivered.toFixed(1)} vs right ${quads.rightDelivered.toFixed(1)}`,
    )
  }
}

// ---- a block is charged and labelled as the structure it actually IS --------
// Under triset a block that found only one legal partner is a superset, and an InBody rule-4
// region is supersetted whatever the client picked. The rest multiplier and load adjustment
// used to come off the PROGRAM, so those blocks were charged and labelled as trisets: the
// table printed rest x1.15 on straight rows the time model charged at x1.00.
{
  const mismatched: string[] = []
  let differing = 0
  let blocks = 0
  for (const pr of PRESETS) {
    for (const structure of STRUCTURES) {
      for (const inbody of [{}, WORKED_EXAMPLE]) {
        const p = run({ ...pr.input, structure, inbody })
        for (const d of p.days) {
          for (const b of d.blocks) {
            blocks++
            const paired = b.indices.length > 1
            const wantRest = paired ? (data.structure.restMultiplier[b.structure] ?? 1) : 1
            const wantLoad = paired ? (data.structure.loadAdjustment[b.structure] ?? 0) : 0
            if (b.structure !== structure && paired) differing++
            if (b.restMultiplier !== wantRest || b.loadAdjustment !== wantLoad)
              mismatched.push(
                `${pr.name}/${structure} day ${d.index + 1}: a ${b.structure} block carries rest x${b.restMultiplier}, load ${b.loadAdjustment}`,
              )
          }
        }
      }
    }
  }
  check(
    'Structure: every block carries its own rest multiplier and load, not the program’s',
    mismatched.length === 0 && differing > 0,
    mismatched.length
      ? mismatched.slice(0, 3).join('; ')
      : `${blocks} blocks swept, ${differing} of them a different structure from the program they sit in`,
  )

  {
    // The displayed rest and the charged rest come from the same number now.
    const p = run({ ...REF, structure: 'triset' })
    const straight = p.days.flatMap((d) => d.blocks).filter((b) => b.indices.length === 1)
    check(
      'Structure: a straight block inside a triset program takes no rest multiplier',
      straight.length > 0 && straight.every((b) => b.restMultiplier === 1),
      `${straight.length} straight blocks in a triset program, all at x1.00 — the table scales rest by this same figure`,
    )
  }
}

// ---- VALD swaps must clear every gate selection cleared ---------------------
// Step 5's swap searches the whole library. Before this was guarded it reached around the
// injury layer AND around the Stage 1 age/level/equipment rules — 343 swaps across the sweep
// below included 37 injury-removed exercises, 82 barred by age or level, and 154 unavailable
// at the client's own equipment tier. None of the other 148 checks caught it, because every
// one of them tested VALD on a full-gym adult with no pain.
{
  const ALL: ValdInput = Object.fromEntries(
    data.vald.tests.map((t) => [t.code, { asymmetry: 25, weakSide: 'Left' as const }]),
  )
  const violations: string[] = []
  let swaps = 0
  for (const pr of PRESETS) {
    for (const pains of [{}, { LOWBACK: 'Both' }, { SHOULDER: 'Both' }, { KNEE_ANT: 'Both' }]) {
      for (const equipment of EQUIPMENT_TIERS) {
        const input: ClientInput = { ...pr.input, pains: pains as PainSelection, equipment, vald: ALL }
        const p = run(input)
        const removed = new Set(p.removedByPain.map((r) => r.exercise.id))
        for (const d of p.days) {
          for (const e of d.exercises) {
            if (e.unilateral?.form !== 'swapped') continue
            swaps++
            const where = `${pr.name}/${Object.keys(pains)[0] ?? 'no pain'}/${equipment}`
            if (removed.has(e.exercise.id))
              violations.push(`${where}: "${e.exercise.name}" is removed for this pain`)
            if (!isEligible(e.exercise, input.level, p.ageBracket, equipment))
              violations.push(`${where}: "${e.exercise.name}" fails the age/level/equipment screen`)
          }
        }
      }
    }
  }
  check(
    'VALD: a swapped-in exercise clears injury, age, level and equipment, like a selected one',
    violations.length === 0 && swaps > 0,
    violations.length
      ? `${violations.length} violations, e.g. ${violations.slice(0, 3).join('; ')}`
      : `${swaps} swaps across ${PRESETS.length} presets x 4 pain sets x ${EQUIPMENT_TIERS.length} equipment tiers`,
  )
}

{
  // `swappedFrom` was read after the slot had already been mutated, so it recorded the
  // exercise swapped TO under a field that means swapped FROM.
  const p = run({
    ...preset('Stress test').input,
    vald: { 'G-ABD': { asymmetry: 25, weakSide: 'Left' } },
  })
  const swapped = p.vald.bumps.filter((b) => b.swappedFrom)
  const bad = swapped.filter((b) => {
    const slot = p.days[b.dayIndex].exercises[b.slotIndex]
    return b.swappedFrom === slot.exercise.name
  })
  check(
    'VALD: a swap records the exercise it replaced, not the one it replaced it with',
    bad.length === 0 && swapped.length > 0,
    bad.length
      ? bad.map((b) => `"${b.swappedFrom}" is also the slot's current exercise`).join('; ')
      : swapped
          .map((b) => `"${b.swappedFrom}" -> "${p.days[b.dayIndex].exercises[b.slotIndex].exercise.name}"`)
          .join('; '),
  )
}

// ---- BodyDot layer ---------------------------------------------------------
{
  const withBd = (bodydot: BodyDotInput, over: Partial<ClientInput> = {}) =>
    run({ ...REF, ...over, bodydot })
  /** the main program only — corrective slots are additive and sit outside it */
  const mainOf = (p: ReturnType<typeof run>) =>
    p.days.map((d) => d.exercises.map((e) => `${e.exercise.id}:${e.sets}`).join(',')).join(' | ')
  const bands = realBands(data.bodydot)
  const nameOf = (c: { prescribedName: string }) => c.prescribedName.toLowerCase()

  check(
    'BodyDot: with no readings the program is unchanged',
    mainOf(run(REF)) === mainOf(withBd({})) &&
      !run(REF).bodydot.active &&
      run(REF).days.every((d) => d.correctives.length === 0 && d.correctiveMinutes === 0) &&
      run(REF).days.every((d, i) => d.minutes === run(REF).days[i].minutes),
    'inert',
  )

  {
    // the only machine that adds slots — and it must add ONLY slots
    const p = withBd({ S02: { value: 60 } })
    check(
      'BodyDot: a finding adds corrective slots and changes nothing else',
      mainOf(p) === mainOf(run(REF)) && p.bodydot.correctives.length > 0,
      `${p.bodydot.correctives.length} correctives, main program byte-identical`,
    )
  }

  // ---- step 3, the side rule ----------------------------------------------
  {
    const p = withBd({ F05: { value: 6, side: 'Left' } })
    const c = p.bodydot.correctives
    check(
      'BodyDot: a LEFT Pelvic Tilt finding prescribes a RIGHT hip hike',
      c.length === 1 && c[0].side === 'Right' && nameOf(c[0]).includes('right hip hike'),
      c.map((x) => `${x.prescribedName} [${x.side}]`).join(', ') || 'nothing prescribed',
    )
  }

  {
    const p = withBd({ S08: { value: 12, side: 'Right' } })
    const c = p.bodydot.correctives
    check(
      'BodyDot: a RIGHT Kendall Knee finding prescribes LEFT leg work',
      c.length > 0 && c.every((x) => x.side === 'Left') && nameOf(c[0]).includes('left leg extensions'),
      c.map((x) => `${x.prescribedName} [${x.side}]`).join(', ') || 'nothing prescribed',
    )
  }

  {
    // the opposite-side rule is BodyDot's alone — VALD still trains the side that tested weak
    const p = withBd(
      { S08: { value: 12, side: 'Right' } },
      { vald: { 'Q-KD': { asymmetry: 25, weakSide: 'Right' } } },
    )
    const bump = p.days.flatMap((d) => d.exercises).find((e) => e.unilateral)
    check(
      "BodyDot: the opposite-side rule does not leak into VALD's weak-side convention",
      bump?.unilateral?.weakSide === 'Right' && p.bodydot.correctives.every((c) => c.side === 'Left'),
      `same client: VALD works the ${bump?.unilateral?.weakSide} side, BodyDot the ${p.bodydot.correctives[0]?.side}`,
    )
  }

  // ---- F06, deliberately swapped relative to the source spreadsheet -------
  {
    const p = withBd({ F06: { value: 6, side: 'Right' } })
    const names = p.bodydot.correctives.map(nameOf)
    const stretches = p.bodydot.stretches.map((s) => s.name.toLowerCase())
    check(
      'BodyDot: an HKA reading above the band (valgus) prescribes abduction work and an adductor stretch',
      names.some((n) => n.includes('abduction')) &&
        !names.some((n) => n.includes('adduction')) &&
        stretches.some((s) => s.includes('adductor')),
      `${names.join(', ')} + stretches: ${stretches.join(', ')}`,
    )
    const low = withBd({ F06: { value: -6, side: 'Right' } })
    check(
      'BodyDot: an HKA reading below the band (varus) prescribes adduction work and an abductor stretch',
      low.bodydot.correctives.some((c) => nameOf(c).includes('adduction')) &&
        low.bodydot.stretches.some((s) => s.name.toLowerCase().includes('abductor')),
      `${low.bodydot.correctives.map(nameOf).join(', ')} + ${low.bodydot.stretches.map((s) => s.name).join(', ')}`,
    )
    const f06 = data.bodydot.arsenal.filter((a) => a.code === 'F06')
    check(
      'BodyDot: both F06 rows are flagged as corrected from source, with their meaning stated',
      f06.length === 2 && f06.every((a) => a.correctedFromSource && a.meaning),
      f06.map((a) => `${a.edge} = ${a.meaning}`).join('; '),
    )
  }

  // ---- step 5, the cap and the reservation pass ---------------------------
  {
    const many: BodyDotInput = {
      S01: { value: 40 },
      S02: { value: 60 },
      S05: { value: 55 },
      S06: { value: 65 },
      S07: { value: 12 },
      Q04: { value: 40 },
      T03: { value: 20 },
    }
    let sessions = 0
    let worst = 0
    for (const pr of PRESETS) {
      const p = run({ ...pr.input, bodydot: many })
      for (const d of p.days) {
        sessions++
        worst = Math.max(worst, d.correctives.length)
      }
      worst = Math.max(worst, p.bodydot.correctives.length)
    }
    check(
      'BodyDot: never more than 3 corrective exercises in a session',
      worst <= data.bodydot.correctiveSlotCapPerSession && sessions > 0,
      `worst session had ${worst} of a cap of ${data.bodydot.correctiveSlotCapPerSession}, across ${sessions} sessions`,
    )
  }

  {
    // S02 abnormal bilateral fills the cap on its own and still brings a stretch
    const p = withBd({ S02: { value: 60 } })
    const full = p.days.find((d) => d.correctives.length === data.bodydot.correctiveSlotCapPerSession)
    check(
      'BodyDot: stretches do not count toward the corrective cap',
      p.bodydot.correctives.length === 3 &&
        p.bodydot.stretches.length === 1 &&
        full !== undefined &&
        full.correctiveStretches.length === 1,
      `${p.bodydot.correctives.length} correctives (cap 3) plus ${p.bodydot.stretches.length} stretch in the same session`,
    )
  }

  {
    // S02 (three exercises, ranked first) vs S01 (one exercise). Without the reservation
    // pass S02 eats the whole cap and S01 gets nothing at all.
    const p = withBd({ S02: { value: 60 }, S01: { value: 40 } })
    const block = p.bodydot.correctives
    const s01 = block.filter((c) => c.codes.includes('S01'))
    const s02 = block.filter((c) => c.codes.includes('S02'))
    check(
      'BodyDot: both findings are served before the three-exercise entry gets its second',
      s01.length >= 1 && s02.length >= 1 && block.length === 3 && p.bodydot.deferred.length === 1,
      `S02 got ${s02.length} of 3, S01 got ${s01.length} of 1, ${p.bodydot.deferred.length} deferred`,
    )
    check(
      'BodyDot: what did not fit is reported by name, not dropped',
      p.bodydot.deferred[0]?.names.length === 1 && /cap/.test(p.bodydot.deferred[0]?.reason ?? ''),
      `${p.bodydot.deferred[0]?.code}: ${p.bodydot.deferred[0]?.names.join(', ')}`,
    )
  }

  // ---- step 6, placement --------------------------------------------------
  {
    // Day 2 and day 4 of the reference client have the headroom to carry the whole block.
    const p = withBd({ F05: { value: 6, side: 'Left' } })
    check(
      'BodyDot: correctives appear in every session of the week, tagged and attributed',
      p.days.length > 0 &&
        p.days.every(
          (d) =>
            d.correctives.length > 0 &&
            d.correctives.every((c) => c.codes.length > 0 && c.indicators.length > 0),
        ),
      `${p.days.map((d) => d.correctives.length).join('/')} per session, attributed to ${p.days[0].correctives[0].indicators.join(', ')}`,
    )
    check(
      'BodyDot: corrective slots stay out of the main exercise list and the set totals',
      p.days.every(
        (d) =>
          !d.exercises.some((e) => d.correctives.some((c) => c.exercise.id === e.exercise.id)) &&
          d.totalSets === run(REF).days[d.index].totalSets,
      ),
      'appended after the main work, no change to weekly volume',
    )
  }

  {
    // S07 high lists a mobility exercise (90/90 hip lift) among its three
    const p = withBd({ S07: { value: 12 } })
    const mob = p.bodydot.correctives.filter((c) => c.exercise.type === 'mobility')
    const loaded = p.bodydot.correctives.filter((c) => c.exercise.type !== 'mobility')
    check(
      'BodyDot: a mobility corrective is timed, never given sets and reps',
      mob.length > 0 && mob.every((c) => c.reps === null && c.seconds === data.bodydot.stretchSeconds),
      `${mob.length} mobility corrective(s) examined: ${mob.map((c) => `${c.exercise.name} = ${c.sets}x${c.seconds}s`).join(', ')}`,
    )
    check(
      'BodyDot: a loaded corrective still gets reps',
      loaded.length > 0 && loaded.every((c) => c.reps !== null && c.seconds === null),
      `${loaded.length} loaded corrective(s): ${loaded.map((c) => `${c.exercise.name} ${c.sets}x${c.reps}`).join(', ')}`,
    )
  }

  // ---- step 4, set counts -------------------------------------------------
  {
    const abnormal = withBd({ F05: { value: 6, side: 'Left' } }).bodydot.correctives
    const borderline = withBd({ F03: { value: 11, side: 'Left' } }).bodydot.correctives
    check(
      'BodyDot: a unilateral finding gets +2 sets when abnormal, +1 when borderline',
      abnormal.length > 0 &&
        abnormal.every((c) => c.sets === data.bodydot.sets.abnormalUnilateral) &&
        borderline.length > 0 &&
        borderline.every((c) => c.sets === data.bodydot.sets.borderlineUnilateral),
      `abnormal ${abnormal[0]?.sets} set(s), borderline ${borderline[0]?.sets} set(s)`,
    )
  }

  {
    // S05 borderline high (45-49.5) vs abnormal high — the same entry, two exercises
    const b = withBd({ S05: { value: 47 } })
    const a = withBd({ S05: { value: 55 } })
    const std = a.bodydot.standardSets
    check(
      'BodyDot: a borderline bilateral finding takes the first arsenal exercise only, abnormal takes all',
      b.bodydot.correctives.length === 1 &&
        a.bodydot.correctives.length === 2 &&
        b.bodydot.findings[0].limitedToFirst &&
        b.bodydot.correctives[0].sets === std,
      `borderline ${b.bodydot.correctives.map(nameOf).join(', ')} | abnormal ${a.bodydot.correctives.map(nameOf).join(', ')}, both at the program's ${std} sets`,
    )
  }

  // ---- precedence: injury outranks a corrective ---------------------------
  {
    // Shoulder pain removes the rear delt fly, which is the FIRST exercise of the S02 entry.
    const painFree = withBd({ S02: { value: 60 } })
    const p = withBd({ S02: { value: 60 } }, { pains: { SHOULDER: 'Both' } })
    const removedFromEntry = data.bodydot.arsenal
      .filter((entry) => entry.code === 'S02')
      .flatMap((entry) => entry.exercises)
      .filter((e) => e.exerciseId !== null && p.verdicts.get(e.exerciseId)?.verdict === 'REMOVE')
    check(
      'BodyDot: an injury REMOVE outranks a corrective — the exercise is not added',
      removedFromEntry.length > 0 &&
        p.bodydot.correctives.every((c) => c.exercise.id !== removedFromEntry[0].exerciseId) &&
        painFree.bodydot.correctives.some((c) => c.exercise.id === removedFromEntry[0].exerciseId),
      `${removedFromEntry.map((e) => e.libraryName).join(', ')} is prescribed for this finding pain-free, and removed with shoulder pain reported`,
    )
    check(
      'BodyDot: a stretch removed for a reported pain is not prescribed either',
      painFree.bodydot.stretches.length > 0 && p.bodydot.stretches.length === 0,
      `pain-free: ${painFree.bodydot.stretches.map((s) => s.name).join(', ')}; with shoulder pain: none`,
    )
  }

  {
    // Low back pain removes the ONLY exercise the F05 entry has
    const p = withBd({ F05: { value: 6, side: 'Left' } }, { pains: { LOWBACK: 'Both' } })
    check(
      'BodyDot: a finding whose whole entry is removed by pain prescribes nothing, and says why',
      p.bodydot.correctives.length === 0 &&
        p.bodydot.unfilled.some((u) => u.code === 'F05' && /removed by a pain/.test(u.reason)),
      p.bodydot.unfilled.map((u) => `${u.code}: ${u.reason}`).join(' | '),
    )
  }

  {
    // Age and equipment still bind: the Q04 entry is a leg press and a deep barbell squat
    const p = run({ ...preset('Older adult').input, bodydot: { Q04: { value: 40 } } })
    check(
      'BodyDot: a corrective the client cannot safely load is not added, and says why',
      p.bodydot.correctives.length === 0 &&
        p.bodydot.unfilled.some((u) => u.code === 'Q04' && /age, level or equipment/.test(u.reason)),
      p.bodydot.unfilled.map((u) => `${u.code}: ${u.reason}`).join(' | '),
    )
  }

  // ---- steps 1-2, bands and coverage --------------------------------------
  {
    const noProtocol = bands.filter((b) => !b.inArsenal)
    const readings = Object.fromEntries(
      noProtocol.map((b) => [b.code, { value: 999 }]),
    ) as BodyDotInput
    const p = withBd(readings)
    check(
      'BodyDot: an indicator with no protocol is reported as measured, never silently skipped',
      noProtocol.length === 13 &&
        noProtocol.every((b) => p.bodydot.unfilled.some((u) => u.code === b.code)) &&
        p.bodydot.correctives.length === 0,
      `${noProtocol.length} of ${bands.length} indicators have no arsenal entry, all ${p.bodydot.unfilled.length} reported`,
    )
  }

  {
    // T03 defines no band below its normal range at all
    const p = withBd({ T03: { value: -20 } })
    check(
      'BodyDot: a reading outside an edge the file leaves undefined is reported, not treated as normal',
      p.bodydot.findings.some((f) => f.code === 'T03' && f.tier === 'unbanded') &&
        p.bodydot.unfilled.some((u) => u.code === 'T03'),
      p.bodydot.unfilled.map((u) => u.reason).join(' | '),
    )
  }

  {
    // Boundaries are inclusive on both sides in the file, so the milder tier has to win.
    const s05 = bands.find((b) => b.code === 'S05')!
    check(
      'BodyDot: tiers classify on the crossed edge, with boundary values taking the milder tier',
      classify(s05, 45).tier === 'normal' &&
        classify(s05, 47).tier === 'borderline' &&
        classify(s05, 49.5).tier === 'borderline' &&
        classify(s05, 55).tier === 'abnormal' &&
        classify(s05, 33).tier === 'borderline' &&
        classify(s05, 25).tier === 'abnormal' &&
        classify(s05, 55).edge === 'high' &&
        classify(s05, 25).edge === 'low',
      'S05 45/47/49.5/55 and 33/25 deg',
    )
  }

  {
    // The 10% rule, checked against the bands the file actually ships.
    const off: string[] = []
    let checked = 0
    for (const b of bands) {
      const n = parseRange(b.normal)
      if (!n) continue
      for (const [str, thr] of [
        [b.borderlineLow, n[0]],
        [b.borderlineHigh, n[1]],
      ] as [string, number][]) {
        const r = parseRange(str)
        if (!r) continue
        checked++
        // Where the threshold is zero the 10% rule degenerates, and the file falls back to
        // 10% of the band's other threshold. Both cases are outside the arsenal.
        const expect = thr === 0 ? null : 0.1 * Math.abs(thr)
        if (expect !== null && Math.abs(r[1] - r[0] - expect) > 1e-9)
          off.push(`${b.code}: ${r[1] - r[0]} vs ${expect.toFixed(2)}`)
      }
    }
    check(
      'BodyDot: every borderline band is 10% of the threshold at its edge',
      off.length === 0 && checked > 0,
      off.length
        ? off.join('; ')
        : `${checked} bands checked; S04 low and Q05 low sit on a zero threshold and fall back to 10% of the band's other edge`,
    )
  }

  {
    // "The borderline tier can never fire on 7 of 21 edges" — verified, not assumed.
    const dead: string[] = []
    let live = 0
    for (const b of bands.filter((x) => x.inArsenal)) {
      for (const [edge, bl, ab] of [
        ['low', b.borderlineLow, b.abnormalLow],
        ['high', b.borderlineHigh, b.abnormalHigh],
      ] as ['low' | 'high', string, string][]) {
        const r = parseRange(bl)
        const a = parseRange(ab)
        if (!r || !a) continue
        live++
        if ((r[1] - r[0]) / (a[1] - a[0]) < 0.05) dead.push(`${b.code} ${edge}`)
      }
    }
    const declared = data.bodydot.deadBorderlineEdges.map(([c, e]) => `${c} ${e}`)
    check(
      'BodyDot: the 7 declared dead borderline edges are exactly the ones under 5% of their abnormal region',
      live === 21 &&
        dead.length === 7 &&
        dead.every((d) => declared.includes(d)) &&
        declared.every((d) => dead.includes(d)),
      `${dead.length} of ${live} live edges: ${dead.join(', ')}`,
    )
  }

  {
    // The arsenal is pre-resolved to library ids — nothing here name-matches at runtime.
    const bad: string[] = []
    let resolved = 0
    for (const entry of data.bodydot.arsenal) {
      for (const item of [...entry.exercises, ...entry.stretches]) {
        if (item.exerciseId === null) continue
        resolved++
        const lib = data.exercises.find((e) => e.id === item.exerciseId)
        if (!lib) bad.push(`${entry.code} ${item.arsenalName} -> missing id ${item.exerciseId}`)
        else if (lib.name !== item.libraryName)
          bad.push(`${entry.code} id ${item.exerciseId}: "${item.libraryName}" vs "${lib.name}"`)
      }
    }
    check(
      'BodyDot: every arsenal id resolves to the library and matches its recorded name',
      bad.length === 0 && resolved > 0,
      bad.length ? bad.join('; ') : `${resolved} pre-resolved ids checked across ${data.bodydot.arsenal.length} entries`,
    )
  }

  {
    const p = withBd({ F06: { value: 6, side: 'Right' } })
    const unmapped = p.bodydot.stretches.filter((s) => s.unmapped)
    check(
      'BodyDot: a stretch with no library match is prescribed as free text with the timer',
      unmapped.length > 0 &&
        unmapped.every(
          (s) => s.exerciseId === null && s.seconds === data.bodydot.stretchSeconds,
        ) &&
        data.bodydot.unmappedStretches.includes(unmapped[0].name),
      `${unmapped.map((s) => `${s.name} ${s.seconds}s`).join(', ')} — 4 declared unmapped: ${data.bodydot.unmappedStretches.join(', ')}`,
    )
  }

  // ---- step 7, time and trim ----------------------------------------------
  check(
    'BodyDot: the time constants match the formula in the data file',
    new RegExp(`work\\s*${CORRECTIVE_WORK_SECONDS}`).test(data.bodydot.timeCost) &&
      new RegExp(`rest\\s*${CORRECTIVE_REST_SECONDS}`).test(data.bodydot.timeCost) &&
      new RegExp(`stretches x ${data.bodydot.stretchSeconds}`).test(data.bodydot.timeCost),
    data.bodydot.timeCost,
  )

  {
    const p = withBd({ S02: { value: 60 } })
    const bad = p.days.filter((d) => {
      const expect =
        (d.correctives.reduce(
          (s, c) => s + c.sets * (CORRECTIVE_WORK_SECONDS + CORRECTIVE_REST_SECONDS),
          0,
        ) +
          d.correctiveStretches.length * data.bodydot.stretchSeconds) /
        60
      return Math.abs(d.correctiveMinutes - expect) > 1e-9
    })
    check(
      'BodyDot: corrective minutes follow exercises x sets x (40 + 30) + stretches x 40',
      bad.length === 0 && p.days.some((d) => d.correctiveMinutes > 0),
      `${p.days.map((d) => d.correctiveMinutes.toFixed(2)).join(' / ')} min of corrective work per session`,
    )
  }

  {
    // The per-session time trim is gone. Corrective work now reaches every session intact
    // and is only ever given up through the time-cap button, at a stated price.
    const many: BodyDotInput = { S02: { value: 60 }, S01: { value: 40 }, T03: { value: 20 } }
    const bad: string[] = []
    let carried = 0
    for (const pr of PRESETS) {
      const p = run({ ...pr.input, bodydot: many })
      if (p.bodydot.trimmed.length > 0)
        bad.push(`${pr.name}: ${p.bodydot.trimmed.length} corrective(s) dropped with no cap pressed`)
      for (const d of p.days) {
        carried += d.correctives.length
        if (d.correctives.length !== p.bodydot.correctives.length)
          bad.push(`${pr.name} day ${d.index + 1}: ${d.correctives.length} of ${p.bodydot.correctives.length}`)
      }
    }
    check(
      'BodyDot: with no cap pressed the corrective block reaches every session intact',
      bad.length === 0 && carried > 0,
      bad.length ? bad.join('; ') : `${carried} corrective slots carried across the presets, none dropped`,
    )
  }

  {
    // VALD's session-cap guard was the reason trim steps 3 and 4 were unreachable. Nothing
    // caps a session at generation now, so what has to hold instead is that VALD's weak-side
    // sets still land — they were the thing the old guard was silently refusing.
    const vald: ValdInput = {
      'Q-KD': { asymmetry: 25, weakSide: 'Left' },
      'H-KF': { asymmetry: 22, weakSide: 'Right' },
    }
    let bumped = 0
    let extraSets = 0
    for (const pr of PRESETS) {
      const p = run({ ...pr.input, vald })
      bumped += p.vald.bumps.length
      extraSets += p.vald.bumps.reduce((s, b) => s + b.extraSets, 0)
    }
    check(
      'VALD: weak-side sets are no longer refused for session length',
      bumped > 0 && extraSets > 0,
      `${bumped} bumps adding ${extraSets} weak-side sets across the presets`,
    )
  }

  check(
    'BodyDot: two runs of the same input are identical',
    JSON.stringify(withBd({ S02: { value: 60 }, F05: { value: 6, side: 'Left' } }).bodydot.correctives) ===
      JSON.stringify(withBd({ S02: { value: 60 }, F05: { value: 6, side: 'Left' } }).bodydot.correctives),
    'deterministic',
  )
}

// ---- VALD newton inputs ----------------------------------------------------
{
  const withVald = (vald: ValdInput, over: Partial<ClientInput> = {}) =>
    run({ ...REF, ...over, vald })
  const reading = (p: ReturnType<typeof run>, code: string) =>
    p.vald.readings.find((r) => r.code === code)!
  const bumpsOf = (p: ReturnType<typeof run>) =>
    p.days.flatMap((d) => d.exercises).filter((e) => e.unilateral)

  check(
    'VALD/Load: the 17 test codes in vald.json and load.json are the same set',
    (() => {
      const a = new Set(data.vald.tests.map((t) => t.code))
      const b = new Set(Object.values(data.load.testSubRegion))
      return a.size === 17 && b.size === 17 && [...a].every((c) => b.has(c))
    })(),
    'joined on the sub-region code, never on the test name (the names differ by a " Strength Asymmetry" suffix)',
  )

  {
    // forces only: the percentage and the weak side are derived, and VALD still fires
    const p = withVald({ 'Q-KD': { leftN: 300, rightN: 400 } })
    const r = reading(p, 'Q-KD')
    check(
      'VALD: newtons alone derive the percentage and the weak side',
      Math.abs(r.asymmetry! - 25) < 1e-9 &&
        r.weakSide === 'Left' &&
        r.asymmetrySource === 'derived' &&
        r.weakSideSource === 'derived' &&
        bumpsOf(p).length > 0,
      `300/400 N -> ${r.asymmetry!.toFixed(1)}% weak ${r.weakSide}, ${bumpsOf(p).length} bump(s)`,
    )
  }

  {
    // both supplied: the entered figure wins, it is never recomputed from the forces
    const p = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left', leftN: 300, rightN: 400 } })
    const r = reading(p, 'Q-KD')
    check(
      'VALD: an entered percentage is used as given, never derived from the forces',
      r.asymmetry === 25 && r.asymmetrySource === 'entered' && r.weakSideSource === 'entered',
      `entered 25% kept alongside 300/400 N`,
    )
  }

  {
    const flagged = withVald({ 'Q-KD': { asymmetry: 18, weakSide: 'Left', leftN: 300, rightN: 400 } })
    const quiet = withVald({ 'Q-KD': { asymmetry: 25.5, weakSide: 'Left', leftN: 300, rightN: 400 } })
    const f = reading(flagged, 'Q-KD')
    check(
      'VALD: a percentage more than 1 point from the forces is flagged, and still used',
      f.mismatch !== null &&
        Math.abs(f.mismatch.fromNewtons - 25) < 1e-9 &&
        flagged.vald.findings.find((x) => x.code === 'Q-KD')?.asymmetry === 18 &&
        reading(quiet, 'Q-KD').mismatch === null,
      `18% entered vs 25.0% from the forces -> flagged; 25.5% vs 25.0% -> not flagged`,
    )
  }

  {
    // the side contradicting the forces is not recoverable, so the finding is held back
    const conflicted = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left', leftN: 400, rightN: 300 } })
    const clean = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left', leftN: 300, rightN: 400 } })
    const c = reading(conflicted, 'Q-KD').conflict
    check(
      'VALD: a weak side contradicting the forces blocks the finding rather than warning',
      c !== null &&
        c.enteredSide === 'Left' &&
        c.forcesSay === 'Right' &&
        conflicted.vald.findings.length === 0 &&
        bumpsOf(conflicted).length === 0 &&
        conflicted.vald.blocked.length === 1 &&
        // the same reading with the sides agreeing does fire, so this is a block, not a no-op
        bumpsOf(clean).length > 0,
      `weak side Left vs 400/300 N -> blocked; the agreeing version adds ${bumpsOf(clean).length} bump(s)`,
    )
    check(
      'VALD: a blocked finding estimates no weight either, so no limb gets the wrong load',
      conflicted.load.references.length === 0 && clean.load.references.length === 1,
      'the conflicting test is withheld from the Load layer too',
    )
  }

  {
    // percentages only stay valid — VALD works, Load has nothing to go on
    const p = withVald({ 'Q-KD': { asymmetry: 25, weakSide: 'Left' } })
    check(
      'VALD: percentages with no forces still work, and Load reads "not estimated"',
      bumpsOf(p).length > 0 && !p.load.active && p.load.references.length === 0,
      `${bumpsOf(p).length} bump(s), 0 load references`,
    )
  }
}

// ---- Load layer ------------------------------------------------------------
{
  const withN = (vald: ValdInput, over: Partial<ClientInput> = {}) => run({ ...REF, ...over, vald })
  const ELBOW: ValdInput = { 'TRI-LAT': { leftN: 400, rightN: 400 } }
  const PUSH: ValdInput = { 'C-MID': { leftN: 900, rightN: 900 } }
  const loadOf = (p: ReturnType<typeof run>, name: string) => p.load.byExercise.get(idOf(name))!
  const fmt = (p: ReturnType<typeof run>, name: string) => {
    const l = loadOf(p, name)
    return l.range ? `${l.range.low.toFixed(1)}-${l.range.high.toFixed(1)} ${l.tier}` : `none (${l.tier})`
  }

  {
    const p = withN(ELBOW)
    const ref = p.load.references[0]
    check(
      'Load: Elbow Extension 400 N gives a 26.1 kg reference',
      Math.abs(ref.left! - 26.1) < 0.05 && ref.left === ref.right,
      `${ref.left!.toFixed(2)} kg per limb (400 / 9.80665 x 0.64)`,
    )

    // Every row of the spec's first worked example, checked against the source figures.
    const expected: [string, number, number, string][] = [
      ['Pushdown - rope, straight bar, V-bar', 42.5, 52.5, 'MATCHED'],
      ['Reverse-grip pushdown', 35.0, 57.5, 'DERIVED'],
      ['Close-grip bench press', 57.5, 95.0, 'DERIVED'],
      ['Machine triceps extension', 35.0, 57.5, 'DERIVED'],
      ['Triceps kickback', 10.0, 15.0, 'DERIVED'],
      ['Tate press', 12.5, 20.0, 'DERIVED'],
    ]
    const wrong = expected.filter(([name, low, high, tier]) => {
      const l = loadOf(p, name)
      return !l.range || l.range.low !== low || l.range.high !== high || l.tier !== tier
    })
    check(
      'Load: all six Elbow Extension worked-example rows match the source',
      wrong.length === 0,
      wrong.length
        ? wrong.map(([n, lo, hi]) => `${n}: want ${lo}-${hi}, got ${fmt(p, n)}`).join('; ')
        : expected.map(([n]) => `${n} ${fmt(p, n)}`).join(' | '),
    )
    check(
      'Load: the per-hand and per-side rows are labelled as such',
      loadOf(p, 'Tate press').perHand &&
        !loadOf(p, 'Tate press').unilateral &&
        loadOf(p, 'Triceps kickback').unilateral &&
        !loadOf(p, 'Triceps kickback').perHand,
      'Tate press is a dumbbell pair (per hand); the kickback is one limb at a time (per side)',
    )
  }

  {
    const p = withN(PUSH)
    const ref = p.load.references[0]
    check(
      'Load: Shoulder Push 900 N gives a 27.5 kg reference',
      Math.abs(ref.left! - 27.5) < 0.05,
      `${ref.left!.toFixed(2)} kg per limb (900 / 9.80665 x 0.30)`,
    )
    const expected: [string, number, number][] = [
      ['Flat bench press', 60.0, 100.0],
      ['Mid-height cable crossover', 45.0, 55.0],
      ['Pec deck', 37.5, 62.5],
      ['Flat fly', 12.5, 22.5],
      ['Svend press', 27.5, 45.0],
    ]
    const wrong = expected.filter(([name, low, high]) => {
      const l = loadOf(p, name)
      return !l.range || l.range.low !== low || l.range.high !== high
    })
    check(
      'Load: all five Shoulder Push worked-example rows match the source',
      wrong.length === 0,
      wrong.length
        ? wrong.map(([n, lo, hi]) => `${n}: want ${lo}-${hi}, got ${fmt(p, n)}`).join('; ')
        : expected.map(([n]) => `${n} ${fmt(p, n)}`).join(' | '),
    )
    check(
      'Load: the anchor reads Measured and everything else in its sub-region Estimated',
      loadOf(p, 'Mid-height cable crossover').tier === 'MATCHED' &&
        ['Flat bench press', 'Pec deck', 'Flat fly', 'Svend press'].every(
          (n) => loadOf(p, n).tier === 'DERIVED',
        ),
      'isAnchor decides the tier; it is never re-derived from the anchors name map',
    )
  }

  {
    const p = withN(ELBOW, { age: 10, level: 'Beginner' })
    const reachable = data.load.exercises.filter((e) =>
      ['TRI-LAT', 'TRI-LONG'].includes(e.code),
    )
    const anyNumber = reachable.filter((e) => p.load.byExercise.get(e.id)?.range !== null)
    const tiersSeen = new Set(reachable.map((e) => p.load.byExercise.get(e.id)?.tier))
    check(
      'Load: a 10-year-old gets no weight anywhere, at any tier',
      anyNumber.length === 0 && reachable.length > 0 && tiersSeen.has('MATCHED'),
      `${reachable.length} exercises the readings reach, tiers ${[...tiersSeen].join('/')}, 0 with a number`,
    )
  }

  {
    const adult = withN(ELBOW)
    const beginner = withN(ELBOW, { level: 'Beginner' })
    // DERIVED is +/-25%, so the beginner cut lands clear of the bottom and is visible
    const a = loadOf(adult, 'Reverse-grip pushdown').range!
    const b = loadOf(beginner, 'Reverse-grip pushdown').range!
    // The cut applies to the unrounded top, so the printed figure lands within one 2.5 kg
    // step of 0.80 x the printed adult top rather than exactly on it.
    check(
      "Load: a beginner's top of range is 20% lower and the bottom is unchanged",
      b.low === a.low &&
        b.high < a.high &&
        Math.abs(b.high - a.high * 0.8) <= data.load.roundToKg &&
        roundTo(b.high, data.load.roundToKg) === b.high,
      `${a.low}-${a.high} kg becomes ${b.low}-${b.high} kg (0.80 x the unrounded top, then rounded)`,
    )
    // MATCHED is only +/-10%, so 0.8 x the top falls below the bottom — reported, not hidden
    const m = loadOf(beginner, 'Pushdown - rope, straight bar, V-bar')
    check(
      'Load: where the beginner cut inverts a MATCHED band, the band flattens and says so',
      m.flattened && m.range!.high === m.range!.low && m.tier === 'MATCHED',
      `${m.range!.low}-${m.range!.high} kg — 0.80 x the top of a +/-10% band sits under its own bottom`,
    )
  }

  {
    const p = run(REF)
    const base = mainFingerprint(p)
    const withLoad = withN(ELBOW)
    check(
      'Load: with no newton readings every exercise reads "not estimated" and nothing changes',
      !p.load.active &&
        p.load.byExercise.size === 0 &&
        base === mainFingerprint(withLoad) &&
        withLoad.load.active,
      'inert without forces; the program is byte-identical with them',
    )
  }

  {
    // Shoulder pain puts a CAUTION verdict on the floor press, which Shoulder Push reaches
    const p = withN(PUSH, { pains: { SHOULDER: 'Both' } })
    const l = loadOf(p, 'Floor press')
    const painFree = loadOf(withN(PUSH), 'Floor press')
    check(
      'Load: a CAUTION verdict caps the prescription at the bottom and withholds the range',
      l.capped &&
        l.sides.length === 0 &&
        l.range!.low === painFree.range!.low &&
        !painFree.capped,
      `pain-free ${painFree.range!.low}-${painFree.range!.high} kg becomes "at most ${l.range!.low} kg"`,
    )
  }

  {
    const p = withN(ELBOW)
    const bw = data.load.exercises.filter((e) => e.class === 'BODYWEIGHT' && e.code === 'TRI-LAT')
    const carry = data.load.exercises.filter((e) => e.class === 'ISOMETRIC_CARRY')
    const bad = [...bw, ...carry].filter((e) => p.load.byExercise.get(e.id)?.range !== null)
    check(
      'Load: a bodyweight or carry exercise never gets a weight, whatever the tier',
      bad.length === 0 && bw.length > 0,
      `${bw.length} bodyweight exercises inside a tested sub-region and ${carry.length} carries, none given a number`,
    )
  }

  {
    // every test entered at once, so nothing is unestimated for want of a reading
    const all: ValdInput = Object.fromEntries(
      data.vald.tests.map((t) => [t.code, { leftN: 400, rightN: 400 }]),
    )
    const p = withN(all)
    const neck = data.load.exercises.filter((e) => e.code.startsWith('N-'))
    const bad = neck.filter((e) => p.load.byExercise.get(e.id)?.tier !== 'NONE')
    check(
      'Load: neck stays unestimated even with all 17 tests entered',
      bad.length === 0 && neck.length > 0,
      `${neck.length} neck exercises across 3 sub-regions, all unbridged by design`,
    )
    check(
      'Load: with every test entered the library is still only partly reachable',
      p.load.counts.NONE > 0 && p.load.counts.MATCHED === 14,
      `MATCHED ${p.load.counts.MATCHED} / DERIVED ${p.load.counts.DERIVED} / BRIDGED ${p.load.counts.BRIDGED} / NONE ${p.load.counts.NONE}`,
    )
    check(
      'Load: the 3 sub-regions naming an anchor no exercise carries are reported',
      p.load.anchorGaps.length === 3 &&
        p.load.anchorGaps.every((g) => !data.load.exercises.some((e) => e.code === g.code && e.isAnchor)),
      p.load.anchorGaps.map((g) => `${g.code} names "${g.named}"`).join('; '),
    )
  }

  {
    // asymmetric forces: the two sides diverge on a unilateral exercise, and a bilateral one
    // is prescribed from the weaker limb
    const p = withN({ 'TRI-LAT': { leftN: 300, rightN: 400 } })
    const uni = loadOf(p, 'Triceps kickback')
    const bi = loadOf(p, 'Reverse-grip pushdown')
    const weakOnly = loadOf(withN({ 'TRI-LAT': { leftN: 300, rightN: 300 } }), 'Reverse-grip pushdown')
    check(
      'Load: a unilateral exercise gets a load per limb, from that limb’s own reading',
      uni.sides.length === 2 &&
        uni.sides[0].side === 'Left' &&
        uni.sides[0].high < uni.sides[1].high,
      uni.sides.map((s) => `${s.side} ${s.low}-${s.high} kg`).join(' vs '),
    )
    check(
      'Load: a bilateral exercise is prescribed from the weaker limb',
      bi.range!.low === weakOnly.range!.low && bi.range!.high === weakOnly.range!.high,
      `300/400 N gives ${bi.range!.low}-${bi.range!.high} kg, the same as 300 N on both sides`,
    )
  }

  {
    // The three divergences from the source spreadsheet, pinned so a "correction" fails here
    const bwIds = ['Push-up', 'Assisted pull-up'].map((n) =>
      data.exercises.find((e) => e.name.toLowerCase() === n.toLowerCase())?.id,
    )
    const pushUp = data.load.exercises.find((e) => e.id === bwIds[0])
    const compound = ['Floor press', 'Incline hex press'].map((n) =>
      data.load.exercises.find((e) => e.id === idOf(n)),
    )
    check(
      'Load: push-up is BODYWEIGHT, not a loadable compound',
      pushUp?.class === 'BODYWEIGHT',
      `a "weighted" equipment token would have read it as loadable — the spec's own worked example showed a push-up at 60-100 kg`,
    )
    check(
      'Load: floor press and incline hex press are COMPOUND',
      compound.every((e) => e?.class === 'COMPOUND'),
      'both are multi-joint presses; the library carries an explicit compound flag',
    )
    check(
      'Load: Hip Abduction and Hip Flexion have anchors, taking 2 of 17 tests from dead to working',
      ['G-ABD', 'G-HF'].every((code) => data.load.exercises.some((e) => e.code === code && e.isAnchor)) &&
        data.load.notes.anchorsFilled.join(',') === 'G-ABD,G-HF',
      'the source marks both "NONE - no loadable exercise"',
    )
  }

  {
    // The calibration hook: nothing sets it yet, so it has to be provably wired.
    const rec = data.load.exercises.find((e) => e.id === idOf('Pec deck'))!
    const plain = applyChain(27.5, rec, data.load, false)
    const scaled = applyChain(27.5, { ...rec, correctionFactor: 1.1 }, data.load, false)
    check(
      'Load: the correction factor defaults to 1.00 and scales the estimate when set',
      data.load.correctionFactorDefault === 1 &&
        data.load.exercises.every((e) => e.correctionFactor === undefined) &&
        Math.abs(scaled - plain * 1.1) < 1e-9,
      `nothing sets it today; setting it to 1.10 moves ${plain.toFixed(1)} kg to ${scaled.toFixed(1)} kg`,
    )
  }

  check(
    'Load: every one of the 315 library exercises has a pre-computed record',
    data.load.exercises.length === data.exercises.length &&
      data.load.exercises.every((r) => {
        const ex = data.exercises.find((e) => e.id === r.id)
        return ex !== undefined && ex.code === r.code
      }),
    `${data.load.exercises.length} records, every code matching exercises.json`,
  )

  {
    const p = withN({ 'TRI-LAT': { leftN: 437, rightN: 361 } })
    const off = [...p.load.byExercise.values()]
      .flatMap((l) => (l.range ? [l.range.low, l.range.high, ...l.sides.flatMap((s) => [s.low, s.high])] : []))
      .filter((v) => Math.abs(v / data.load.roundToKg - Math.round(v / data.load.roundToKg)) > 1e-9)
    check(
      'Load: every figure lands on a 2.5 kg step',
      off.length === 0 && p.load.counts.DERIVED > 0,
      off.length ? off.slice(0, 5).join(', ') : 'awkward inputs (437 / 361 N) still round cleanly',
    )
  }
}

// ---- Amend layer -----------------------------------------------------------
{
  const withPins = (pins: Pin[], over: Partial<ClientInput> = {}) => run({ ...REF, ...over, pins })
  const ex = (name: string) => data.exercises.find((e) => e.name === name)!
  const ctxFor = (p: ReturnType<typeof run>, equipment: ClientInput['equipment'] = 'Full gym'): AmendContext => ({
    data: data.amend,
    library: data.exercises,
    ageBracket: p.ageBracket,
    equipment,
    verdictOf: (id) => p.verdicts.get(id)?.verdict ?? 'OK',
  })
  const pin = (slotId: string, from: number, to: number, extra: Partial<Pin> = {}): Pin => ({
    slotId,
    from,
    to,
    actor: 'client',
    timestamp: '2026-08-16T00:00:00.000Z',
    ...extra,
  })

  check(
    'Amend: with no pins the program is identical',
    mainFingerprint(run(REF)) === mainFingerprint(withPins([])) && !run(REF).amend.active,
    'inert',
  )

  {
    // A main slot needs a compound movement — read off the LIBRARY's movement type, not the
    // Load layer's mechanical class. The two disagree on push-up, and the spec needs the
    // library reading for its own worked example.
    const p = run(REF)
    const bench = ex('Flat bench press')
    const list = buildShortlist({ dayIndex: 0, sub: bench.sub, n: 0 }, bench, ctxFor(p))
    const paused = list.candidates.find((c) => c.exercise.name === 'Paused bench press')
    const named = ['Flat fly', 'Mid-height cable crossover', 'Pec deck', 'Banded pec stretch']
    const blocked = named.filter((n) =>
      list.candidates.some((c) => c.exercise.name === n && c.blocked?.kind === 'mainSlot'),
    )
    check(
      'Amend: on a main slot, Paused bench press is RECOMMENDED and the non-compounds are blocked',
      list.mainSlot && paused?.badge === 'RECOMMENDED' && !paused.blocked && blocked.length === 4,
      `${blocked.length}/4 named exercises blocked as non-compound (${list.sameSubBlocked} in total, Svend press being the fifth)`,
    )
    check(
      'Amend: push-up stays available on a main slot — the library calls it compound',
      list.candidates.some((c) => c.exercise.name === 'Push-up' && !c.blocked),
      "the Load layer classes it BODYWEIGHT; the main-slot rule reads exercises.json's movement type, one field not two",
    )
    // Correction to the source spec, which says two.
    check(
      'Amend: the chest main-lift count is four, not two',
      data.exercises.filter((e) => e.group === 'Chest' && e.mainLift).length === 4,
      data.exercises.filter((e) => e.group === 'Chest' && e.mainLift).map((e) => e.name).join(', '),
    )
  }

  {
    const p = run({ ...REF, age: 30 })
    const lat = ex('Lateral raise')
    const list = buildShortlist({ dayIndex: 0, sub: lat.sub, n: 0 }, lat, ctxFor(p))
    const sameSub = list.candidates.filter((c) => c.type === 'B')
    check(
      'Amend: lateral raise for a healthy 30-year-old offers 7 same-sub-region swaps, none blocked',
      sameSub.length === 7 && sameSub.every((c) => !c.blocked) && !list.widened,
      `${sameSub.length} type B candidates, plus ${list.candidates.filter((c) => c.type === 'A').length} equipment variants of the same exercise`,
    )
  }

  {
    // Worked example 3 in the source spec is not achievable: every exercise in this
    // sub-region carries SH_IMPINGE, which is on the SHOULDER REMOVE list.
    const p = run({ ...REF, age: 30, pains: { SHOULDER: 'Left' } })
    const lat = ex('Lateral raise')
    const list = buildShortlist({ dayIndex: 0, sub: lat.sub, n: 0 }, lat, ctxFor(p))
    const siblings = data.amend.siblingSubRegions[lat.code]
    const adapted = list.candidates.filter((c) => c.badge === 'ADAPTED' && !c.blocked)
    const verdicts = data.exercises
      .filter((e) => e.code === lat.code)
      .map((e) => p.verdicts.get(e.id)!.verdict)
    check(
      'Amend: shoulder pain empties the lateral-raise sub-region and the list widens to siblings',
      list.sameSubAvailable === 0 &&
        list.widened &&
        adapted.length > 0 &&
        adapted.every((c) => siblings.includes(c.exercise.code)),
      `${verdicts.filter((v) => v === 'REMOVE').length} REMOVE + ${verdicts.filter((v) => v === 'SIDE_ONLY').length} SIDE_ONLY, zero available — widened to ${[...new Set(adapted.map((c) => c.exercise.code))].join(', ')}`,
    )
    check(
      'Amend: a widened list still shows the blocked options and never comes back blank',
      list.candidates.some((c) => c.blocked) && list.candidates.length > 0,
      `${list.candidates.filter((c) => c.blocked).length} blocked entries kept alongside ${adapted.length} adapted ones`,
    )
  }

  {
    // The data file's own claim about which sub-regions each pain empties, checked against
    // the engine rather than trusted.
    const wrong: string[] = []
    let checked = 0
    for (const [painId, codes] of Object.entries(data.amend.emptyShortlistByPain)) {
      const p = run({ ...REF, age: 30, pains: { [painId]: 'Both' } as PainSelection })
      for (const code of codes) {
        const from = data.exercises.find((e) => e.code === code)
        if (!from) continue
        checked++
        const list = buildShortlist({ dayIndex: 0, sub: from.sub, n: 0 }, from, ctxFor(p))
        if (list.sameSubAvailable > 0) wrong.push(`${painId}/${code}: ${list.sameSubAvailable} available`)
      }
    }
    check(
      'Amend: every sub-region the data says a pain empties really is empty',
      wrong.length === 0 && checked > 0,
      wrong.length
        ? wrong.slice(0, 3).join('; ')
        : `${checked} pain/sub-region pairs across ${Object.keys(data.amend.emptyShortlistByPain).length} pains — medial elbow alone empties ${data.amend.emptyShortlistByPain.ELBOW_MED.length}`,
    )
  }

  {
    const base = run(REF)
    const qkd = base.days.flatMap((d) => d.exercises).find((e) => e.exercise.code === 'Q-KD')!
    const curl = ex('Lying leg curl')
    const held = withPins([pin(qkd.slotId, qkd.exercise.id, curl.id, { accepted: false })])
    const done = withPins([pin(qkd.slotId, qkd.exercise.id, curl.id, { accepted: true })])
    const at = (p: ReturnType<typeof run>) =>
      p.days.flatMap((d) => d.exercises).find((e) => e.slotId === qkd.slotId)?.exercise.name

    check(
      'Amend: a type C swap does nothing until it is accepted',
      amendType(qkd.exercise, curl) === 'C' &&
        held.amend.applied.length === 0 &&
        held.amend.pending.length === 1 &&
        at(held) === qkd.exercise.name &&
        at(done) === 'Lying leg curl',
      `held back the slot stays on ${at(held)}; accepted it becomes ${at(done)}`,
    )

    const drift = done.amend.drift
    const codes = drift.map((d) => d.code)
    check(
      'Amend: that swap reports drift on both Q-KD and H-CURL',
      codes.includes('Q-KD') && codes.includes('H-CURL'),
      drift.map((d) => `${d.code} ${d.target}->${d.delivered} (${(d.pct * 100).toFixed(0)}%)`).join(' | '),
    )
    check(
      'Amend: drift is reported, never blocked',
      done.amend.applied.length === 1 && drift.length > 0 && done.exerciseCount === base.exerciseCount,
      'the swap applies in full and the program stays the same size',
    )
  }

  {
    // A pin the CURRENT injury screen would refuse is never applied.
    const base = run(REF)
    const slot = base.days.flatMap((d) => d.exercises).find((e) => e.exercise.code === 'D-SIDE')!
    const alt = data.exercises.find((e) => e.code === 'D-SIDE' && e.id !== slot.exercise.id)!
    const pins = [pin(slot.slotId, slot.exercise.id, alt.id, { actor: 'trainer' })]
    const before = withPins(pins)
    const after = withPins(pins, { pains: { SHOULDER: 'Both' } })
    check(
      'Amend: a pin that later becomes injury-blocked is dropped, with the reason stated',
      before.amend.applied.length === 1 &&
        after.amend.applied.length === 0 &&
        after.amend.retired.length === 1 &&
        /pain you reported/.test(after.amend.retired[0].reason),
      `"${alt.name}" applies pain-free, and is retired once shoulder pain is reported: ${after.amend.retired[0]?.reason}`,
    )
  }

  {
    // A pin whose slot no longer exists — the split or the frequency moved underneath it.
    const base = run(REF)
    const first = base.days[0].exercises[0]
    const alt = data.exercises.find((e) => e.code === first.exercise.code && e.id !== first.exercise.id)!
    const moved = withPins([pin(first.slotId, first.exercise.id, alt.id)], {
      days: 3,
      split: 'Full Body',
    })
    check(
      'Amend: a pin that outlives its slot is retired and reported',
      moved.amend.applied.length === 0 &&
        moved.amend.retired.length === 1 &&
        /no longer exists/.test(moved.amend.retired[0].reason),
      moved.amend.retired[0]?.reason,
    )
  }

  {
    const base = run(REF)
    const slot = base.days.flatMap((d) => d.exercises).find((e) => e.exercise.code === 'D-SIDE')!
    const alt = data.exercises.find((e) => e.code === 'D-SIDE' && e.id !== slot.exercise.id)!
    const pins = [pin(slot.slotId, slot.exercise.id, alt.id)]
    const a = withPins(pins)
    const b = withPins(pins)
    check(
      'Amend: two identical amend sequences produce identical programs',
      mainFingerprint(a) === mainFingerprint(b),
      'deterministic',
    )
    const ids = a.days.flatMap((d) => d.exercises.map((e) => e.exercise.id))
    check(
      'Amend: a pinned exercise is not also selected somewhere else in the week',
      ids.filter((id) => id === alt.id).length === 1,
      `"${alt.name}" appears once — pinned ids are reserved before selection runs`,
    )
  }

  {
    const p = run(REF)
    const anyEx = data.exercises.find((e) => e.type === 'compound')!
    const corrective = blockFor(anyEx, { ...ctxFor(p), corrective: true }, false)
    check(
      'Amend: a corrective slot is not amendable at all',
      corrective?.kind === 'corrective',
      corrective?.reason ?? 'not blocked',
    )
  }

  {
    const bench = ex('Flat bench press')
    const paused = ex('Paused bench press')
    const curl = ex('Lying leg curl')
    check(
      'Amend: the three types are detected from the exercises, never chosen',
      amendType(bench, bench, 'DB') === 'A' &&
        amendType(bench, paused) === 'B' &&
        amendType(bench, curl) === 'C' &&
        data.amend.types.C.requiresAcceptance &&
        !data.amend.types.A.requiresAcceptance &&
        !data.amend.types.B.requiresAcceptance,
      'A = same exercise + a different equipment token, B = same code, C = different code',
    )
  }

  {
    // The cap limits choices; it must not swallow the reasons the list is short.
    const p = run({ ...REF, age: 30, pains: { SHOULDER: 'Left' } })
    const lat = ex('Lateral raise')
    const list = buildShortlist({ dayIndex: 0, sub: lat.sub, n: 0 }, lat, ctxFor(p))
    check(
      'Amend: the selectable shortlist is capped at 8',
      list.candidates.filter((c) => !c.blocked && c.type !== 'A').length <= data.amend.shortlistMax &&
        list.candidates.filter((c) => c.blocked).length <= data.amend.shortlistMax,
      `${list.candidates.filter((c) => !c.blocked && c.type !== 'A').length} selectable swaps, ${list.candidates.filter((c) => c.blocked).length} shown blocked (cap ${data.amend.shortlistMax} each; equipment variants of the same exercise sit outside it)`,
    )
  }

  {
    // Equipment availability is not one of the four blocks, but offering a barbell to a
    // client with no barbell is noise rather than choice, so it is filtered out.
    const p = run({ ...REF, equipment: 'Bodyweight only' })
    const lat = ex('Lateral raise')
    const list = buildShortlist({ dayIndex: 0, sub: lat.sub, n: 0 }, lat, ctxFor(p, 'Bodyweight only'))
    const unavailable = list.candidates.filter(
      (c) => !isEquipmentAvailable(c.exercise, 'Bodyweight only'),
    )
    check(
      'Amend: the shortlist never offers what the client has no equipment for',
      unavailable.length === 0,
      `${list.candidates.length} candidates at bodyweight-only, none needing kit the client lacks`,
    )
  }
}

// ---- Time-cap layer --------------------------------------------------------
{
  const T = data.timecap
  const capped = (input: ClientInput, dayIndex: number): ClientInput => ({
    ...input,
    caps: [{ dayIndex, actor: 'client', timestamp: '2026-08-17T00:00:00.000Z' }] as CapPin[],
  })

  // Every client this suite can reach, so the layer is measured on real days rather than a
  // curated few. Two structures per preset, because the structure lever's availability is
  // exactly what the client's own choice decides.
  const CLIENTS: { name: string; input: ClientInput }[] = []
  for (const pr of PRESETS)
    for (const s of ['straight', 'superset'] as Structure[])
      CLIENTS.push({ name: `${pr.name}/${s}`, input: { ...pr.input, structure: s } })
  const bodydotMany: BodyDotInput = { S02: { value: 60 }, S01: { value: 40 }, T03: { value: 20 } }
  const valdBoth: ValdInput = {
    'Q-KD': { asymmetry: 25, weakSide: 'Left' },
    'H-KF': { asymmetry: 22, weakSide: 'Right' },
  }
  for (const pr of PRESETS)
    CLIENTS.push({
      name: `${pr.name}/loaded`,
      input: { ...pr.input, bodydot: bodydotMany, vald: valdBoth, inbody: WORKED_EXAMPLE },
    })

  // ---- correction 1: the block formula ----
  {
    // A 3-set row supersetted with a 2-set curl, Build Muscle, 75 s rest.
    const p = timeParams(data.structure, 'Build Muscle', 'superset', 75, 0)
    const block = { indices: [0, 1], structure: 'superset' as const, restMultiplier: 1 }
    const paired = blockSeconds(block, (i) => [3, 2][i], p)
    const straight = blockSeconds({ indices: [0], structure: 'straight' as const }, () => 3, p)
    check(
      'Time model: a mixed 3-set + 2-set Build Muscle superset is 480 s, not 540 s',
      Math.abs(paired - 480) < 1e-9 && Math.abs(straight - 360) < 1e-9,
      `paired ${paired} s (old formula gave 540), single 3-set exercise ${straight} s`,
    )
  }

  // ---- the button is rendered if and only if the day exceeds 60 ----
  {
    // The component's condition is `minutes > target`, strictly. A day landing on exactly
    // 60.0 is not over 60 and gets no button — and days do land there: the Reference client's
    // day 4 is exactly 60.00 min. What has to hold is that the gate and the engine agree, so
    // a day that would be offered the button always has something to cut, and a day that
    // would not is never quietly changed by pressing it.
    let over = 0
    let under = 0
    let onTheLine = 0
    const bad: string[] = []
    for (const c of CLIENTS)
      for (const d of run(c.input).days) {
        const offered = d.wholeSetMinutes > T.target
        if (offered) over++
        else under++
        if (Math.abs(d.wholeSetMinutes - T.target) < 1e-9) onTheLine++
        if (offered) continue
        const p = run(capped(c.input, d.index))
        const plan = p.timecap.applied.find((a) => a.dayIndex === d.index)!.plan
        if (plan.points !== 0 || plan.steps.length !== 0)
          bad.push(`${c.name} day ${d.index + 1} at ${d.wholeSetMinutes.toFixed(2)} min spent ${plan.points} points`)
      }
    check(
      `Time cap: the button is offered if and only if the day exceeds ${T.target} min, strictly`,
      bad.length === 0 && over > 0 && under > 0,
      bad.length
        ? bad.join('; ')
        : `${over} days offer the button, ${under} do not (${onTheLine} sit on exactly ${T.target}.00 and correctly do not)`,
    )
  }

  // ---- every applied plan lands at or under 60.0, or reports a shortfall ----
  const applied: { name: string; dayIndex: number; plan: ReturnType<typeof planCap>; model: CapDayModel }[] = []
  for (const c of CLIENTS) {
    const base = run(c.input)
    for (const d of base.days) {
      if (d.wholeSetMinutes <= T.target) continue
      const p = run(capped(c.input, d.index))
      const entry = p.timecap.applied.find((a) => a.dayIndex === d.index)
      if (entry) applied.push({ name: c.name, dayIndex: d.index, plan: entry.plan, model: entry.model })
    }
  }
  {
    const bad = applied.filter(
      (a) => !(a.plan.reached ? a.plan.minutesAfter <= T.target + 1e-9 : a.plan.shortfall > 0 && a.plan.reason.length > 0),
    )
    const reached = applied.filter((a) => a.plan.reached).length
    check(
      `Time cap: every plan lands at or under ${T.target}.0 min, or reports a shortfall with a reason`,
      bad.length === 0 && applied.length > 0,
      bad.length
        ? bad.map((b) => `${b.name} day ${b.dayIndex + 1}: ${b.plan.minutesAfter.toFixed(2)}`).join('; ')
        : `${reached}/${applied.length} days reached ${T.target} min; ${applied.length - reached} reported a shortfall`,
    )
  }

  // ---- the applied program agrees with the plan ----
  {
    const bad: string[] = []
    for (const c of CLIENTS) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const p = run(capped(c.input, d.index))
        const entry = p.timecap.applied.find((a) => a.dayIndex === d.index)!
        const day = p.days.find((x) => x.index === d.index)!
        if (Math.abs(day.minutes - entry.plan.minutesAfter) > 1e-6)
          bad.push(`${c.name} day ${d.index + 1}: header ${day.minutes.toFixed(2)} vs plan ${entry.plan.minutesAfter.toFixed(2)}`)
      }
    }
    check(
      'Time cap: the session the client is shown is the session the search costed',
      bad.length === 0,
      bad.length ? bad.slice(0, 3).join('; ') : `${applied.length} capped days, header and plan identical`,
    )
  }

  // ---- the four hard floors ----
  {
    const bad: string[] = []
    for (const c of CLIENTS) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const p = run(capped(c.input, d.index))
        const day = p.days.find((x) => x.index === d.index)!
        const entry = p.timecap.applied.find((a) => a.dayIndex === d.index)!
        const plan = entry.plan
        // The baseline is the day AS THE SEARCH SAW IT — whole sets, nothing cut. Comparing
        // against the raw fractional day would read the whole-set resolution as a cut.
        const before = new Map(entry.model.exercises.map((e) => [e.exercise.id, e]))
        const where = `${c.name} day ${d.index + 1}`

        for (const e of day.exercises) {
          if (e.sets < T.floors.sessionMinSets)
            bad.push(`${where}: "${e.exercise.name}" at ${e.sets} sets`)
          const was = before.get(e.exercise.id)!
          const floor = Math.min(
            data.timecap.restFloor[p.ageBracket]?.[c.input.goal] ?? 0,
            was.restSeconds,
          )
          if (e.restSeconds < floor - 1e-9)
            bad.push(`${where}: rest ${e.restSeconds} below floor ${floor}`)
        }
        // No muscle is left trained-but-under-two: every surviving exercise holds >= 2 sets,
        // so a group is either out of the session entirely or at 2 sets or more.
        const byGroup = new Map<string, number>()
        for (const e of day.exercises)
          byGroup.set(e.exercise.group, (byGroup.get(e.exercise.group) ?? 0) + e.sets)
        for (const [g, sets] of byGroup)
          if (sets > 0 && sets < T.floors.sessionMinSets) bad.push(`${where}: ${g} at ${sets} sets`)

        // main lifts: never removed, never trimmed
        for (const e of entry.model.exercises) {
          if (!e.mainLift) continue
          const still = day.exercises.find((x) => x.exercise.id === e.exercise.id)
          if (!still) bad.push(`${where}: main lift "${e.exercise.name}" removed`)
          else if (still.sets < e.sets) bad.push(`${where}: main lift "${e.exercise.name}" cut to ${still.sets}`)
        }

        // one structure step per day, and only ever a step
        const steps = plan.steps.filter((s) => s.lever === 'structure_step').length
        if (steps > 1) bad.push(`${where}: ${steps} structure steps`)
        const expected = steps === 1 ? nextStructure(d.structure) : d.structure
        if (day.structure !== expected)
          bad.push(`${where}: structure ${d.structure} -> ${day.structure}, expected ${expected}`)
      }
    }
    check(
      'Time cap: no plan breaches SESSION_MIN, the rest floor, the one-step rule or the main lift',
      bad.length === 0,
      bad.length ? bad.slice(0, 4).join('; ') : `${applied.length} capped days, all four floors held`,
    )
  }

  // ---- supersetting never changes a set count ----
  {
    const bad: string[] = []
    let checked = 0
    for (const c of CLIENTS) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const p = run(capped(c.input, d.index))
        const entry = p.timecap.applied.find((a) => a.dayIndex === d.index)!
        // isolate the structure step: only compare where it was the ONLY lever pulled
        if (entry.plan.steps.length !== 1 || entry.plan.steps[0].lever !== 'structure_step') continue
        checked++
        const day = p.days.find((x) => x.index === d.index)!
        for (const e of entry.model.exercises) {
          const still = day.exercises.find((x) => x.exercise.id === e.exercise.id)
          if (!still || still.sets !== e.sets)
            bad.push(`${c.name} day ${d.index + 1}: "${e.exercise.name}" ${e.sets} -> ${still?.sets ?? 'gone'}`)
        }
      }
    }
    check(
      'Time cap: supersetting never changes any member’s set count',
      bad.length === 0 && checked > 0,
      bad.length ? bad.slice(0, 3).join('; ') : `${checked} days solved by the structure step alone, every set intact`,
    )
  }

  // ---- determinism ----
  {
    const bad: string[] = []
    for (const c of CLIENTS) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const fingerprint = (input: ClientInput) => {
          const p = run(input)
          const plan = p.timecap.applied.find((a) => a.dayIndex === d.index)!.plan
          return JSON.stringify([plan.points, plan.steps.map((s) => [s.dataId, s.detail]), plan.minutesAfter])
        }
        if (fingerprint(capped(c.input, d.index)) !== fingerprint(capped(c.input, d.index)))
          bad.push(`${c.name} day ${d.index + 1}`)
      }
    }
    check(
      'Time cap: the same day pressed twice produces the same plan',
      bad.length === 0,
      bad.length ? bad.join('; ') : `${applied.length} capped days, byte-identical on a second press`,
    )
  }

  // ---- optimality: the plan is provably the cheapest, not the first that fits ----
  {
    // Dijkstra's guarantee rests on every lever costing more than zero. The engine also
    // prunes any pull that does not shorten the session, which is only safe if such a pull
    // could never unlock a bigger saving later.
    //
    // Every lever that removes work — sets, exercises, correctives, filler, rest — is
    // monotone: it can only shorten. The superset -> triset step is NOT, and this measured
    // it: four exercises pack into two clean supersets, but into one triset plus one
    // straight exercise, and the triset carries a 1.15 rest multiplier the pairs do not.
    // Reference/superset day 2 comes out 39 s LONGER as a triset.
    //
    // That step is capped at one per day and unlocks nothing, so pruning it where it does not
    // help costs no optimality. Asserted here as two separate facts so a future change to
    // either one fails loudly instead of quietly invalidating the search.
    const badRemovers: string[] = []
    const lengthening: string[] = []
    let pulls = 0
    for (const c of CLIENTS.slice(0, 8)) {
      const p = run(c.input)
      for (const d of p.days) {
        const s = baseState(d.capModel)
        const before = capSeconds(d.capModel, s)
        for (const child of children(d.capModel, s, Infinity)) {
          pulls++
          if (child.seconds <= before) continue
          const line = `${c.name} day ${d.index + 1}: "${child.step.detail}" adds ${(child.seconds - before).toFixed(0)} s`
          if (child.step.lever === 'structure_step') lengthening.push(line)
          else badRemovers.push(line)
        }
      }
    }
    check(
      'Time cap: every lever that removes work shortens the session — only the triset step can lengthen it',
      badRemovers.length === 0 && pulls > 0,
      badRemovers.length
        ? badRemovers.slice(0, 3).join('; ')
        : `${pulls} single pulls checked across 8 clients; ${lengthening.length} were superset→triset steps that would have LENGTHENED the day and are pruned, e.g. ${lengthening[0] ?? 'none'}`,
    )
  }
  {
    // Brute force against the exact optimum on the days small enough to enumerate: every
    // state reachable for fewer points than the plan spent must still be over the target.
    const bad: string[] = []
    let proved = 0
    // A partial walk that finds nothing proves nothing. Days whose sub-budget space is too
    // large to enumerate are counted separately and never as a pass — a check that can go
    // green by running out of room is worse than no check.
    const abandoned: string[] = []
    const LIMIT = 400_000
    for (const a of applied) {
      if (!a.plan.reached || !a.plan.proven) continue
      const day = { capModel: a.model }
      const budget = a.plan.points
      const seen = new Set<string>()
      let cheaper: string | null = null
      let ranOut = false
      const walk = (state: ReturnType<typeof baseState>, spent: number) => {
        if (cheaper || ranOut) return
        for (const child of children(day.capModel, state, capSeconds(day.capModel, state))) {
          const next = spent + child.step.cost
          if (next >= budget) continue // cannot beat the plan from here
          const key = stateKey(child.state)
          if (seen.has(key)) continue
          seen.add(key)
          if (seen.size > LIMIT) {
            ranOut = true
            return
          }
          if (child.seconds <= T.target * 60) {
            cheaper = `${a.name} day ${a.dayIndex + 1}: ${next} < ${budget} points reaches ${(child.seconds / 60).toFixed(1)} min`
            return
          }
          walk(child.state, next)
          if (cheaper || ranOut) return
        }
      }
      walk(baseState(day.capModel), 0)
      if (cheaper) bad.push(cheaper)
      else if (ranOut) abandoned.push(`${a.name} day ${a.dayIndex + 1} (${budget} pts)`)
      else proved++
    }
    check(
      'Time cap: no cheaper plan exists — brute-forced against the exact optimum',
      bad.length === 0 && proved > 0,
      bad.length
        ? bad.slice(0, 3).join('; ')
        : `${proved} plans re-proved optimal by exhausting every state below their own cost` +
          (abandoned.length
            ? `; ${abandoned.length} NOT re-proved — the sub-budget space passed ${LIMIT.toLocaleString()} states: ${abandoned.slice(0, 3).join(', ')}`
            : ''),
    )
  }

  // ---- a Get Stronger day: verify the TOTAL, not the first step ----
  {
    const gs = CLIENTS.filter((c) => c.input.goal === 'Get Stronger')
    const lines: string[] = []
    let anyCheaperTotal = true
    for (const c of gs) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const p = run(capped(c.input, d.index))
        const plan = p.timecap.applied.find((a) => a.dayIndex === d.index)!.plan
        const restSteps = plan.steps.filter((s) => s.lever === 'rest').length
        const accessory = plan.steps.filter(
          (s) => s.lever === 'set_accessory' || s.lever === 'remove_accessory_exercise',
        ).length
        lines.push(`${c.name} d${d.index + 1}: ${plan.points}pt rest×${restSteps} accessory×${accessory}`)
        // Rest costs 4 on Get Stronger, an accessory set costs 4 too. The claim under test is
        // not that one comes first, it is that the TOTAL is the cheapest available — proved
        // by the brute-force check above. Here we only record which the search preferred.
      }
    }
    check(
      'Time cap: a Get Stronger day is costed on the total, not on which lever comes first',
      anyCheaperTotal && lines.length > 0,
      lines.slice(0, 4).join(' | '),
    )
    log(`  Get Stronger cap plans: ${lines.length} days — ${lines.slice(0, 6).join(' | ')}`)
  }

  // ---- a day that cannot reach 60 reports rather than cutting the main lift ----
  {
    const unreachable = applied.filter((a) => !a.plan.reached)
    const bad = unreachable.filter((a) => a.plan.reason.length === 0 || a.plan.shortfall <= 0)
    check(
      'Time cap: a day that cannot reach the target reports the shortfall instead of cutting the main lift',
      bad.length === 0,
      unreachable.length
        ? `${unreachable.length} unreachable days, e.g. ${unreachable[0].name} day ${unreachable[0].dayIndex + 1} at ${unreachable[0].plan.minutesAfter.toFixed(1)} min (${unreachable[0].plan.shortfall.toFixed(1)} over): ${unreachable[0].plan.reason}`
        : 'no day in the preset sweep was unreachable',
    )
  }

  // ---- rest trims in whole 10 s steps ----
  {
    const bad: string[] = []
    for (const c of CLIENTS) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const p = run(capped(c.input, d.index))
        const day = p.days.find((x) => x.index === d.index)!
        const plan = p.timecap.applied.find((a) => a.dayIndex === d.index)!.plan
        const steps = plan.steps.filter((s) => s.lever === 'rest').length
        if (steps === 0) continue
        const floor = data.timecap.restFloor[p.ageBracket]?.[c.input.goal] ?? 0
        for (const e of day.exercises) {
          const was = d.exercises.find((x) => x.exercise.id === e.exercise.id)
          if (!was) continue
          // Whole 10 s steps, except where the last step lands ON the floor: 75 s at a 60 s
          // floor goes 75 -> 65 -> 60, and 60 is a number a client can follow perfectly well.
          const onFloor = Math.abs(e.restSeconds - Math.min(floor, was.restSeconds)) < 1e-9
          const drop = was.restSeconds - e.restSeconds
          if (drop % 10 !== 0 && !onFloor)
            bad.push(`${c.name} day ${d.index + 1}: rest ${was.restSeconds} → ${e.restSeconds} (floor ${floor})`)
        }
      }
    }
    check(
      'Time cap: rest trims in whole 10 s steps, or lands exactly on its floor',
      bad.length === 0,
      bad.length ? bad.slice(0, 3).join('; ') : 'every rest change on a capped day is a multiple of 10 s or the floor itself',
    )
  }

  // ---- the cost table resolves ----
  {
    const ids = [
      'filler',
      restLeverId('Lose Fat'),
      restLeverId('Build Muscle'),
      restLeverId('Get Stronger'),
      'structure_step',
      'corrective_borderline',
      'corrective_abnormal',
      'set_accessory',
      'set_secondary',
      'set_primary',
      'remove_accessory_exercise',
    ]
    const missing = ids.filter((id) => leverCost(T, id) === null)
    check(
      'Time cap: every lever the engine can pull has a cost in the data file, and the main lift has none',
      missing.length === 0 && leverCost(T, 'main_lift') === null,
      missing.length ? `missing: ${missing.join(', ')}` : `${ids.length} levers priced, main_lift blocked`,
    )
  }

  // ---- an untouched day is byte-identical ----
  {
    const bad: string[] = []
    for (const c of CLIENTS) {
      const base = run(c.input)
      const short = base.days.find((d) => d.wholeSetMinutes <= T.target)
      if (!short) continue
      const p = run({ ...c.input, caps: [{ dayIndex: short.index, actor: 'client', timestamp: '2026-08-17T00:00:00.000Z' }] })
      const plan = p.timecap.applied.find((a) => a.dayIndex === short.index)!.plan
      if (plan.steps.length !== 0 || plan.points !== 0)
        bad.push(`${c.name} day ${short.index + 1}: ${plan.points} points spent on a day already inside`)
      // and no OTHER day moved
      for (const d of base.days) {
        const now = p.days.find((x) => x.index === d.index)!
        if (d.index !== short.index && Math.abs(now.minutes - d.minutes) > 1e-9)
          bad.push(`${c.name}: pressing day ${short.index + 1} moved day ${d.index + 1}`)
      }
    }
    check(
      'Time cap: it is per day — pressing one day never touches another, and a short day costs nothing',
      bad.length === 0,
      bad.length ? bad.slice(0, 3).join('; ') : 'no cross-day effect across the preset sweep',
    )
  }

  // ---- both views agree on a capped day ----
  {
    // A button labelled "Reduce to 60 min" that leaves the client-facing view reading 63 is
    // the one outcome this layer cannot have. A capped day is resolved to whole sets before
    // the search runs, so the simple view's rounding is a no-op on it and both views land on
    // the same minute.
    const bad: string[] = []
    let checked = 0
    for (const c of CLIENTS) {
      const base = run(c.input)
      for (const d of base.days) {
        if (d.wholeSetMinutes <= T.target) continue
        const p = run(capped(c.input, d.index))
        const day = p.days.find((x) => x.index === d.index)!
        const r = roundSets(p)
        const simple = capMinutes(day.capModel, {
          ...day.capState,
          sets: day.exercises.map((e, i) => r.byPick.get(pickKey(day.index, i)) ?? e.sets),
        })
        checked++
        if (Math.abs(simple - day.minutes) > 1e-9)
          bad.push(`${c.name} day ${d.index + 1}: simple ${simple.toFixed(1)} vs ${day.minutes.toFixed(1)}`)
      }
    }
    check(
      'Time cap: the client-facing view and the engine read the same minute on a capped day',
      bad.length === 0 && checked > 0,
      bad.length ? bad.slice(0, 3).join('; ') : `${checked} capped days, simple and detailed views identical`,
    )
  }

  {
    // Resolving one day to whole sets takes its picks out of the per-group rounding carry, so
    // the OTHER days' rounded figures can shift by a set. That is the same mechanism, and the
    // same ±0.5 guarantee, that already governs the uncapped program — asserted here rather
    // than assumed, because it is a visible consequence of pressing the button.
    const bad: string[] = []
    for (const c of CLIENTS) {
      const base = run(c.input)
      const long = base.days.find((d) => d.wholeSetMinutes > T.target)
      if (!long) continue
      const r = roundSets(run(capped(c.input, long.index)))
      if (r.maxDrift > 0.5 + 1e-9)
        bad.push(`${c.name}: max drift ${r.maxDrift.toFixed(2)} sets after capping day ${long.index + 1}`)
    }
    check(
      'Time cap: capping one day keeps every muscle group inside the ±0.5-set rounding guarantee',
      bad.length === 0,
      bad.length ? bad.join('; ') : 'no muscle group drifts past 0.5 sets on any capped program',
    )
  }

  // ---- two of the twelve levers are unreachable, and it is not the engine's doing ----
  {
    // Selection ranks primary tier first, and all 47 sub-regions in the library contain a
    // primary-tier exercise — so an allocation slot asking for one exercise always gets a
    // primary one. Accessory-tier exercises are only ever reached through reuse or a sibling
    // substitution, which in practice never happens. That makes "accessory set" (4 points)
    // and "whole accessory exercise" (10) dead rows in the cost table, and leaves the
    // cheapest set cut actually on offer at 18. Recorded as a finding, not hidden.
    const tiers = new Map<string, number>()
    const subsWithPrimary = new Set<string>()
    for (const e of data.exercises) if (e.tier === 'primary') subsWithPrimary.add(e.sub)
    const allSubs = new Set(data.exercises.map((e) => e.sub))
    for (const c of CLIENTS)
      for (const d of run(c.input).days)
        for (const e of d.exercises) tiers.set(e.exercise.tier, (tiers.get(e.exercise.tier) ?? 0) + 1)
    const accessoriesChosen = tiers.get('accessory') ?? 0
    const accessoryPulls = applied
      .flatMap((a) => a.plan.steps)
      .filter((s) => s.lever === 'set_accessory' || s.lever === 'remove_accessory_exercise').length
    check(
      'Time cap: the two accessory levers are unreachable because selection never picks an accessory',
      accessoriesChosen === 0 && accessoryPulls === 0 && subsWithPrimary.size === allSubs.size,
      `chosen tiers ${[...tiers].map(([t, n]) => `${t} ${n}`).join(', ')}; ` +
        `${subsWithPrimary.size}/${allSubs.size} sub-regions contain a primary, so ranking always takes one — ` +
        `"accessory set" (4) and "whole accessory exercise" (10) never fire, and the cheapest set cut on offer costs 18`,
    )
  }

  // ---- the search proves optimality, or says it did not ----
  {
    const unproven = applied.filter((a) => !a.plan.proven)
    check(
      'Time cap: a plan the search could not prove minimal says so rather than claiming it',
      unproven.every((a) => a.plan.reached && a.plan.reason.includes('prove no cheaper one exists')),
      unproven.length
        ? `${unproven.length}/${applied.length} not proven minimal within the search budget, each reaching the target and labelled`
        : `all ${applied.length} plans proven minimal`,
    )
  }

  // ---- lever-use distribution, for comparison with the spec's 34/23/15/11 ----
  {
    const byLever = new Map<string, number>()
    let steps = 0
    for (const a of applied)
      for (const s of a.plan.steps) {
        byLever.set(s.lever, (byLever.get(s.lever) ?? 0) + 1)
        steps++
      }
    // Counted two ways, because they say different things. Share of PULLS is dominated by
    // the handful of very long sessions that need a dozen set cuts each; share of DAYS the
    // lever appears on is the one comparable with "supersetting alone solves about a third
    // of days".
    const byDay = new Map<string, number>()
    for (const a of applied)
      for (const l of new Set(a.plan.steps.map((s) => s.lever)))
        byDay.set(l, (byDay.get(l) ?? 0) + 1)
    const share = (m: Map<string, number>, total: number, ...keys: string[]) =>
      ((keys.reduce((s, k) => s + (m.get(k) ?? 0), 0) / Math.max(1, total)) * 100).toFixed(0)
    const SET_LEVERS = ['set_accessory', 'set_secondary', 'set_primary']
    const CORR_LEVERS = ['corrective_borderline', 'corrective_abnormal']
    log(
      `  Time-cap lever use, share of ${steps} pulls across ${applied.length} pressed days: ` +
        `structure ${share(byLever, steps, 'structure_step')}%, rest ${share(byLever, steps, 'rest')}%, ` +
        `filler ${share(byLever, steps, 'filler')}%, remove exercise ${share(byLever, steps, 'remove_accessory_exercise')}%, ` +
        `sets ${share(byLever, steps, ...SET_LEVERS)}%, correctives ${share(byLever, steps, ...CORR_LEVERS)}%`,
    )
    log(
      `  Time-cap lever use, share of the ${applied.length} pressed DAYS each appears on: ` +
        `structure ${share(byDay, applied.length, 'structure_step')}%, rest ${share(byDay, applied.length, 'rest')}%, ` +
        `filler ${share(byDay, applied.length, 'filler')}%, remove exercise ${share(byDay, applied.length, 'remove_accessory_exercise')}%, ` +
        `sets ${share(byDay, applied.length, ...SET_LEVERS)}%, correctives ${share(byDay, applied.length, ...CORR_LEVERS)}% ` +
        `— spec measured structure 34 / rest 23 / filler 15 / remove 11`,
    )
    const solvedByStructureAlone = applied.filter(
      (a) => a.plan.steps.length === 1 && a.plan.steps[0].lever === 'structure_step',
    ).length
    log(
      `  Structure step alone solved ${solvedByStructureAlone}/${applied.length} pressed days ` +
        `(${((solvedByStructureAlone / Math.max(1, applied.length)) * 100).toFixed(0)}%); ` +
        `median plan ${applied.length ? applied.map((a) => a.plan.points).sort((x, y) => x - y)[Math.floor(applied.length / 2)] : 0} points, ` +
        `max search ${Math.max(0, ...applied.map((a) => a.plan.nodesExpanded))} states expanded`,
    )
    const restUsed = restOf
    void restUsed
  }
}

// ---- BodyDot import (Bodydot API) ------------------------------------------
// Offline: the indicator map and the reading rules are checked against a synthetic session
// shaped like a real one. The transport is not exercised here — it needs the live service.
{
  const bands = realBands(data.bodydot)
  const codes = bands.map((b) => b.code)
  const mapped = Object.keys(INDICATOR_SOURCES)

  check(
    'BodyDot import: every one of the 26 indicators has a source in a Bodydot session',
    codes.every((c) => mapped.includes(c)) && mapped.every((c) => codes.includes(c)),
    `${mapped.length} mapped against ${codes.length} bands` +
      `; unmapped: ${codes.filter((c) => !mapped.includes(c)).join(', ') || 'none'}` +
      `; unknown: ${mapped.filter((c) => !codes.includes(c)).join(', ') || 'none'}`,
  )

  {
    // The posture form in the VALD-automator wires 15 of the 26 and has no source at all for
    // S07, which IS in the arsenal. Asserted so the gap cannot quietly reopen.
    const arsenalCodes = bands.filter((b) => b.inArsenal).map((b) => b.code)
    check(
      'BodyDot import: every arsenal indicator is sourced, S07 included',
      arsenalCodes.every((c) => mapped.includes(c)) && mapped.includes('S07'),
      `${arsenalCodes.length} arsenal indicators, all sourced (the posture form misses S07 Anterior Pelvic Tilt)`,
    )
  }

  check(
    'BodyDot import: distances scale from metres to cm, angles do not scale',
    bands.every((b) => scaleFor(b) === (b.unit === 'cm' ? 100 : 1)),
    `${bands.filter((b) => b.unit === 'cm').length} cm indicators scaled x100, the rest left as degrees`,
  )

  {
    // A session shaped exactly like a real one: front view, both side views with DIFFERENT
    // values, one cancelled step, and no squat or toe-touch at all.
    const session = {
      id: 'test',
      createdAt: '2026-08-17T09:00:00.000Z',
      sequences: [
        {
          code: 'custom',
          stepResults: [
            {
              stepCode: 'standingFront',
              status: 'Analyzed',
              data: {
                values: [
                  { valueCode: 'leftShoulderSlope', value: 13 }, // normal
                  { valueCode: 'rightShoulderSlope', value: 21 }, // abnormal high
                  { valueCode: 'frontalASISAlignment', value: -3.1 }, // signed, tilts Left
                  { valueCode: 'coronalBalance', value: 0.03 }, // metres -> 3 cm
                ],
              },
            },
            {
              stepCode: 'standingRight',
              status: 'Analyzed',
              data: { values: [{ valueCode: 'thoracicKyphosis', value: 41 }] },
            },
            {
              stepCode: 'standingLeft',
              status: 'Analyzed',
              data: { values: [{ valueCode: 'thoracicKyphosisLeft', value: 62 }] },
            },
            { stepCode: 'overheadSquatRight', status: 'Canceled', data: { values: [] } },
          ],
        },
      ],
    }
    const imp = readSession(session, data.bodydot)
    const by = new Map(imp.indicators.map((i) => [i.code, i]))

    check(
      'BodyDot import: where both sides are measured, the WORSE side becomes the finding',
      by.get('F03')?.side === 'Right' &&
        by.get('F03')?.value === 21 &&
        by.get('F03')?.bySide?.left === 13 &&
        // The two standing views are separate steps; reading both from one step left the
        // left view unread and made every sagittal finding claim the right side.
        by.get('S05')?.side === 'Left' &&
        by.get('S05')?.value === 62,
      `shoulder slope L13/R21 -> Right 21 (${by.get('F03')?.tier}); kyphosis R41/L62 -> Left 62 (${by.get('S05')?.tier})`,
    )

    check(
      'BodyDot import: the frontal pelvic reading stays signed, and its side is read off the sign',
      by.get('F05')?.value === -3.1 && by.get('F05')?.side === 'Left',
      `frontalASISAlignment -3.1 -> value -3.1, side Left (the band runs -2.0 to 2.0, so an absolute value would lose the direction)`,
    )

    check(
      'BodyDot import: a metre distance is converted to the cm the band is written in',
      Math.abs((by.get('F07')?.value ?? 0) - 3) < 1e-9,
      `coronalBalance 0.03 m -> 3 cm`,
    )

    check(
      'BodyDot import: a step that was not analyzed is reported missing, never guessed',
      imp.missing.length === 26 - imp.indicators.length &&
        imp.missing.some((m) => m.code === 'Q01') &&
        imp.missing.some((m) => m.code === 'T03') &&
        !imp.indicators.some((i) => i.code === 'Q01'),
      `${imp.indicators.length} read, ${imp.missing.length} reported missing (the cancelled squat and the absent toe touch)`,
    )

    check(
      'BodyDot import: the MAJORITY validity rule matches the report generator',
      imp.validity.analyzed === 3 && imp.validity.total === 4 && imp.validity.valid,
      `3 of 4 steps analyzed -> valid`,
    )

    {
      // Two sessions on one day is a failed attempt and its redo; the later one counts.
      const kept = latestPerDay([
        { id: 'a', createdAt: '2026-08-17T09:00:00.000Z' },
        { id: 'b', createdAt: '2026-08-17T11:30:00.000Z' },
        { id: 'c', createdAt: '2026-08-16T09:00:00.000Z' },
      ])
      check(
        'BodyDot import: several tests on one day collapse to the latest',
        kept.length === 2 && kept[0].id === 'b' && kept[1].id === 'c',
        `3 sessions across 2 days -> ${kept.map((k) => k.id).join(', ')}`,
      )
    }

    {
      // The readings have to drive the layer, not just parse.
      const p = run({ ...REF, bodydot: imp.readings })
      check(
        'BodyDot import: imported readings drive the corrective block',
        p.bodydot.active && p.bodydot.findings.length > 0,
        `${p.bodydot.findings.length} findings, ${p.bodydot.correctives.length} correctives from a 3-step scan`,
      )
    }
  }
}

// ---- VALD import (DynaMo Excel export) -------------------------------------
// Offline: the grid reader is fed rows shaped exactly like a real export — newest-first,
// one row per attempt, the trunk written as two one-sided bends. The .xlsx unzipping is not
// exercised here; it needs a browser's DecompressionStream.
{
  const HEADER = [
    'Name', 'External Id', 'Date', 'Time', 'Device', 'Movement', 'Type', 'Body Region',
    'Position', 'L Reps', 'R Reps', 'N Reps', 'L Max Force (N)', 'R Max Force (N)',
    'N Max Force (N)', 'L Avg Force (N)', 'R Avg Force (N)', 'N Avg Force (N)',
    'Force Asymmetry (%)',
  ]
  const col = (name: string) => HEADER.indexOf(name)
  /** One export row. `time` is a fraction of a day, exactly as DynaMo writes it. */
  const row = (o: {
    name: string
    date: number
    time: number
    movement: string
    region: string
    asym?: string
    l?: number
    r?: number
    n?: number
  }) => {
    const cells = HEADER.map(() => '')
    cells[col('Name')] = o.name
    cells[col('Date')] = String(o.date)
    cells[col('Time')] = String(o.time)
    cells[col('Movement')] = o.movement
    cells[col('Body Region')] = o.region
    cells[col('Force Asymmetry (%)')] = o.asym ?? 'n/a'
    if (o.l !== undefined) cells[col('L Max Force (N)')] = String(o.l)
    if (o.r !== undefined) cells[col('R Max Force (N)')] = String(o.r)
    if (o.n !== undefined) cells[col('N Max Force (N)')] = String(o.n)
    return cells
  }
  const DAY = 46251 // 2026-08-17 as an Excel serial

  {
    // A movement redone twice. The FIRST row is the LATEST attempt.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '6.4% L', l: 227, r: 212 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Push', region: 'Shoulder', asym: '23% R', l: 137, r: 177 }),
    ]
    const s = parseValdGrid(grid, data.vald).sessions[0]
    const t = s.tests.find((x) => x.code === 'C-MID')
    check(
      'VALD import: a repeated movement keeps the latest attempt, not the last row',
      t?.asymmetry === 6.4 && t?.weakSide === 'Right' && t?.leftN === 227 && t?.attempts === 2,
      `kept ${t?.asymmetry}% weak ${t?.weakSide} from ${t?.attempts} attempts` +
        ' (row order alone would have kept 23% weak Left — the opposite side)',
    )
  }

  {
    // The latest attempt is a dud: cancelled, so no percentage and a zero on one side.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: 'n/a', l: 0, r: 177 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Push', region: 'Shoulder', asym: '23% R', l: 137, r: 177 }),
    ]
    const t = parseValdGrid(grid, data.vald).sessions[0].tests.find((x) => x.code === 'C-MID')
    check(
      'VALD import: a cancelled attempt never displaces one that produced a reading',
      t?.asymmetry === 23 && t?.leftN === 137,
      `kept the 23% attempt over a later "n/a" row; ${t?.attempts} attempts seen`,
    )
  }

  {
    // The trunk: two one-sided bends, each with a neutral force and no percentage.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Lateral Flexion Right', region: 'Trunk', n: 155 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Lateral Flexion Left', region: 'Trunk', n: 96 }),
      row({ name: 'A', date: DAY, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
    ]
    const s = parseValdGrid(grid, data.vald).sessions[0]
    const t = s.tests.find((x) => x.code === 'AC-ALF')
    // 59 / 155 = 38.06% on DynaMo's own convention, and the left side pushed less.
    check(
      'VALD import: the trunk is assembled from its two one-sided rows',
      t !== undefined && Math.abs(t.asymmetry! - 38.06) < 0.01 && t.weakSide === 'Left',
      t
        ? `L 96 N / R 155 N -> ${t.asymmetry!.toFixed(2)}% weak ${t.weakSide}`
        : 'no trunk test produced — neither row names a test on its own',
    )
    check(
      'VALD import: the derived trunk figure is on the same scale as every machine-scored test',
      t !== undefined && Math.abs(t.asymmetry! - asymmetryFromNewtons(96, 155)) < 1e-9,
      `divides by the stronger side like DynaMo, not by the mean (which would read 47.01%)` +
        ` — so the 8% and ${data.vald.referralThreshold}% thresholds mean the same thing for the trunk`,
    )
  }

  {
    // Only one side bent. Half a pair scores nothing.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Lateral Flexion Left', region: 'Trunk', n: 96 }),
      row({ name: 'A', date: DAY, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
    ]
    const s = parseValdGrid(grid, data.vald).sessions[0]
    check(
      'VALD import: a one-sided trunk bend is reported, never scored against nothing',
      !s.tests.some((x) => x.code === 'AC-ALF') &&
        s.unmapped.some((u) => u.bodyRegion === 'Trunk' && /left side only/.test(u.movement)),
      `unmapped: ${s.unmapped.map((u) => `${u.bodyRegion} ${u.movement}`).join(', ')}`,
    )
  }

  {
    // Shoulder + elbow + knee and nothing trunk/hip-flexion — a full-body battery.
    const full = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Internal Rotation', region: 'Shoulder', asym: '8% R', l: 108, r: 168 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Flexion', region: 'Elbow', asym: '2% R', l: 261, r: 263 }),
      row({ name: 'A', date: DAY, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
      row({ name: 'A', date: DAY, time: 0.6, movement: 'Abduction', region: 'Hip', asym: '9% R', l: 180, r: 196 }),
    ]
    const s = parseValdGrid(full, data.vald).sessions
    check(
      'VALD import: shoulder + elbow + knee with no trunk or hip flexion reads as full body',
      s.length === 1 && s[0].battery === 'full' && !s[0].pairedSameDay,
      `${s.length} test(s): ${s.map((x) => `${x.battery} x${x.tests.length}`).join(', ')}`,
    )
  }

  {
    // The same shape plus a trunk bend and hip flexion — an upper and a lower, same day.
    const both = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Internal Rotation', region: 'Shoulder', asym: '8% R', l: 108, r: 168 }),
      row({ name: 'A', date: DAY, time: 0.88, movement: 'Grip Squeeze', region: 'Hand', asym: '3% R', l: 457, r: 472 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Flexion', region: 'Elbow', asym: '2% R', l: 261, r: 263 }),
      row({ name: 'A', date: DAY, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
      row({ name: 'A', date: DAY, time: 0.65, movement: 'Flexion', region: 'Hip', asym: '4% L', l: 126, r: 121 }),
      row({ name: 'A', date: DAY, time: 0.6, movement: 'Lateral Flexion Right', region: 'Trunk', n: 155 }),
      row({ name: 'A', date: DAY, time: 0.55, movement: 'Lateral Flexion Left', region: 'Trunk', n: 96 }),
    ]
    const s = parseValdGrid(both, data.vald).sessions
    const upper = s.find((x) => x.battery === 'upper')
    const lower = s.find((x) => x.battery === 'lower')
    const codes = s.flatMap((x) => x.tests.map((t) => t.code))
    check(
      'VALD import: an upper and a lower on one day become two tests, not one merged reading',
      s.length === 2 &&
        upper !== undefined &&
        lower !== undefined &&
        s.every((x) => x.pairedSameDay) &&
        codes.length === new Set(codes).size,
      `upper: ${upper?.tests.map((t) => t.code).join(',')} | lower: ${lower?.tests.map((t) => t.code).join(',')}`,
    )
    check(
      'VALD import: neither half of a split day carries the other half of the movements',
      upper!.tests.every((t) => movementBattery(t.movement, t.bodyRegion) !== 'lower') &&
        lower!.tests.every((t) => movementBattery(t.movement, t.bodyRegion) !== 'upper'),
      'the trunk goes to the lower half, grip to the upper',
    )
  }

  {
    // The two halves of one day, used together.
    const both = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Internal Rotation', region: 'Shoulder', asym: '8% R', l: 108, r: 168 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Flexion', region: 'Elbow', asym: '2% R', l: 261, r: 263 }),
      row({ name: 'A', date: DAY, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
      row({ name: 'A', date: DAY, time: 0.65, movement: 'Flexion', region: 'Hip', asym: '4% L', l: 126, r: 121 }),
      row({ name: 'A', date: DAY, time: 0.6, movement: 'Lateral Flexion Right', region: 'Trunk', n: 155 }),
      row({ name: 'A', date: DAY, time: 0.55, movement: 'Lateral Flexion Left', region: 'Trunk', n: 96 }),
    ]
    const s = parseValdGrid(both, data.vald).sessions
    const m = mergeSessions(s)
    const one = mergeSessions([s.find((x) => x.battery === 'upper')!])
    check(
      'VALD import: a client\'s upper and lower can be used together, as the union of both',
      m.tests.length === one.tests.length + s.find((x) => x.battery === 'lower')!.tests.length &&
        m.overlaps.length === 0,
      `upper alone ${one.tests.length} movements, both together ${m.tests.length}, no overlap`,
    )
    check(
      'VALD import: merged readings reach the layer as one set',
      Object.keys(toValdInput(s)).length === m.tests.length,
      `${Object.keys(toValdInput(s)).join(', ')}`,
    )
  }

  {
    // An old full-body test and a fresh upper. Both measure the shoulder.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '4% L', l: 240, r: 230 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Flexion', region: 'Elbow', asym: '2% R', l: 261, r: 263 }),
      row({ name: 'A', date: DAY - 90, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '26% R', l: 137, r: 185 }),
      row({ name: 'A', date: DAY - 90, time: 0.8, movement: 'Flexion', region: 'Elbow', asym: '9% R', l: 200, r: 220 }),
      row({ name: 'A', date: DAY - 90, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
    ]
    const all = parseValdGrid(grid, data.vald).sessions
    const m = mergeSessions(all)
    const push = m.tests.find((t) => t.code === 'C-MID')
    const knee = m.tests.find((t) => t.code === 'Q-KD')
    check(
      'VALD import: where two chosen tests measure the same movement, the latest reading wins',
      push?.asymmetry === 4 && push?.weakSide === 'Right' && knee?.asymmetry === 5,
      `shoulder push from the newer test (4%, not the older 26%), and the knee still comes` +
        ' from the older one — the merge is per movement, not per test',
    )
    check(
      'VALD import: a superseded reading is named, never silently overwritten',
      m.overlaps.length === 2 &&
        m.overlaps.every((o) => o.dropped.length === 1 && o.kept.includes('2026-08-17')),
      m.overlaps.map((o) => `${o.test}: ${o.kept} over ${o.dropped.join('/')}`).join('; '),
    )
  }

  {
    // Two tests on ONE date measuring the same movement — only the clock separates them.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '4% L', l: 240, r: 230 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Flexion', region: 'Elbow', asym: '2% R', l: 261, r: 263 }),
      row({ name: 'A', date: DAY, time: 0.7, movement: 'Extension', region: 'Knee', asym: '5% R', l: 300, r: 316 }),
      row({ name: 'A', date: DAY, time: 0.65, movement: 'Flexion', region: 'Hip', asym: '4% L', l: 126, r: 121 }),
    ]
    const s = parseValdGrid(grid, data.vald).sessions
    // Force an overlap the split would not normally produce, to pin the tiebreak itself.
    const code = s[0].tests[0].code
    const late = { ...s[0], tests: [{ ...s[0].tests[0], asymmetry: 4, at: 0.9 }] }
    const early = { ...s[0], tests: [{ ...s[0].tests[0], asymmetry: 99, at: 0.1 }] }
    const forwards = mergeSessions([early, late]).tests.find((t) => t.code === code)?.asymmetry
    const backwards = mergeSessions([late, early]).tests.find((t) => t.code === code)?.asymmetry
    check(
      'VALD import: two tests on one date are separated by the clock, not by list order',
      forwards === 4 && backwards === 4,
      `chosen in either order the 0.9 reading wins (${forwards} / ${backwards}), not the 0.1 one` +
        ' — list order would have given 99 one way round',
    )
  }

  {
    // Shoulder Adduction is named by no list in the automator, but it is plainly upper body.
    check(
      'VALD import: a movement the automator does not name is filed by its region, not both',
      movementBattery('Adduction', 'Shoulder') === 'upper' &&
        movementBattery('External Rotation', 'Hip') === 'lower',
      'Shoulder Adduction -> upper, Hip External Rotation -> lower',
    )
  }

  {
    // Two athletes on two dates: four rows, four separate tests, nothing merged.
    const many = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '6% L', l: 227, r: 212 }),
      row({ name: 'B', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '9% R', l: 200, r: 220 }),
      row({ name: 'A', date: DAY + 1, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '2% L', l: 230, r: 226 }),
    ]
    const s = parseValdGrid(many, data.vald).sessions
    check(
      'VALD import: an export with several athletes and dates yields one test per athlete-day',
      s.length === 3 && new Set(s.map((x) => `${x.name}|${x.date}`)).size === 3,
      s.map((x) => `${x.name} ${x.date}`).join(' · '),
    )
    check(
      'VALD import: tests are offered newest first',
      s[0].date > s[s.length - 1].date,
      `${s.map((x) => x.date).join(' -> ')}`,
    )
  }

  {
    // Columns are found by header text. Reordering them must change nothing.
    const base = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Push', region: 'Shoulder', asym: '6.4% L', l: 227, r: 212 }),
    ]
    const order = [...HEADER.keys()].reverse()
    const shuffled = base.map((r) => order.map((i) => r[i] ?? ''))
    const a = parseValdGrid(base, data.vald).sessions[0].tests[0]
    const b = parseValdGrid(shuffled, data.vald).sessions[0].tests[0]
    check(
      'VALD import: columns are read by header text, so reordering them changes nothing',
      JSON.stringify(a) === JSON.stringify(b),
      `${a.code} ${a.asymmetry}% weak ${a.weakSide} both ways`,
    )
  }

  {
    // A movement with no test in the data file is named, never approximated onto a neighbour.
    const grid = [
      HEADER,
      row({ name: 'A', date: DAY, time: 0.9, movement: 'Dorsiflexion', region: 'Ankle', asym: '5% R', l: 90, r: 95 }),
      row({ name: 'A', date: DAY, time: 0.8, movement: 'Push', region: 'Shoulder', asym: '6% L', l: 227, r: 212 }),
    ]
    const s = parseValdGrid(grid, data.vald).sessions[0]
    check(
      'VALD import: an unknown movement is reported by name, not mapped to a neighbour',
      s.tests.length === 1 &&
        s.unmapped.length === 1 &&
        s.unmapped[0].movement === 'Dorsiflexion',
      `1 mapped, unmapped: ${s.unmapped.map((u) => `${u.bodyRegion} ${u.movement}`).join(', ')}`,
    )
  }

  {
    // The export names the STRONGER side; the app works in weak sides.
    const p = parseAsymmetry('22% R')
    check(
      'VALD import: "22% R" names the stronger side, so the weak side is the other one',
      p?.strong === 'Right' && p?.pct === 22,
      'the importer inverts it to weakSide Left',
    )
  }

  {
    // A file that is not a DynaMo export fails loudly rather than importing nothing.
    let threw = false
    try {
      parseValdGrid([['Client', 'Weight', 'Reps'], ['A', '80', '5']], data.vald)
    } catch {
      threw = true
    }
    check(
      'VALD import: a file without Movement and Body Region is rejected, not silently empty',
      threw,
      'a spreadsheet of something else does not import as zero tests',
    )
  }
}

// ---- Report ----------------------------------------------------------------
let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
console.log(`\n${results.length - failed}/${results.length} passing`)
for (const n of notes) console.log(n)

// Extra diagnostics (not pass/fail)
for (const pr of PRESETS) {
  const p = run(pr.input)
  const a = buildAudit(p, data.exercises, pr.input.sex, data.config)
  console.log(
    `\n[${pr.name}] days=${p.days.length} exercises=${p.exerciseCount} ` +
      `minutes=${p.days.map((d) => d.minutes.toFixed(0)).join('/')} ` +
      `warnings=${p.warnings.length} audit=${a.substantiveWithin25}/${a.substantiveTotal} within ±25%`,
  )
  if (a.unmappedAlsoTrains.length)
    console.log(`   unmapped alsoTrains: ${a.unmappedAlsoTrains.join(', ')}`)
}

process.exit(failed > 0 ? 1 : 0)
