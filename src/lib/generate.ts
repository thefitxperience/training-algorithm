import type {
  AllocationBlock,
  ClientInput,
  DataBundle,
  Exercise,
  PrescriptionEntry,
  Slot,
} from '../types'
import { isEquipmentAvailable, type EquipmentTier } from './equipment'

export interface ChosenExercise {
  exercise: Exercise
  /** the sub-region the allocation asked for (may differ from exercise.sub on a substitution) */
  requestedSub: string
  sets: number
  reps: string
  rest: string
  /** why this pick is not a clean first-choice, if applicable */
  flag?: 'reused' | 'substituted'
}

export interface GeneratedDay {
  index: number
  label: string
  exercises: ChosenExercise[]
  /** sum of sets across the day */
  totalSets: number
  minutes: number
  overCeiling: boolean
}

export type WarningKind = 'reuse' | 'substitute' | 'dropped'

export interface Warning {
  kind: WarningKind
  dayIndex: number
  dayLabel: string
  sub: string
  message: string
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
  /** minutes = totalSets * minutesPerSet + warmupMinutes — exposed so the simple view can
   *  recompute session length from its whole-number sets */
  minutesPerSet: number
  warmupMinutes: number
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

export function rankCandidates(candidates: Exercise[], goal: string): Exercise[] {
  return [...candidates].sort((a, b) => {
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
      error: `No allocation block for key "${key}". This combination is not present in allocation.json.`,
    }
  }

  const pKey = prescriptionKey({ sex: input.sex, days: input.days, ageBr, level: input.level })
  const rx = prescription[pKey]?.[input.goal]
  if (!rx) {
    return {
      ok: false,
      key: pKey,
      ageBracket: ageBr,
      error: `No prescription entry for key "${pKey}" / goal "${input.goal}".`,
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

  const eligibleIn = (sub: string): Exercise[] =>
    (bySub.get(sub) ?? []).filter((ex) => isEligible(ex, input.level, ageBr, input.equipment))

  const warnings: Warning[] = []
  const usedThisWeek = new Set<number>()
  const days: GeneratedDay[] = []

  block.days.forEach((allocDay, dayIndex) => {
    const chosen: ChosenExercise[] = []

    for (const slot of allocDay.slots as Slot[]) {
      const [sub, count, setsPerExercise] = slot

      for (let n = 0; n < count; n++) {
        const ranked = rankCandidates(eligibleIn(sub), input.goal)

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

        // Was this sub-region emptied by the equipment filter specifically, or by age/level?
        const equipmentBlocked =
          input.equipment !== 'Full gym' &&
          (bySub.get(sub) ?? []).some((ex) => isEligible(ex, input.level, ageBr, 'Full gym'))
        const because = equipmentBlocked ? ` (equipment: ${input.equipment})` : ''

        // 3. nothing eligible here -> sibling sub-region in the SAME muscle group
        if (!pick) {
          const group = subToGroup.get(sub)
          if (group) {
            const siblings = (groupToSubs.get(group) ?? []).filter((s) => s !== sub)
            const siblingPool = rankCandidates(siblings.flatMap(eligibleIn), input.goal)
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
            kind: 'dropped',
            dayIndex,
            dayLabel: allocDay.label,
            sub,
            message: `Day ${dayIndex + 1} (${allocDay.label}): slot "${sub}" dropped${because} — no eligible exercise in this sub-region or any sibling in the same muscle group.`,
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
        })
      }
    }

    // Session ordering: on Get Stronger the day must open on its main lifts. This is a
    // stable reorder of the same picks, so muscle-group volume is untouched.
    if (input.goal === 'Get Stronger') {
      chosen.sort((a, b) => Number(b.exercise.mainLift) - Number(a.exercise.mainLift))
    }

    const totalSets = chosen.reduce((s, c) => s + c.sets, 0)
    const minutes =
      (totalSets * (config.repsMid[input.goal] * 3 + config.restMid[input.goal])) / 60 +
      config.warmupMinutes

    days.push({
      index: dayIndex,
      label: allocDay.label,
      exercises: chosen,
      totalSets,
      minutes,
      overCeiling: minutes > config.timeCeiling[input.goal],
    })
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
      minutesPerSet: (config.repsMid[input.goal] * 3 + config.restMid[input.goal]) / 60,
      warmupMinutes: config.warmupMinutes,
    },
  }
}
