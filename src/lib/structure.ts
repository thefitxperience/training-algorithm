import type { Exercise, StructureData } from '../types'

export type Structure = 'straight' | 'superset' | 'triset'
export const STRUCTURES: Structure[] = ['straight', 'superset', 'triset']

export type PairReason = 'antagonist' | 'non-competing' | 'same muscle'
export type Badge = 'RECOMMENDED' | 'AVAILABLE'

/** Minimal shape the pairing needs — keeps this layer decoupled from generate.ts. */
export interface Pairable {
  exercise: Exercise
  sets: number
  corrective: boolean
}

export interface Block {
  /** indices into the day's exercise list, in prescribed order */
  indices: number[]
  /** 'straight' for any single-exercise block, whatever the client selected */
  structure: Structure
  /** why the anchor pair was legal; absent on straight blocks */
  reason?: PairReason
  /**
   * Resolved for THIS block, not for the program. A block that could only find one legal
   * partner is a superset even when the client picked triset, and an InBody rule-4 region is
   * supersetted regardless of what the client picked — so the program-level figure is the
   * wrong one to charge it or to label it with. Set by generate.ts once the blocks are known.
   */
  restMultiplier?: number
  loadAdjustment?: number
}

export interface StructureContext {
  goal: string
  structure: Structure
  data: StructureData
  /** injury.json's corrective flag, keyed by exercise id */
  corrective: Set<number>
  /**
   * Every spelling of a sub-region. `alsoTrains` uses the injury library's spelling for
   * eight sub-regions while `sub` uses the skeleton's, so a raw string compare misses the
   * synergist case the rule exists for — overhead press lists "Lateral-medial (lockout)"
   * but the pushdown's `sub` is "Lateral / medial (lockout)". Built by joining on `id`, so
   * the aliases are exact, never guessed.
   */
  subAliases: Map<string, Set<string>>
}

export function buildSubAliases(
  exercises: Exercise[],
  injuryExercises: { id: number; key: string }[],
): Map<string, Set<string>> {
  const libraryByw = new Map(injuryExercises.map((r) => [r.id, r.key.split(' > ')[1] ?? '']))
  const aliases = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!a || !b) return
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      if (!aliases.has(x)) aliases.set(x, new Set([x]))
      aliases.get(x)!.add(y)
    }
  }
  for (const e of exercises) link(e.sub, libraryByw.get(e.id) ?? e.sub)
  return aliases
}

// ---- badges ----------------------------------------------------------------

export interface StructureBadges {
  badges: Record<Structure, Badge>
  /** set when triset was stepped down, for the UI to explain */
  trisetDowngraded: boolean
  downgradeReason: string
}

export function structureBadges(
  data: StructureData,
  client: { goal: string; ageBracket: string; level: string },
): StructureBadges {
  const badges: Record<Structure, Badge> = {
    straight: 'AVAILABLE',
    superset: 'AVAILABLE',
    triset: 'AVAILABLE',
  }

  const preferred = data.recommendedDefault[client.goal] as Structure | undefined
  if (preferred) badges[preferred] = 'RECOMMENDED'
  if (client.goal === 'Lose Fat') badges.triset = 'RECOMMENDED'

  const byAge = data.trisetDowngradeAges.includes(client.ageBracket)
  const byLevel = data.trisetDowngradeLevels.includes(client.level)
  const downgraded = (byAge || byLevel) && badges.triset === 'RECOMMENDED'
  if (byAge || byLevel) badges.triset = 'AVAILABLE'

  return {
    badges,
    trisetDowngraded: downgraded,
    downgradeReason:
      byAge && byLevel
        ? `trisets are stepped down at your age (${client.ageBracket}) and level (${client.level})`
        : byAge
          ? `trisets are stepped down at your age (${client.ageBracket})`
          : byLevel
            ? `trisets are stepped down at your level (${client.level})`
            : '',
  }
}

/** Whichever is RECOMMENDED; if more than one, the goal's default. */
export function defaultStructure(data: StructureData, client: { goal: string; ageBracket: string; level: string }): Structure {
  const { badges } = structureBadges(data, client)
  const recommended = STRUCTURES.filter((s) => badges[s] === 'RECOMMENDED')
  if (recommended.length === 1) return recommended[0]
  return (data.recommendedDefault[client.goal] as Structure) ?? 'straight'
}

// ---- legality --------------------------------------------------------------

const jointsOf = (data: StructureData, sub: string) => new Set(data.joints[sub] ?? [])

function sharesJoint(data: StructureData, a: string, b: string): boolean {
  const ja = jointsOf(data, a)
  for (const j of jointsOf(data, b)) if (ja.has(j)) return true
  return false
}

function isAntagonist(data: StructureData, a: string, b: string): boolean {
  return data.antagonists.some(
    (g) => (g.a.includes(a) && g.b.includes(b)) || (g.b.includes(a) && g.a.includes(b)),
  )
}

/**
 * Why this pair is legal, or null. Rejections are checked BEFORE the reasons, in the
 * order given by the spec — a rejected pair is never rescued by a later reason.
 */
export function pairReason(x: Pairable, y: Pairable, ctx: StructureContext): PairReason | null {
  const { data, goal } = ctx
  const a = x.exercise
  const b = y.exercise

  // 1. main lifts stay alone when the goal protects them (Get Stronger only)
  if (data.mainLiftProtectedGoals.includes(goal) && (a.mainLift || b.mainLift)) return null

  // 2. two compounds sharing a joint
  if (a.type === 'compound' && b.type === 'compound' && sharesJoint(data, a.sub, b.sub)) return null

  // 3. synergist — one already fatigues the other, even with no shared joint.
  //    This is what stops a shoulder press pairing with a triceps pushdown, so it has to
  //    match across both spellings of a sub-region.
  const names = (sub: string) => ctx.subAliases.get(sub) ?? new Set([sub])
  const trains = (ex: Exercise, other: string) => {
    const alt = names(other)
    return ex.alsoTrains.some((t) => alt.has(t))
  }
  if (trains(a, b.sub) || trains(b, a.sub)) return null

  // 4. a corrective pairs only with another corrective, so labelled blocks stay intact
  if (x.corrective !== y.corrective) return null

  if (isAntagonist(data, a.sub, b.sub)) return 'antagonist'
  if (!sharesJoint(data, a.sub, b.sub)) return 'non-competing'
  if (a.sub === b.sub && goal === 'Lose Fat') return 'same muscle'
  return null
}

// ---- block formation -------------------------------------------------------

/**
 * Two passes, both load-bearing:
 *   1. anchor every block on a genuine ANTAGONIST pairing, filling each to size before
 *      starting the next — a single greedy pass lets a merely non-competing partner take
 *      a slot an antagonist pair needed, and forming all pairs before growing them means
 *      every candidate is consumed and trisets never form.
 *   2. anchor on any legal reason.
 * Whatever is left stays straight, in prescribed order.
 */
export function formBlocks(items: Pairable[], ctx: StructureContext): Block[] {
  const size = ctx.data.blockSize[ctx.structure] ?? 1
  if (size <= 1) {
    return items.map((_, i) => ({ indices: [i], structure: 'straight' }))
  }

  const taken = new Array(items.length).fill(false)
  const blocks: Block[] = []

  const legalWithAll = (candidate: number, members: number[]): PairReason | null => {
    let weakest: PairReason | null = null
    for (const m of members) {
      const r = pairReason(items[m], items[candidate], ctx)
      if (!r) return null
      weakest = r
    }
    return weakest
  }

  const growFrom = (i: number, anchorOnly: 'antagonist' | 'any') => {
    const members = [i]
    let reason: PairReason | undefined

    for (let j = 0; j < items.length && members.length < size; j++) {
      if (taken[j] || members.includes(j)) continue
      const r = legalWithAll(j, members)
      if (!r) continue
      // the anchor pair must satisfy the pass's requirement
      if (members.length === 1 && anchorOnly === 'antagonist' && r !== 'antagonist') continue
      if (members.length === 1) reason = r
      members.push(j)
    }

    if (members.length < 2) return null
    members.sort((a, b) => a - b)
    for (const m of members) taken[m] = true
    // Label by what the block actually is: under `triset`, a block that could only find one
    // legal partner is a superset, and calling it a triset would be a lie.
    return {
      indices: members,
      structure: members.length >= 3 ? 'triset' : 'superset',
      reason,
    } as Block
  }

  for (const pass of ['antagonist', 'any'] as const) {
    for (let i = 0; i < items.length; i++) {
      if (taken[i]) continue
      const block = growFrom(i, pass)
      if (block) blocks.push(block)
    }
  }

  for (let i = 0; i < items.length; i++) {
    if (!taken[i]) blocks.push({ indices: [i], structure: 'straight' })
  }

  // Blocks never reorder the session beyond pulling a partner forward.
  blocks.sort((a, b) => a.indices[0] - b.indices[0])
  return blocks
}

// ---- time model ------------------------------------------------------------

export interface TimeParams {
  workSeconds: number
  restSeconds: number
  transitionSeconds: number
  restMultiplier: number
  warmupMinutes: number
}

export function timeParams(data: StructureData, goal: string, structure: Structure, restSeconds: number, warmupMinutes: number): TimeParams {
  return {
    workSeconds: data.workSeconds[goal] ?? 40,
    restSeconds,
    transitionSeconds: data.transitionSeconds,
    restMultiplier: data.restMultiplier[structure] ?? 1,
    warmupMinutes,
  }
}

/**
 *   S = sum of the members' set counts
 *   R = max of the members' set counts        // the number of ROUNDS
 *   block_seconds = work x S + (S - R) x transition + R x rest x restMultiplier
 *
 * Rest is taken once per ROUND, and there are R rounds. A transition happens only where a
 * round holds more than one member, which is exactly S - R times.
 *
 * The members of a block usually do NOT share a set count — Stage 1 solves sets per muscle
 * group, so a 3-set row genuinely pairs with a 2-set curl. The earlier form charged
 * `sets x (size x work + …)` with `sets` as the max, which invented work for the short
 * member: a 3+2 Build Muscle superset at 75 s rest came out at 540 s against a true 480 s,
 * a 12% overstatement. Straight sets are identical under both: S = R, so a single 3-set
 * exercise is 45x3 + 0 + 3x75 = 360 s either way.
 */
export function blockSeconds(block: Block, setsFor: (i: number) => number, p: TimeParams): number {
  const counts = block.indices.map(setsFor)
  const S = counts.reduce((a, b) => a + b, 0)
  const R = Math.max(...counts)
  // A single-exercise block takes no multiplier, whatever the program-level figure is. Above
  // that the block's own multiplier wins; `p.restMultiplier` is only a fallback for callers
  // that have not resolved it.
  const restMultiplier =
    block.indices.length === 1 ? 1 : (block.restMultiplier ?? p.restMultiplier)
  return p.workSeconds * S + (S - R) * p.transitionSeconds + R * p.restSeconds * restMultiplier
}

export function sessionMinutes(blocks: Block[], setsFor: (i: number) => number, p: TimeParams): number {
  const seconds = blocks.reduce((s, b) => s + blockSeconds(b, setsFor, p), 0)
  return seconds / 60 + p.warmupMinutes
}
