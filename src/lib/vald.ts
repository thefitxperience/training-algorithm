import type { Exercise, ValdData, ValdTest } from '../types'

export type WeakSide = 'Left' | 'Right'

/**
 * Four independent optional fields. The API supplies the percentage and the raw forces
 * separately, so one is never derived from the other while both are present — the machine's
 * own figure wins. Newtons feed the Load layer; the percentage and side feed this one.
 */
export interface ValdReading {
  asymmetry?: number
  weakSide?: WeakSide
  /** peak force, left limb */
  leftN?: number
  /** peak force, right limb */
  rightN?: number
}

/** keyed by test code — the side is stored PER TEST, never per client */
export type ValdInput = Record<string, ValdReading>

export type ReadingSource = 'entered' | 'derived'

export interface ResolvedReading {
  code: string
  asymmetry: number | null
  weakSide: WeakSide | null
  asymmetrySource: ReadingSource | null
  weakSideSource: ReadingSource | null
  leftN: number | null
  rightN: number | null
  /** entered % vs the % the forces imply — a quiet flag; the entered figure still wins */
  mismatch: { entered: number; fromNewtons: number; delta: number } | null
  /** the entered weak side contradicts the forces — this finding is BLOCKED, not warned */
  conflict: { enteredSide: WeakSide; forcesSay: WeakSide; leftN: number; rightN: number } | null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && !Number.isNaN(v) ? v : null

/** (stronger - weaker) / stronger x 100 */
export function asymmetryFromNewtons(leftN: number, rightN: number): number {
  const stronger = Math.max(leftN, rightN)
  const weaker = Math.min(leftN, rightN)
  if (stronger <= 0) return 0
  return ((stronger - weaker) / stronger) * 100
}

/** how far the entered percentage may sit from the forces before it is flagged */
export const MISMATCH_TOLERANCE_PP = 1

/**
 * Reconciles the four fields for one test.
 *
 * Two contradictions, handled differently on purpose. A percentage that disagrees with the
 * forces is a rounding artefact most of the time, so it is flagged and the entered figure is
 * kept. A weak SIDE that disagrees is not recoverable: acting on it would send the extra
 * sets to the wrong limb and prescribe each side the wrong weight, and nothing downstream
 * would catch either. That one blocks the finding until a human resolves it.
 */
export function resolveReading(code: string, raw: ValdReading | undefined): ResolvedReading {
  const leftN = num(raw?.leftN)
  const rightN = num(raw?.rightN)
  const enteredPct = num(raw?.asymmetry)
  const enteredSide = raw?.weakSide ?? null
  const bothForces = leftN !== null && rightN !== null

  const forcesPct = bothForces ? asymmetryFromNewtons(leftN, rightN) : null
  const forcesSide: WeakSide | null = bothForces
    ? leftN === rightN
      ? null
      : leftN < rightN
        ? 'Left'
        : 'Right'
    : null

  let mismatch: ResolvedReading['mismatch'] = null
  if (enteredPct !== null && forcesPct !== null) {
    const delta = Math.abs(enteredPct - forcesPct)
    if (delta > MISMATCH_TOLERANCE_PP)
      mismatch = { entered: enteredPct, fromNewtons: forcesPct, delta }
  }

  let conflict: ResolvedReading['conflict'] = null
  if (enteredSide && forcesSide && enteredSide !== forcesSide)
    conflict = { enteredSide, forcesSay: forcesSide, leftN: leftN!, rightN: rightN! }

  return {
    code,
    asymmetry: enteredPct ?? forcesPct,
    weakSide: enteredSide ?? forcesSide,
    asymmetrySource: enteredPct !== null ? 'entered' : forcesPct !== null ? 'derived' : null,
    weakSideSource: enteredSide ? 'entered' : forcesSide ? 'derived' : null,
    leftN,
    rightN,
    mismatch,
    conflict,
  }
}

export function resolveAll(input: ValdInput): ResolvedReading[] {
  if (!input) return []
  return Object.keys(input).map((code) => resolveReading(code, input[code]))
}

export interface Bracket {
  name: string
  min: number
  max: number | null
  setsAdded: number
}

export interface Finding {
  code: string
  test: ValdTest
  asymmetry: number
  weakSide: WeakSide
  bracket: Bracket
  setsAdded: number
  /** at or above referralThreshold: escalates by referral, not by more volume */
  referral: boolean
}

export type UnilateralForm = 'already' | 'swapped' | 'converted'

export interface Bump {
  dayIndex: number
  slotIndex: number
  code: string
  weakSide: WeakSide
  extraSets: number
  form: UnilateralForm
  /** set when a swap replaced the exercise */
  swappedFrom?: string
}

export interface UnfilledFinding {
  finding: Finding
  owed: number
  reason: string
}

export interface ValdResult {
  active: boolean
  findings: Finding[]
  /** findings that fired (+1 or +2) */
  firing: Finding[]
  bumps: Bump[]
  unfilled: UnfilledFinding[]
  /** injury said train the other side — the bump was refused */
  conflicts: { finding: Finding; injurySide: string; exercise: string }[]
  referrals: Finding[]
  trimmed: string[]
  /** every entered test, reconciled across all four fields */
  readings: ResolvedReading[]
  /** weak side contradicts the forces — held back until a human resolves it */
  blocked: ResolvedReading[]
  /** percentage disagrees with the forces by more than a point — quiet flag only */
  mismatched: ResolvedReading[]
}

export const INERT_VALD: ValdResult = {
  active: false,
  findings: [],
  firing: [],
  bumps: [],
  unfilled: [],
  conflicts: [],
  referrals: [],
  trimmed: [],
  readings: [],
  blocked: [],
  mismatched: [],
}

export function hasAnyReading(input: ValdInput): boolean {
  if (!input) return false
  return Object.values(input).some(
    (r) => num(r?.asymmetry) !== null || num(r?.leftN) !== null || num(r?.rightN) !== null,
  )
}

/** forces only, with no percentage anywhere — the Load layer works, VALD has nothing to do */
export function hasAnyForce(input: ValdInput): boolean {
  if (!input) return false
  return Object.values(input).some((r) => num(r?.leftN) !== null || num(r?.rightN) !== null)
}

/**
 * Step 1 — bracket a reading. Edges are continuous: < 4, < 8, < 15, < 20, < 30, >= 30.
 * On re-test the 2% hysteresis widens the band a value must cross to leave its previous
 * bracket; with no prior reading stored it classifies directly.
 */
export function bracketFor(asymmetry: number, data: ValdData, previous?: Bracket): Bracket {
  const brackets = data.brackets as Bracket[]
  const direct = brackets.find(
    (b) => asymmetry >= b.min && (b.max === null || asymmetry < b.max),
  )!
  if (!previous || previous.name === direct.name) return direct
  // hold the previous bracket unless the reading has moved past its edge by the hysteresis
  const h = data.hysteresis
  const movedUp = asymmetry >= (previous.max ?? Infinity) * (1 + h)
  const movedDown = asymmetry < previous.min * (1 - h)
  return movedUp || movedDown ? direct : previous
}

export function buildFindings(input: ValdInput, data: ValdData): Finding[] {
  const out: Finding[] = []
  for (const test of data.tests) {
    const r = resolveReading(test.code, input[test.code])
    // A side that contradicts the forces is blocked outright — see resolveReading.
    if (r.conflict) continue
    if (r.asymmetry === null || r.weakSide === null) continue
    const bracket = bracketFor(r.asymmetry, data)
    out.push({
      code: test.code,
      test,
      asymmetry: r.asymmetry,
      weakSide: r.weakSide,
      bracket,
      setsAdded: bracket.setsAdded,
      referral: r.asymmetry >= data.referralThreshold,
    })
  }
  return out
}

const isNativeUnilateral = (ex: Exercise, data: ValdData, injuryUnilateral: Set<number>) =>
  new RegExp(data.unilateralNamePattern, 'i').test(ex.name) || injuryUnilateral.has(ex.id)

const isConvertible = (ex: Exercise, data: ValdData) =>
  new RegExp(data.convertibleEquipmentPattern).test(ex.equipment)

export interface AllocationSlot {
  exercise: Exercise
  sets: number
  mainLift: boolean
  /** injury SIDE_ONLY forces training one side; VALD must not fight it */
  injurySideOnly?: string
  /** injury verdict blocks any change */
  locked?: boolean
}

export interface AllocationDay {
  index: number
  slots: AllocationSlot[]
}

export interface AllocateContext {
  data: ValdData
  library: Exercise[]
  injuryUnilateral: Set<number>
  /**
   * Every gate the base generator applies at selection — injury REMOVE, age, level and the
   * client's equipment tier. Step 5's swap searches the whole library, so without this it
   * reaches around the injury layer and around the Stage 1 safety rules both.
   */
  canSwapIn: (ex: Exercise) => boolean
  /**
   * True if adding `extraSets` to this day would breach a session-length cap. The generator
   * no longer imposes one — session length is the client's decision, taken with the time-cap
   * button — so it passes `() => false`. Kept on the contract so a caller that does want a
   * cap can impose one without this layer changing.
   */
  wouldBreachSessionCap: (dayIndex: number, extraSets: number, newUnilateralSlots: number) => boolean
}

/**
 * Steps 3-5. Two passes with four counters that persist across BOTH passes — resetting any
 * of them in pass 2 produces output that looks plausible and is silently wrong.
 */
export function allocate(
  findings: Finding[],
  days: AllocationDay[],
  ctx: AllocateContext,
): Pick<ValdResult, 'bumps' | 'unfilled' | 'conflicts'> {
  const { data } = ctx
  const canonicalOrder = new Map(data.tests.map((t, i) => [t.code, i]))

  // Fixed, total ordering so two runs on the same input are byte-identical.
  const firing = findings
    .filter((f) => f.setsAdded > 0)
    .sort(
      (a, b) =>
        b.setsAdded - a.setsAdded ||
        b.asymmetry - a.asymmetry ||
        (canonicalOrder.get(a.code) ?? 0) - (canonicalOrder.get(b.code) ?? 0),
    )

  // ---- the four persistent counters ---------------------------------------
  const spentPerSubRegion = new Map<string, number>() // weekly budget, per tested sub-region
  const addedPerSlot = new Map<string, number>() // `${day}:${slot}` -> sets added
  const extraPerSession = new Map<number, number>() // session fatigue guard
  const served = new Set<string>() // findings that got their pass-1 reservation

  const bumps: Bump[] = []
  const conflicts: ValdResult['conflicts'] = []
  const usedForSwap = new Set<number>()
  const slotKey = (d: number, s: number) => `${d}:${s}`

  /** matching slots for a finding, sessions in order, LAST slot first within a session */
  const matchingSlots = (f: Finding) =>
    days.flatMap((day) =>
      day.slots
        .map((slot, slotIndex) => ({ day, slot, slotIndex }))
        .filter((x) => x.slot.exercise.code === f.code)
        .reverse(),
    )

  /** step 5 — make a slot unilateral, in strict preference order */
  const resolveForm = (
    f: Finding,
    slot: AllocationSlot,
  ): { form: UnilateralForm; swapTo?: Exercise } | null => {
    if (isNativeUnilateral(slot.exercise, data, ctx.injuryUnilateral)) return { form: 'already' }
    // a main lift is never swapped and never converted, for any goal
    if (slot.mainLift) return null
    const swap = ctx.library.find(
      (ex) =>
        ex.code === f.code &&
        ex.id !== slot.exercise.id &&
        !usedForSwap.has(ex.id) &&
        ctx.canSwapIn(ex) &&
        isNativeUnilateral(ex, data, ctx.injuryUnilateral),
    )
    if (swap) return { form: 'swapped', swapTo: swap }
    if (isConvertible(slot.exercise, data)) return { form: 'converted' }
    return null
  }

  const tryBump = (f: Finding, want: number): number => {
    let placed = 0
    for (const { day, slot, slotIndex } of matchingSlots(f)) {
      if (placed >= want) break
      const key = slotKey(day.index, slotIndex)
      const already = addedPerSlot.get(key) ?? 0
      if (already >= f.setsAdded) continue // this slot is topped up to its bracket
      if (slot.locked) continue

      // injury outranks VALD: if injury says train the other side, refuse the bump
      if (slot.injurySideOnly && slot.injurySideOnly !== f.weakSide) {
        if (!conflicts.some((c) => c.finding.code === f.code && c.exercise === slot.exercise.name))
          conflicts.push({
            finding: f,
            injurySide: slot.injurySideOnly,
            exercise: slot.exercise.name,
          })
        continue
      }

      const spent = spentPerSubRegion.get(f.test.subRegion) ?? 0
      if (spent >= data.budgetPerTestedSubRegion) break

      const existing = bumps.find((b) => b.dayIndex === day.index && b.slotIndex === slotIndex)
      let form = existing?.form
      let swapTo: Exercise | undefined
      if (!form) {
        const resolved = resolveForm(f, slot)
        if (!resolved) continue // bilateral-only: keep the budget for another slot
        form = resolved.form
        swapTo = resolved.swapTo
      }

      // Extra sets are real local fatigue, so they count in full against whatever cap the
      // caller imposes. The generator imposes none — see `wouldBreachSessionCap`.
      const newUnilateral = existing ? 0 : form === 'already' ? 0 : 1
      if (ctx.wouldBreachSessionCap(day.index, 1, newUnilateral)) continue

      // Captured before the mutation below — reading it after records the exercise swapped
      // TO under a field that means swapped FROM.
      const replaced = slot.exercise.name
      if (swapTo) {
        usedForSwap.add(swapTo.id)
        slot.exercise = swapTo
      }
      if (existing) {
        existing.extraSets += 1
      } else {
        bumps.push({
          dayIndex: day.index,
          slotIndex,
          code: f.code,
          weakSide: f.weakSide,
          extraSets: 1,
          form: form!,
          swappedFrom: swapTo ? replaced : undefined,
        })
      }
      addedPerSlot.set(key, already + 1)
      spentPerSubRegion.set(f.test.subRegion, spent + 1)
      extraPerSession.set(day.index, (extraPerSession.get(day.index) ?? 0) + 1)
      placed += 1
    }
    return placed
  }

  // ---- pass 1: reservation -------------------------------------------------
  // Every firing finding with a matching slot anywhere in the week gets ONE set before
  // anything else is allocated, so a Major finding can't eat a sub-region's whole budget.
  for (const f of firing) {
    if (matchingSlots(f).length === 0) continue
    if (tryBump(f, 1) > 0) served.add(f.code)
  }

  // ---- pass 2: top-up ------------------------------------------------------
  for (const f of firing) {
    const owedToOthers = firing
      .filter((o) => o.code !== f.code && o.test.subRegion === f.test.subRegion && !served.has(o.code))
      .length
    const spent = spentPerSubRegion.get(f.test.subRegion) ?? 0
    const available = data.budgetPerTestedSubRegion - spent - owedToOthers
    const want = Math.min(f.setsAdded - (served.has(f.code) ? 1 : 0), Math.max(0, available))
    if (want > 0) tryBump(f, want)
  }

  // ---- what could not be filled -------------------------------------------
  const unfilled: UnfilledFinding[] = []
  for (const f of firing) {
    const got = bumps.filter((b) => b.code === f.code).reduce((s, b) => s + b.extraSets, 0)
    if (got >= f.setsAdded) continue
    const slots = matchingSlots(f)
    const reason =
      slots.length === 0
        ? `no slot in this program trains ${f.test.subRegion}`
        : conflicts.some((c) => c.finding.code === f.code)
          ? 'a reported pain restricts this exercise to the other side'
          : slots.every((s) => s.slot.mainLift && !isNativeUnilateral(s.slot.exercise, data, ctx.injuryUnilateral))
            ? 'the only matching slot is a bilateral main lift, which is never converted'
            : (spentPerSubRegion.get(f.test.subRegion) ?? 0) >= data.budgetPerTestedSubRegion
              ? `the ${data.budgetPerTestedSubRegion}-set weekly budget for ${f.test.subRegion} was already spent`
              : 'no matching slot could be run one side at a time'
    unfilled.push({ finding: f, owed: f.setsAdded - got, reason })
  }

  return { bumps, unfilled, conflicts }
}
