import type {
  AllocationBlock,
  ClientInput,
  DataBundle,
  Exercise,
  Modality,
  PrescriptionEntry,
  Slot,
} from '../types'
import { isEquipmentAvailable, type EquipmentTier } from './equipment'
import {
  STRENGTH_STYLES,
  inStrengthPool,
  isGymOnly,
  memberOf,
  isUnloaded,
  withinSheetLevel,
  laddersOf,
  rungIsSet,
  rungsBelow,
  rungsFor,
  skillFamilyOf,
  stylesOf,
  usesMoveWarmup,
  warmupMinutesFor,
  withStyleOverrides,
  warmupMoves,
  type Rung,
  type WarmupMove,
} from './modality'
import { buildMetcon } from './metcon'
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
import { derivedWeights, withDerivedGoals } from './goals'
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
  balanceFullBody,
  competingPairs,
  conditioningCapFor,
  fitTimecap,
  completeFullDays,
  fullBodyKind,
  fullBodyKindOf,
  isHeavyHinge,
  isRedundant,
  maxMainLiftsFor,
  maxPairsFor,
  mainFamily,
  maxSetsFor,
  orderRank,
  repsFor,
  restCapFor,
  restFloorFor,
  setupSeconds,
} from './fit'
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
  unilateral?: {
    form: UnilateralForm
    weakSide: WeakSide
    extraSets: number
    /** the VALD finding this answers, and what it replaced — carried on the exercise, so it survives a trim */
    code?: string
    swappedFrom?: string
  }
  /** an amend pinned this slot — the client or trainer chose this exercise */
  pinned?: { equipment?: string; actor: string }
  /** the calisthenics skill that opens the session, chosen on purpose (not a sub-region slot) */
  skill?: string
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
  /** the five-move warm-up (a style beyond the gym, data/modalities.json); absent for the gym */
  warmupMoves?: WarmupMove[]
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
  /** the training styles this was built for, and the client's rung on each ladder (calisthenics) */
  styles: {
    styles: Modality[]
    rungs: { family: string; rung: number; set: boolean; exercises: string[]; next: string[]; top: number; step: number; steps: number; prevRung?: number; nextRung?: number }[]
  }
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

const fitHourOn = (input: ClientInput) => input.fitHour !== false

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

export function generate(raw: DataBundle, input: ClientInput): GenerateResult {
  // Shape Up and any other goal made from others (fit.json) get their table entries first.
  const data = withStyleOverrides(withDerivedGoals(raw))
  const { config, allocation, exercises, prescription } = data
  const ageBr = ageBracket(input.age, config.ages)

  // ---- training styles (data/modalities.json) -------------------------------------------------
  // Gym only is the generator exactly as it was: no pool filter, no ladders, no metcon.
  const styles = stylesOf(input)
  const styled = !isGymOnly(styles)
  const strengthStyles = styles.filter((st) => STRENGTH_STYLES.includes(st))
  const ladders = styled && strengthStyles.includes('Calisthenics') ? laddersOf(exercises) : undefined
  const rungs: Map<string, Rung> | undefined = ladders ? rungsFor(data, ladders, input, ageBr) : undefined
  /**
   * In one of the client's strength styles (CrossFit's metcon moves are the metcon's). For the gym
   * this is the library as it was: the modality sheet's rows reach a gym program only when
   * modalities.json switches that on.
   */
  const inPool = (ex: Exercise) => inStrengthPool(data, ex, strengthStyles)
  /**
   * A ladder exercise is trained at the client's rung or the two under it (the sheet's rule 2: the
   * hardest three rungs the client can reach are working sets); easier rungs are warm-up, harder ones wait.
   */
  const working = data.modalities?.ladders.workingRungs ?? 1
  const onRung = (ex: Exercise) => {
    if (!rungs || !ladders) return true
    const d = rungsBelow(ex, rungs, ladders)
    return d === undefined || (d >= 0 && d < working)
  }
  const moveWarmup = fitHourOn(input) && usesMoveWarmup(data, styles)

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

  // ---- fitting the hour (fit.json) -----------------------------------------
  const fitOn = input.fitHour !== false
  const fit = data.fit
  /** a goal made from others (Shape Up), with its own rules on top of the blend */
  const derived = fitOn ? fit.derivedGoals?.[input.goal] : undefined
  // Never more volume than the goal it takes its tables from: Shape Up's days are held to the sets of this
  // client's Build Muscle program, day by day.
  const referenceSets = new Map<number, number>()
  if (derived) {
    const ref = generate(raw, { ...input, goal: derived.tablesFrom })
    if (ref.ok)
      for (const d of ref.program.days)
        referenceSets.set(d.index, d.exercises.reduce((n, c) => n + c.sets + (c.unilateral?.extraSets ?? 0), 0))
  }
  // Shape Up pairs its isolation work from the start (room for its conditioning).
  // Shape Up pairs its isolation work from the start, and pairs only: never straight, never circuits.
  const baseStructure: Structure = derived?.pairIsolation ? (derived.structure as Structure) : input.structure
  const maxSets = fitOn ? maxSetsFor(fit, input.goal, input.level, input.age) : undefined
  const timecapData = fitOn ? fitTimecap(data.timecap, fit) : data.timecap
  /** the prescription's rest range, in seconds — the rest an exercise is charged sits inside it */
  const [rxRestLo, rxRestHi] = (() => {
    const m = rx.rest.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/)
    const lo = m ? Number(m[1]) : config.restMid[input.goal]
    return [lo, m?.[2] ? Number(m[2]) : lo]
  })()
  const baseRest = fitOn
    ? Math.min(Math.max(config.restMid[input.goal], rxRestLo), rxRestHi)
    : config.restMid[input.goal]

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
    (bySub.get(sub) ?? []).filter(
      (ex) =>
        inPool(ex) &&
        onRung(ex) &&
        // A rung the trainer set may sit above the level's ceiling; the age rules still hold.
        ((isEligible(ex, input.level, ageBr, input.equipment) && withinSheetLevel(data, ex, input.level)) ||
          (!!rungs && rungIsSet(ex, rungs) && isEligible(ex, 'Advanced', ageBr, input.equipment))),
    )

  const eligibleIn = (sub: string): Exercise[] => baseEligibleIn(sub).filter((ex) => !isRemoved(ex))

  // Structure layer: decides how the work is performed, never what it is. Sets, reps and
  // selection are already fixed by this point.
  const correctiveIds = new Set(data.injury.exercises.filter((r) => r.corrective).map((r) => r.id))
  const structureCtx: StructureContext = {
    goal: input.goal,
    structure: baseStructure,
    data: data.structure,
    corrective: correctiveIds,
    subAliases: buildSubAliases(exercises, data.injury.exercises),
    ...(fitOn && {
      protectAllMainLifts: fit.pairing.protectMainLiftsAllGoals,
      competing: competingPairs(fit),
      maxPairs: maxPairsFor(fit, input.level, input.age),
      neverPairTypes: fit.pairing.neverPairTypes,
      ...(rungs && { neverPairIds: new Set(exercises.filter((e) => skillFamilyOf(data, e)).map((e) => e.id)) }),
      ...(derived?.pairIsolation && { pairTypes: ['isolation'] }),
    }),
  }
  const tp = timeParams(
    data.structure,
    input.goal,
    baseStructure,
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

  // Every Full Body day gets a lower-body compound, a push and a pull (the week's volume is unchanged).
  const allocDays = !fitOn
    ? block.days
    : input.split === 'Full Body'
      ? balanceFullBody(block.days, fit)
      : completeFullDays(block.days, fit)
  /** heavy hinges per day, so a session holds at most one and (from four days a week) none follow one */
  const hingesOn: number[] = []
  /** main lifts per day: at most three a session (two for a beginner) */
  const mainOn: number[] = []
  /** the main-lift families each day already holds: one heavy press, one squat… a session */
  const familiesOn: Set<number>[] = []
  const maxMain = fitOn ? maxMainLiftsFor(fit, input.level) : Infinity
  const skillFirst = (c: ChosenExercise) => (styled && skillFamilyOf(data, c.exercise) ? 0 : 1)
  /**
   * Abs placement never moves a calisthenics skill: an L-sit or a human flag is core work, but it
   * is a skill first, and it opens the session.
   */
  const absView = (e: Exercise): Exercise => (styled && skillFamilyOf(data, e) ? { ...e, group: 'Skill' } : e)
  /**
   * The style's own ranking on top of the gym's: with Calisthenics as the main style its moves come
   * first (the gym fills what it cannot), and an advanced CrossFit client's hinge slot leads with an
   * Olympic lift (which counts as the day's heavy hinge).
   */
  const calisthenicsFirst = styled && styles[0] === 'Calisthenics' && strengthStyles.length > 1
  const olympicFirst = styled && styles.includes('CrossFit') && input.level === 'Advanced'
  /** on a ladder, the client's own rung before the easier working rungs under it */
  const rungRank = (e: Exercise) => (rungs && ladders ? (rungsBelow(e, rungs, ladders) ?? 0) : 0)
  const styleRank = (list: Exercise[]) =>
    !calisthenicsFirst && !olympicFirst && !rungs
      ? list
      : [...list].sort(
          (a, b) =>
            (calisthenicsFirst ? Number(memberOf(data, b, 'Calisthenics')) - Number(memberOf(data, a, 'Calisthenics')) : 0) ||
            (olympicFirst ? Number((b.tags ?? []).includes('Olympic')) - Number((a.tags ?? []).includes('Olympic')) : 0) ||
            // two rungs of one ladder: the client's own before the easier one
            ((a.ladders?.length ?? 0) && (b.ladders?.length ?? 0) ? rungRank(a) - rungRank(b) : 0),
        )
  /**
   * Calisthenics skills, programmed on purpose: each session opens with one ladder's skill (two from
   * intermediate), rotated across the week so each gets its turn, ladders the trainer set first.
   */
  const skillFamilies = (() => {
    if (!rungs || !ladders || !data.modalities) return []
    const order = data.modalities.ladders.skillFamilies
    return [...order]
      .filter((f) => ladders.has(f) && rungs.has(f))
      .sort((a, b) => Number(rungs.get(b)!.set) - Number(rungs.get(a)!.set) || order.indexOf(a) - order.indexOf(b))
  })()
  const skillsPerDay = input.level === 'Beginner' ? 1 : 2

  allocDays.forEach((allocDay, dayIndex) => {
    const chosen: ChosenExercise[] = []
    const fullDay = fitOn && (input.split === 'Full Body' || /full/i.test(allocDay.label))
    hingesOn[dayIndex] = 0
    mainOn[dayIndex] = 0
    familiesOn[dayIndex] = new Set()
    const mainBlocked = (ex: Exercise) =>
      fitOn && ex.mainLift && (mainOn[dayIndex] >= maxMain || familiesOn[dayIndex].has(mainFamily(fit, ex)))
    const countMain = (ex: Exercise) => {
      if (!ex.mainLift) return
      mainOn[dayIndex]++
      const f = mainFamily(fit, ex)
      if (f >= 0) familiesOn[dayIndex].add(f)
    }
    const hingeBlocked = (ex: Exercise) =>
      fitOn &&
      isHeavyHinge(fit, ex) &&
      (hingesOn[dayIndex] >= fit.heavyHinge.perSession ||
        (fit.heavyHinge.notOnConsecutiveDays && input.days >= 4 && (hingesOn[dayIndex - 1] ?? 0) > 0))

    // The day's skill work, before any slot: the skill at the client's rung, straight sets.
    if (skillFamilies.length) {
      let placed = 0
      for (let k = 0; k < skillFamilies.length && placed < skillsPerDay; k++) {
        const family = skillFamilies[(dayIndex * skillsPerDay + k) % skillFamilies.length]
        const r = rungs!.get(family)!
        const pick = ladders!
          .get(family)!
          .find((st) => st.rung === r.rung)
          ?.exercises.find((e) => eligibleIn(e.sub).some((x) => x.id === e.id) && !chosen.some((c) => c.exercise.id === e.id))
        if (!pick) continue
        placed++
        chosen.push({
          exercise: pick,
          requestedSub: pick.sub,
          slotId: slotId({ dayIndex, sub: `Skill: ${family}`, n: 0 }),
          sets: input.level === 'Advanced' ? 4 : 3,
          reps: rx.reps,
          rest: rx.rest,
          restSeconds: baseRest,
          verdict: verdicts.get(pick.id) ?? { verdict: 'OK', byPain: [] },
          skill: family,
        })
      }
    }

    for (const slot of allocDay.slots as Slot[]) {
      const [sub, count, setsPerExercise] = slot

      // Loaded neck work is left out from fifty.
      if (fitOn && input.age >= fit.neckFromAge.age && subToGroup.get(sub) === 'Neck') {
        warnings.push({
          kind: 'dropped',
          dayIndex,
          dayLabel: allocDay.label,
          sub,
          message: `Day ${dayIndex + 1} (${allocDay.label}): "${sub}" left out — no loaded neck work from ${fit.neckFromAge.age}.`,
        })
        continue
      }

      for (let n = 0; n < count; n++) {
        const sid = slotId({ dayIndex, sub, n })
        seenSlots.add(sid)
        const pin = pinBySlot.get(sid)
        if (pin) {
          const pinned = byId.get(pin.to)!
          appliedPins.push(pin)
          if (isHeavyHinge(fit, pinned)) hingesOn[dayIndex]++
          countMain(pinned)
          chosen.push({
            exercise: pinned,
            requestedSub: sub,
            slotId: sid,
            sets: setsPerExercise,
            reps: rx.reps,
            rest: rx.rest,
            restSeconds: baseRest,
            verdict: verdicts.get(pinned.id) ?? { verdict: 'OK', byPain: [] },
            pinned: { equipment: pin.equipment, actor: pin.actor },
          })
          continue
        }

        const allRanked = styleRank(rankCandidates(eligibleIn(sub), input.goal, verdicts))
        // A second heavy hinge this session (or one the day after a heavy hinge) gives way to
        // a lighter exercise for the same sub-region, where there is one.
        const lighter = allRanked.filter((ex) => !hingeBlocked(ex) && !mainBlocked(ex))
        let ranked = lighter.length > 0 ? lighter : allRanked
        let borrowedKind = false
        // A Full day's first slot of a kind (a leg lift, a press, a pull) takes a real one: a compound, and for the
        // push a press, not a fly or a raise, where the sub-region has one.
        const kind = fullDay ? fullBodyKind(fit, sub) : -1
        if (kind >= 0 && !chosen.some((c) => fullBodyKindOf(fit, c.exercise) === kind)) {
          const real = ranked.filter((ex) => fullBodyKindOf(fit, ex) === kind)
          if (real.length > 0) ranked = real
          else {
            // Nothing real here for this client (age, level, equipment or pain): one from another area of the kind.
            const kindSubs = [fit.fullBody.lower, fit.fullBody.pushPress ?? fit.fullBody.push, fit.fullBody.pull][kind]
            const pool = rankCandidates(kindSubs.filter((x) => x !== sub).flatMap(eligibleIn), input.goal, verdicts).filter(
              (ex) => fullBodyKindOf(fit, ex) === kind && !hingeBlocked(ex) && !mainBlocked(ex),
            )
            // one not used this week, or else one already used: the day needs it more than variety
            const other = pool.find((ex) => !usedThisWeek.has(ex.id)) ?? pool[0]
            if (other) {
              ranked = [other]
              borrowedKind = true
            }
          }
        }
        // Every candidate here is a second heavy hinge or a second main lift of its family (a
        // bodyweight client's pull-up slots): a lighter exercise from a sibling sub-region first.
        let borrowed: Exercise | undefined
        if (fitOn && lighter.length === 0 && allRanked.length > 0) {
          const group = subToGroup.get(sub)
          const siblings = group ? (groupToSubs.get(group) ?? []).filter((x) => x !== sub) : []
          borrowed = rankCandidates(siblings.flatMap(eligibleIn), input.goal, verdicts).find(
            (ex) => !usedThisWeek.has(ex.id) && !hingeBlocked(ex) && !mainBlocked(ex),
          )
          if (borrowed) ranked = [borrowed]
        }

        // A style's small pool can run out: never the same exercise twice in one session (styled only;
        // the gym's behaviour is unchanged).
        if (styled) ranked = ranked.filter((ex) => !chosen.some((c) => c.exercise.id === ex.id))
        // 1. eligible and unused
        let pick = ranked.find((ex) => !usedThisWeek.has(ex.id))
        let flag: ChosenExercise['flag'] = borrowed || borrowedKind ? 'substituted' : undefined

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
            const allSiblings = rankCandidates(siblings.flatMap(eligibleIn), input.goal, verdicts).filter(
              // An Olympic lift trains its own slot, never another's as a stand-in; nor anything twice a session.
              (ex) => !styled || (!(ex.tags ?? []).includes('Olympic') && !chosen.some((c) => c.exercise.id === ex.id)),
            )
            // A borrowed exercise follows the same rules: no second heavy hinge or second main lift of a family.
            const lighterSiblings = allSiblings.filter((ex) => !hingeBlocked(ex) && !mainBlocked(ex))
            const siblingPool = lighterSiblings.length > 0 ? lighterSiblings : allSiblings
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
        if (isHeavyHinge(fit, pick)) hingesOn[dayIndex]++
        countMain(pick)
        chosen.push({
          exercise: pick,
          requestedSub: sub,
          slotId: sid,
          sets: setsPerExercise,
          reps: rx.reps,
          rest: rx.rest,
          restSeconds: baseRest,
          flag,
          verdict: verdicts.get(pick.id) ?? { verdict: 'OK', byPain: [] },
        })
      }
    }

    // Session ordering, a stable reorder of the same picks — muscle-group volume is
    // untouched. Injury corrective work opens the session; after that the main lifts, then
    // the other compounds, isolation, and small work (rotator cuff, neck, grip, lower back)
    // and carries last, so nothing tires the lower back or the grip before the big lifts.
    const priorityRank = (c: ChosenExercise) => (c.verdict.verdict === 'PRIORITY' ? 1 : 0)
    chosen.sort((a, b) => {
      const p = priorityRank(b) - priorityRank(a)
      if (p !== 0) return p
      // Calisthenics skills (handstand, levers, planche…) open the session, while the client is fresh.
      const sk = skillFirst(a) - skillFirst(b)
      if (sk !== 0) return sk
      if (fitOn) return orderRank(fit, a.exercise) - orderRank(fit, b.exercise)
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
      chosen: placeAbs(chosen, input.absPlacement, (c) => absView(c.exercise)),
    })
  })

  // A Full Body day keeps a lower-body lift, a push and a pull. The allocation was balanced by
  // slot; a slot that borrowed from a sibling sub-region can still leave a day without one, so
  // the picks are balanced too: a day missing one takes it from the day holding two or more.
  if (fitOn && input.split === 'Full Body') {
    for (let kind = 0; kind < 3; kind++) {
      const ofKind = (c: ChosenExercise) => fullBodyKindOf(fit, c.exercise) === kind
      for (const day of selected) {
        if (day.chosen.some(ofKind)) continue
        const donor = [...selected]
          .filter((d) => d !== day && d.chosen.filter(ofKind).length >= 2)
          .sort((a, b) => b.chosen.filter(ofKind).length - a.chosen.filter(ofKind).length)[0]
        if (!donor) continue
        // the donor's last one of the kind, a main lift only if nothing else will do
        const pool = donor.chosen.filter(ofKind)
        const move = [...pool].reverse().find((c) => !c.exercise.mainLift) ?? pool[pool.length - 1]
        donor.chosen = donor.chosen.filter((c) => c !== move)
        day.chosen.push(move)
      }
    }
  }

  if (fitOn) {
    // At most so many of a group a session (two calf and lower-leg exercises): the extra ones' sets go to the rest.
    for (const cap of fit.perSessionCaps ?? []) {
      const of = (c: ChosenExercise) => cap.groups.includes(c.exercise.group)
      for (const day of selected) {
        const all = day.chosen.filter(of)
        if (all.length <= cap.max) continue
        const keep = [...all.filter((c) => c.pinned), ...all.filter((c) => !c.pinned)].slice(0, cap.max)
        const extra = all.filter((c) => !keep.includes(c))
        const moved = extra.reduce((n, c) => n + c.sets, 0)
        keep.forEach((c) => (c.sets = Math.min(c.sets + moved / keep.length, cap.maxSetsEach ?? Infinity)))
        day.chosen = day.chosen.filter((c) => !extra.includes(c))
      }
    }
    // No front raises: a week with an overhead press has the front delts covered; a week without one gets one,
    // at three sets, in the first front raise's place (when the client can do one), and the other raises go.
    if (fit.frontRaiseOnlyWithoutPress) {
      // (A calisthenics skill on the front delts, a handstand or a planche, is a skill, not a raise.)
      const raise = (c: ChosenExercise) =>
        !c.pinned && !c.skill && !(styled && skillFamilyOf(data, c.exercise)) && c.exercise.sub === 'Front' && c.exercise.type !== 'compound'
      let pressing = selected.some((d) => d.chosen.some((c) => c.exercise.sub === 'Front' && c.exercise.type === 'compound'))
      if (!pressing) {
        const day = selected.find((d) => d.chosen.some(raise))
        const press = rankCandidates(eligibleIn('Front'), input.goal, verdicts).find(
          (ex) => ex.type === 'compound' && !ex.mainLift && !isHeavyHinge(fit, ex),
        )
        if (day && press) {
          const at = day.chosen.findIndex(raise)
          day.chosen[at] = { ...day.chosen[at], exercise: press, sets: Math.max(3, day.chosen[at].sets), verdict: verdicts.get(press.id) ?? { verdict: 'OK', byPain: [] } }
          usedThisWeek.add(press.id)
          pressing = true
        }
      }
      if (pressing) for (const day of selected) day.chosen = day.chosen.filter((c) => !raise(c))
    }
  }

  // At most two chest presses a session: a third's sets go to the other two (the week's chest
  // volume is unchanged). A trainer's own pick stays.
  if (fitOn) {
    const press = (c: ChosenExercise) => fit.pressesPerSession.subs.includes(c.exercise.sub)
    for (const day of selected) {
      const presses = day.chosen.filter(press)
      if (presses.length <= fit.pressesPerSession.max) continue
      const keep = [...presses.filter((c) => c.pinned), ...presses.filter((c) => !c.pinned)].slice(0, fit.pressesPerSession.max)
      const extra = presses.filter((c) => !keep.includes(c))
      const moved = extra.reduce((n, c) => n + c.sets, 0)
      keep.forEach((c) => (c.sets += moved / keep.length))
      day.chosen = day.chosen.filter((c) => !extra.includes(c))
    }
  }

  // ---- InBody -------------------------------------------------------------
  // Runs after selection because it solves sets against the exercises actually chosen. It
  // never changes the split, the frequency, the slot count or the selection — only the
  // values in those slots, plus a forced structure on high-fat regions.
  const allChosen = selected.flatMap((d) => d.chosen)
  const inbody = evaluateInBody(input.inbody, data.inbody, {
    statedGoal: input.goal,
    derivedWeights: (fatOver) => derivedWeights(data, input.goal, fatOver),
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
    // A calisthenics skill is chosen on purpose, like a trainer's swap: VALD's one-sided swap and
    // weak-side sets leave it as it is (it is put back below if the allocator touched it).
    const skillsBefore = new Map(
      selected.flatMap((d) => d.chosen.filter((c) => c.skill).map((c) => [c.slotId, { exercise: c.exercise, sets: c.sets }] as const)),
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
      canSwapIn: (ex) => !isRemoved(ex) && inPool(ex) && onRung(ex) && isEligible(ex, input.level, ageBr, input.equipment),
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
      // A skill stays the skill the session was built around.
      if (slot.skill && skillsBefore.has(slot.slotId)) continue
      slot.exercise = allocSlot.exercise
      slot.unilateral = {
        form: b.form,
        weakSide: b.weakSide,
        extraSets: b.extraSets,
        code: b.code,
        ...(b.swappedFrom && { swappedFrom: b.swappedFrom }),
      }
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

  // Reps per exercise, from the goal's (or InBody's) range: holds timed, carries measured,
  // small work never below ten, heavy compounds never above twelve. After VALD, which can
  // swap an exercise for its one-sided version.
  const oneSided = new Set(data.injury.exercises.filter((r) => r.unilateral).map((r) => r.id))
  // VALD can swap an exercise for its one-sided version, which may sit elsewhere in the order:
  // the session is put back in order (a stable reorder), abs where the placement wants them.
  for (const day of fitOn ? selected : []) {
    // VALD's one-sided swap can land on an exercise the session already holds (common in a style's
    // small pool, rare in the gym's): the one-sided version, weak-side sets and all, replaces the other.
    // (The gym too: two of the same exercise in one session is never right.)
    day.chosen = day.chosen.filter(
        (c, i) => !day.chosen.some((o, j) => j !== i && o.exercise.id === c.exercise.id && (o.unilateral ? !c.unilateral || j < i : !c.unilateral && j < i)),
      )
    const priorityRank = (c: ChosenExercise) => (c.verdict.verdict === 'PRIORITY' ? 1 : 0)
    day.chosen = placeAbs(
      [...day.chosen].sort(
        (a, b) => priorityRank(b) - priorityRank(a) || skillFirst(a) - skillFirst(b) || orderRank(fit, a.exercise) - orderRank(fit, b.exercise),
      ),
      input.absPlacement,
      (c) => absView(c.exercise),
    )
  }
  for (const { chosen } of fitOn ? selected : []) {
    for (const c of chosen) {
      const base = inbody.active
        ? c.rule4
          ? String(inbody.reps[1])
          : `${inbody.reps[0]}-${inbody.reps[1]}`
        : rx.reps
      c.reps = repsFor(fit, c.exercise, base, oneSided)
      // Unloaded work is never 3-5 reps: its strength comes from the harder rung.
      if (styled && input.goal === 'Get Stronger' && data.modalities && c.exercise.type !== 'isometric' && isUnloaded(data, c.exercise))
        c.reps = data.modalities.bodyweightStrengthReps
      // Hard bodyweight and technique moves have their own counts (a negative is 3-5, never 16-19), and
      // no unloaded compound above twelve: past that the next rung is the progression.
      const caps = styled ? data.modalities?.repCaps : undefined
      if (caps) {
        const own = caps.byName[c.exercise.name] ?? (c.exercise.tags ?? []).map((t) => caps.byTag?.[t]).find(Boolean)
        if (own) c.reps = own
        else if (c.exercise.type === 'compound' && c.exercise.skill >= 2 && isUnloaded(data, c.exercise)) {
          const m = c.reps.match(/^(\d+)-(\d+)$/)
          if (m && Number(m[2]) > caps.bodyweightMaxReps) c.reps = `${Math.min(Number(m[1]), caps.bodyweightMaxReps - 4)}-${caps.bodyweightMaxReps}`
        }
      }
      // A calisthenics skill hold is short and maximal, rested fully: seconds by family, not the goal's.
      const family = styled ? skillFamilyOf(data, c.exercise) : undefined
      if (family && c.exercise.type === 'isometric' && data.modalities) {
        const l = data.modalities.ladders
        c.reps = `${l.holdSeconds[family] ?? l.holdSeconds.default} s`
        c.restSeconds = Math.max(c.restSeconds, l.skillRestSeconds)
        c.rest = String(c.restSeconds)
        continue
      }
      // A squat, hinge, press, row or pulldown is prescribed at least three sets.
      if (c.exercise.type === 'compound' && fullBodyKind(fit, c.exercise.sub) >= 0 && c.sets < fit.kindCompoundMinSets.sets)
        c.sets = fit.kindCompoundMinSets.sets
      // Heavy-compound rest is not for isolation work, holds or carries.
      const cap = restCapFor(fit, c.exercise)
      if (c.restSeconds > cap) {
        c.restSeconds = cap
        c.rest = String(cap)
      }
      // At most so many sets on one exercise of a capped group (four on a calf exercise), after InBody's sets.
      for (const cap of fit.perSessionCaps ?? [])
        if (cap.maxSetsEach !== undefined && cap.groups.includes(c.exercise.group)) c.sets = Math.min(c.sets, cap.maxSetsEach)
      // A main lift or heavy compound never rests like isolation work, whatever the goal.
      const floor = restFloorFor(fit, c.exercise, c.reps)
      if (c.restSeconds < floor) {
        c.restSeconds = floor
        c.rest = String(floor)
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
    // Warm-up posture work: light activation at fixed reps and sets, whatever the goal.
    reps: fitOn ? fit.correctives.reps : inbody.active ? `${inbody.reps[0]}-${inbody.reps[1]}` : rx.reps,
    ...(fitOn && { correctiveSets: fit.correctives.sets }),
    // Precedence: injury outranks a corrective, so a removed exercise is never added back.
    removed: isRemoved,
    // No loaded compound is warm-up work: an overhead press or a Romanian deadlift is main work.
    allowedExercise: (ex) =>
      isEligible(ex, input.level, ageBr, input.equipment, true) &&
      (!fitOn || (!fit.correctives.excludeTypes.includes(ex.type) && ex.load <= fit.correctives.maxLoad)),
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
      const rule4Blocks = formBlocks(
        rule4Idx.map((i) => pairable[i]),
        // Shape Up pairs, never circuits, even where InBody wants its fat-burning structure.
        { ...structureCtx, structure: (derived?.pairIsolation ? derived.structure : data.inbody.rule4.structure) as Structure },
      ).map((b) => remap(rule4Idx, b))
      // A session's pair limit covers both pools together.
      const left =
        structureCtx.maxPairs === undefined
          ? undefined
          : Math.max(0, structureCtx.maxPairs - rule4Blocks.filter((b) => b.indices.length > 1).length)
      return [
        ...rule4Blocks,
        ...formBlocks(
          otherIdx.map((i) => pairable[i]),
          { ...structureCtx, structure, maxPairs: left },
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

  /**
   * What no trim may remove: an exercise carrying the weaker side's extra sets (the scan found
   * it), and the only exercise for its sub-region in the week — unless that sub-region is one
   * the trim treats as redundant anyway (neck, grip, shrugs).
   */
  const weekSubs = new Map<string, number>()
  for (const d of selected)
    for (const c of d.chosen) weekSubs.set(c.exercise.sub, (weekSubs.get(c.exercise.sub) ?? 0) + 1)
  // A trainer's own pick (a swap) is theirs, so it is never removed automatically either.
  const isProtected = (c: ChosenExercise) => (c.unilateral?.extraSets ?? 0) > 0 || !!c.pinned || !!c.skill
  const isSole = (c: ChosenExercise) =>
    weekSubs.get(c.exercise.sub) === 1 &&
    !fit.trim.redundant.groups.includes(c.exercise.group) &&
    !fit.trim.redundant.subs.includes(c.exercise.sub)
  const mainLiftMinSets = fit.trim.levers.find((l) => l.id === 'main_lift')?.minSets ?? 3

  const buildCapModel = (
    list: ChosenExercise[],
    structure: Structure,
    correctives: CorrectiveSlot[],
    stretches: CorrectiveStretch[],
    fillerBouts: number,
    conditioningMinutes: number,
    conditioningFixed = false,
    /** a Full Body day, or a split's Full day: it keeps a leg lift, a press and a pull */
    fullDay = false,
    /** this day's own set ceiling, under the session's (Shape Up: Build Muscle's day) */
    dayMaxSets?: number,
    /** the shortest the planned conditioning may be cut to: a metcon is never cut */
    conditioningShortest = 5,
  ): CapDayModel => {
    const blockCache = new Map<string, Block[]>()
    const listed = list.map((c) => c.exercise)
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
      conditioningFixed,
      conditioningShortest,
      ...(derived?.pairIsolation && { maxStructure: derived.structure as Structure }),
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
      data: timecapData,
      minSets: data.timecap.floors.sessionMinSets,
      ...(fitOn && {
        setupSeconds: list.map((c) => setupSeconds(fit, c.exercise)),
        rampSeconds: fit.time.rampSecondsPerMainLift[input.goal] ?? 0,
        // A new style's warm-up is the five moves (five minutes) where the gym's is four minutes of cardio.
        warmup: moveWarmup ? { ...fit.warmup, generalMinutes: warmupMinutesFor(data) } : fit.warmup,
        maxSets: dayMaxSets !== undefined && maxSets !== undefined ? Math.min(maxSets, dayMaxSets) : maxSets,
        protectedIdx: list.map(isProtected),
        soleIdx: list.map(isSole),
        redundant: (i: number, alive: readonly boolean[]) => isRedundant(fit, listed, alive, i),
        mainLiftMinSets,
        restFloors: list.map((c) => restFloorFor(fit, c.exercise, c.reps)),
        compoundFloor: { sets: fit.trim.compoundFloor.sets, isolationAbove: fit.trim.compoundFloor.whileIsolationAbove },
        pairRestMax: true,
        mainLifts: {
          keep: fit.trim.mainLifts.keep[input.level] ?? fit.trim.mainLifts.keep.default,
          // dropFirst's sub-regions in order, then every other main lift
          dropRank: list.map((c) => {
            const at = fit.trim.mainLifts.dropFirst.indexOf(c.exercise.sub)
            return at >= 0 ? at : fit.trim.mainLifts.dropFirst.length
          }),
        },
        ...(fullDay && {
          // A Full Body day keeps a lower-body lift, a push and a pull.
          essential: (i: number, alive: readonly boolean[]) => {
            const kind = fullBodyKindOf(fit, listed[i])
            return kind >= 0 && !listed.some((o, j) => j !== i && alive[j] && fullBodyKindOf(fit, o) === kind)
          },
        }),
      }),
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
      (i) => isAbs(absView(chosen[i].exercise)),
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
      !!conditioning?.planned,
      fitOn && (input.split === 'Full Body' || /full/i.test(label)),
      referenceSets.get(dayIndex),
      conditioning?.metcon ? conditioning.minutes : 5,
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

  /**
   * The day's warm-up posture work: the corrective block, less anything the session already
   * trains (a rear-delt corrective on a day with a reverse pec deck), and the stretches that
   * belong to what is left.
   */
  const warmupFor = (chosen: ChosenExercise[]) => {
    const trained = new Set(chosen.map((c) => c.exercise.sub))
    const correctives = fitOn && fit.correctives.skipWhenSubTrained
      ? bodydot.correctives.filter((c) => !trained.has(c.exercise.sub))
      : bodydot.correctives
    const held = new Set(correctives.flatMap((c) => c.codes))
    return {
      correctives,
      stretches: bodydot.stretches.filter((st) => st.codes.some((code) => held.has(code))),
    }
  }

  const days: GeneratedDay[] = selected.map(({ index, label, chosen }) => {
    const w = warmupFor(chosen)
    return buildDay(index, label, chosen, baseStructure, w.correctives, w.stretches)
  })

  // Shape Up's planned conditioning: its real difference from Build Muscle. Ten minutes on two sessions a week
  // (three when InBody shows body fat over range), spread across the week, inside the hour: the trim makes room
  // for it and never drops it. Intervals from intermediate under fifty, steady work otherwise.
  const planned = derived?.plannedConditioning
  if (planned && days.length > 0) {
    const count = Math.min(days.length, inbody.active && inbody.states.pbf === 'Over' ? planned.sessionsFatHigh : planned.sessions)
    const at = new Set(Array.from({ length: count }, (_, k) => Math.floor(((k + 0.5) * days.length) / count)))
    const base = prescribeConditioning(data.sessionlength, planned.minutes, Object.keys(input.pains))
    if (base) {
      const intervals = planned.intervals.fromLevel.includes(input.level) && input.age < planned.intervals.underAge
      const pick = intervals ? [base.modality, ...base.alternatives].find((m) => m.id === 'intervals') : undefined
      const conditioning: Conditioning = {
        ...base,
        ...(pick && { modality: pick, alternatives: [base.modality, ...base.alternatives].filter((m) => m.id !== pick.id) }),
        planned: true,
      }
      days.forEach((d, i) => {
        if (!at.has(i)) return
        days[i] = buildDay(d.index, d.label, d.exercises, d.structure, d.correctives, d.correctiveStretches, d.fillerBouts, conditioning, d.restBoost)
      })
    }
  }

  // CrossFit's metcon: the session's finish, which the hour is fitted around and the trim never
  // cuts (it takes its minutes out of the strength part). Every day for CrossFit on its own; on a
  // hybrid, half the week's days, spread.
  if (styles.includes('CrossFit') && data.modalities && days.length > 0) {
    const rules = data.modalities.crossfit.metcon
    const count = strengthStyles.length === 1 ? days.length : Math.ceil(days.length / 2)
    // From the first day: a one-day strength week (the first day of a two-day program) keeps its metcon.
    const at = new Set(Array.from({ length: count }, (_, k) => Math.floor((k * days.length) / count)))
    const usedInMetcons = new Set<number>()
    days.forEach((d, i) => {
      if (!at.has(i)) return
      const metcon = buildMetcon(data, rules, {
        usedThisWeek: usedInMetcons,
        level: input.level,
        goal: input.goal,
        age: input.age,
        ageBr,
        equipment: input.equipment,
        dayIndex: i,
        strength: d.exercises.map((c) => c.exercise),
        heavyHingeToday: d.exercises.some((c) => isHeavyHinge(fit, c.exercise)),
        verdicts,
      })
      if (!metcon) {
        // Too few moves left for a metcon (pains, age): the session still finishes with its planned
        // conditioning, the same minutes, on what the client can do.
        const fallback = prescribeConditioning(data.sessionlength, rules.minutes[input.level] ?? 10, Object.keys(input.pains))
        if (fallback) days[i] = buildDay(d.index, d.label, d.exercises, d.structure, d.correctives, d.correctiveStretches, d.fillerBouts, { ...fallback, planned: true }, d.restBoost)
        return
      }
      const conditioning: Conditioning = {
        minutes: metcon.minutes,
        modality: { id: 'metcon', label: `Metcon · ${metcon.format}`, impact: false },
        alternatives: [],
        impactWithheldFor: [],
        planned: true,
        metcon,
      }
      days[i] = buildDay(d.index, d.label, d.exercises, d.structure, d.correctives, d.correctiveStretches, d.fillerBouts, conditioning, d.restBoost)
    })
  }

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


  // ---- fitting the hour ------------------------------------------------------
  // Every session fits a one-hour personal-training session (fit.json). Each day is resolved
  // to the whole-number sets the client is actually prescribed, then brought inside the hour
  // AND the session's working-set ceiling by the time-cap search: the cheapest compromises
  // first (supersets, rest, what the session already covers), the weaker side's work and the
  // trainer's own picks never, a main lift only as the last resort and never below three sets.
  // It only ever removes, and the plan is recomputed from the untouched day on every
  // generation, so it is deterministic. A session that comes out short of the band floor is
  // then filled (rest within the prescription, then conditioning), never past the hour.
  //
  // With `fitHour: false` this is the spec's order instead: fill every session into the 55-75
  // band, then trim only the days the client asked for, to the band ceiling.
  const sl = data.sessionlength
  const rawBand = bandFor(sl, ageBr)
  const capTarget = fitOn ? fit.sessionMinutes : rawBand ? rawBand[1] : data.timecap.target
  const band: readonly [number, number] | null = rawBand
    ? fitOn
      ? [Math.min(rawBand[0], capTarget), capTarget]
      : rawBand
    : null
  const capApplied: TimeCapResult['applied'] = []
  const capRetired: { pin: CapPin; reason: string }[] = []

  /** Trims these days to the target; `always` records a plan even for a day already inside it. */
  const trimDays = (which: Set<number>, always: boolean) => {
    if (which.size === 0) return
    // Whole-number sets first, so the search drives the number the client actually reads.
    const rounding = roundSets({ days })
    for (let at = 0; at < days.length; at++) {
      if (!which.has(days[at].index)) continue
      const d = days[at]
      d.exercises.forEach((c, i) => {
        c.sets = rounding.byPick.get(pickKey(d.index, i)) ?? c.sets
      })
      days[at] = buildDay(d.index, d.label, d.exercises, d.structure, d.correctives, d.correctiveStretches, d.fillerBouts, d.conditioning, d.restBoost)
    }
    for (let at = 0; at < days.length; at++) {
      const day = days[at]
      if (!which.has(day.index)) continue
      const model = day.capModel
      // At generation the search is bounded tighter than a button press: a program builds in
      // about a second, and an unproven plan still fits — it is the cheapest found so far.
      const plan = planCap(model, { target: capTarget, ...(fitOn && { nodeLimit: 8_000 }) })
      if (!always && plan.steps.length === 0) continue
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
      const stretches = day.correctiveStretches.filter((st) => st.codes.some((c) => liveCodes.has(c)))
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
        // Conditioning is the cheapest lever, so it is the first thing a trim removes.
        state.conditioningAlive
          ? state.conditioningShort && day.conditioning
            ? { ...day.conditioning, minutes: Math.min(day.conditioning.minutes, 5) }
            : day.conditioning
          : null,
        day.restBoost,
      )
      // `model` is the day as the search saw it — whole sets, nothing cut yet. Kept so the
      // plan can be re-derived and re-proved from outside.
      capApplied.push({ dayIndex: day.index, plan, model })
    }
  }

  /**
   * Fills every session short of the band floor without adding a set: rest is raised (with
   * fit.json never past the prescription's own range, nor isolation work past its cap), and
   * whatever is still missing becomes conditioning, rounded UP to five minutes.
   *
   * Ages 6-12 have no band at all and neither lever is applied to them — a ten-year-old
   * should not be given an hour, and their session is whatever their volume produces.
   */
  const fillDays = () => {
    if (!band) return
    const [floor] = band
    // InBody's rest replaces the goal's prescription, so it is the ceiling when it is active.
    const maxRest = fitOn && fit.rest.neverAbovePrescription
      ? Math.min(maxRestFor(sl, input.goal), inbody.active ? inbody.rest : rxRestHi)
      : maxRestFor(sl, input.goal)
    const restCeiling = (c: ChosenExercise) => (fitOn ? Math.min(maxRest, restCapFor(fit, c.exercise)) : maxRest)
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
                restSeconds: boostedRest(c.restSeconds, boost, restCeiling(c), step),
              }))
        const model = buildCapModel(
          list,
          day.structure,
          day.correctives,
          day.correctiveStretches,
          day.fillerBouts,
          conditioning,
          !!day.conditioning?.planned,
          fitOn && (input.split === 'Full Body' || /full/i.test(day.label)),
        )
        return capMinutes(model, { ...baseState(model), sets })
      }

      // Lever 1 — rest. Free: no work is added or removed, only the interval between sets.
      // The Lose Fat ceiling is deliberately low, because short rest IS the fat-loss method;
      // a client resting three minutes is no longer doing fat-loss training.
      let boost = solveRestBoost(
        floor,
        day.exercises.map((c) => c.restSeconds),
        sl,
        input.goal,
        (b) => probe(b, day.conditioning?.planned ? day.conditioning.minutes : 0),
      )
      // Stepped rest rounds up, so on a long list of sets it could jump past the hour: not taken.
      if (fitOn && boost > 0 && probe(boost, day.conditioning?.planned ? day.conditioning.minutes : 0) > capTarget) boost = 0
      if (boost > 0) {
        for (const c of day.exercises) {
          c.restSeconds = boostedRest(c.restSeconds, boost, restCeiling(c), step)
          // A raised rest is a single number, not the prescription's range — the client has
          // to be able to follow it on a clock.
          c.rest = String(c.restSeconds)
        }
      }

      // Lever 2 — conditioning, rounded UP to five minutes. Rounding to the NEAREST five
      // leaves a session a minute or two under the floor, which reaches the band never.
      // A planned block (Shape Up) stays as it is; anything else short of the floor gets filler.
      const conditioning = day.conditioning?.planned
        ? day.conditioning
        : prescribeConditioning(
            sl,
            fitOn
              ? Math.min(conditioningMinutes(sl, floor, probe(0, 0)), conditioningCapFor(fit, input.goal))
              : conditioningMinutes(sl, floor, probe(0, 0)),
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
  }

  if (fitOn) {
    trimDays(new Set(days.map((d) => d.index)), false)
    // A metcon day the trim could not bring inside the hour (everything left is protected) takes the
    // minutes it is over out of the metcon's clock instead, never below eight: same workout, shorter.
    if (data.modalities && days.some((d) => d.conditioning?.metcon)) refreshWholeSetMinutes()
    if (data.modalities)
      days.forEach((d, i) => {
        const mc = d.conditioning?.metcon
        if (!mc || d.wholeSetMinutes <= capTarget + 1e-6) return
        const room = Math.floor(mc.minutes - (d.wholeSetMinutes - capTarget))
        if (room >= mc.minutes) return
        const shorter = buildMetcon(data, data.modalities!.crossfit.metcon, {
          level: input.level,
          goal: input.goal,
          age: input.age,
          ageBr,
          equipment: input.equipment,
          dayIndex: i,
          strength: d.exercises.map((c) => c.exercise),
          heavyHingeToday: d.exercises.some((c) => isHeavyHinge(fit, c.exercise)),
          verdicts,
          moves: mc.moves.map((x) => x.exercise),
          maxMinutes: Math.max(8, room),
        })
        if (!shorter || !d.conditioning) return
        days[i] = buildDay(d.index, d.label, d.exercises, d.structure, d.correctives, d.correctiveStretches, d.fillerBouts, { ...d.conditioning, minutes: shorter.minutes, metcon: shorter }, d.restBoost)
      })
    refreshWholeSetMinutes()
    fillDays()
    // The two exercises of a pair share one rest, the longer of theirs, taken after each round
    // (the time model already charges it so).
    for (const d of days)
      for (const b of d.blocks) {
        if (b.indices.length < 2) continue
        const rest = Math.max(...b.indices.map((i) => d.exercises[i].restSeconds))
        for (const i of b.indices) {
          if (d.exercises[i].restSeconds === rest) continue
          d.exercises[i].restSeconds = rest
          d.exercises[i].rest = String(rest)
        }
      }
  } else {
    fillDays()
    // Only the days the client pressed "Reduce" on; a press whose day no longer exists is retired.
    const capPins = input.caps ?? []
    const pressed = new Set<number>()
    for (const pin of capPins) {
      if (days.some((d) => d.index === pin.dayIndex)) pressed.add(pin.dayIndex)
      else capRetired.push({ pin, reason: `day ${pin.dayIndex + 1} no longer exists in this program` })
    }
    trimDays(pressed, true)
  }
  refreshWholeSetMinutes()

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

  // The five-move warm-up, from the finished sessions (after the trim, so it warms up what is left).
  if (moveWarmup)
    for (const d of days)
      d.warmupMoves = warmupMoves(
        data,
        exercises,
        [
          ...d.exercises.map((c) => ({ exercise: c.exercise, sets: c.sets })),
          // the metcon's moves are warmed up too (two sets' worth each)
          ...(d.conditioning?.metcon?.moves ?? []).map((m) => ({ exercise: m.exercise, sets: 2 })),
        ],
        {
        rungs,
        ladders,
        ageBr,
        equipment: input.equipment,
        verdicts,
      })

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
      structure: baseStructure,
      loadAdjustment: data.structure.loadAdjustment[baseStructure] ?? 0,
      restMultiplier: tp.restMultiplier,
      inbody,
      vald,
      bodydot,
      load,
      amend,
      timecap,
      verdicts,
      removedByPain,
      styles: {
        styles,
        rungs:
          ladders && rungs
            ? [...ladders.entries()]
                .filter(([, steps]) => steps.some((st) => st.exercises.some((e) => inPool(e))))
                .map(([family, steps]) => {
                  const r = rungs.get(family)!
                  const i = steps.findIndex((st) => st.rung === r.rung)
                  return {
                    family,
                    rung: r.rung,
                    set: r.set,
                    exercises: steps[i]?.exercises.map((e) => e.name) ?? [],
                    next: steps[i + 1]?.exercises.map((e) => e.name) ?? [],
                    top: steps[steps.length - 1].rung,
                    /** where it sits on the ladder (1-based) and the rungs either side, for the trainer's buttons */
                    step: i + 1,
                    steps: steps.length,
                    prevRung: steps[i - 1]?.rung,
                    nextRung: steps[i + 1]?.rung,
                  }
                })
            : [],
      },
    },
  }
}
