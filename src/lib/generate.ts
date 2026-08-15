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
  evaluateInBody,
  groupsForRegions,
  slotLoad,
  type InBodyResult,
} from './inbody'
import {
  blockSeconds,
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
  sets: number
  reps: string
  rest: string
  /** why this pick is not a clean first-choice, if applicable */
  flag?: 'reused' | 'substituted'
  /** injury-layer verdict for this exercise against the ticked pains */
  verdict: ExerciseVerdict
  /** InBody rule 4 forced the fat-burning structure on this slot */
  rule4?: boolean
  /** per-slot load adjustment, as a fraction — two slots can legitimately differ */
  loadAdjustment?: number
}

export interface GeneratedDay {
  index: number
  label: string
  exercises: ChosenExercise[]
  /** how the session is performed — one entry per straight exercise or paired block */
  blocks: Block[]
  /** sum of sets across the day */
  totalSets: number
  minutes: number
  overCeiling: boolean
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
  timeCeiling: number
  /** exposed so the simple view can recompute session length from its whole-number sets */
  timeParams: TimeParams
  structure: Structure
  /** how much lighter this structure runs, as a fraction (triset -0.08) */
  loadAdjustment: number
  restMultiplier: number
  /** everything the InBody layer derived and changed; inert when no scan was entered */
  inbody: InBodyResult
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
): boolean {
  if (ex.type === 'mobility') return false
  if (ex.avoidAges.includes(ageBr)) return false
  if (!isEquipmentAvailable(ex, equipment)) return false

  if (level === 'Beginner' && ex.skill > 2) return false
  if (level === 'Intermediate' && ex.skill > 4) return false

  if (ageBr === '6-12' && ex.load > 3) return false
  if (ageBr === '65+' && (ex.load > 4 || ex.skill > 3)) return false
  if (ageBr === '13-17' && level === 'Beginner' && ex.load > 4) return false

  return true
}

/** Spec ranking: main lift (Get Stronger only) -> tier -> load desc -> id asc. */
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

  const warnings: Warning[] = []
  const usedThisWeek = new Set<number>()
  const selected: { index: number; label: string; chosen: ChosenExercise[] }[] = []

  block.days.forEach((allocDay, dayIndex) => {
    const chosen: ChosenExercise[] = []

    for (const slot of allocDay.slots as Slot[]) {
      const [sub, count, setsPerExercise] = slot

      for (let n = 0; n < count; n++) {
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
          sets: setsPerExercise,
          reps: rx.reps,
          rest: rx.rest,
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

    selected.push({ index: dayIndex, label: allocDay.label, chosen })
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

  const days: GeneratedDay[] = selected.map(({ index: dayIndex, label, chosen }) => {
    // InBody replaces the goal-keyed values on each slot. Sets come from the resolved
    // per-group figure; reps and rest from the blended, floored numbers.
    if (inbody.active) {
      for (const c of chosen) {
        const resolved = inbody.sets[c.exercise.group]
        if (resolved !== undefined) c.sets = resolved
        c.reps = onRule4(c) ? String(inbody.reps[1]) : `${inbody.reps[0]}-${inbody.reps[1]}`
        c.rest = String(onRule4(c) ? rule4Rest : inbody.rest)
        c.rule4 = onRule4(c)
      }
    }

    const pairable = chosen.map((c) => ({
      exercise: c.exercise,
      sets: c.sets,
      corrective: correctiveIds.has(c.exercise.id),
    }))

    // The structure is now per region: rule-4 slots are supersetted while the rest keep the
    // client's own choice, so blocks are formed within each pool and merged.
    let blocks: Block[]
    if (inbody.active && rule4Groups.size > 0) {
      const rule4Idx = chosen.map((c, i) => (onRule4(c) ? i : -1)).filter((i) => i >= 0)
      const otherIdx = chosen.map((_, i) => i).filter((i) => !rule4Idx.includes(i))
      const remap = (subset: number[], b: Block): Block => ({
        ...b,
        indices: b.indices.map((i) => subset[i]),
      })
      blocks = [
        ...formBlocks(
          rule4Idx.map((i) => pairable[i]),
          { ...structureCtx, structure: data.inbody.rule4.structure as Structure },
        ).map((b) => remap(rule4Idx, b)),
        ...formBlocks(
          otherIdx.map((i) => pairable[i]),
          structureCtx,
        ).map((b) => remap(otherIdx, b)),
      ].sort((a, b) => a.indices[0] - b.indices[0])
    } else {
      blocks = formBlocks(pairable, structureCtx)
    }

    // Step 8 — load is per slot, not per program: two slots in one session can carry
    // different adjustments because their structures differ.
    for (const b of blocks) {
      const blockLoad = b.indices.length > 1 ? (data.structure.loadAdjustment[b.structure] ?? 0) : 0
      for (const i of b.indices) {
        // A rule-4 slot carries the fat-burning structure by instruction, so it takes that
        // load adjustment whether or not a legal partner happened to be found for it.
        const structureLoad = chosen[i].rule4 ? data.inbody.rule4.loadAdjustment : blockLoad
        chosen[i].loadAdjustment = inbody.active
          ? slotLoad(data.inbody, inbody, structureLoad)
          : structureLoad
      }
    }

    const totalSets = chosen.reduce((s, c) => s + c.sets, 0)
    // Per-block timing, since one region can be supersetted while another is straight.
    const minutes =
      blocks.reduce((sum, b) => {
        const isRule4 = onRule4(chosen[b.indices[0]])
        const params = inbody.active
          ? {
              ...tp,
              restSeconds: isRule4 ? rule4Rest : inbody.rest,
              restMultiplier:
                b.indices.length > 1
                  ? (data.structure.restMultiplier[b.structure] ?? 1)
                  : tp.restMultiplier,
            }
          : tp
        return sum + blockSeconds(b, (i) => chosen[i].sets, params)
      }, 0) /
        60 +
      config.warmupMinutes

    return {
      index: dayIndex,
      label,
      exercises: chosen,
      blocks,
      totalSets,
      minutes,
      overCeiling: minutes > config.timeCeiling[input.goal],
    }
  })

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
      timeCeiling: config.timeCeiling[input.goal],
      timeParams: tp,
      structure: input.structure,
      loadAdjustment: data.structure.loadAdjustment[input.structure] ?? 0,
      restMultiplier: tp.restMultiplier,
      inbody,
      verdicts,
      removedByPain,
    },
  }
}
