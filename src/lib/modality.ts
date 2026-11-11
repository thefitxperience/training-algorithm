import type { ClientInput, DataBundle, Exercise, InjuryData, Modality } from '../types'
import type { ExerciseVerdict } from './injury'
import { equipmentOptions, isEquipmentAvailable, type EquipmentTier } from './equipment'

/**
 * Training styles beyond the gym (data/modalities.json): which exercises each style may use,
 * which styles combine and how, a client's rung on each calisthenics ladder, and the five-move
 * warm-up. Gym-only programs never reach any of this: the pool filter is a no-op for them.
 */

export interface ModalitiesData {
  note: string
  modalities: Record<Modality, { template: 'strength' | 'crossfit' | 'pilates'; label: string; apparatus?: string[]; ladders?: boolean; why: string }>
  gymTakesNewRows: boolean
  needs: Partial<Record<Modality, { equipment: string; why: string }>>
  levelRule: { maxSkill: Record<string, number> }
  strengthExcludeTags: string[]
  bodyweightStrengthReps: string
  bodyweightTokens: string[]
  combine: {
    maxStyles: number
    pairs: { styles: [Modality, Modality]; how: 'session' | 'days'; why: string }[]
  }
  overrides?: {
    tick: Partial<Record<Modality, string[]>>
    untick: Partial<Record<Modality, string[]>>
    ladders: { name: string; family: string; rung: number }[]
  }
  repCaps?: { byName: Record<string, string>; byTag?: Record<string, string>; bodyweightMaxReps: number }
  ladders: {
    startByLevel: Record<string, { maxSkill: number; why: string }>
    startOverride?: Record<string, Record<string, number> | string>
    cleanWhen: { reps: string; hold: string }
    skillFamilies: string[]
    holdSeconds: Record<string, string>
    skillRestSeconds: number
    warmupRungsBelow: number
    workingRungs?: number
    focus?: {
      max: number
      perSession: Record<string, number>
      setsPerSession: Record<string, number>
      minSetsEach: number
      maxByLevel?: Record<string, number>
      timesPerWeek: Record<string, number>
      straightArm: string[]
      setsEachMax?: Record<string, number>
      goalByAge?: Record<string, Record<string, string | null> | string>
      pullSubs?: string[]
      support: Record<string, { families: string[]; names: string[] }>
    }
    holdByName?: Record<string, string>
    countedNotHeld?: string[]
  }
  crossfit: {
    strengthExcludeTags: string[]
    metcon: MetconRules
  }
  pilates: PilatesRules
  warmup: {
    styles: Modality[]
    moves: number
    workSeconds: number
    transitionSeconds: number
    bannedTokens: string[]
    areas: Record<string, { groups: string[] }>
    pool: Record<string, string[]>
  }
}

export interface MetconRules {
  minutesGetStronger?: Record<string, number>
  perMove?: { factor: Record<string, number>; unit: Record<string, string>; secondsPerRep: Record<string, number>; emomMaxSeconds: number }
  over60?: { excludeTags: string[]; excludeNames: string[] }
  excludeTags?: string[]
  minutes: Record<string, number>
  minutesLoseFat: Record<string, number>
  minutesOver50: number
  formats: string[]
  formatsBeginner: string[]
  forTimeRounds: Record<string, number>
  roles: Record<'lower' | 'upper' | 'engine', { subs?: string[]; tags?: string[]; names?: string[]; label: string }>
  reps: Record<string, { reps: number; cal: number; metres: number; du: number; sled?: number; hsw?: number }>
  emomRepsFactor: number
  gripHeavy: { subs: string[]; alsoTrains: string[]; names: string[] }
  unitByName: Record<string, 'cal' | 'metres' | 'du'>
}

export interface PilatesRules {
  sessionMinutes: number
  warmupMinutes: number
  level: { maxSkill: Record<string, number> }
  secondsPerRep: number
  setupSeconds: Record<string, number>
  warmup?: { moves: string[]; count: number; seconds: number }
  counterStretch?: { name: string; label: string }
  holdSeconds?: { default: string; seconds: number }
  reps: {
    maxByName?: Record<string, number>
    maxDefaultExtra?: number
    default: Record<string, number>
    byTag: Record<string, number>
    bySkill: Record<string, number>
    special: Record<string, string>
    specialSeconds: Record<string, number>
    buildMuscleExtra: number
  }
  perSide: { names: string[] }
  springs: { default: string; byTag: Record<string, string>; byName: Record<string, string> }
  section: { reformerOrder: string[]; reformerTagToSection: Record<string, string>; reformerUntagged: Record<string, string> }
  balance: { categories: Record<string, { subs?: string[]; groups?: string[] }> }
  sameMove: { matToReformer: Record<string, string> }
  prep: { beginnerPrepMoves: number }
  goal: Record<string, { addTags?: string[]; why: string }>
  posture: { byIndicator: Record<string, string[]> }
}

/** Rows the modality sheet added (ids 1000 + the sheet's "#"); the library before it is below. */
export const NEW_ROW_ID = 1000
export const STRENGTH_STYLES: Modality[] = ['Gym', 'Calisthenics', 'CrossFit']
export const PILATES_STYLES: Modality[] = ['Mat Pilates', 'Reformer Pilates']
export const ALL_STYLES: Modality[] = [...STRENGTH_STYLES, ...PILATES_STYLES]

export const stylesOf = (input: Pick<ClientInput, 'modalities'>): Modality[] =>
  input.modalities && input.modalities.length > 0 ? input.modalities : ['Gym']

/** The gym exactly as it was: no pool filter, no ladders, no metcon. */
export const isGymOnly = (styles: Modality[]) => styles.length === 1 && styles[0] === 'Gym'

/** Does this exercise belong to this style? A new row reaches Gym only when that is switched on. */
export function memberOf(data: Pick<DataBundle, 'modalities'>, ex: Exercise, style: Modality): boolean {
  if (!(ex.modalities ?? ['Gym']).includes(style)) return false
  if (style === 'Gym' && ex.id >= NEW_ROW_ID && !data.modalities?.gymTakesNewRows) return false
  return true
}

/** The sheet's level rule for its own rows (skill 1-2 Beginner, 3 Intermediate, 4-5 Advanced). */
export const withinSheetLevel = (data: Pick<DataBundle, 'modalities'>, ex: Exercise, level: string) =>
  ex.id < NEW_ROW_ID || ex.skill <= (data.modalities?.levelRule.maxSkill[level] ?? 2)

/** No external load at all: bodyweight, a bar, rings, a wall, a box. */
export const isUnloaded = (data: Pick<DataBundle, 'modalities'>, ex: Exercise) =>
  equipmentOptions(ex).every((t) => (data.modalities?.bodyweightTokens ?? ['BW']).includes(t))

/**
 * The strength part's pool: an exercise of any of the client's strength styles. CrossFit's metcon
 * moves (burpees, wall balls, the rower…) are the metcon's, not strength slots.
 */
export function inStrengthPool(data: Pick<DataBundle, 'modalities'>, ex: Exercise, styles: Modality[]): boolean {
  // Metcon and engine moves are never a strength slot, in any style (the gym library has none).
  const excluded = data.modalities?.strengthExcludeTags ?? data.modalities?.crossfit.strengthExcludeTags ?? []
  if ((ex.tags ?? []).some((t) => excluded.includes(t))) return false
  return styles.some((s) => STRENGTH_STYLES.includes(s) && memberOf(data, ex, s))
}

// ─── Combining ───────────────────────────────────────────────────────────────────────────

export type StylePlan =
  | {
      ok: true
      styles: Modality[]
      strength: Modality[]
      pilates: Modality[]
      /** one style; styles merged into one session; or Pilates on days of its own */
      how: 'single' | 'session' | 'days'
      reasons: string[]
    }
  | { ok: false; error: string }

export function planStyles(data: Pick<DataBundle, 'modalities'>, input: Pick<ClientInput, 'modalities'> & { equipment?: string | null }): StylePlan {
  const styles = [...new Set(stylesOf(input))]
  const m = data.modalities
  if (!m) return isGymOnly(styles) ? { ok: true, styles, strength: styles, pilates: [], how: 'single', reasons: [] } : { ok: false, error: 'The training styles could not be loaded.' }
  const unknown = styles.filter((s) => !m.modalities[s])
  if (unknown.length) return { ok: false, error: `Unknown training style: ${unknown.join(', ')}.` }
  if (styles.length > m.combine.maxStyles) return { ok: false, error: `At most ${m.combine.maxStyles} training styles together.` }
  // A style that needs the gym's equipment says so instead of building empty sessions.
  for (const st of styles) {
    const need = m.needs?.[st]
    if (need && input.equipment && input.equipment !== need.equipment) return { ok: false, error: need.why }
  }
  const reasons: string[] = []
  for (let i = 0; i < styles.length; i++)
    for (let j = i + 1; j < styles.length; j++) {
      const pair = m.combine.pairs.find((p) => p.styles.includes(styles[i]) && p.styles.includes(styles[j]))
      if (!pair) return { ok: false, error: `${styles[i]} and ${styles[j]} cannot be combined.` }
      reasons.push(`${styles[i]} + ${styles[j]}: ${pair.why}`)
    }
  const strength = styles.filter((s) => STRENGTH_STYLES.includes(s))
  const pilates = styles.filter((s) => PILATES_STYLES.includes(s))
  return { ok: true, styles, strength, pilates, how: styles.length === 1 ? 'single' : strength.length && pilates.length ? 'days' : 'session', reasons }
}

/**
 * How a week splits between a strength style and Pilates: listed first, Pilates takes half the
 * days (rounded up); otherwise a third (rounded down), and always at least one of each.
 */
export function splitDays(plan: Extract<StylePlan, { ok: true }>, days: number): { strength: number; pilates: number } {
  if (!plan.pilates.length) return { strength: days, pilates: 0 }
  if (!plan.strength.length) return { strength: 0, pilates: days }
  const pilatesFirst = PILATES_STYLES.includes(plan.styles[0])
  let pilates = pilatesFirst ? Math.ceil(days / 2) : Math.max(1, Math.floor(days / 3))
  pilates = Math.min(Math.max(pilates, 1), days - 1)
  return { strength: days - pilates, pilates }
}

/** The week's order: Pilates days spread evenly between the strength days. */
export function weekOrder(strength: number, pilates: number): ('strength' | 'pilates')[] {
  const total = strength + pilates
  const at = new Set(Array.from({ length: pilates }, (_, k) => Math.floor(((k + 0.5) * total) / pilates)))
  return Array.from({ length: total }, (_, i) => (at.has(i) ? 'pilates' : 'strength'))
}

// ─── Ladders ─────────────────────────────────────────────────────────────────────────────

export interface LadderStep {
  rung: number
  exercises: Exercise[]
}

/** Every progression ladder in the library, easiest rung first. */
export function laddersOf(exercises: Exercise[]): Map<string, LadderStep[]> {
  const out = new Map<string, LadderStep[]>()
  for (const ex of exercises)
    for (const l of ex.ladders ?? []) {
      if (!out.has(l.family)) out.set(l.family, [])
      const steps = out.get(l.family)!
      const step = steps.find((s) => s.rung === l.rung)
      if (step) step.exercises.push(ex)
      else steps.push({ rung: l.rung, exercises: [ex] })
    }
  for (const steps of out.values()) steps.sort((a, b) => a.rung - b.rung)
  return out
}

/**
 * Where a client starts on a ladder they have no rung for: one band below their level's ceiling
 * (data/modalities.json ladders.startByLevel), never the top. An age the rung's exercises avoid
 * moves the start down until one fits.
 */
export function startRung(data: Pick<DataBundle, 'modalities'>, steps: LadderStep[], level: string, ageBr: string, family?: string): number {
  const override = family ? data.modalities?.ladders.startOverride?.[family] : undefined
  if (override && typeof override === 'object' && override[level] !== undefined) {
    const want = override[level]
    const at = steps.find((st) => st.rung === want && st.exercises.some((e) => !e.avoidAges.includes(ageBr)))
    if (at) return at.rung
  }
  const maxSkill = data.modalities?.ladders.startByLevel[level]?.maxSkill ?? 1
  const fits = (s: LadderStep) => s.exercises.some((e) => e.skill <= maxSkill && !e.avoidAges.includes(ageBr))
  const ok = steps.filter(fits)
  if (ok.length) return ok[ok.length - 1].rung
  const ageOk = steps.find((s) => s.exercises.some((e) => !e.avoidAges.includes(ageBr)))
  return (ageOk ?? steps[0]).rung
}

export interface Rung {
  rung: number
  /** the trainer set it (it may sit above the level's ceiling); otherwise the default start */
  set: boolean
}

export function rungsFor(
  data: Pick<DataBundle, 'modalities'>,
  ladders: Map<string, LadderStep[]>,
  input: Pick<ClientInput, 'rungs' | 'level'>,
  ageBr: string,
): Map<string, Rung> {
  const out = new Map<string, Rung>()
  for (const [family, steps] of ladders) {
    const asked = input.rungs?.[family]
    if (asked !== undefined && steps.length) {
      // A rung that does not exist is read as the nearest that does.
      const nearest = steps.reduce((b, s) => (Math.abs(s.rung - asked) < Math.abs(b.rung - asked) ? s : b), steps[0])
      out.set(family, { rung: nearest.rung, set: true })
    } else out.set(family, { rung: startRung(data, steps, input.level, ageBr, family), set: false })
  }
  return out
}

/** Where an exercise sits against the client's rungs: the rung they train, below it, or above. */
export function placeOnLadders(ex: Exercise, rungs: Map<string, Rung>): 'current' | 'below' | 'above' | 'off' {
  const ls = (ex.ladders ?? []).filter((l) => rungs.has(l.family))
  if (!ls.length) return 'off'
  // Above the client on any of its ladders is above, whatever another ladder says: a pull-up is the
  // first rung of the muscle-up ladder, but a client on negatives has not earned it yet.
  if (ls.some((l) => l.rung > rungs.get(l.family)!.rung)) return 'above'
  if (ls.some((l) => l.rung === rungs.get(l.family)!.rung)) return 'current'
  return 'below'
}

/**
 * How many rungs under the client's an exercise sits on its ladders (0 = the client's own rung), or
 * -1 when it is above the client on any of them; undefined when it is on no ladder the client has.
 */
export function rungsBelow(ex: Exercise, rungs: Map<string, Rung>, ladders: Map<string, LadderStep[]>): number | undefined {
  const ls = (ex.ladders ?? []).filter((l) => rungs.has(l.family) && ladders.has(l.family))
  if (!ls.length) return undefined
  let best = Infinity
  for (const l of ls) {
    const steps = ladders.get(l.family)!
    const at = steps.findIndex((s) => s.rung === l.rung)
    const cur = steps.findIndex((s) => s.rung === rungs.get(l.family)!.rung)
    if (at > cur) return -1
    best = Math.min(best, cur - at)
  }
  return best
}

/** Is a trainer-set rung carrying this exercise, so the level's skill ceiling does not apply? */
export const rungIsSet = (ex: Exercise, rungs: Map<string, Rung>) =>
  (ex.ladders ?? []).some((l) => rungs.get(l.family)?.set && rungs.get(l.family)!.rung === l.rung)

export const skillFamilyOf = (data: Pick<DataBundle, 'modalities'>, ex: Exercise): string | undefined =>
  (ex.ladders ?? []).map((l) => l.family).find((f) => data.modalities?.ladders.skillFamilies.includes(f))

// ─── The five-move warm-up ─────────────────────────────────────────────────────────────────

export interface WarmupMove {
  name: string
  exerciseId: number
  area: string
  seconds: number
  /** an easier rung of a ladder the session trains */
  fromLadder?: string
}

const WARMUP_BAN_EXTRA = new Set<string>()

/**
 * Five moves, 45 s each, one per body area the session's work touches (most sets first), the
 * leftover moves on the busiest area. Easier rungs of the session's own ladders come first, then
 * the gym-library pool; nothing on a machine, cable or reformer, nothing a pain removes, nothing
 * the age avoids, never the same move twice.
 */
export function warmupMoves(
  data: Pick<DataBundle, 'modalities'>,
  exercises: Exercise[],
  work: { exercise: Exercise; sets: number }[],
  opts: { rungs?: Map<string, Rung>; ladders?: Map<string, LadderStep[]>; ageBr: string; equipment: EquipmentTier; verdicts: Map<number, ExerciseVerdict> },
): WarmupMove[] {
  const w = data.modalities?.warmup
  if (!w) return []
  const areaOfGroup = new Map<string, string>()
  for (const [area, def] of Object.entries(w.areas)) for (const g of def.groups) areaOfGroup.set(g, area)
  const setsByArea = new Map<string, number>()
  for (const c of work) {
    const a = areaOfGroup.get(c.exercise.group)
    if (a) setsByArea.set(a, (setsByArea.get(a) ?? 0) + c.sets)
  }
  const areas = [...setsByArea.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)
  if (!areas.length) areas.push('trunk', 'hips')

  const banned = new Set([...w.bannedTokens, ...WARMUP_BAN_EXTRA])
  const usable = (e: Exercise) =>
    !e.avoidAges.includes(opts.ageBr) &&
    opts.verdicts.get(e.id)?.verdict !== 'REMOVE' &&
    equipmentOptions(e).some((t) => !banned.has(t)) &&
    isEquipmentAvailable(e, opts.equipment)
  const byName = new Map(exercises.map((e) => [e.name, e]))

  // Source 1: the two rungs under the client's own, for every ladder this session trains, by area.
  const drills = new Map<string, WarmupMove[]>()
  if (opts.rungs && opts.ladders) {
    const below = data.modalities?.ladders.warmupRungsBelow ?? 2
    const working = data.modalities?.ladders.workingRungs ?? 1
    const families = new Set(work.flatMap((c) => (c.exercise.ladders ?? []).map((l) => l.family)))
    const inSession = new Set(work.map((c) => c.exercise.id))
    for (const f of families) {
      const r = opts.rungs.get(f)
      const steps = opts.ladders.get(f)
      if (!r || !steps) continue
      const cur = steps.findIndex((s) => s.rung === r.rung)
      // The rungs just under the working ones; a ladder near its start has none, and the pool fills in.
      const under = steps.slice(Math.max(0, cur - working + 1 - below), Math.max(0, cur - working + 1)).reverse().filter((s) => s.exercises.every((e) => !inSession.has(e.id)))
      for (const s of under)
        for (const e of s.exercises) {
          const a = areaOfGroup.get(e.group)
          if (!a || !usable(e)) continue
          if (!drills.has(a)) drills.set(a, [])
          drills.get(a)!.push({ name: e.name, exerciseId: e.id, area: a, seconds: w.workSeconds, fromLadder: f })
        }
    }
  }
  // Source 2: the gym-library pool, by area, in the sheet's order.
  const pool = new Map<string, WarmupMove[]>()
  for (const [a, names] of Object.entries(w.pool))
    pool.set(
      a,
      names
        .map((n) => byName.get(n))
        .filter((e): e is Exercise => !!e && usable(e))
        .map((e) => ({ name: e.name, exerciseId: e.id, area: a, seconds: w.workSeconds })),
    )

  const out: WarmupMove[] = []
  const taken = new Set<number>()
  const takeFrom = (a: string) => {
    const next = [...(drills.get(a) ?? []), ...(pool.get(a) ?? [])].find((m) => !taken.has(m.exerciseId))
    if (next) {
      taken.add(next.exerciseId)
      out.push(next)
    }
    return !!next
  }
  for (const a of areas) if (out.length < w.moves) takeFrom(a)
  // Leftover moves on the busiest area, then the next busiest if it runs dry.
  for (const a of areas) while (out.length < w.moves && takeFrom(a));
  for (const a of Object.keys(w.pool)) while (out.length < w.moves && takeFrom(a));
  return out
}

/** The warm-up's minutes: five moves of 45 s and 15 s to change, five minutes. */
export const warmupMinutesFor = (data: Pick<DataBundle, 'modalities'>) => {
  const w = data.modalities?.warmup
  return w ? (w.moves * (w.workSeconds + w.transitionSeconds)) / 60 : 0
}

/** Does this client's warm-up use the five moves (a new style) rather than the live gym warm-up? */
export const usesMoveWarmup = (data: Pick<DataBundle, 'modalities'>, styles: Modality[]) =>
  !!data.modalities && styles.some((s) => data.modalities!.warmup.styles.includes(s))

/**
 * The app's own additions on top of the coaches' sheet (modalities.json overrides): a style ticked
 * on a library row, a style unticked, a library row put on a ladder. Applied once per data set;
 * the gym's own pool never changes (a tick only adds a non-gym style; ladders are read for
 * calisthenics only).
 */
const overridden = new WeakMap<Exercise[], Exercise[]>()
export function withStyleOverrides<T extends Pick<DataBundle, 'exercises' | 'modalities'>>(data: T): T {
  const o = data.modalities?.overrides
  if (!o) return data
  let out = overridden.get(data.exercises)
  if (!out) {
    out = data.exercises.map((e) => {
      const add = Object.entries(o.tick).filter(([, names]) => names!.includes(e.name)).map(([st]) => st as Modality)
      const drop = Object.entries(o.untick).filter(([, names]) => names!.includes(e.name)).map(([st]) => st as Modality)
      const ladders = o.ladders.filter((l) => l.name === e.name)
      if (!add.length && !drop.length && !ladders.length) return e
      const mods = new Set<Modality>([...(e.modalities ?? ['Gym']), ...add, ...(ladders.length ? (['Calisthenics'] as Modality[]) : [])])
      for (const d of drop) mods.delete(d)
      const lads = [...(e.ladders ?? [])]
      for (const l of ladders) if (!lads.some((x) => x.family === l.family)) lads.push({ family: l.family, rung: l.rung })
      return { ...e, modalities: [...mods], ...(lads.length && { ladders: lads }) }
    })
    overridden.set(data.exercises, out)
  }
  return { ...data, exercises: out }
}

/** The injury records for the sheet's new rows, merged into injury.json's at load. */
export function withModalityInjury(injury: InjuryData, extra: { exercises: InjuryData['exercises'] } | undefined): InjuryData {
  if (!extra?.exercises?.length) return injury
  const have = new Set(injury.exercises.map((r) => r.id))
  return { ...injury, exercises: [...injury.exercises, ...extra.exercises.filter((r) => !have.has(r.id))] }
}
