import type { ClientInput, DataBundle, Exercise, Modality } from '../types'
import type { ExerciseVerdict } from './injury'
import { classify, realBands } from './bodydot'
import { buildFindings } from './vald'
import { memberOf, NEW_ROW_ID, type PilatesRules, type WarmupMove } from './modality'
import type { EquipmentTier } from './equipment'

/**
 * A Pilates session: not sets and rest, but the classical order, a few precise reps of each move,
 * almost no rest, timed to the hour. What the level allows, in its place in the order; the
 * client's posture findings move the Pilates that answers them to the front of the queue; every
 * session keeps a flexion, an extension, a rotation and a hip move; and the sessions of a week
 * rotate the variations they keep, so the week covers the repertoire rather than one class four
 * times.
 */

export interface PilatesItem {
  exercise: Exercise
  section: string
  /** "6", "100 beats", "8 each side" */
  reps: string
  seconds: number
  perSide: boolean
  /** reformer: light, medium or heavy, mapped to the studio's springs once */
  springs?: string
  /** a U-Body finding this answers */
  forPosture?: string
  /** the weaker side goes first and does two more */
  weakSideFirst?: 'Left' | 'Right'
  /** a ticked pain cautions it: one spring lighter, and the first thing the hour trims */
  caution?: string
}

export interface PilatesSession {
  /** 0-based among the week's Pilates sessions */
  index: number
  label: string
  apparatus: ('mat' | 'reformer')[]
  warmup: WarmupMove[]
  sections: { name: string; items: PilatesItem[] }[]
  /** warm-up included */
  minutes: number
  notes: string[]
}

const AREA_SECTION_MAT = 'Mat'

export interface PilatesInput {
  input: ClientInput
  ageBr: string
  styles: Modality[]
  index: number
  total: number
  verdicts: Map<number, ExerciseVerdict>
  equipment: EquipmentTier
}

export function buildPilatesSession(data: DataBundle, p: PilatesInput): PilatesSession | null {
  const rules = data.modalities?.pilates
  if (!rules) return null
  const { input, ageBr } = p
  const apparatus: ('mat' | 'reformer')[] = []
  if (p.styles.includes('Reformer Pilates')) apparatus.push('reformer')
  if (p.styles.includes('Mat Pilates')) apparatus.push('mat')
  const maxSkill = rules.level.maxSkill[input.level] ?? 2

  const findings = postureFindings(data, input)
  const weak = weakerSide(data, input)
  const postureOf = new Map<string, string>()
  for (const ind of findings) for (const n of rules.posture.byIndicator[ind] ?? []) if (!postureOf.has(n)) postureOf.set(n, ind)

  const verdictOf = (e: Exercise) => p.verdicts.get(e.id)?.verdict ?? 'OK'
  // "This side only" keeps a move only when it is done one side at a time.
  const eligible = (e: Exercise, style: Modality) =>
    memberOf(data, e, style) &&
    e.skill <= maxSkill &&
    !e.avoidAges.includes(ageBr) &&
    verdictOf(e) !== 'REMOVE' &&
    (verdictOf(e) !== 'SIDE_ONLY' || rules.perSide.names.includes(e.name))
  const isWarmupDrill = (e: Exercise) => e.type === 'mobility' && (e.tags ?? []).includes('Drill')

  // Pilates warms up with its own pre-Pilates moves, which then stay out of the session.
  const wu = rules.warmup
  const warmup: WarmupMove[] = (wu?.moves ?? [])
    .map((n) => data.exercises.find((e) => e.name === n))
    .filter((e): e is Exercise => !!e && !e.avoidAges.includes(ageBr) && verdictOf(e) !== 'REMOVE' && verdictOf(e) !== 'SIDE_ONLY')
    .slice(0, wu?.count ?? 5)
    .map((e) => ({ name: e.name, exerciseId: e.id, area: 'trunk', seconds: wu?.seconds ?? 45 }))
  const inWarmup = new Set(warmup.map((w) => w.exerciseId))

  // ---- the ordered candidates -------------------------------------------------------------
  const cands: PilatesItem[] = []
  const seen = new Set<number>()
  const make = (e: Exercise, section: string) => {
    const it = item(rules, e, section, input, postureOf.get(e.name), weak)
    const v = p.verdicts.get(e.id)
    if (v?.verdict !== 'CAUTION') return it
    // A cautioned move: one spring lighter, marked with the pain it is careful of.
    const lighter: Record<string, string> = { heavy: 'medium', medium: 'light' }
    const springs = it.springs ? it.springs.replace(/^(heavy|medium)/, (x) => lighter[x]) : undefined
    return { ...it, ...(springs && { springs }), caution: v.byPain.filter((x) => x.verdict === 'CAUTION').map((x) => x.painLabel).join(', ') }
  }
  const add = (e: Exercise, section: string) => {
    if (seen.has(e.id) || isWarmupDrill(e) || inWarmup.has(e.id)) return
    seen.add(e.id)
    cands.push(make(e, section))
  }
  if (apparatus.includes('reformer')) {
    const order = rules.section.reformerOrder
    const sectionOf = (e: Exercise) =>
      e.id < NEW_ROW_ID
        ? 'Prep'
        : ((e.tags ?? []).map((t) => rules.section.reformerTagToSection[t]).find(Boolean) ?? rules.section.reformerUntagged[e.name] ?? 'Finish')
    const ref = data.exercises
      .filter((e) => eligible(e, 'Reformer Pilates') && e.id >= NEW_ROW_ID)
      .sort((a, b) => order.indexOf(sectionOf(a)) - order.indexOf(sectionOf(b)) || a.id - b.id)
    for (const e of ref) add(e, sectionOf(e))
  }
  if (apparatus.includes('mat')) {
    // The mat follows the sheet's order, which is the classical order; the library's pre-Pilates
    // moves (dead bug, bird dog, clam…) are prep, at the start.
    const mat = data.exercises.filter((e) => eligible(e, 'Mat Pilates'))
    const prep = mat.filter((e) => e.id < NEW_ROW_ID)
    const classical = mat.filter((e) => e.id >= NEW_ROW_ID).sort((a, b) => a.id - b.id)
    const matSection = apparatus.includes('reformer') ? AREA_SECTION_MAT : 'Mat'
    // Beginners open with two prep moves; the rest of the prep only fills a session that runs short.
    const prepFirst = input.level === 'Beginner' ? rules.prep.beginnerPrepMoves : 0
    for (const e of prep.slice(0, prepFirst)) add(e, 'Prep')
    for (const e of classical) add(e, matSection)
    for (const e of prep.slice(prepFirst)) if (!inWarmup.has(e.id)) cands.push({ ...make(e, 'Prep'), section: 'Prep (fill)' })
  }
  // The goal's extra (the jumpboard for Lose Fat) is already in the reformer pool; it is kept below.
  const goalTags = rules.goal[input.goal]?.addTags ?? []

  // ---- fitting the hour ---------------------------------------------------------------------
  const budget = (rules.sessionMinutes - rules.warmupMinutes) * 60
  const categoryOf = (e: Exercise) =>
    Object.entries(rules.balance.categories).find(([, c]) => c.subs?.includes(e.sub) || c.groups?.includes(e.group))?.[0]
  const total = (list: PilatesItem[]) => list.reduce((s, c) => s + c.seconds, 0)
  const tier = (e: Exercise) => (e.tier === 'primary' ? 0 : e.tier === 'secondary' ? 1 : 2)
  const isProtected = (c: PilatesItem) => !!c.forPosture || (c.exercise.tags ?? []).some((t) => goalTags.includes(t))
  /**
   * Trims one apparatus's moves to its share of the hour: accessory before secondary before
   * primary, never a posture answer or the goal's move, never the last move of a direction of the
   * spine; the week's sessions rotate which go first, so each keeps a different part of the
   * repertoire.
   */
  const trimTo = (list: PilatesItem[], share: number) => {
    let keep = [...list]
    // A cautioned move goes first; then accessory before secondary before primary (Get Stronger: the
    // easier variations before the harder); the week's sessions rotate the order within a tier.
    const strong = input.goal === 'Get Stronger'
    const dropOrder = keep
      .map((c, i) => ({
        c,
        key: (c.caution ? 100000 : 0) + (strong ? (5 - c.exercise.skill) * 1000 : tier(c.exercise) * 1000) - ((i + p.index * 7) % Math.max(1, keep.length)),
      }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.c)
    for (const c of dropOrder) {
      if (total(keep) <= share) break
      if (isProtected(c)) continue
      const cat = categoryOf(c.exercise)
      if (cat && keep.filter((k) => categoryOf(k.exercise) === cat).length <= 1) continue
      keep = keep.filter((k) => k !== c)
    }
    return keep
  }
  const fill = cands.filter((c) => c.section === 'Prep (fill)')
  const main = cands.filter((c) => c.section !== 'Prep (fill)')
  let keep: PilatesItem[]
  if (apparatus.length === 2) {
    // Reformer and mat together: each keeps its share of the hour, the one listed first the larger.
    const reformerFirst = p.styles.indexOf('Reformer Pilates') < p.styles.indexOf('Mat Pilates')
    const onReformer = (c: PilatesItem) => c.exercise.equipment.startsWith('reformer') || c.section === 'Prep'
    const refShare = budget * (reformerFirst ? 0.6 : 0.4)
    const ref = trimTo(main.filter(onReformer), refShare)
    const onRef = new Set(ref.map((c) => c.exercise.name))
    // A move both have is done once, on the reformer.
    const mat = main.filter((c) => !onReformer(c) && !onRef.has(rules.sameMove.matToReformer[c.exercise.name] ?? ''))
    keep = [...ref, ...trimTo(mat, budget - total(ref))]
  } else keep = trimTo(main, budget)

  // A session that runs short (a beginner's: the level opens few moves) takes up to four of the
  // library's prep moves at the start, then runs at a teaching pace: more reps of each, up to the cap.
  for (const c of fill.slice(0, 4)) {
    if (total(keep) + c.seconds > budget) break
    keep = [{ ...c, section: 'Prep' }, ...keep]
  }
  // Classical counts are caps: a roll up is 3-5, the push-up 3; a class the level cannot fill stays shorter.
  const repCapOf = (c: PilatesItem) =>
    rules.reps.maxByName?.[c.exercise.name] ?? (rules.reps.default[input.level] ?? 5) + (rules.reps.maxDefaultExtra ?? 2)
  for (let guard = 0; total(keep) < budget - 60 && guard < 6; guard++) {
    let grew = false
    let running = total(keep)
    keep = keep.map((c) => {
      const step = (c.perSide ? 2 : 1) * rules.secondsPerRep
      if (rules.reps.special[c.exercise.name] || running + step > budget) return c
      const n = Number.parseInt(c.reps, 10)
      if (!Number.isFinite(n) || n >= repCapOf(c)) return c
      grew = true
      running += step
      return { ...c, reps: c.reps.replace(String(n), String(n + 1)), seconds: c.seconds + step }
    })
    if (!grew) break
  }

  // Rest position follows the session's last extension move: the classical counter-stretch.
  const cs = rules.counterStretch
  const rest = cs ? data.exercises.find((e) => e.name === cs.name) : undefined
  if (rest && !inWarmup.has(rest.id) && verdictOf(rest) !== 'REMOVE' && !keep.some((c) => c.exercise.id === rest.id)) {
    const lastExt = keep.map((c) => categoryOf(c.exercise)).lastIndexOf('extension')
    if (lastExt >= 0)
      keep = [...keep.slice(0, lastExt + 1), { ...make(rest, keep[lastExt].section), reps: cs!.label, seconds: 30, perSide: false }, ...keep.slice(lastExt + 1)]
  }

  // Sections, in session order: Prep first, then as the candidates were ordered.
  const sectionOrder = ['Prep', ...new Set(cands.map((c) => c.section).filter((s) => s !== 'Prep' && s !== 'Prep (fill)'))]
  const sections = sectionOrder
    .map((name) => ({ name, items: keep.filter((c) => c.section === name) }))
    .filter((s) => s.items.length > 0)

  const notes: string[] = []
  if (findings.length) notes.push(`For the U-Body findings (${findings.join(', ')}), the moves that answer them are kept in every session.`)
  if (weak) notes.push(`One side at a time: the ${weak.toLowerCase()} side first, with two more reps (U-Muscle).`)
  if (apparatus.includes('reformer')) notes.push('Springs as light, medium or heavy: the studio maps them to its reformer once.')
  if (goalTags.length && keep.some((c) => (c.exercise.tags ?? []).some((t) => goalTags.includes(t))))
    notes.push(rules.goal[input.goal].why)

  const minutes = Math.round(rules.warmupMinutes + total(keep) / 60)
  if (minutes < rules.sessionMinutes - 5)
    notes.push(`Shorter than the hour (${minutes} min): the level opens ${keep.length} moves, run at a teaching pace; the rest of the hour is for teaching them.`)
  if (total(main) <= budget && p.total > 1)
    notes.push('Every session runs the full order the level opens: the same basic order each time, until the moves are owned.')
  const label = apparatus.length === 2 ? 'Reformer and mat Pilates' : apparatus[0] === 'reformer' ? 'Reformer Pilates' : 'Mat Pilates'
  return {
    index: p.index,
    label,
    apparatus,
    warmup,
    sections,
    minutes,
    notes,
  }
}

function item(rules: PilatesRules, e: Exercise, section: string, input: ClientInput, forPosture: string | undefined, weak: 'Left' | 'Right' | null): PilatesItem {
  const perSide = rules.perSide.names.includes(e.name) || (e.id < NEW_ROW_ID && /side-lying|single-leg|clam|fire hydrant/i.test(e.name))
  // A hold is timed, never counted.
  // A held position from the gym library (a plank, a hollow hold) is timed; the sheet's isometric moves
  // are done with reps on the reformer and the mat (long stretch, leg pull front), as classically.
  const timed = e.type === 'isometric' && e.id < NEW_ROW_ID && !!rules.holdSeconds
  const special = rules.reps.special[e.name] ?? (timed ? rules.holdSeconds!.default : undefined)
  const springs = e.equipment.startsWith('reformer')
    ? rules.springs.byName[e.name] ?? (e.tags ?? []).map((t) => rules.springs.byTag[t]).find(Boolean) ?? rules.springs.default
    : undefined
  let reps = rules.reps.default[input.level] ?? 5
  const byTag = (e.tags ?? []).map((t) => rules.reps.byTag[t]).find((v) => v !== undefined)
  if (byTag !== undefined && byTag > 0) reps = byTag
  reps += rules.reps.bySkill[String(e.skill)] ?? 0
  const sprung = (e.tags ?? []).some((t) => ['Footwork', 'Leg springs', 'Arm springs', 'Rowing'].includes(t))
  if (sprung && (input.goal === 'Build Muscle' || input.goal === 'Shape Up')) reps += rules.reps.buildMuscleExtra
  reps = Math.max(3, reps)
  const oneSide = perSide && weak !== null
  const label = special ?? (perSide ? (oneSide ? `${reps} each side, ${weak!.toLowerCase()} +2` : `${reps} each side`) : String(reps))
  const setup = rules.setupSeconds[e.equipment.startsWith('reformer') ? 'reformer' : 'mat'] ?? 15
  const seconds =
    rules.reps.specialSeconds[e.name] ??
    (timed ? setup + rules.holdSeconds!.seconds * (perSide ? 2 : 1) : undefined) ??
    setup + (perSide ? 2 * reps + (oneSide ? 2 : 0) : reps) * rules.secondsPerRep
  return {
    exercise: e,
    section,
    reps: label,
    seconds,
    perSide,
    ...(springs && { springs }),
    ...(forPosture && { forPosture }),
    ...(oneSide && { weakSideFirst: weak! }),
  }
}

/** The U-Body indicators outside their normal band (borderline or abnormal), by name. */
export function postureFindings(data: DataBundle, input: ClientInput): string[] {
  const out: string[] = []
  for (const band of realBands(data.bodydot)) {
    const r = input.bodydot?.[band.code]
    if (!r) continue
    const c = classify(band, r.value, r.side)
    if (c.tier === 'abnormal' || c.tier === 'borderline') out.push(band.indicator)
  }
  return out
}

/** The side most of the client's flagged VALD findings call weaker, if any are flagged. */
export function weakerSide(data: DataBundle, input: ClientInput): 'Left' | 'Right' | null {
  const flagged = buildFindings(input.vald ?? {}, data.vald).filter((f) => f.setsAdded > 0)
  if (!flagged.length) return null
  const left = flagged.filter((f) => f.weakSide === 'Left').length
  return left * 2 >= flagged.length ? (left * 2 === flagged.length ? flagged[0].weakSide : 'Left') : 'Right'
}
