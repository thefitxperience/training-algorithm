import type { AllocationDay, Exercise, FitData, Slot, TimeCapData } from '../types'

/**
 * Fitting every session into a one-hour personal-training session (data/fit.json).
 *
 * The generator builds the session to fit, rather than building a long one and compressing it:
 * a working-set ceiling per session, a time model that charges set-up and ramp-up, warm-up
 * posture work that is light and sits inside the warm-up, stricter pairing, and an order a
 * coach would run. Whatever is still over the hour is trimmed by the time-cap search, which
 * now runs on every day and never removes the weaker side's work.
 */

export type SetupClass = 'barbell' | 'machine' | 'dumbbell' | 'bodyweight'

const SETUP_BY_TOKEN: Record<string, SetupClass> = {
  BB: 'barbell',
  'trap bar': 'barbell',
  M: 'machine',
  C: 'machine',
  Smith: 'machine',
  GHD: 'machine',
  DB: 'dumbbell',
  KB: 'dumbbell',
  EZ: 'dumbbell',
  plate: 'dumbbell',
  'wrist roller': 'dumbbell',
  'tib bar': 'dumbbell',
}

/** What setting the exercise up is like, from the first equipment listed for it. */
export function setupClass(ex: Exercise): SetupClass {
  const first = ex.equipment.split('/')[0].trim()
  return SETUP_BY_TOKEN[first] ?? 'bodyweight'
}

export const setupSeconds = (fit: FitData, ex: Exercise) => fit.time.setupSeconds[setupClass(ex)] ?? 0

/** The most working sets one session may hold, for this goal, level and age. */
export function maxSetsFor(fit: FitData, goal: string, level: string, age: number): number {
  const byLevel = fit.setsPerSession[goal]?.[level] ?? Infinity
  return age >= fit.older.fromAge ? Math.min(byLevel, fit.older.maxSets) : byLevel
}

/** At most `limitPairs.max` pairs a session for a beginner or a client from sixty. */
export function maxPairsFor(fit: FitData, level: string, age: number): number | undefined {
  const l = fit.pairing.limitPairs
  return l.levels.includes(level) || age >= l.fromAge ? l.max : undefined
}

/** Sub-region pairs that load the same tissue, keyed both ways round. */
export function competingPairs(fit: FitData): Set<string> {
  const out = new Set<string>()
  for (const [a, b] of [...fit.pairing.competing, ...(fit.pairing.competingGroups ?? [])]) {
    out.add(`${a}|${b}`)
    out.add(`${b}|${a}`)
  }
  return out
}

/** The most main lifts one session may hold, for this level. */
export function maxMainLiftsFor(fit: FitData, level: string): number {
  const v = fit.mainLiftsPerSession[level] ?? fit.mainLiftsPerSession.default
  return typeof v === 'number' ? v : Infinity
}

/** The most rest this exercise is charged: heavy-compound rest is not for isolation work. */
export function restCapFor(fit: FitData, ex: Exercise): number {
  return ex.type === 'compound' ? Infinity : fit.rest.isolationMaxSeconds
}

/** The least rest a main lift or heavy compound takes at these reps: 150 s to five, 120 s to nine, else 90 (0 for anything else). */
export function restFloorFor(fit: FitData, ex: Exercise, reps: string): number {
  if (!isHeavyCompound(fit, ex)) return 0
  const f = fit.rest.heavyFloor
  const rr = range(reps)
  if (!rr) return f.seconds
  return rr[0] <= f.lowRepsUpTo ? f.lowRepsSeconds : rr[0] <= f.midRepsUpTo ? f.midRepsSeconds : f.seconds
}

/** The most conditioning a short session may be given, in minutes. */
export function conditioningCapFor(fit: FitData, goal: string): number {
  const v = fit.conditioningMaxMinutes[goal] ?? fit.conditioningMaxMinutes.default
  return typeof v === 'number' ? v : Infinity
}

/** Which movement family a main lift belongs to (one per session), or -1. */
export function mainFamily(fit: FitData, ex: Exercise): number {
  return ex.mainLift ? fit.mainLiftFamilies.families.findIndex((f) => f.includes(ex.sub)) : -1
}

/** Lower body, push, pull: what every Full Body day keeps. Returns the kind's index, or -1. */
export function fullBodyKind(fit: FitData, sub: string): number {
  return [fit.fullBody.lower, fit.fullBody.push, fit.fullBody.pull].findIndex((k) => k.includes(sub))
}

export function isHeavyHinge(fit: FitData, ex: Exercise): boolean {
  const h = fit.heavyHinge
  return h.subs.includes(ex.sub) && h.types.includes(ex.type) && ex.load >= h.minLoad
}

export function isHeavyCompound(fit: FitData, ex: Exercise): boolean {
  return ex.mainLift || (ex.type === 'compound' && ex.load >= fit.reps.heavyMinLoad)
}

const range = (reps: string): [number, number] | null => {
  const m = reps.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
  if (!m) return null
  const lo = Number(m[1])
  return [lo, m[2] ? Number(m[2]) : lo]
}

/**
 * The reps this exercise is actually prescribed, from the goal's range: holds are timed and
 * carries measured; small and isolation work never goes below the floor; heavy compounds never
 * above the ceiling. Anything else keeps the goal's range.
 */
const LOWER_GROUPS = new Set(['Quads, hams, adductors', 'Glutes & hips'])

export function repsFor(fit: FitData, ex: Exercise, reps: string, oneSided?: ReadonlySet<number>): string {
  const r = fit.reps
  if (ex.type === 'isometric') return `${r.holdSeconds} s`
  if (ex.type === 'carry') return `${r.carryMetres} m`
  if (ex.type === 'mobility') return reps
  const rr = range(reps)
  if (!rr) return reps
  // One-leg and stability lower-body lifts: never below six reps (a knee and balance risk).
  if (oneSided?.has(ex.id) && ex.type === 'compound' && LOWER_GROUPS.has(ex.group) && rr[0] < r.unilateralLowerFloor)
    return r.unilateralLowerRange
  // Heavy core work (a suitcase deadlift) is never loaded below eight.
  if (ex.type === 'compound' && (ex.group === 'Abs & core' || ex.group === 'Lower back') && !ex.mainLift && rr[0] < r.coreCompoundFloor)
    return r.coreCompoundRange
  if (isHeavyCompound(fit, ex)) return rr[1] > r.heavyMaxReps ? r.heavyRange : reps
  const small = r.smallTypes.includes(ex.type) || r.smallGroups.includes(ex.group)
  if (small && rr[0] < r.smallFloor) return r.smallRange
  return reps
}

/** Where an exercise sits in the session: main lifts, compounds, isolation, then small work. */
export function orderRank(fit: FitData, ex: Exercise): number {
  if (fit.order.lastTypes.includes(ex.type)) return 4
  if (fit.order.smallGroups.includes(ex.group) && ex.type !== 'compound') return 3
  if (ex.mainLift) return 0
  if (ex.type === 'compound') return 1
  if (fit.order.smallGroups.includes(ex.group)) return 3
  return 2
}

const PRESS_GROUPS = new Set(['Chest'])

/**
 * Exercises the trim may take out cheaply: a second exercise for a sub-region the session
 * already trains, a front raise on a day that presses, neck and grip work, shrugs.
 */
export function isRedundant(fit: FitData, list: readonly Exercise[], alive: readonly boolean[], i: number): boolean {
  const ex = list[i]
  if (ex.mainLift) return false
  const r = fit.trim.redundant
  if (r.groups.includes(ex.group) || r.subs.includes(ex.sub)) return true
  const others = list.filter((_, j) => j !== i && alive[j])
  if (r.sameSubTwice && others.some((o) => o.sub === ex.sub)) return true
  if (ex.sub === 'Front' && ex.type !== 'compound') {
    if (r.frontRaiseAlways) return true
    if (r.frontRaiseWithPress)
      return others.some((o) => PRESS_GROUPS.has(o.group) || (o.sub === 'Front' && o.type === 'compound'))
  }
  return false
}

/** The time cap's levers with this file's added: a cheap redundant cut, removal, and the main lift as a last resort. */
export function fitTimecap(timecap: TimeCapData, fit: FitData): TimeCapData {
  const levers = timecap.levers.map((l) => {
    const own = fit.trim.levers.find((f) => f.id === l.id)
    return own ? { ...l, cost: own.cost, blocked: false, compromises: own.compromises } : l
  })
  for (const own of fit.trim.levers) {
    if (levers.some((l) => l.id === own.id)) continue
    const at = own.after ? levers.findIndex((l) => l.id === own.after) : -1
    levers.splice(at >= 0 ? at + 1 : levers.length, 0, { id: own.id, cost: own.cost, compromises: own.compromises })
  }
  return { ...timecap, target: fit.sessionMinutes, levers }
}

/**
 * A Full Body week, re-dealt across its days. The allocation can stack one day with isolation
 * work and leave another without a leg or a pull; a Full Body day should have all three and a
 * fair share of the week. So every slot is taken apart into single exercises and dealt again:
 * the lower-body, push and pull exercises first, one to each day in turn (the day with fewest of
 * that kind, then fewest sets), then everything else to the day with the fewest sets so far,
 * never the same sub-region twice in a day where it can be helped. The week's volume is unchanged.
 * Returns new days; the allocation is never mutated.
 */
export function balanceFullBody(days: AllocationDay[], fit: FitData): AllocationDay[] {
  type Unit = { sub: string; sets: number; order: number }
  const units: Unit[] = []
  let order = 0
  for (const d of days) for (const [sub, count, sets] of d.slots as Slot[]) for (let n = 0; n < count; n++) units.push({ sub, sets, order: order++ })
  const dealt: Unit[][] = days.map(() => [])
  const setsOn = (i: number) => dealt[i].reduce((n, u) => n + u.sets, 0)
  const has = (i: number, sub: string) => dealt[i].some((u) => u.sub === sub)
  const place = (u: Unit, rank: (i: number) => number[]) => {
    const order = dealt.map((_, i) => i)
    const fresh = order.filter((i) => !has(i, u.sub))
    const pool = fresh.length > 0 ? fresh : order
    pool.sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return ra[k] - rb[k]
      return a - b
    })
    dealt[pool[0]].push(u)
  }
  const kinds = [fit.fullBody.lower, fit.fullBody.push, fit.fullBody.pull]
  const bySets = (a: Unit, b: Unit) => b.sets - a.sets || a.order - b.order
  for (const subs of kinds) {
    const ofKind = (i: number) => dealt[i].filter((u) => subs.includes(u.sub)).length
    for (const u of units.filter((x) => subs.includes(x.sub)).sort(bySets)) place(u, (i) => [ofKind(i), setsOn(i)])
  }
  for (const u of units.filter((x) => !kinds.some((k) => k.includes(x.sub))).sort(bySets)) place(u, (i) => [setsOn(i)])

  // A day still without one (the week has fewer than there are days) gets one added.
  const add = fit.fullBody.addMissing
  ;[add.lower, add.push, add.pull].forEach((sub, k) => {
    for (const day of dealt) if (!day.some((u) => kinds[k].includes(u.sub))) day.push({ sub, sets: add.sets, order: order++ })
  })

  return days.map((d, i) => {
    // Back into slots in the allocation's own order; the same sub-region twice becomes one slot of two.
    const slots: Slot[] = []
    for (const u of [...dealt[i]].sort((a, b) => a.order - b.order)) {
      const at = slots.findIndex((x) => x[0] === u.sub)
      if (at < 0) slots.push([u.sub, 1, u.sets])
      else slots[at] = [u.sub, slots[at][1] + 1, (slots[at][2] * slots[at][1] + u.sets) / (slots[at][1] + 1)]
    }
    return { ...d, slots }
  })
}
