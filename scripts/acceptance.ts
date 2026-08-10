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
import type { ClientInput, DataBundle } from '../src/types'

const dir = join(process.cwd(), 'public', 'data')
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const data: DataBundle = {
  config: read('config.json'),
  allocation: read('allocation.json'),
  exercises: read('exercises.json'),
  prescription: read('prescription.json'),
  splits: read('splits.json'),
}

const results: { name: string; pass: boolean; detail: string }[] = []
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
  // "roughly 54–75" — allow 1 min either side, and always print the exact figures.
  check(
    'Reference: sessions roughly 54–75 min',
    mins.every((m) => m >= 53 && m <= 76),
    `${mins.map((m) => m.toFixed(1)).join(', ')} min${
      mins.some((m) => m < 54 || m > 75) ? '  (marginal: outside a strict 54–75 read)' : ''
    }`,
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

// ---- Report ----------------------------------------------------------------
let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
console.log(`\n${results.length - failed}/${results.length} passing`)

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
