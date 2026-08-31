import type { Exercise } from '../types'

/**
 * Where the abs work sits in the session.
 *
 * Same exercises, same sets, same total time either way — only the order changes. This layer
 * is a reorder and nothing else: it never adds, removes or re-sets a slot, so weekly volume
 * cannot move through it.
 */
export type AbsPlacement = 'end' | 'integrated'

export const ABS_PLACEMENTS: AbsPlacement[] = ['end', 'integrated']

/** The muscle group as exercises.json spells it. Matched exactly, never inferred from a name. */
export const ABS_GROUP = 'Abs & core'

export const ABS_PLACEMENT_LABEL: Record<AbsPlacement, string> = {
  end: 'End block',
  integrated: 'Integrated',
}

export const ABS_PLACEMENT_BLURB: Record<AbsPlacement, string> = {
  end: 'All the abs work together at the end, under one heading.',
  integrated: 'Spread through the session, paired with other work. Denser.',
}

export const isAbs = (ex: Exercise) => ex.group === ABS_GROUP

/**
 * The canonical order the blocks are formed from: abs last, everything else untouched.
 *
 * Block formation is greedy over the list, so the order it runs on decides which pairs form —
 * and if that order changed with the placement, the two placements would produce different
 * blocks and therefore different session lengths. Forming from one fixed order and placing
 * the finished BLOCKS is what makes "same total time either way" true rather than nearly true.
 */
export function absLastOrder(count: number, isAbsAt: (i: number) => boolean): number[] {
  const rest: number[] = []
  const abs: number[] = []
  for (let i = 0; i < count; i++) (isAbsAt(i) ? abs : rest).push(i)
  return [...rest, ...abs]
}

/**
 * Where each finished block goes. A block counts as abs work if any member is.
 *
 * `end` gathers them at the finish, under one heading; `integrated` deals them through the
 * session. The one hard rule on the integrated side: **no abs block is ever placed before the
 * main lift**. A fatigued trunk under a heavy squat or a deadlift is a real risk, not a
 * preference, so dealing starts after the block holding the last main lift.
 */
export function orderAbsBlocks(
  blocks: { indices: number[] }[],
  isAbsAt: (i: number) => boolean,
  isMainAt: (i: number) => boolean,
  placement: AbsPlacement,
): number[] {
  const absBlocks: number[] = []
  const rest: number[] = []
  blocks.forEach((b, bi) => (b.indices.some(isAbsAt) ? absBlocks : rest).push(bi))
  if (absBlocks.length === 0 || rest.length === 0) return blocks.map((_, bi) => bi)
  if (placement === 'end') return [...rest, ...absBlocks]

  const lastMain = rest.map((bi) => blocks[bi].indices.some(isMainAt)).lastIndexOf(true)
  const head = rest.slice(0, lastMain + 1)
  const tail = rest.slice(lastMain + 1)

  const out = [...head]
  const gap = (tail.length + 1) / (absBlocks.length + 1)
  let placed = 0
  for (let i = 0; i <= tail.length; i++) {
    while (placed < absBlocks.length && (placed + 1) * gap <= i + 0.5) out.push(absBlocks[placed++])
    if (i < tail.length) out.push(tail[i])
  }
  while (placed < absBlocks.length) out.push(absBlocks[placed++])
  return out
}

/**
 * Reorder one session's picks for the chosen placement.
 *
 * `order` is the session order everything above this layer has already settled — corrective
 * work first, then main lifts on Get Stronger — and both placements preserve it among the
 * non-abs picks. Only where the abs go changes.
 *
 * The one hard rule on the integrated side: **an abs exercise is never placed before the main
 * lift**. A fatigued trunk under a heavy squat or a deadlift is a real risk, not a preference,
 * so integration starts after the last main lift in the session rather than from the top.
 */
export function placeAbs<T>(
  items: T[],
  placement: AbsPlacement,
  exerciseOf: (item: T) => Exercise,
): T[] {
  const abs = items.filter((i) => isAbs(exerciseOf(i)))
  if (abs.length === 0 || abs.length === items.length) return [...items]
  const rest = items.filter((i) => !isAbs(exerciseOf(i)))

  if (placement === 'end') return [...rest, ...abs]

  // Everything up to and including the last main lift is untouchable; abs are dealt into
  // what follows. With no main lift the whole session is available.
  const lastMain = rest.map((i) => exerciseOf(i).mainLift).lastIndexOf(true)
  const head = rest.slice(0, lastMain + 1)
  const tail = rest.slice(lastMain + 1)

  // Deal the abs evenly through the tail rather than clumping them at one end — the point of
  // integrating is that the trunk work sits between other work, not that it moved.
  const out: T[] = [...head]
  const gap = (tail.length + 1) / (abs.length + 1)
  let placed = 0
  for (let i = 0; i <= tail.length; i++) {
    while (placed < abs.length && (placed + 1) * gap <= i + 0.5) out.push(abs[placed++])
    if (i < tail.length) out.push(tail[i])
  }
  while (placed < abs.length) out.push(abs[placed++])
  return out
}

/**
 * Three of the twelve new abs entries are the same physical movement as one already filed
 * under another muscle group — Farmer's walk against Farmer's carry, and the two overhead
 * carries against Waiter's walk.
 *
 * They stay separate entries with their own ids and their own primary sub-region, because
 * each filing is a real claim: a farmer's walk genuinely loads the traps AND genuinely
 * resists lateral flexion, and merging them would lose one of the two. What must not happen
 * is the **indirect-volume model counting both** — each names the other's primary sub-region
 * in `alsoTrains`, so a week holding both credits the same carry twice, once directly and
 * once as a synergist.
 *
 * Named here rather than derived, because "each names the other's sub-region" is true of 234
 * pairs in this library — a squat and a lunge do genuinely credit each other — and a rule
 * that broad would gut the synergist model to fix three rows.
 */
export const DUPLICATE_MOVEMENTS: readonly (readonly [string, string])[] = [
  ["Farmer's walk", "Farmer's carry"],
  ['Overhead dumbbell carry', "Waiter's walk / overhead carry"],
  ['Single-arm overhead carry', "Waiter's walk / overhead carry"],
]

/** id -> the ids naming the same movement. Empty for anything the list does not mention. */
export function duplicateMovements(library: Exercise[]): Map<number, number[]> {
  const byName = new Map(library.map((e) => [e.name, e]))
  const out = new Map<number, number[]>()
  const link = (a: number, b: number) => out.set(a, [...(out.get(a) ?? []), b])
  for (const [a, b] of DUPLICATE_MOVEMENTS) {
    const x = byName.get(a)
    const y = byName.get(b)
    // A rename upstream leaves the pair unlinked rather than silently matching the wrong row;
    // the acceptance suite asserts every name here still resolves.
    if (!x || !y) continue
    link(x.id, y.id)
    link(y.id, x.id)
  }
  return out
}
