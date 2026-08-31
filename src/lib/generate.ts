import type {
  AllocationBlock,
  ClientInput,
  DataBundle,
  Exercise,
  PrescriptionEntry,
  Slot,
} from '../types'
import { isEquipmentAvailable, type EquipmentTier } from './equipment'
import {
  buildInjuryIndex,
  evaluateAll,
  type ExerciseVerdict,
  type InjuryIndex,
  type PainVerdict,
} from './injury'
import {
  INERT_VALD,
  allocate,
  buildFindings,
  hasAnyReading,
  resolveAll,
  type AllocationDay as ValdAllocationDay,
  type UnilateralForm,
  type ValdResult,
  type WeakSide,
} from './vald'
import {
  evaluateInBody,
  groupsForRegions,
  slotLoad,
  type InBodyResult,
} from './inbody'
import {
  correctiveSeconds,
  evaluateBodyDot,
  type BodyDotResult,
  type CorrectiveSlot,
  type CorrectiveStretch,
} from './bodydot'
import {
  baseState,
  capMinutes,
  planCap,
  restOf,
  structureOf,
  type CapDayModel,
  type CapPin,
  type CapState,
  type TimeCapResult,
} from './timecap'
import { evaluateLoad, type LoadResult } from './weight'
import { pickKey, roundSets } from './rounding'
import {
  INERT_AMEND,
  amendType,
  blockFor,
  driftRows,
  parseSlotId,
  slotId,
  type AmendResult,
  type Pin,
  type RetiredPin,
} from './amend'
import { absLastOrder, isAbs, orderAbsBlocks, placeAbs } from './abs'
import { defaultRank } from './defaults'
import {
  bandFor,
  boostedRest,
  conditioningMinutes,
  maxRestFor,
  prescribeConditioning,
  restStep,
  solveRestBoost,
  type Conditioning,
} from './sessionlength'
import {
  buildSubAliases,
  formBlocks,
  timeParams,
  type Block,
  type Structure,
  type StructureContext,
  type TimeParams,
} from './structure'

/** The injury index only depends on the loaded data, so build it once per bundle. */
const indexCache = new WeakMap<Exercise[], InjuryIndex>()
function injuryIndexFor(data: DataBundle): InjuryIndex {
  let idx = indexCache.get(data.exercises)
  if (!idx) {
    idx = buildInjuryIndex(data.injury, data.exercises)
    indexCache.set(data.exercises, idx)
  }
  return idx
}

export interface ChosenExercise {
  exercise: Exercise
  /** the sub-region the allocation asked for (may differ from exercise.sub on a substitution) */
  requestedSub: string
  /** stable identity of the allocation slot this fills, so an amend can pin it */
  slotId: string
  sets: number
  reps: string
  rest: string
  /** what the time model charges, as a single number — `rest` above may be a range */
  restSeconds: number
  /** why this pick is not a clean first-choice, if applicable */
  flag?: 'reused' | 'substituted'
  /** injury-layer verdict for this exercise against the ticked pains */
  verdict: ExerciseVerdict
  /** InBody rule 4 forced the fat-burning structure on this slot */
  rule4?: boolean
  /** per-slot load adjustment, as a fraction — two slots can legitimately differ */
  loadAdjustment?: number
  /** VALD made this slot one-sided and added sets to the weak side */
  unilateral?: { form: UnilateralForm; weakSide: WeakSide; extraSets: number }
  /** an amend pinned this slot — the client or trainer chose this exercise */
  pinned?: { equipment?: string; actor: string }
}

export interface GeneratedDay {
  index: number
  label: string
  exercises: ChosenExercise[]
  /** how the session is performed — one entry per straight exercise or paired block */
  blocks: Block[]
  /** sum of sets across the day — corrective slots are additive and stay out of it */
  totalSets: number
  /** session length from the RAW allocation sets, fractions and all */
  minutes: number
  /**
   * Session length from the whole-number sets the client is actually prescribed. This is the
   * figure both views show and the figure the time cap drives to 60 — a 3.5-set slot is
   * performed as 3 or 4, never as 3.5, so it is the only honest reading of "how long is this
   * session". Filled once the whole program is known, since the rounding carries per muscle
   * group across days.
   */
  wholeSetMinutes: number
  /** BodyDot corrective work, appended after the main work; same block in every session */
  correctives: CorrectiveSlot[]
  correctiveStretches: CorrectiveStretch[]
  correctiveMinutes: number
  /** InBody high-TBW filler bouts performed this session; each one costs session time */
  fillerBouts: number
  /**
   * The session-length conditioning block, or null. It sits at the very end of the session,
   * after the corrective work, costs session time and satisfies no muscle-group target — it
   * is never in `exercises`, so the volume audit cannot see it.
   */
  conditioning: Conditioning | null
  /** seconds added to every exercise's rest to reach the band floor; 0 when none was needed */
  restBoost: number
  /** how this session is performed, after any time-cap structure step */
  structure: Structure
  /**
   * Everything the time-cap button needs, and the single implementation of session length —
   * `minutes` above is `capMinutes(capModel, capState)`, so the figure the client reads and
   * the figure the search drives to 60 cannot diverge.
   */
  capModel: CapDayModel
  capState: CapState
}

export type WarningKind = 'reuse' | 'substitute' | 'dropped' | 'pain-dropped'

export interface Warning {
  kind: WarningKind
  dayIndex: number
  dayLabel: string
  sub: string
  message: string
}

export interface RemovedExercise {
  exercise: Exercise
  /** the REMOVE verdicts that took it out, one per pain responsible */
  reasons: PainVerdict[]
}

export interface Program {
  block: AllocationBlock
  key: string
  ageBracket: string
  days: GeneratedDay[]
  warnings: Warning[]
  prescription: PrescriptionEntry
  prescriptionKey: string
  exerciseCount: number
  /** the program-level work/rest/transition figures, for anything that needs to re-time it */
  timeParams: TimeParams
  structure: Structure
  /** how much lighter this structure runs, as a fraction (triset -0.08) */
  loadAdjustment: number
  restMultiplier: number
  /** everything the InBody layer derived and changed; inert when no scan was entered */
  inbody: InBodyResult
  /** VALD findings, bumps and anything it could not fill; inert with no readings */
  vald: ValdResult
  /** posture findings and the corrective block they produced; inert with no readings */
  bodydot: BodyDotResult
  /** estimated working weights; inert until newton figures are entered */
  load: LoadResult
  /** pins applied, held back or retired, plus the volume drift they caused */
  amend: AmendResult
  /** per-day "Reduce to 60 min" plans; inert until a day is pressed */
  timecap: TimeCapResult
  /** verdict per exercise id across the whole library, for the audit and the UI */
  verdicts: Map<number, ExerciseVerdict>
  /** everything the injury layer took out of the pool, for the removals panel */
  removedByPain: RemovedExercise[]
}

export type GenerateResult =
  | { ok: true; program: Program }
  | { ok: false; error: string; key: string; ageBracket: string }

/**
 * Age in years -> bracket. Bracket strings come from config.ages; "65+" is matched as a
 * string, never parsed.
 */
export function ageBracket(age: number, ages: string[]): string {
  for (const bracket of ages) {
    if (bracket.endsWith('+')) {
      const floor = Number(bracket.slice(0, -1))
      if (age >= floor) return bracket
    } else {
      const [lo, hi] = bracket.split('-').map(Number)
      if (age >= lo && age <= hi) return bracket
    }
  }
  // Below the lowest bracket (e.g. age 4) — clamp to the first.
  return ages[0]
}

export function allocationKey(i: { split: string; goal: string; ageBr: string; level: string; days: number }) {
  return [i.split, i.goal, i.ageBr, i.level, String(i.days)].join('|')
}

export function prescriptionKey(i: { sex: string; days: number; ageBr: string; level: string }) {
  return [i.sex, String(i.days), i.ageBr, i.level].join('|')
}

export function splitsKey(i: { goal: string; days: number; level: string; split: string }) {
  return [i.goal, String(i.days), i.level, i.split].join('|')
}

/**
 * All eligibility rules from the spec, plus the client's equipment tier. Every one must
 * pass. Equipment is applied at the same stage as the age/level rules, so an unavailable
 * exercise routes through the same fallback cascade and shows up as a warning.
 */
export function isEligible(
  ex: Exercise,
  level: string,
  ageBr: string,
  equipment: EquipmentTier = 'Full gym',
  /** mobility is barred from the main pool by design; as BodyDot corrective work it is the point */
  allowMobility = false,
): boolean {
  if (ex.type === 'mobility' && !allowMobility) return false
  if (ex.avoidAges.includes(ageBr)) return false
  if (!isEquipmentAvailable(ex, equipment)) return false

  if (level === 'Beginner' && ex.skill > 2) return false
  if (level === 'Intermediate' && ex.skill > 4) return false

  if (ageBr === '6-12' && ex.load > 3) return false
  if (ageBr === '65+' && (ex.load > 4 || ex.skill > 3)) return false
  if (ageBr === '13-17' && level === 'Beginner' && ex.load > 4) return false

  return true
}

/**
 * "Program standard sets" for a bilateral corrective: the set count the rest of this program
 * is already using, as a whole number, since a corrective has to be decisive. Halves round
 * up and a tie goes to the larger figure.
 */
export function modalSets(values: number[]): number {
  if (values.length === 0) return 0
  const counts = new Map<number, number>()
  for (const v of values) {
    const n = Math.round(v)
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
}

/**
 * Main lift (Get Stronger only) -> the default ranking -> tier -> load desc -> id asc.
 *
 * The default ranking sits above tier and below every eligibility filter, so what a
 * sub-region leads with is a known, plainly-named movement wherever one exists — see
 * lib/defaults.ts. Injury PRIORITY still outranks all of it.
 */
const TIER_ORDER: Record<string, number> = { primary: 0, secondary: 1, accessory: 2 }

export function rankCandidates(
  candidates: Exercise[],
  goal: string,
  verdicts?: Map<number, ExerciseVerdict>,
): Exercise[] {
  const isPriority = (e: Exercise) => (verdicts?.get(e.id)?.verdict === 'PRIORITY' ? 1 : 0)
  return [...candidates].sort((a, b) => {
    // Injury-layer corrective work outranks the standard tier ordering.
    const p = isPriority(b) - isPriority(a)
    if (p !== 0) return p
    if (goal === 'Get Stronger') {
      const m = Number(b.mainLift) - Number(a.mainLift)
      if (m !== 0) return m
    }
    const d = defaultRank(a, b)
    if (d !== 0) return d
    const t = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
    if (t !== 0) return t
    if (b.load !== a.load) return b.load - a.load
    return a.id - b.id
  })
}

export function generate(data: DataBundle, input: ClientInput): GenerateResult {
  const { config, allocation, exercises, prescription } = data
  const ageBr = ageBracket(input.age, config.ages)

  const key = allocationKey({
    split: input.split,
    goal: input.goal,
    ageBr,
    level: input.level,
    days: input.days,
  })
  const block = allocation[key]
  if (!block) {
    return {
      ok: false,
      key,
      ageBracket: ageBr,
      error: `No program is available for this combination: ${input.split}, ${input.goal}, ${ageBr}, ${input.level}, ${input.days} days per week.`,
    }
  }

  const pKey = prescriptionKey({ sex: input.sex, days: input.days, ageBr, level: input.level })
  const rx = prescription[pKey]?.[input.goal]
  if (!rx) {
    return {
      ok: false,
      key: pKey,
      ageBracket: ageBr,
      error: `No reps and rest guidance is available for a ${input.sex.toLowerCase()} ${input.level.toLowerCase()} aged ${ageBr} training ${input.days} days per week for ${input.goal}.`,
    }
  }

  // Index exercises by sub-region and by muscle group. Joined on `sub` verbatim — the
  // files are already normalised to a common spelling, so no fuzzy matching here.
  const bySub = new Map<string, Exercise[]>()
  const groupToSubs = new Map<string, string[]>()
  const subToGroup = new Map<string, string>()
  for (const ex of exercises) {
    if (!bySub.has(ex.sub)) bySub.set(ex.sub, [])
    bySub.get(ex.sub)!.push(ex)
    subToGroup.set(ex.sub, ex.group)
  }
  for (const [sub, group] of subToGroup) {
    if (!groupToSubs.has(group)) groupToSubs.set(group, [])
    groupToSubs.get(group)!.push(sub)
  }

  // The injury layer runs BEFORE selection: verdicts are computed for the whole library,
  // and REMOVE exercises leave the candidate pool entirely. SIDE_ONLY and CAUTION stay in
  // and are annotated. Nothing else about the pipeline changes.
  const verdicts = evaluateAll(exercises, input.pains, data.injury, injuryIndexFor(data))
  const isRemoved = (ex: Exercise) => verdicts.get(ex.id)?.verdict === 'REMOVE'

  const removedByPain: RemovedExercise[] = exercises
    .filter(isRemoved)
    .map((ex) => ({
      exercise: ex,
      reasons: (verdicts.get(ex.id)?.byPain ?? []).filter((v) => v.verdict === 'REMOVE'),
    }))

  /** passes the age/level/equipment rules, ignoring pain — used to attribute empty slots */
  const baseEligibleIn = (sub: string): Exercise[] =>
    (bySub.get(sub) ?? []).filter((ex) => isEligible(ex, input.level, ageBr, input.equipment))

  const eligibleIn = (sub: string): Exercise[] => baseEligibleIn(sub).filter((ex) => !isRemoved(ex))

  // Structure layer: decides how the work is performed, never what it is. Sets, reps and
  // selection are already fixed by this point.
  const correctiveIds = new Set(data.injury.exercises.filter((r) => r.corrective).map((r) => r.id))
  const structureCtx: StructureContext = {
    goal: input.goal,
    structure: input.structure,
    data: data.structure,
    corrective: correctiveIds,
    subAliases: buildSubAliases(exercises, data.injury.exercises),
  }
  const tp = timeParams(
    data.structure,
    input.goal,
    input.structure,
    config.restMid[input.goal],
    config.warmupMinutes,
  )

  // ---- amend ---------------------------------------------------------------
  // A pin, not an edit. The generator re-runs holding it, so a re-test, a goal change or a
  // new scan cannot silently discard a client's amend — which is the worst failure available
  // here, because they would never know it had been undone.
  const pins = input.pins ?? []
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const pinBySlot = new Map<string, Pin>()
  const appliedPins: Pin[] = []
  const pendingPins: Pin[] = []
  const retiredPins: RetiredPin[] = []
  const seenSlots = new Set<string>()

  for (const pin of pins) {
    const to = byId.get(pin.to)
    const from = byId.get(pin.from)
    if (!to || !from) {
      retiredPins.push({ pin, reason: 'the exercise this pin refers to is no longer in the library' })
      continue
    }
    // Type C is a real change of muscle, so it does nothing until the client accepts it.
    if (amendType(from, to, pin.equipment) === 'C' && !pin.accepted) {
      pendingPins.push(pin)
      continue
    }
    const blocked = blockFor(
      to,
      {
        data: data.amend,
        library: exercises,
        ageBracket: ageBr,
        equipment: input.equipment,
        verdictOf: (id) => verdicts.get(id)?.verdict ?? 'OK',
      },
      from.mainLift,
    )
    // A pin the CURRENT screen would refuse is never applied — a new pain reported since the
    // amend was made outranks it, and the client is told rather than left to discover it.
    if (blocked) {
      retiredPins.push({ pin, reason: `"${to.name}" is ${blocked.reason}` })
      continue
    }
    pinBySlot.set(pin.slotId, pin)
  }

  const warnings: Warning[] = []
  const usedThisWeek = new Set<number>()
  // Reserve every pinned exercise so an earlier unpinned slot cannot consume it first and
  // leave the pinned slot holding a duplicate.
  for (const pin of pinBySlot.values()) usedThisWeek.add(pin.to)
  const selected: { index: number; label: string; chosen: ChosenExercise[] }[] = []

  block.days.forEach((allocDay, dayIndex) => {
    const chosen: ChosenExercise[] = []

    for (const slot of allocDay.slots as Slot[]) {
      const [sub, count, setsPerExercise] = slot

      for (let n = 0; n < count; n++) {
        const sid = slotId({ dayIndex, sub, n })
        seenSlots.add(sid)
        const pin = pinBySlot.get(sid)
        if (pin) {
          const pinned = byId.get(pin.to)!
          appliedPins.push(pin)
          chosen.push({
            exercise: pinned,
            requestedSub: sub,
            slotId: sid,
            sets: setsPerExercise,
            reps: rx.reps,
            rest: rx.rest,
            restSeconds: config.restMid[input.goal],
            verdict: verdicts.get(pinned.id) ?? { verdict: 'OK', byPain: [] },
            pinned: { equipment: pin.equipment, actor: pin.actor },
          })
          continue
        }

        const ranked = rankCandidates(eligibleIn(sub), input.goal, verdicts)

        // 1. eligible and unused
        let pick = ranked.find((ex) => !usedThisWeek.has(ex.id))
        let flag: ChosenExercise['flag']

        // 2. eligible but already used this week -> reuse, warn
        if (!pick && ranked.length > 0) {
          pick = ranked[0]
          flag = 'reused'
          warnings.push({
            kind: 'reuse',
            dayIndex,
            dayLabel: allocDay.label,
            sub,
            message: `Day ${dayIndex + 1} (${allocDay.label}): "${pick.name}" reused — no unused eligible exercise left in "${sub}".`,
          })
        }

        // Attribute an empty sub-region to the layer that emptied it. A slot lost to pain
        // is a different thing from "nothing eligible found" and has to read differently.
        const equipmentBlocked =
          input.equipment !== 'Full gym' &&
          (bySub.get(sub) ?? []).some((ex) => isEligible(ex, input.level, ageBr, 'Full gym'))
        const painRemovals = baseEligibleIn(sub).filter(isRemoved)
        const painBlocked = eligibleIn(sub).length === 0 && painRemovals.length > 0
        const painLabels = [
          ...new Set(
            painRemovals.flatMap((ex) =>
              (verdicts.get(ex.id)?.byPain ?? [])
                .filter((v) => v.verdict === 'REMOVE')
                .map((v) => v.painLabel),
            ),
          ),
        ]
        const because = painBlocked
          ? ` (removed because you reported ${painLabels.join(' and ')})`
          : equipmentBlocked
            ? ` (equipment: ${input.equipment})`
            : ''

        // 3. nothing eligible here -> sibling sub-region in the SAME muscle group
        if (!pick) {
          const group = subToGroup.get(sub)
          if (group) {
            const siblings = (groupToSubs.get(group) ?? []).filter((s) => s !== sub)
            const siblingPool = rankCandidates(siblings.flatMap(eligibleIn), input.goal, verdicts)
            const sub1 = siblingPool.find((ex) => !usedThisWeek.has(ex.id)) ?? siblingPool[0]
            if (sub1) {
              pick = sub1
              flag = 'substituted'
              warnings.push({
                kind: 'substitute',
                dayIndex,
                dayLabel: allocDay.label,
                sub,
                message: `Day ${dayIndex + 1} (${allocDay.label}): nothing eligible in "${sub}"${because} — substituted "${pick.name}" from sibling sub-region "${pick.sub}" (same group: ${group}).`,
              })
            }
          }
        }

        // 4. still nothing -> drop the slot
        if (!pick) {
          warnings.push({
            kind: painBlocked ? 'pain-dropped' : 'dropped',
            dayIndex,
            dayLabel: allocDay.label,
            sub,
            message: painBlocked
              ? `Day ${dayIndex + 1} (${allocDay.label}): "${sub}" removed because you reported ${painLabels.join(' and ')} — there was nothing safe left to train here or anywhere else in this muscle group.`
              : `Day ${dayIndex + 1} (${allocDay.label}): slot "${sub}" dropped${because} — no eligible exercise in this sub-region or any sibling in the same muscle group.`,
          })
          continue
        }

        usedThisWeek.add(pick.id)
        chosen.push({
          exercise: pick,
          requestedSub: sub,
          slotId: sid,
          sets: setsPerExercise,
          reps: rx.reps,
          rest: rx.rest,
          restSeconds: config.restMid[input.goal],
          flag,
          verdict: verdicts.get(pick.id) ?? { verdict: 'OK', byPain: [] },
        })
      }
    }

    // Session ordering, a stable reorder of the same picks — muscle-group volume is
    // untouched. Injury corrective work opens the session; after that, on Get Stronger,
    // the main lifts.
    const priorityRank = (c: ChosenExercise) => (c.verdict.verdict === 'PRIORITY' ? 1 : 0)
    chosen.sort((a, b) => {
      const p = priorityRank(b) - priorityRank(a)
      if (p !== 0) return p
      if (input.goal === 'Get Stronger') {
        return Number(b.exercise.mainLift) - Number(a.exercise.mainLift)
      }
      return 0
    })

    // Where the abs work sits. A reorder and nothing else: same exercises, same sets. On the
    // integrated side no abs exercise is ever placed before the session's main lift.
    selected.push({
      index: dayIndex,
      label: allocDay.label,
      chosen: placeAbs(chosen, input.absPlacement, (c) => c.exercise),
    })
  })

  // ---- InBody -------------------------------------------------------------
  // Runs after selection because it solves sets against the exercises actually chosen. It
  // never changes the split, the frequency, the slot count or the selection — only the
  // values in those slots, plus a forced structure on high-fat regions.
  const allChosen = selected.flatMap((d) => d.chosen)
  const inbody = evaluateInBody(input.inbody, data.inbody, {
    statedGoal: input.goal,
    ageBracket: ageBr,
    level: input.level,
    chosen: allChosen.map((c) => ({ exercise: c.exercise, group: c.exercise.group })),
    indirectCredit: config.indirectCredit,
    subToGroup,
    pains: Object.keys(input.pains),
  })
  const rule4Groups = inbody.active
    ? groupsForRegions(data.inbody, inbody.rule4Regions)
    : new Set<string>()

  /** rule 4 never forces a structure change on a main lift, for any goal */
  const onRule4 = (c: ChosenExercise) =>
    inbody.active && rule4Groups.has(c.exercise.group) && !c.exercise.mainLift

  const rule4Rest = Math.max(
    inbody.restFloor,
    Math.round(inbody.rest * data.inbody.rule4.restMultiplier),
  )

  // ---- VALD ---------------------------------------------------------------
  // Adds sets to the weak side. Never changes the goal, split, frequency, slot count, or
  // the strong side's volume. Precedence is injury > InBody > VALD.
  // Readings are reconciled across all four fields before anything acts on them. A weak side
  // that contradicts the measured forces blocks its finding outright, so it is surfaced here
  // even when nothing is left for the allocator to do.
  const valdReadings = resolveAll(input.vald)
  const valdBlocked = valdReadings.filter((r) => r.conflict)
  const valdMismatched = valdReadings.filter((r) => r.mismatch)
  const valdFindings = hasAnyReading(input.vald) ? buildFindings(input.vald, data.vald) : []
  let vald: ValdResult = {
    ...INERT_VALD,
    readings: valdReadings,
    blocked: valdBlocked,
    mismatched: valdMismatched,
  }
  if (valdFindings.length > 0) {
    const injuryUnilateral = new Set(
      data.injury.exercises.filter((r) => r.unilateral).map((r) => r.id),
    )
    const allocDays: ValdAllocationDay[] = selected.map((d) => ({
      index: d.index,
      slots: d.chosen.map((c) => ({
        exercise: c.exercise,
        sets: c.sets,
        mainLift: c.exercise.mainLift,
        injurySideOnly:
          c.verdict.verdict === 'SIDE_ONLY' && c.verdict.decidedBy?.side
            ? c.verdict.decidedBy.side === 'Left'
              ? 'Right'
              : 'Left'
            : undefined,
      })),
    }))

    const { bumps, unfilled, conflicts } = allocate(valdFindings, allocDays, {
      data: data.vald,
      library: exercises,
      injuryUnilateral,
      // A swapped-in exercise has to clear exactly what a selected one cleared.
      canSwapIn: (ex) => !isRemoved(ex) && isEligible(ex, input.level, ageBr, input.equipment),
      // No session-length cap is imposed at generation any more. Session length is the
      // client's decision, taken with the time-cap button, and the weak-side sets a real
      // asymmetry earns are not the place to make it silently for them. The callback stays
      // on the VALD contract so a caller that does want a cap can still impose one.
      wouldBreachSessionCap: () => false,
    })

    // Apply the swaps back onto the chosen slots, then record the bumps.
    for (const b of bumps) {
      const slot = selected[b.dayIndex]?.chosen[b.slotIndex]
      const allocSlot = allocDays[b.dayIndex]?.slots[b.slotIndex]
      if (!slot || !allocSlot) continue
      slot.exercise = allocSlot.exercise
      slot.unilateral = { form: b.form, weakSide: b.weakSide, extraSets: b.extraSets }
    }

    vald = {
      active: true,
      findings: valdFindings,
      firing: valdFindings.filter((f) => f.setsAdded > 0),
      bumps,
      unfilled,
      conflicts,
      referrals: valdFindings.filter((f) => f.referral),
      trimmed: [],
      readings: valdReadings,
      blocked: valdBlocked,
      mismatched: valdMismatched,
    }
  }

  // InBody replaces the goal-keyed values on each slot. Sets come from the resolved
  // per-group figure; reps and rest from the blended, floored numbers. Applied before
  // BodyDot, which reads the set counts the rest of the program has actually settled on.
  if (inbody.active) {
    for (const { chosen } of selected) {
      for (const c of chosen) {
        const resolved = inbody.sets[c.exercise.group]
        if (resolved !== undefined) c.sets = resolved
        c.rule4 = onRule4(c)
        c.reps = c.rule4 ? String(inbody.reps[1]) : `${inbody.reps[0]}-${inbody.reps[1]}`
        c.restSeconds = c.rule4 ? rule4Rest : inbody.rest
        c.rest = String(c.restSeconds)
      }
    }
  }

  // ---- BodyDot ------------------------------------------------------------
  // The only machine here that ADDS slots. Everything above it is already fixed: it appends
  // corrective work to the end of each session and never touches the split, the selection,
  // or anyone else's sets. It no longer trims that work to a time ceiling — nothing caps a
  // session at generation now, and dropping a corrective is a lever the client pulls
  // knowingly with the time-cap button, at a price the file states.
  const bodydot = evaluateBodyDot(input.bodydot, data.bodydot, {
    library: exercises,
    // What the rest of the program is doing, as one decisive whole number.
    standardSets: modalSets(selected.flatMap((d) => d.chosen.map((c) => c.sets))),
    reps: inbody.active ? `${inbody.reps[0]}-${inbody.reps[1]}` : rx.reps,
    // Precedence: injury outranks a corrective, so a removed exercise is never added back.
    removed: isRemoved,
    allowedExercise: (ex) => isEligible(ex, input.level, ageBr, input.equipment, true),
    // A stretch carries no load, so only pain and available equipment can rule it out.
    allowedStretch: (ex) =>
      !ex.avoidAges.includes(ageBr) && isEquipmentAvailable(ex, input.equipment),
  })

  // ---- day construction ---------------------------------------------------
  // Blocks are re-formed rather than patched whenever the day changes, because the time-cap
  // layer can both remove an exercise and step the structure — either one changes which
  // exercises pair with which, and a patched block list would be quietly wrong.

  /**
   * Blocks over `list`, with indices into `list`.
   *
   * Formed from ONE canonical order — abs last — whatever order `list` is actually in. Block
   * formation is greedy, so running it on the placed order would make the two abs placements
   * produce different pairings and therefore different session lengths. Canonicalising here
   * is what makes "same exercises, same sets, same total time either way" exactly true.
   */
  const buildBlocks = (list: ChosenExercise[], structure: Structure): Block[] => {
    const order = absLastOrder(list.length, (i) => isAbs(list[i].exercise))
    const canonical = order.map((i) => list[i])
    return blocksOver(canonical, structure)
      .map((b) => ({ ...b, indices: b.indices.map((j) => order[j]).sort((x, y) => x - y) }))
      .sort((a, b) => a.indices[0] - b.indices[0])
  }

  /** the greedy pass itself, over whatever order it is handed */
  const blocksOver = (list: ChosenExercise[], structure: Structure): Block[] => {
    const pairable = list.map((c) => ({
      exercise: c.exercise,
      sets: c.sets,
      corrective: correctiveIds.has(c.exercise.id),
    }))
    // The structure is per region: rule-4 slots are supersetted while the rest keep the
    // client's own choice, so blocks are formed within each pool and merged. A time-cap
    // structure step moves the client's pool only — InBody outranks it and has already
    // fixed the rule-4 pool at supersets.
    if (inbody.active && rule4Groups.size > 0) {
      const rule4Idx = list.map((c, i) => (onRule4(c) ? i : -1)).filter((i) => i >= 0)
      const otherIdx = list.map((_, i) => i).filter((i) => !rule4Idx.includes(i))
      const remap = (subset: number[], b: Block): Block => ({
        ...b,
        indices: b.indices.map((i) => subset[i]),
      })
      return [
        ...formBlocks(
          rule4Idx.map((i) => pairable[i]),
          { ...structureCtx, structure: data.inbody.rule4.structure as Structure },
        ).map((b) => remap(rule4Idx, b)),
        ...formBlocks(
          otherIdx.map((i) => pairable[i]),
          { ...structureCtx, structure },
        ).map((b) => remap(otherIdx, b)),
      ].sort((a, b) => a.indices[0] - b.indices[0])
    }
    return formBlocks(pairable, { ...structureCtx, structure })
  }

  /**
   * Step 8 — load is per slot, not per program: two slots in one session can carry different
   * adjustments because their structures differ. Resolved onto the block once, here, so the
   * time model and the table can never disagree about what structure a block is charged as.
   */
  const applyBlockFigures = (list: ChosenExercise[], blocks: Block[]) => {
    for (const b of blocks) {
      const blockLoad = b.indices.length > 1 ? (data.structure.loadAdjustment[b.structure] ?? 0) : 0
      b.loadAdjustment = blockLoad
      b.restMultiplier =
        b.indices.length > 1 ? (data.structure.restMultiplier[b.structure] ?? 1) : 1
      for (const i of b.indices) {
        // A rule-4 slot carries the fat-burning structure by instruction, so it takes that
        // load adjustment whether or not a legal partner happened to be found for it.
        const structureLoad = list[i].rule4 ? data.inbody.rule4.loadAdjustment : blockLoad
        list[i].loadAdjustment = inbody.active
          ? slotLoad(data.inbody, inbody, structureLoad)
          : structureLoad
      }
    }
  }

  /** REST_FLOOR[age][goal], with the beginner floor on top — a floor can only rise. */
  const capRestFloor = Math.max(
    data.timecap.restFloor[ageBr]?.[input.goal] ?? 0,
    input.level === 'Beginner' ? (data.timecap.beginnerRestFloor[input.goal] ?? 0) : 0,
  )

  /** which lever pays for dropping a corrective — its own finding's tier */
  const correctiveTier = (slot: CorrectiveSlot): 'borderline' | 'abnormal' =>
    bodydot.findings.find((f) => slot.codes.includes(f.code))?.tier === 'borderline'
      ? 'borderline'
      : 'abnormal'

  const buildCapModel = (
    list: ChosenExercise[],
    structure: Structure,
    correctives: CorrectiveSlot[],
    stretches: CorrectiveStretch[],
    fillerBouts: number,
    conditioningMinutes: number,
  ): CapDayModel => {
    const blockCache = new Map<string, Block[]>()
    return {
      goal: input.goal,
      workSeconds: data.structure.workSeconds[input.goal] ?? 40,
      transitionSeconds: data.structure.transitionSeconds,
      warmupMinutes: config.warmupMinutes,
      restMultiplier: data.structure.restMultiplier,
      baseStructure: structure,
      restFloor: capRestFloor,
      fillerBoutSeconds: inbody.filler?.seconds ?? data.timecap.timeModel.fillerBoutSeconds,
      stretchSeconds: data.bodydot.stretchSeconds,
      conditioningMinutes,
      exercises: list.map((c) => ({
        exercise: c.exercise,
        tier: c.exercise.tier,
        mainLift: c.exercise.mainLift,
        sets: c.sets,
        restSeconds: c.restSeconds,
        unilateralExtraSets: c.unilateral?.extraSets ?? 0,
      })),
      correctives: correctives.map((c) => ({
        tier: correctiveTier(c),
        label: c.prescribedName,
        sets: c.sets,
        codes: c.codes,
      })),
      stretches: stretches.map((s) => ({ codes: s.codes })),
      fillerBouts,
      blocksFor: (s, alive) => {
        const key = `${s}|${alive.map((a) => (a ? 1 : 0)).join('')}`
        const hit = blockCache.get(key)
        if (hit) return hit
        const keep = list.map((_, i) => i).filter((i) => alive[i])
        const blocks = buildBlocks(
          keep.map((i) => list[i]),
          s,
        ).map((b) => ({ ...b, indices: b.indices.map((j) => keep[j]) }))
        blockCache.set(key, blocks)
        return blocks
      },
      data: data.timecap,
      minSets: data.timecap.floors.sessionMinSets,
    }
  }

  const absPlacement = input.absPlacement
  const buildDay = (
    dayIndex: number,
    label: string,
    chosen: ChosenExercise[],
    structure: Structure,
    correctives: CorrectiveSlot[],
    stretches: CorrectiveStretch[],
    fillerOverride?: number,
    conditioning: Conditioning | null = null,
    restBoost = 0,
  ): GeneratedDay => {
    // Placement acts on the finished BLOCKS, never on the picks they are formed from, and
    // never on the exercise list itself. The partition is identical either way — same
    // members, same sets, same rest — so the only thing that changes is the order the
    // session is read in. That is what makes "same total time either way" exactly true
    // rather than nearly true.
    const formed = buildBlocks(chosen, structure)
    const blocks = orderAbsBlocks(
      formed,
      (i) => isAbs(chosen[i].exercise),
      (i) => chosen[i].exercise.mainLift,
      absPlacement,
    ).map((bi) => formed[bi])
    applyBlockFigures(chosen, blocks)
    // High-TBW filler is prescribed on isolation slots, so a session without one runs none.
    const fillerBouts =
      fillerOverride ??
      (inbody.filler && chosen.some((c) => c.exercise.type === 'isolation')
        ? inbody.filler.bouts
        : 0)
    const capModel = buildCapModel(
      chosen,
      structure,
      correctives,
      stretches,
      fillerBouts,
      conditioning?.minutes ?? 0,
    )
    const capState = baseState(capModel)
    return {
      index: dayIndex,
      label,
      exercises: chosen,
      blocks,
      totalSets: chosen.reduce((s, c) => s + c.sets, 0),
      minutes: capMinutes(capModel, capState),
      wholeSetMinutes: 0, // filled by refreshWholeSetMinutes once every day exists
      correctives,
      correctiveStretches: stretches,
      correctiveMinutes:
        correctiveSeconds(correctives, stretches, data.bodydot.stretchSeconds) / 60,
      fillerBouts,
      conditioning,
      restBoost,
      structure,
      capModel,
      capState,
    }
  }

  const days: GeneratedDay[] = selected.map(({ index, label, chosen }) =>
    buildDay(index, label, chosen, input.structure, bodydot.correctives, bodydot.stretches),
  )

  /**
   * The rounding carries an error per muscle group across the whole week, so every day's
   * whole-set length depends on every other day's. Recomputed rather than patched whenever
   * the program changes underneath it.
   */
  const refreshWholeSetMinutes = () => {
    const r = roundSets({ days })
    for (const d of days)
      d.wholeSetMinutes = capMinutes(d.capModel, {
        ...d.capState,
        sets: d.exercises.map((c, i) => r.byPick.get(pickKey(d.index, i)) ?? c.sets),
      })
    return r
  }
  refreshWholeSetMinutes()


  // ---- session length -----------------------------------------------------
  // Every workout in 55-75 minutes, without touching a single volume table. Two levers, in
  // order: raise rest to the goal's ceiling, then fill whatever is still missing with
  // conditioning. Neither adds a set, so weekly volume cannot move through this.
  //
  // Ages 6-12 have no band at all and neither lever is applied to them — a ten-year-old
  // should not be given an hour, and their session is whatever their volume produces.
  const sl = data.sessionlength
  const band = bandFor(sl, ageBr)
  if (band) {
    const [floor] = band
    const maxRest = maxRestFor(sl, input.goal)
    const step = restStep(sl)
    const painIds = Object.keys(input.pains)
    const rounded = refreshWholeSetMinutes()

    days.forEach((day, at) => {
      const sets = day.exercises.map(
        (c, i) => rounded.byPick.get(pickKey(day.index, i)) ?? c.sets,
      )
      /** the day as it would read at this rest boost and this much conditioning */
      const probe = (boost: number, conditioning: number): number => {
        const list =
          boost === 0
            ? day.exercises
            : day.exercises.map((c) => ({
                ...c,
                restSeconds: boostedRest(c.restSeconds, boost, maxRest, step),
              }))
        const model = buildCapModel(
          list,
          day.structure,
          day.correctives,
          day.correctiveStretches,
          day.fillerBouts,
          conditioning,
        )
        return capMinutes(model, { ...baseState(model), sets })
      }

      // Lever 1 — rest. Free: no work is added or removed, only the interval between sets.
      // The Lose Fat ceiling is deliberately low, because short rest IS the fat-loss method;
      // a client resting three minutes is no longer doing fat-loss training.
      const boost = solveRestBoost(
        floor,
        day.exercises.map((c) => c.restSeconds),
        sl,
        input.goal,
        (b) => probe(b, 0),
      )
      if (boost > 0) {
        for (const c of day.exercises) {
          c.restSeconds = boostedRest(c.restSeconds, boost, maxRest, step)
          // A raised rest is a single number, not the prescription's range — the client has
          // to be able to follow it on a clock.
          c.rest = String(c.restSeconds)
        }
      }

      // Lever 2 — conditioning, rounded UP to five minutes. Rounding to the NEAREST five
      // leaves a session a minute or two under the floor, which reaches the band never.
      const conditioning = prescribeConditioning(
        sl,
        conditioningMinutes(sl, floor, probe(0, 0)),
        painIds,
      )

      days[at] = buildDay(
        day.index,
        day.label,
        day.exercises,
        day.structure,
        day.correctives,
        day.correctiveStretches,
        day.fillerBouts,
        conditioning,
        boost,
      )
    })

    refreshWholeSetMinutes()
  }

  // ---- Load ---------------------------------------------------------------
  // Purely an annotation layer: it reads the newton figures and attaches a weight range to
  // exercises that already exist. It never changes selection, sets, reps, rest or timing.
  const load = evaluateLoad(valdReadings, data.load, {
    ageBracket: ageBr,
    level: input.level,
    library: exercises,
    verdictOf: (id) => verdicts.get(id)?.verdict ?? 'OK',
    vald: data.vald,
  })

  // ---- time cap ------------------------------------------------------------
  // Runs last, after injury, all three machines, the structure selector and any amends, and
  // it only ever removes. The plan is recomputed from the untouched day on every generation,
  // so pressing the same day twice produces the same plan.
  // Lever 3 — trim. Anything over the band CEILING is handed to the time-cap engine, which
  // is what that engine exists for. So the button drives to the ceiling rather than to
  // timecap.json's own 60: a session the band filled to 55-60 is already where it should be,
  // and shrinking it further is the client's call, not the program's.
  const capTarget = band ? band[1] : data.timecap.target
  const capPins = input.caps ?? []
  const capApplied: TimeCapResult['applied'] = []
  const capRetired: { pin: CapPin; reason: string }[] = []

  // A day the client asked to shorten is resolved to its whole-number sets before the search
  // runs, so the search drives the number they actually read down to 60. Targeting the raw
  // fractional figure instead left the day reading 63 min under a button labelled "Reduce to
  // 60 min", which is the one outcome this layer cannot have.
  const rounding = capPins.length > 0 ? roundSets({ days }) : null

  for (const pin of capPins) {
    const at = days.findIndex((d) => d.index === pin.dayIndex)
    if (at < 0) {
      capRetired.push({
        pin,
        reason: `day ${pin.dayIndex + 1} no longer exists in this program`,
      })
      continue
    }
    if (rounding) {
      const d = days[at]
      d.exercises.forEach((c, i) => {
        c.sets = rounding.byPick.get(pickKey(d.index, i)) ?? c.sets
      })
      days[at] = buildDay(
        d.index,
        d.label,
        d.exercises,
        d.structure,
        d.correctives,
        d.correctiveStretches,
        d.fillerBouts,
        d.conditioning,
        d.restBoost,
      )
    }
    const day = days[at]
    const model = day.capModel
    const plan = planCap(model, { target: capTarget })
    const { state } = plan

    const keep = day.exercises.map((_, i) => i).filter((i) => state.alive[i])
    const chosen = keep.map((i) => day.exercises[i])
    keep.forEach((i, k) => {
      chosen[k].sets = state.sets[i]
      // A trimmed rest is a single number the client can follow on a clock, not a range.
      if (state.restStep > 0) {
        chosen[k].restSeconds = restOf(model, state, i)
        chosen[k].rest = String(chosen[k].restSeconds)
      }
    })

    const correctives = day.correctives.filter((_, i) => state.correctivesAlive[i])
    const liveCodes = new Set(correctives.flatMap((c) => c.codes))
    const stretches = day.correctiveStretches.filter((s) => s.codes.some((c) => liveCodes.has(c)))
    for (const c of day.correctives.filter((_, i) => !state.correctivesAlive[i]))
      bodydot.trimmed.push({
        dayIndex: day.index,
        what: `${c.prescribedName} (${c.indicators.join(', ')})`,
      })

    days[at] = buildDay(
      day.index,
      day.label,
      chosen,
      structureOf(model, state),
      correctives,
      stretches,
      state.fillerBouts,
      // Conditioning is the cheapest lever, so it is the first thing a press removes.
      state.conditioningAlive ? day.conditioning : null,
      day.restBoost,
    )
    // `model` is the day as the search saw it — whole sets, nothing cut yet. Kept so the
    // plan can be re-derived and re-proved from outside.
    capApplied.push({ dayIndex: day.index, plan, model })
  }

  if (capApplied.length > 0) refreshWholeSetMinutes()

  const timecap: TimeCapResult = {
    active: capApplied.length + capRetired.length > 0,
    target: capTarget,
    applied: capApplied,
    retired: capRetired,
  }

  // Pins whose slot no longer exists — the split or the frequency changed underneath them.
  for (const [sid, pin] of pinBySlot)
    if (!seenSlots.has(sid))
      retiredPins.push({
        pin,
        reason: `the ${parseSlotId(sid)?.sub ?? 'slot'} slot on day ${(parseSlotId(sid)?.dayIndex ?? 0) + 1} no longer exists in this program`,
      })

  const anyPin = appliedPins.length + pendingPins.length + retiredPins.length > 0
  // A time cap that cut sets moved weekly volume too, so it is measured by the same check.
  const amend: AmendResult = !anyPin && capApplied.length === 0
    ? INERT_AMEND
    : {
        active: true,
        applied: appliedPins,
        pending: pendingPins,
        retired: retiredPins,
        // Reported, never blocked — the client asked for this. Unlimited type C amends let
        // someone rebuild the program into something the engine never validated.
        drift: appliedPins.length || capApplied.length
          ? driftRows(
              block,
              days.flatMap((d) =>
                d.exercises.map((c) => ({
                  sub: c.exercise.sub,
                  code: c.exercise.code,
                  sets: c.sets,
                })),
              ),
              data.amend.driftTolerance,
            )
          : [],
        driftTolerance: data.amend.driftTolerance,
      }

  return {
    ok: true,
    program: {
      block,
      key,
      ageBracket: ageBr,
      days,
      warnings,
      prescription: rx,
      prescriptionKey: pKey,
      exerciseCount: days.reduce((s, d) => s + d.exercises.length, 0),
      timeParams: tp,
      structure: input.structure,
      loadAdjustment: data.structure.loadAdjustment[input.structure] ?? 0,
      restMultiplier: tp.restMultiplier,
      inbody,
      vald,
      bodydot,
      load,
      amend,
      timecap,
      verdicts,
      removedByPain,
    },
  }
}
