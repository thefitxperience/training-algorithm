import type { AmendData, AllocationBlock, Exercise, Slot } from '../types'
import { isTokenAvailable, equipmentOptions, type EquipmentTier } from './equipment'
import type { Verdict } from './injury'

export type AmendType = 'A' | 'B' | 'C'
export type Badge = 'RECOMMENDED' | 'AVAILABLE' | 'ADAPTED'
export type BlockKind = 'injury' | 'age' | 'mainSlot' | 'corrective'

/**
 * A slot's identity has to survive a re-run, because an amend is a pin and the generator is
 * re-run holding it. Keyed on the allocation's own structure rather than on a position in the
 * output: the session is re-sorted after selection, so an output index would drift.
 *
 * No day repeats a sub-region in any of the 2,205 allocation blocks, so `sub` is unique
 * within a day — which makes this both stable and readable, and leaves it unaffected by a
 * reordering of the slots inside a day.
 */
export interface SlotRef {
  dayIndex: number
  sub: string
  /** which of the slot's `count` exercises this is */
  n: number
}

export const slotId = (s: SlotRef) => `${s.dayIndex}|${s.sub}|${s.n}`

export function parseSlotId(id: string): SlotRef | null {
  const parts = id.split('|')
  if (parts.length !== 3) return null
  const dayIndex = Number(parts[0])
  const n = Number(parts[2])
  if (!Number.isInteger(dayIndex) || !Number.isInteger(n)) return null
  return { dayIndex, sub: parts[1], n }
}

export interface Pin {
  slotId: string
  /** the exercise that was in the slot when the amend was made */
  from: number
  to: number
  /** the chosen equipment token — a type A amend changes this and nothing else */
  equipment?: string
  actor: string
  timestamp: string
  /** type C does not apply until this is true */
  accepted?: boolean
}

export interface Blocked {
  kind: BlockKind
  reason: string
}

export interface Candidate {
  exercise: Exercise
  type: AmendType
  badge: Badge
  /** set on a type A candidate — the same exercise, a different equipment token */
  equipment?: string
  blocked: Blocked | null
  /** every recompute this amend triggers, from the data file */
  recomputes: string[]
  requiresAcceptance: boolean
}

export interface Shortlist {
  slot: SlotRef
  from: Exercise
  /** a slot whose current exercise carries the main-lift flag */
  mainSlot: boolean
  candidates: Candidate[]
  /** how many same-sub-region options are usable — 0 is what triggers the widen */
  sameSubAvailable: number
  sameSubBlocked: number
  /** the same-sub-region list had nothing usable, so siblings were pulled in */
  widened: boolean
  /** nothing is available anywhere, stated in full rather than shown as a blank list */
  emptyReason?: string
}

export interface DriftRow {
  code: string
  sub: string
  target: number
  delivered: number
  /** signed fraction off target */
  pct: number
}

export interface RetiredPin {
  pin: Pin
  reason: string
}

export interface AmendResult {
  active: boolean
  applied: Pin[]
  /** pins held back because a type C has not been accepted yet */
  pending: Pin[]
  retired: RetiredPin[]
  drift: DriftRow[]
  driftTolerance: number
}

export const INERT_AMEND: AmendResult = {
  active: false,
  applied: [],
  pending: [],
  retired: [],
  drift: [],
  driftTolerance: 0,
}

export function hasAnyPin(pins: Pin[]): boolean {
  return Array.isArray(pins) && pins.length > 0
}

/** Detected from the two exercises, never chosen by the caller. */
export function amendType(from: Exercise, to: Exercise, equipment?: string): AmendType {
  if (from.id === to.id && equipment) return 'A'
  return to.code === from.code ? 'B' : 'C'
}

export interface AmendContext {
  data: AmendData
  library: Exercise[]
  ageBracket: string
  equipment: EquipmentTier
  verdictOf: (id: number) => Verdict
  /** BodyDot corrective slots are prescribed by the screening, so they are not amendable */
  corrective?: boolean
}

/**
 * The four blocks, in the precedence the data file states. Injury is the only hard refusal in
 * spirit as well as in code: everything else in this layer is allowed and merely badged, the
 * same way a split is never refused.
 *
 * SIDE_ONLY blocks alongside REMOVE. The main program keeps a side-only exercise and badges
 * it, but deliberately *choosing* one as a replacement is a different act — and it is what
 * makes a shoulder-pain lateral raise shortlist come back with nothing available.
 */
export function blockFor(ex: Exercise, ctx: AmendContext, mainSlot: boolean): Blocked | null {
  if (ctx.corrective)
    return {
      kind: 'corrective',
      reason: 'corrective work is prescribed by your posture screening, not chosen',
    }

  const verdict = ctx.verdictOf(ex.id)
  if (verdict === 'REMOVE')
    return { kind: 'injury', reason: 'ruled out by a pain you reported' }
  if (verdict === 'SIDE_ONLY')
    return {
      kind: 'injury',
      reason: 'a pain you reported restricts this to one side only, so it is not offered as a swap',
    }

  if (ex.avoidAges.includes(ctx.ageBracket))
    return { kind: 'age', reason: `not appropriate at age ${ctx.ageBracket}` }

  // Correction to the source spec: this reads the LIBRARY's movement type, not the Load
  // layer's mechanical class. The two disagree on push-up — the library calls it compound,
  // the Load layer calls it BODYWEIGHT — and the spec's own worked example needs the library
  // reading. It has to be one field, not two.
  if (mainSlot && !ctx.data.mainSlotAllowed.some((a) => a.toLowerCase() === ex.type))
    return {
      kind: 'mainSlot',
      reason: `a main lift slot needs a compound movement, and this is ${ex.type}`,
    }

  return null
}

function badgeFor(type: AmendType, from: Exercise, to: Exercise, mainSlot: boolean): Badge {
  if (type === 'C') return 'ADAPTED'
  const sameMovement = to.type === from.type
  if (!sameMovement) return 'AVAILABLE'
  // On a main slot, RECOMMENDED additionally requires the main-lift flag.
  if (mainSlot && !to.mainLift) return 'AVAILABLE'
  return 'RECOMMENDED'
}

const TYPE_ORDER: Record<AmendType, number> = { A: 0, B: 1, C: 2 }

/** The seven ranking rules from the data file, in order. Fully deterministic. */
function rank(a: Candidate, b: Candidate, from: Exercise, mainSlot: boolean): number {
  const blocked = Number(a.blocked !== null) - Number(b.blocked !== null)
  if (blocked !== 0) return blocked

  const type = TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  if (type !== 0) return type

  if (mainSlot) {
    const main = Number(b.exercise.mainLift) - Number(a.exercise.mainLift)
    if (main !== 0) return main
  }

  const movement = Number(a.exercise.type !== from.type) - Number(b.exercise.type !== from.type)
  if (movement !== 0) return movement

  const tokens = new Set(equipmentOptions(from))
  const shares = (e: Exercise) => equipmentOptions(e).some((t) => tokens.has(t))
  const equip = Number(!shares(a.exercise)) - Number(!shares(b.exercise))
  if (equip !== 0) return equip

  const load = Math.abs(a.exercise.load - from.load) - Math.abs(b.exercise.load - from.load)
  if (load !== 0) return load

  return a.exercise.id - b.exercise.id
}

/**
 * The shortlist for one slot. Free search over 315 exercises is what produces the accidental
 * all-chest program, so this stays inside the sub-region, widens only when it has to, and is
 * capped.
 */
export function buildShortlist(
  slot: SlotRef,
  from: Exercise,
  ctx: AmendContext,
  currentEquipment?: string,
): Shortlist {
  const mainSlot = from.mainLift
  const { data } = ctx

  const make = (to: Exercise, type: AmendType, equipment?: string): Candidate => {
    const spec = data.types[type]
    return {
      exercise: to,
      type,
      badge: badgeFor(type, from, to, mainSlot),
      equipment,
      blocked: blockFor(to, ctx, mainSlot),
      recomputes: spec?.recomputes ?? [],
      requiresAcceptance: spec?.requiresAcceptance ?? false,
    }
  }

  // Availability is not a safety rule, so it is not one of the four blocks — but offering a
  // barbell to a client with no barbell is noise, not choice, so it is filtered out.
  const usable = (e: Exercise) =>
    equipmentOptions(e).some((t) => isTokenAvailable(t, ctx.equipment))

  // Type A — the same exercise on a different implement. Cheapest possible amend: nothing
  // downstream moves except the load.
  const typeA: Candidate[] = equipmentOptions(from)
    .filter((t) => t !== currentEquipment && isTokenAvailable(t, ctx.equipment))
    .map((t) => make(from, 'A', t))

  const sameSub = ctx.library
    .filter((e) => e.code === from.code && e.id !== from.id && usable(e))
    .map((e) => make(e, 'B'))

  const candidates = [...typeA, ...sameSub]
  const sameSubAvailable = candidates.filter((c) => !c.blocked).length
  const sameSubBlocked = candidates.filter((c) => c.blocked).length

  // Sibling sub-regions in the same muscle group are always offered, ranked below the
  // same-sub-region options — ranking rule 2 ("type B before type C") only means anything if
  // both are in one list, and the spec's own leg-press-to-leg-curl example is a type C on a
  // sub-region that is not empty. `widened` marks the case the data file cares about: the
  // same-sub-region list had nothing available, so the siblings are all that is left.
  // The list of siblings mirrors the injury layer's reroute table and the generator's own
  // fallback cascade, so this is not new machinery.
  const siblings = data.siblingSubRegions[from.code] ?? []
  if (data.widenOnEmpty || sameSubAvailable > 0)
    candidates.push(
      ...ctx.library.filter((e) => siblings.includes(e.code) && usable(e)).map((e) => make(e, 'C')),
    )
  const widened = sameSubAvailable === 0 && candidates.some((c) => c.type === 'C' && !c.blocked)

  candidates.sort((a, b) => rank(a, b, from, mainSlot))

  // The cap exists to stop a free search over 315 exercises producing the accidental
  // all-chest program, so it bounds the EXERCISE swaps. Two things stay outside it:
  //   - type A entries are the same exercise on a different implement, bounded already by
  //     that exercise's own equipment list, and nothing downstream moves except the load.
  //     Counting them would let four tokens crowd out half the real alternatives.
  //   - blocked entries are the explanation for a short list, not choices in it. Truncating
  //     them away leaves the client staring at three options with no reason given.
  //
  // The cap is applied PER GROUP rather than to the union. A single union cap sounds closer
  // to the wording, but Q-KD alone has more than eight same-sub-region options, so type C
  // would never survive it — and the spec's own worked example (leg press to lying leg curl)
  // is a type C on a sub-region that is nowhere near empty. Capping each group keeps every
  // route reachable while still bounding the list, which is what the cap is for.
  const take = (want: (c: Candidate) => boolean) => candidates.filter(want)
  const capped = [
    ...take((c) => !c.blocked && c.type === 'A'),
    ...take((c) => !c.blocked && c.type === 'B').slice(0, data.shortlistMax),
    ...take((c) => !c.blocked && c.type === 'C').slice(0, data.shortlistMax),
    ...take((c) => c.blocked !== null).slice(0, data.shortlistMax),
  ]

  let emptyReason: string | undefined
  if (!capped.some((c) => !c.blocked)) {
    emptyReason =
      siblings.length === 0
        ? `No alternatives available for this exercise — nothing else in the library trains ${from.sub}.`
        : `No alternatives available for this exercise — everything that trains ${from.group} through ${from.sub} or a neighbouring sub-region is excluded for you.`
  }

  return {
    slot,
    from,
    mainSlot,
    candidates: capped,
    sameSubAvailable,
    sameSubBlocked,
    widened,
    emptyReason,
  }
}

// ---- drift -----------------------------------------------------------------

/**
 * Planned sets per sub-region, straight off the allocation's own slots. `targets` in the
 * allocation block is per muscle GROUP, which is too coarse to catch a leg-press-to-leg-curl
 * swap — that moves two sub-regions inside one group and leaves the group total untouched.
 */
export function subRegionTargets(block: AllocationBlock): Map<string, number> {
  const out = new Map<string, number>()
  for (const day of block.days) {
    for (const slot of day.slots as Slot[]) {
      const [sub, count, setsPerExercise] = slot
      out.set(sub, (out.get(sub) ?? 0) + count * setsPerExercise)
    }
  }
  return out
}

export function driftRows(
  block: AllocationBlock,
  delivered: { sub: string; code: string; sets: number }[],
  tolerance: number,
): DriftRow[] {
  const targets = subRegionTargets(block)
  const bySub = new Map<string, { code: string; sets: number }>()
  for (const d of delivered) {
    const row = bySub.get(d.sub) ?? { code: d.code, sets: 0 }
    row.sets += d.sets
    bySub.set(d.sub, row)
  }

  const rows: DriftRow[] = []
  for (const [sub, target] of targets) {
    const got = bySub.get(sub)
    const sets = got?.sets ?? 0
    if (target <= 0) continue
    const pct = (sets - target) / target
    if (Math.abs(pct) > tolerance)
      rows.push({ code: got?.code ?? '', sub, target, delivered: sets, pct })
  }
  // Anything the amend pushed volume INTO that the plan never asked for.
  for (const [sub, row] of bySub) {
    if (targets.has(sub) || row.sets === 0) continue
    rows.push({ code: row.code, sub, target: 0, delivered: row.sets, pct: Infinity })
  }
  return rows.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
}
