/**
 * Headless run of the acceptance criteria from claude-code-prompt.md.
 * Uses the exact same generate()/buildAudit() code the UI uses.
 *
 *   npm run acceptance
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generate } from '../src/lib/generate'
import { buildAudit } from '../src/lib/audit'
import { PRESETS } from '../src/lib/presets'
import { isEquipmentAvailable, libraryCoverage } from '../src/lib/equipment'
import { splitAdvice } from '../src/lib/splitAdvice'
import { roundSets } from '../src/lib/rounding'
import { buildInjuryIndex, verdictForPain, type PainSelection } from '../src/lib/injury'
import { buildSubAliases, pairReason, type Structure } from '../src/lib/structure'
import { WORKED_EXAMPLE, goalWeights, type InBodyInput } from '../src/lib/inbody'
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
  // The Stage 1 window of "roughly 54–75 min" was computed from `repsMid * 3 + restMid`,
  // which the structure layer replaced by instruction. Under the new work/rest model the
  // same program reads longer. Checked against the goal's own ceiling instead, with the
  // superseded window reported so the change stays visible rather than silently widened.
  check(
    `Reference: sessions inside the ${p.timeCeiling} min ceiling (new time model)`,
    mins.every((m) => m <= p.timeCeiling),
    `${mins.map((m) => m.toFixed(1)).join(', ')} min — Stage 1's 54–75 window came from the retired formula and no longer applies`,
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

    // Rounding lengthens sessions; nothing may cross the goal's time ceiling because of it.
    const over = r.dayTotals
      .map((t, i) => ({ day: i + 1, min: t * p.minutesPerSet + p.warmupMinutes }))
      .filter((d) => d.min > p.timeCeiling)
    check(
      `Rounding (${pr.name}): no session crosses the ${p.timeCeiling} min ceiling`,
      over.length === 0,
      over.length
        ? over.map((d) => `day ${d.day} ${d.min.toFixed(0)} min`).join(', ')
        : `longest ${Math.max(...r.dayTotals.map((t) => t * p.minutesPerSet + p.warmupMinutes)).toFixed(0)} min`,
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
    check('Structure: no block pairs a synergist', bad.length === 0, bad.join(', '))

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

  // correctives only with correctives
  {
    const corrective = new Set(data.injury.exercises.filter((r) => r.corrective).map((r) => r.id))
    const bad: string[] = []
    for (const p of [...all, run({ ...REF, structure: 'superset', pains: { SHOULDER: 'Both' } })])
      for (const d of p.days)
        for (const b of d.blocks) {
          if (b.indices.length < 2) continue
          const flags = b.indices.map((i) => corrective.has(d.exercises[i].exercise.id))
          if (flags.some(Boolean) && !flags.every(Boolean))
            bad.push(b.indices.map((i) => d.exercises[i].exercise.name).join(' + '))
        }
    check('Structure: a corrective is never blocked with a non-corrective', bad.length === 0, bad.join('; '))
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
    check('Structure: two compounds sharing a joint never pair', bad.length === 0, bad.join(', '))
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
      rule4Slots.every((s) => !s.exercise.mainLift),
      `${rule4Slots.filter((s) => s.exercise.mainLift).length} main lifts caught`,
    )
    check(
      'InBody: unowned groups are never touched by rule 4',
      rule4Slots.every((s) => !data.inbody.unownedGroups.includes(s.exercise.group)),
      data.inbody.unownedGroups.join(', '),
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
    })
    const f = p.inbody.filler
    check(
      'InBody: a 6-12 Beginner gets 2 bouts x 30s of the non-impact movement',
      f?.bouts === 2 && f?.seconds === 30 && f?.movement === data.inbody.filler.age.movement,
      `${f?.bouts} x ${f?.seconds}s — ${f?.movement}`,
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
      `minutes=${p.days.map((d) => d.minutes.toFixed(0)).join('/')} (ceiling ${p.timeCeiling}) ` +
      `warnings=${p.warnings.length} audit=${a.substantiveWithin25}/${a.substantiveTotal} within ±25%`,
  )
  if (a.unmappedAlsoTrains.length)
    console.log(`   unmapped alsoTrains: ${a.unmappedAlsoTrains.join(', ')}`)
}

process.exit(failed > 0 ? 1 : 0)
