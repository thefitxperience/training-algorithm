import type { Exercise, TimeCapData } from '../types'
import { CORRECTIVE_REST_SECONDS, CORRECTIVE_WORK_SECONDS } from './bodydot'
import type { Block, Structure } from './structure'

/**
 * The time-cap layer. One button per day — "Reduce to 60 min" — that finds the CHEAPEST set
 * of cuts reaching 60 minutes and applies it.
 *
 * It runs last, after injury, all three machines, the structure selector and any amends, and
 * it only ever removes. Nothing above it caps session length any more: the allocation
 * guarantees volume only, and how long that takes is the client's decision, made here.
 */

// ---- the pin ---------------------------------------------------------------

/** A press is a per-day pin, the same model as an amend: held, re-applied, never an edit. */
export interface CapPin {
  dayIndex: number
  actor: string
  timestamp: string
}

// ---- levers ----------------------------------------------------------------

export type LeverId =
  | 'filler'
  | 'rest'
  | 'structure_step'
  | 'corrective_borderline'
  | 'corrective_abnormal'
  | 'set_accessory'
  | 'set_secondary'
  | 'set_primary'
  | 'remove_accessory_exercise'

/** Rest costs a different number of points per goal — it is the training variable on one. */
const REST_LEVER_BY_GOAL: Record<string, string> = {
  'Lose Fat': 'rest_LF',
  'Build Muscle': 'rest_BM',
  'Get Stronger': 'rest_GS',
}

/** The lever a data-file row drives, or null for the blocked main-lift row. */
export function leverIdOf(dataId: string): LeverId | null {
  if (dataId.startsWith('rest_')) return 'rest'
  if (dataId === 'main_lift') return null
  return dataId as LeverId
}

export function restLeverId(goal: string): string {
  return REST_LEVER_BY_GOAL[goal] ?? 'rest_BM'
}

/** null when the file names no such lever, which makes it unavailable rather than free. */
export function leverCost(data: TimeCapData, dataId: string): number | null {
  const lever = data.levers.find((l) => l.id === dataId)
  if (!lever || lever.blocked) return null
  return lever.cost > 0 ? lever.cost : null
}

export function compromiseOf(data: TimeCapData, dataId: string): string {
  return data.levers.find((l) => l.id === dataId)?.compromises ?? ''
}

/** straight -> superset -> triset, and nothing beyond. One step per day, ever. */
export function nextStructure(s: Structure): Structure | null {
  return s === 'straight' ? 'superset' : s === 'superset' ? 'triset' : null
}

export const REST_STEP_SECONDS = 10

// ---- the day model ---------------------------------------------------------

export interface CapExercise {
  exercise: Exercise
  tier: string
  mainLift: boolean
  /** base set count, before any trim */
  sets: number
  /** base rest in seconds, already floored — the incoming value can sit below the floor */
  restSeconds: number
  /** VALD's extra weak-side sets, which cost work + rest each on top of the block */
  unilateralExtraSets: number
}

export interface CapCorrective {
  /** which lever pays for dropping it */
  tier: 'borderline' | 'abnormal'
  label: string
  sets: number
  codes: string[]
}

export interface CapDayModel {
  goal: string
  workSeconds: number
  transitionSeconds: number
  warmupMinutes: number
  restMultiplier: Record<string, number>
  /** what the client picked for the program; the structure lever steps ONCE from here */
  baseStructure: Structure
  restFloor: number
  fillerBoutSeconds: number
  stretchSeconds: number
  exercises: CapExercise[]
  correctives: CapCorrective[]
  /** a stretch survives while any corrective it belongs to survives */
  stretches: { codes: string[] }[]
  fillerBouts: number
  /**
   * Re-forms the day's blocks for a structure and a surviving subset. Blocks change when the
   * structure steps AND when an exercise is removed, so the lever list has to be rebuilt at
   * every node — saving a minute changes what the next minute costs.
   */
  blocksFor: (structure: Structure, alive: readonly boolean[]) => Block[]
  data: TimeCapData
  minSets: number
}

export interface CapState {
  sets: number[]
  alive: boolean[]
  /** how many 10 s steps have come off rest */
  restStep: number
  stepped: boolean
  fillerBouts: number
  correctivesAlive: boolean[]
}

export function baseState(m: CapDayModel): CapState {
  return {
    sets: m.exercises.map((e) => e.sets),
    alive: m.exercises.map(() => true),
    restStep: 0,
    stepped: false,
    fillerBouts: m.fillerBouts,
    correctivesAlive: m.correctives.map(() => true),
  }
}

export function stateKey(s: CapState): string {
  return [
    s.sets.join(','),
    s.alive.map((a) => (a ? 1 : 0)).join(''),
    s.restStep,
    s.stepped ? 1 : 0,
    s.fillerBouts,
    s.correctivesAlive.map((a) => (a ? 1 : 0)).join(''),
  ].join('|')
}

/**
 * Rest for one exercise under this state. Every exercise steps down together, each stopping
 * at its own floor, so a rule-4 slot already on shortened rest reaches the floor first.
 *
 * "Floor the incoming rest before searching" binds in one direction only: where the
 * prescribed rest already sits below REST_FLOOR, the floor becomes that value, so the lever
 * simply cannot move it. This layer only ever removes, and raising a client's rest to meet a
 * floor would lengthen the session it was pressed to shorten.
 */
export function restOf(m: CapDayModel, s: CapState, i: number): number {
  const base = m.exercises[i].restSeconds
  const floor = Math.min(m.restFloor, base)
  return Math.max(floor, base - s.restStep * REST_STEP_SECONDS)
}

/** true while another 10 s step would actually come off some exercise's rest */
export function restTrimmable(m: CapDayModel, s: CapState): boolean {
  return m.exercises.some(
    (e, i) => s.alive[i] && restOf(m, s, i) > Math.min(m.restFloor, e.restSeconds),
  )
}

export function structureOf(m: CapDayModel, s: CapState): Structure {
  return s.stepped ? (nextStructure(m.baseStructure) ?? m.baseStructure) : m.baseStructure
}

/**
 * The one implementation of session length. Generation and the search both call it, so the
 * number on the day header and the number the search is driving to 60 can never disagree.
 *
 *   block   : work x S + (S - R) x transition + R x rest x REST_MULT
 *   session : sum(blocks) + unilateral surcharge + corrective block + filler + warmup
 */
export function capSeconds(m: CapDayModel, s: CapState): number {
  const blocks = m.blocksFor(structureOf(m, s), s.alive)
  let total = 0

  for (const b of blocks) {
    const counts = b.indices.map((i) => s.sets[i])
    const S = counts.reduce((a, c) => a + c, 0)
    const R = Math.max(...counts)
    // A block pairs only within one pool, so every member shares the first member's rest.
    const rest = restOf(m, s, b.indices[0])
    const mult = b.indices.length === 1 ? 1 : (m.restMultiplier[b.structure] ?? 1)
    total += m.workSeconds * S + (S - R) * m.transitionSeconds + R * rest * mult
  }

  // A unilateral set works both sides before the rest interval, so it costs 2 x work + rest
  // rather than 2 x (work + rest). Extra weak-side sets cost a full work + rest each.
  for (let i = 0; i < m.exercises.length; i++) {
    if (!s.alive[i]) continue
    const extra = m.exercises[i].unilateralExtraSets
    if (extra === 0) continue
    total += s.sets[i] * m.workSeconds + extra * (m.workSeconds + restOf(m, s, i))
  }

  for (let i = 0; i < m.correctives.length; i++) {
    if (!s.correctivesAlive[i]) continue
    total += m.correctives[i].sets * (CORRECTIVE_WORK_SECONDS + CORRECTIVE_REST_SECONDS)
  }
  for (const stretch of m.stretches) {
    const held = stretch.codes.some((code) =>
      m.correctives.some((c, i) => s.correctivesAlive[i] && c.codes.includes(code)),
    )
    if (held) total += m.stretchSeconds
  }

  total += s.fillerBouts * m.fillerBoutSeconds
  return total + m.warmupMinutes * 60
}

export const capMinutes = (m: CapDayModel, s: CapState) => capSeconds(m, s) / 60

// ---- children --------------------------------------------------------------

export interface CapStep {
  lever: LeverId
  /** the row in timecap.json this came from, so the cost and the copy are the file's */
  dataId: string
  cost: number
  detail: string
}

interface Child {
  step: CapStep
  state: CapState
  seconds: number
}

const clone = (s: CapState): CapState => ({
  sets: [...s.sets],
  alive: [...s.alive],
  restStep: s.restStep,
  stepped: s.stepped,
  fillerBouts: s.fillerBouts,
  correctivesAlive: [...s.correctivesAlive],
})

const SET_LEVER_BY_TIER: Record<string, string> = {
  primary: 'set_primary',
  secondary: 'set_secondary',
  accessory: 'set_accessory',
}

/**
 * Every legal single pull from this state, in the data file's own lever order — that order
 * is the insertion-order tie-break, not a walk order: the engine searches combinations.
 *
 * A pull that saves nothing is dropped. Every lever here only ever removes work, so a pull
 * that leaves the session the same length can never be part of a cheapest plan, and keeping
 * it would let the search buy zero minutes for real points. The acceptance suite asserts the
 * monotonicity this rests on.
 */
export function children(m: CapDayModel, s: CapState, parentSeconds: number): Child[] {
  const out: Child[] = []
  const push = (dataId: string, lever: LeverId, detail: string, next: CapState) => {
    const cost = leverCost(m.data, dataId)
    if (cost === null) return
    const seconds = capSeconds(m, next)
    if (seconds >= parentSeconds) return
    out.push({ step: { lever, dataId, cost, detail }, state: next, seconds })
  }

  for (const lever of m.data.levers) {
    const id = leverIdOf(lever.id)
    if (id === null) continue // the main lift, blocked

    switch (id) {
      case 'filler': {
        if (s.fillerBouts <= 0) break
        const next = clone(s)
        next.fillerBouts -= 1
        push(lever.id, 'filler', `one filler bout dropped (${next.fillerBouts} left)`, next)
        break
      }

      case 'rest': {
        // Only the goal's own rest row applies to this day.
        if (lever.id !== restLeverId(m.goal)) break
        if (!restTrimmable(m, s)) break
        const next = clone(s)
        next.restStep += 1
        const before = Math.max(...m.exercises.map((_, i) => restOf(m, s, i)))
        const after = Math.max(...m.exercises.map((_, i) => restOf(m, next, i)))
        push(lever.id, 'rest', `rest ${before} → ${after} s (floor ${m.restFloor} s)`, next)
        break
      }

      case 'structure_step': {
        if (s.stepped) break
        const to = nextStructure(m.baseStructure)
        if (!to) break
        const next = clone(s)
        next.stepped = true
        push(lever.id, 'structure_step', `run the session as ${to}s — every set survives`, next)
        break
      }

      case 'corrective_borderline':
      case 'corrective_abnormal': {
        const tier = id === 'corrective_borderline' ? 'borderline' : 'abnormal'
        for (let i = 0; i < m.correctives.length; i++) {
          if (!s.correctivesAlive[i] || m.correctives[i].tier !== tier) continue
          const next = clone(s)
          next.correctivesAlive[i] = false
          push(lever.id, id, `drop the ${tier} corrective "${m.correctives[i].label}"`, next)
        }
        break
      }

      case 'set_accessory':
      case 'set_secondary':
      case 'set_primary': {
        for (let i = 0; i < m.exercises.length; i++) {
          const e = m.exercises[i]
          if (!s.alive[i] || e.mainLift) continue
          if (SET_LEVER_BY_TIER[e.tier] !== lever.id) continue
          if (s.sets[i] - 1 < m.minSets) continue
          const next = clone(s)
          next.sets[i] -= 1
          push(
            lever.id,
            id,
            `${e.exercise.name}: ${s.sets[i]} → ${next.sets[i]} sets`,
            next,
          )
        }
        break
      }

      case 'remove_accessory_exercise': {
        for (let i = 0; i < m.exercises.length; i++) {
          const e = m.exercises[i]
          if (!s.alive[i] || e.mainLift || e.tier !== 'accessory') continue
          // Never empty the session outright.
          if (s.alive.filter(Boolean).length <= 1) continue
          const next = clone(s)
          next.alive[i] = false
          push(lever.id, id, `remove "${e.exercise.name}" (${e.exercise.sub})`, next)
        }
        break
      }
    }
  }

  return out
}

// ---- the search ------------------------------------------------------------

export interface CapPlan {
  /** true when the plan lands at or under the target */
  reached: boolean
  /**
   * true when the search proved this is the CHEAPEST plan reaching the target. False on the
   * small tail of days where it ran out of states or time first and returned the cheapest
   * plan it had actually found — which reaches the target, but is not proven minimal.
   */
  proven: boolean
  steps: CapStep[]
  points: number
  minutesBefore: number
  minutesAfter: number
  /** minutes still over the target; 0 when reached */
  shortfall: number
  state: CapState
  /** one sentence naming what was given up */
  gaveUp: string
  reason: string
  nodesExpanded: number
}

interface Node {
  state: CapState
  seconds: number
  cost: number
  depth: number
  seq: number
  parent: Node | null
  step: CapStep | null
}

/** Ordered by points spent, then fewer steps — the client reads the steps — then insertion. */
function cheaper(a: Node, b: Node): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost
  if (a.depth !== b.depth) return a.depth < b.depth
  return a.seq < b.seq
}

class Heap {
  private items: Node[] = []
  get size() {
    return this.items.length
  }
  push(n: Node) {
    const a = this.items
    a.push(n)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!cheaper(a[i], a[p])) break
      ;[a[i], a[p]] = [a[p], a[i]]
      i = p
    }
  }
  pop(): Node | undefined {
    const a = this.items
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let best = i
        if (l < a.length && cheaper(a[l], a[best])) best = l
        if (r < a.length && cheaper(a[r], a[best])) best = r
        if (best === i) break
        ;[a[i], a[best]] = [a[best], a[i]]
        i = best
      }
    }
    return top
  }
}

/**
 * Pull every lever that shortens the session until none is left. `children` only ever offers
 * a pull that shortens, so this converges on the shortest session the day can legally become.
 *
 * That makes reachability a single evaluation rather than an exhausted search: if this state
 * is still over the target, no plan reaches it — and proving that by expanding the whole
 * state space is the one case where the search is genuinely expensive.
 */
function floorState(m: CapDayModel): { state: CapState; steps: CapStep[]; points: number } {
  let s = baseState(m)
  const steps: CapStep[] = []
  let points = 0
  for (let guard = 0; guard < 500; guard++) {
    const kids = children(m, s, capSeconds(m, s))
    if (kids.length === 0) break
    const k = kids[0]
    s = k.state
    steps.push(k.step)
    points += k.step.cost
  }
  return { state: s, steps, points }
}

/**
 * Best-minutes-per-point, pulled until the target is met. This is the heuristic the spec
 * rejected as an ANSWER — measured against the exact optimum it overspent by 43% and was
 * optimal on only 56% of days — and it is never returned as one. It is used for the single
 * thing it is good for: an upper bound to seed branch and bound with, so the search can
 * discard everything at least that expensive from the first node, and so a search that is
 * cut short still has a real plan reaching the target rather than the shortest-safe state.
 */
function greedyBound(m: CapDayModel, targetSeconds: number): { steps: CapStep[]; state: CapState; seconds: number; points: number } | null {
  let state = baseState(m)
  let seconds = capSeconds(m, state)
  const steps: CapStep[] = []
  let points = 0
  for (let guard = 0; guard < 500 && seconds > targetSeconds; guard++) {
    let pick: Child | null = null
    let bestRate = 0
    for (const child of children(m, state, seconds)) {
      const rate = (seconds - child.seconds) / child.step.cost
      if (rate > bestRate) {
        bestRate = rate
        pick = child
      }
    }
    if (!pick) return null
    state = pick.state
    seconds = pick.seconds
    steps.push(pick.step)
    points += pick.step.cost
  }
  return seconds <= targetSeconds ? { steps, state, seconds, points } : null
}

/** The one sentence under the itemised list. Led by the most expensive lever pulled. */
function gaveUpSentence(m: CapDayModel, steps: CapStep[]): string {
  if (steps.length === 0)
    return `Nothing — this session was already inside ${m.data.target} minutes.`
  const seen = new Map<string, number>()
  for (const s of steps) seen.set(s.dataId, Math.max(seen.get(s.dataId) ?? 0, s.cost))
  const parts = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dataId]) => compromiseOf(m.data, dataId))
    .filter(Boolean)
  if (parts.length === 0) return 'Nothing measurable.'
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('; ')}; and ${parts.at(-1)}`
  return `You gave up ${sentence}.`
}

export interface PlanOptions {
  /** minutes; 60 in the data file, and strictly 60 — a plan landing at 60.2 has not reached it */
  target?: number
  /**
   * How many states the search may expand before it settles for the best plan it has found.
   *
   * The budget is counted in STATES, never in milliseconds. A wall-clock budget was tried
   * and reverted: it makes the plan depend on how busy the machine is, so the same day
   * pressed twice on a loaded laptop returns two different plans — which the acceptance
   * suite caught, and which is the one property a client-facing button cannot lose. States
   * are deterministic and bound the wall clock closely enough (40,000 ≈ 2 s at the worst
   * day measured), so this gives both.
   */
  nodeLimit?: number
}

/**
 * Uniform-cost search (Dijkstra) over lever states. Optimal because every lever costs more
 * than zero, so the queue cannot pop a state cheaper than one already popped. States are
 * deduplicated, not paths — the levers commute, so every ordering of the same multiset of
 * pulls collapses to one node.
 *
 * A greedy best-minutes-per-point pass was built and measured against this: it overspent by
 * 43% and was optimal on 56% of days. A closing rule patches the symptom, not the cause.
 */
export function planCap(m: CapDayModel, opts: PlanOptions = {}): CapPlan {
  const target = opts.target ?? m.data.target
  const nodeLimit = opts.nodeLimit ?? 40_000
  const targetSeconds = target * 60
  const base = baseState(m)
  const beforeSeconds = capSeconds(m, base)
  const minutesBefore = beforeSeconds / 60

  const done = (
    steps: CapStep[],
    state: CapState,
    seconds: number,
    reason: string,
    nodes: number,
    proven = true,
  ): CapPlan => ({
    reached: seconds <= targetSeconds,
    proven,
    steps,
    points: steps.reduce((s, x) => s + x.cost, 0),
    minutesBefore,
    minutesAfter: seconds / 60,
    shortfall: Math.max(0, seconds / 60 - target),
    state,
    gaveUp: gaveUpSentence(m, steps),
    reason,
    nodesExpanded: nodes,
  })

  if (beforeSeconds <= targetSeconds) {
    return done([], base, beforeSeconds, 'already inside the target', 0)
  }

  // Reachability first, so the unreachable case never pays for an exhausted search.
  const floor = floorState(m)
  const floorSeconds = capSeconds(m, floor.state)
  if (floorSeconds > targetSeconds) {
    return done(
      floor.steps,
      floor.state,
      floorSeconds,
      m.exercises.some((e) => e.mainLift)
        ? 'every lever except the main lift is already pulled — the main lift is never cut automatically, so this is the shortest safe version of this session'
        : 'every available lever is already pulled — this is the shortest safe version of this session',
      0,
    )
  }

  const stepsTo = (node: Node): CapStep[] => {
    const steps: CapStep[] = []
    for (let n: Node | null = node; n?.step; n = n.parent) steps.unshift(n.step)
    return steps
  }

  const heap = new Heap()
  const visited = new Set<string>()
  let seq = 0
  heap.push({ state: base, seconds: beforeSeconds, cost: 0, depth: 0, seq: seq++, parent: null, step: null })

  // Branch and bound. Any state that already reaches the target is an INCUMBENT: an upper
  // bound on the answer, so nothing costing at least as much is ever queued. Seeded with a
  // greedy plan, which on the longest sessions is the difference between pruning from the
  // first node and pruning from nowhere.
  let best: Node | null = null
  const seed = greedyBound(m, targetSeconds)
  let seedSteps: CapStep[] | null = null
  let seedCost = Infinity
  let seedState: CapState | null = null
  let seedSeconds = 0
  if (seed) {
    seedSteps = seed.steps
    seedCost = seed.points
    seedState = seed.state
    seedSeconds = seed.seconds
  }
  /** the cheapest reaching plan known — a real node if one was found, else the greedy seed */
  const bound = () => (best ? best.cost : seedCost)

  let expanded = 0
  while (heap.size > 0) {
    const node = heap.pop()!
    const key = stateKey(node.state)
    if (visited.has(key)) continue
    // Popped in nondecreasing cost, so once the queue reaches the incumbent's price nothing
    // cheaper is left and the incumbent is provably the cheapest.
    if (node.cost >= bound()) break
    visited.add(key)
    expanded++

    if (node.seconds <= targetSeconds) {
      return done(stepsTo(node), node.state, node.seconds, 'cheapest plan reaching the target', expanded)
    }

    if (expanded >= nodeLimit) {
      const why = `${nodeLimit.toLocaleString()} states`
      const cutShort = `this plan reaches ${target} min, but the search ran past ${why} before it could prove no cheaper one exists`
      if (best) return done(stepsTo(best), best.state, best.seconds, cutShort, expanded, false)
      if (seedSteps && seedState)
        return done(seedSteps, seedState, seedSeconds, cutShort, expanded, false)
      return done(
        floor.steps,
        floor.state,
        floorSeconds,
        `the search ran past ${why} without finding a plan; the shortest safe version was applied instead`,
        expanded,
        false,
      )
    }

    for (const child of children(m, node.state, node.seconds)) {
      const cost = node.cost + child.step.cost
      if (cost >= bound()) continue
      const next: Node = {
        state: child.state,
        seconds: child.seconds,
        cost,
        depth: node.depth + 1,
        seq: seq++,
        parent: node,
        step: child.step,
      }
      if (child.seconds <= targetSeconds) {
        if (!best || cheaper(next, best)) best = next
        continue
      }
      if (visited.has(stateKey(child.state))) continue
      heap.push(next)
    }
  }

  // The queue ran dry (or was bounded out) with the incumbent proved cheapest.
  if (best) return done(stepsTo(best), best.state, best.seconds, 'cheapest plan reaching the target', expanded)
  if (seedSteps && seedState)
    return done(seedSteps, seedState, seedSeconds, 'cheapest plan reaching the target', expanded)
  // The floor state was inside the target, so the queue cannot legitimately run dry first.
  return done(floor.steps, floor.state, floorSeconds, 'no cheaper plan was found', expanded)
}

// ---- result ----------------------------------------------------------------

export interface TimeCapResult {
  active: boolean
  target: number
  /** `model` is the day exactly as the search saw it: whole sets, nothing cut yet */
  applied: { dayIndex: number; plan: CapPlan; model: CapDayModel }[]
  /** a press whose day no longer exists — the split or the frequency changed underneath it */
  retired: { pin: CapPin; reason: string }[]
}

export const INERT_TIMECAP: TimeCapResult = {
  active: false,
  target: 0,
  applied: [],
  retired: [],
}
