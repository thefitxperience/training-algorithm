import type { Exercise, LoadData, LoadExercise, ValdData } from '../types'
import { equipmentOptions } from './equipment'
import type { ResolvedReading, WeakSide } from './vald'

export type LoadClass = 'COMPOUND' | 'ISO_STABLE' | 'ISO_FREE' | 'BODYWEIGHT' | 'ISOMETRIC_CARRY'
export type LoadTier = 'MATCHED' | 'DERIVED' | 'BRIDGED' | 'NONE'

export interface Range {
  low: number
  high: number
}

export interface SidedRange extends Range {
  flattened?: boolean
  side: WeakSide
}

export interface LoadPrescription {
  tier: LoadTier
  tierLabel: string
  /** null whenever no number should be produced — always with a `reason` */
  range: Range | null
  /** one entry per side on a unilateral exercise, where both limbs were tested */
  sides: SidedRange[]
  perHand: boolean
  unilateral: boolean
  /** a CAUTION verdict caps the prescription at the bottom; the range is not shown */
  capped: boolean
  /** the beginner cut pushed the top of a MATCHED band below its bottom — see bandRange */
  flattened: boolean
  /** why there is no number — "not estimated" is a designed state, not a failure */
  reason?: string
  /** what to prescribe instead, when there is no number */
  insteadOf?: 'age' | 'bodyweight' | 'carry' | 'unreachable'
  /** the test the reference came from */
  sourceTest?: string
  /** set on a BRIDGED estimate */
  bridgedFrom?: string
  bridgeRatio?: number
  bridgeQuality?: string
}

/** the per-sub-region reference weight, kept per limb throughout */
export interface Reference {
  code: string
  test: string
  left: number | null
  right: number | null
}

export interface LoadResult {
  active: boolean
  references: Reference[]
  /** keyed by exercise id, for every exercise in the program */
  byExercise: Map<number, LoadPrescription>
  /** no number anywhere, whatever the tier */
  suppressedByAge: boolean
  /** anchors named in the file whose exercise carries no isAnchor flag */
  anchorGaps: { code: string; named: string }[]
  counts: Record<LoadTier, number>
}

export const INERT_LOAD: LoadResult = {
  active: false,
  references: [],
  byExercise: new Map(),
  suppressedByAge: false,
  anchorGaps: [],
  counts: { MATCHED: 0, DERIVED: 0, BRIDGED: 0, NONE: 0 },
}

/**
 * The one field load.json does NOT ship pre-resolved. The 0.85 cap is about stabilisation
 * demand, so it applies where the lifter carries the load rather than a frame guiding it —
 * an exercise qualifies if any of its equipment options is a free weight. Smith is guided
 * and is not on this list, but "BB / Smith" still qualifies through the barbell.
 */
const FREE_WEIGHT_TOKENS = new Set([
  'BB',
  'DB',
  'KB',
  'EZ',
  'plate',
  'trap bar',
  'weighted',
  'DB between feet',
  'DB on knees',
])

export function isFreeWeight(ex: Exercise): boolean {
  return equipmentOptions(ex).some((t) => FREE_WEIGHT_TOKENS.has(t))
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

/** Step 1 — newtons to kilograms of reference load, per limb, per test. */
export function referenceKg(newtons: number, k: number, gravity: number): number {
  return (newtons / gravity) * k
}

/**
 * Builds the per-sub-region reference table. Joined on the sub-region CODE, which both
 * vald.json and load.json carry and which matches exactly — the test NAMES differ by a
 * " Strength Asymmetry" suffix, and a suffix strip is the kind of fuzzy join this codebase
 * avoids everywhere else.
 */
export function buildReferences(
  readings: ResolvedReading[],
  data: LoadData,
  vald: ValdData,
): Reference[] {
  const codeToTest = new Map<string, string>()
  for (const [test, code] of Object.entries(data.testSubRegion)) codeToTest.set(code, test)

  const out: Reference[] = []
  for (const r of readings) {
    // a blocked finding is blocked for this layer too: the sides cannot be trusted
    if (r.conflict) continue
    if (r.leftN === null && r.rightN === null) continue
    if (!vald.tests.some((t) => t.code === r.code)) continue
    const test = codeToTest.get(r.code)
    if (!test) continue
    const k = data.k[test]
    if (typeof k !== 'number') continue
    out.push({
      code: r.code,
      test,
      left: r.leftN === null ? null : referenceKg(r.leftN, k, data.gravity),
      right: r.rightN === null ? null : referenceKg(r.rightN, k, data.gravity),
    })
  }
  return out
}

interface Resolved {
  tier: LoadTier
  left: number | null
  right: number | null
  sourceTest?: string
  bridgedFrom?: string
  bridgeRatio?: number
  bridgeQuality?: string
}

/**
 * Step 2 — which reference does this exercise get, and how confident is it?
 * `isAnchor` decides MATCHED vs DERIVED; it is authoritative and is never re-derived from
 * the `anchors` name map (see `anchorGaps` for where the two disagree).
 */
export function resolveReference(
  rec: LoadExercise,
  refs: Map<string, Reference>,
  data: LoadData,
): Resolved {
  const direct = refs.get(rec.code)
  if (direct) {
    return {
      tier: rec.isAnchor ? 'MATCHED' : 'DERIVED',
      left: direct.left,
      right: direct.right,
      sourceTest: direct.test,
    }
  }

  const bridge = data.bridges[rec.code]
  if (bridge && bridge.borrowsFrom && bridge.ratio !== null) {
    const from = refs.get(bridge.borrowsFrom)
    if (from) {
      return {
        tier: 'BRIDGED',
        left: from.left === null ? null : from.left * bridge.ratio,
        right: from.right === null ? null : from.right * bridge.ratio,
        sourceTest: from.test,
        bridgedFrom: bridge.borrowsFrom,
        bridgeRatio: bridge.ratio,
        bridgeQuality: bridge.quality,
      }
    }
  }

  return { tier: 'NONE', left: null, right: null }
}

/** Step 3 — reference x class x modifier x laterality x correction factor. */
export function applyChain(
  referenceValue: number,
  rec: LoadExercise,
  data: LoadData,
  freeWeight: boolean,
): number {
  let kg = referenceValue * (data.classRatio[rec.class] ?? 0) * rec.modifier
  if (!rec.unilateral) {
    kg *= data.lateralityBilateral
    if (rec.class === 'COMPOUND' && freeWeight) kg *= data.compoundFreeWeightCap
  }
  return kg * (rec.correctionFactor ?? data.correctionFactorDefault)
}

/**
 * Step 4-5 — band by tier, cut the TOP only for a beginner, halve for a per-hand exercise,
 * then round. The order matters: the worked example's Tate press lands on 12.5-20.0 kg only
 * if the halving happens before the rounding.
 *
 * The beginner cut can invert a MATCHED band. That tier is +/-10%, so cutting the top by 20%
 * puts it at 0.88x against a bottom of 0.90x — the rule as written says the whole estimate is
 * above what a beginner should attempt. The bottom is left exactly where it was, as specified,
 * and the top is held at the bottom rather than displayed backwards; `flattened` records that
 * it bound. Only the 14 anchor exercises can hit this, and only for beginners.
 */
export function bandRange(
  kg: number,
  tier: LoadTier,
  data: LoadData,
  opts: { beginner: boolean; perHand: boolean },
): Range & { flattened: boolean } {
  const width = data.tierBand[tier] ?? 0
  let low = kg * (1 - width)
  let high = kg * (1 + width)
  if (opts.beginner) high *= data.beginnerTopCap
  if (opts.perHand) {
    low /= 2
    high /= 2
  }
  // The inversion is a property of the arithmetic, not of the rounding — on a MATCHED band
  // the two ends can round to the same step and still have crossed, so the flag is taken
  // before rounding while the clamp is applied after it.
  const inverted = high < low
  const rLow = roundTo(low, data.roundToKg)
  const rHigh = roundTo(high, data.roundToKg)
  return { low: rLow, high: Math.max(rLow, rHigh), flattened: inverted }
}

export interface LoadContext {
  ageBracket: string
  level: string
  library: Exercise[]
  /** injury verdict per exercise id — CAUTION caps, REMOVE/SIDE_ONLY need nothing here */
  verdictOf: (id: number) => string
  vald: ValdData
}

const NO_NUMBER: Partial<Record<LoadClass, { kind: 'bodyweight' | 'carry'; reason: string }>> = {
  BODYWEIGHT: {
    kind: 'bodyweight',
    reason: 'bodyweight movement — prescribe reps and reps-in-reserve, not a weight',
  },
  ISOMETRIC_CARRY: { kind: 'carry', reason: 'carry or hold — prescribe time, not a weight' },
}

export function evaluateLoad(
  readings: ResolvedReading[],
  data: LoadData,
  ctx: LoadContext,
): LoadResult {
  const references = buildReferences(readings, data, ctx.vald)
  if (references.length === 0) return INERT_LOAD

  const refs = new Map(references.map((r) => [r.code, r]))
  const byLibraryId = new Map(ctx.library.map((e) => [e.id, e]))
  const suppressedByAge = data.noLoadAges.includes(ctx.ageBracket)
  const beginner = ctx.level === 'Beginner'

  const byExercise = new Map<number, LoadPrescription>()
  const counts: Record<LoadTier, number> = { MATCHED: 0, DERIVED: 0, BRIDGED: 0, NONE: 0 }

  for (const rec of data.exercises) {
    const ex = byLibraryId.get(rec.id)
    if (!ex) continue
    const resolved = resolveReference(rec, refs, data)
    const base: LoadPrescription = {
      tier: resolved.tier,
      tierLabel: data.tierLabel[resolved.tier] ?? resolved.tier,
      range: null,
      sides: [],
      perHand: rec.perHand,
      unilateral: rec.unilateral,
      capped: false,
      flattened: false,
      sourceTest: resolved.sourceTest,
      bridgedFrom: resolved.bridgedFrom,
      bridgeRatio: resolved.bridgeRatio,
      bridgeQuality: resolved.bridgeQuality,
    }

    // The three ways this layer refuses to produce a number, in precedence order.
    if (suppressedByAge) {
      byExercise.set(rec.id, {
        ...base,
        reason: `no external load is prescribed at age ${ctx.ageBracket}, at any confidence tier`,
        insteadOf: 'age',
      })
      counts[resolved.tier]++
      continue
    }
    const noNumber = NO_NUMBER[rec.class as LoadClass]
    if (noNumber) {
      byExercise.set(rec.id, { ...base, reason: noNumber.reason, insteadOf: noNumber.kind })
      counts[resolved.tier]++
      continue
    }
    if (resolved.tier === 'NONE' || (resolved.left === null && resolved.right === null)) {
      byExercise.set(rec.id, {
        ...base,
        tier: 'NONE',
        tierLabel: data.tierLabel.NONE ?? 'Not estimated',
        reason: 'no tested sub-region reaches this exercise, directly or by bridge',
        insteadOf: 'unreachable',
      })
      counts.NONE++
      continue
    }

    const freeWeight = isFreeWeight(ex)
    const toRange = (referenceValue: number) =>
      bandRange(applyChain(referenceValue, rec, data, freeWeight), resolved.tier, data, {
        beginner,
        perHand: rec.perHand,
      })

    // Step 6 — a unilateral exercise gets a load per limb; a bilateral one takes the
    // weaker limb's reading, so the prescription is never heavier than the weak side.
    const sides: SidedRange[] = []
    let range: Range
    let flattened: boolean
    if (rec.unilateral) {
      if (resolved.left !== null) sides.push({ side: 'Left', ...toRange(resolved.left) })
      if (resolved.right !== null) sides.push({ side: 'Right', ...toRange(resolved.right) })
      // the envelope across both limbs; `sides` carries the per-limb answer
      range = {
        low: Math.min(...sides.map((s) => s.low)),
        high: Math.max(...sides.map((s) => s.high)),
      }
      flattened = sides.some((s) => s.flattened)
    } else {
      const weaker = Math.min(
        ...[resolved.left, resolved.right].filter((v): v is number => v !== null),
      )
      const banded = toRange(weaker)
      range = { low: banded.low, high: banded.high }
      flattened = banded.flattened
    }

    // Injury outranks this layer: a CAUTION verdict is prescribed at the bottom of the
    // range only, and the range itself is not shown.
    const capped = ctx.verdictOf(rec.id) === 'CAUTION'

    byExercise.set(rec.id, { ...base, range, sides: capped ? [] : sides, capped, flattened })
    counts[resolved.tier]++
  }

  // Where the file names an anchor but no exercise in that sub-region carries the flag,
  // nothing there can ever be MATCHED. Reported rather than patched — isAnchor is the
  // authoritative field and the instruction is not to re-derive it.
  const anchorGaps: LoadResult['anchorGaps'] = []
  for (const [code, named] of Object.entries(data.anchors)) {
    if (!data.exercises.some((e) => e.code === code && e.isAnchor))
      anchorGaps.push({ code, named })
  }

  return { active: true, references, byExercise, suppressedByAge, anchorGaps, counts }
}
