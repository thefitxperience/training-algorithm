import type { Exercise, InjuryData, InjuryExercise, Pain } from '../types'

export type Verdict = 'PRIORITY' | 'REMOVE' | 'SIDE_ONLY' | 'CAUTION' | 'OK'
export type Side = 'Left' | 'Right' | 'Both'

/** Which pains the client ticked, and for sided pains which side. */
export type PainSelection = Record<string, Side>

export interface PainVerdict {
  painId: string
  painLabel: string
  verdict: Verdict
  /** why — a load-tag description or a sub-region name, for the badge copy */
  reason: string
  side?: Side
}

export interface ExerciseVerdict {
  verdict: Verdict
  /** one entry per ticked pain that had any interaction (OK entries are dropped) */
  byPain: PainVerdict[]
  /** the pain verdict that decided the combined verdict, for badge text */
  decidedBy?: PainVerdict
}

export interface InjuryIndex {
  byId: Map<number, InjuryExercise>
  pains: Map<string, Pain>
  /**
   * `alsoTrains` entries converted to "Group > Sub-region" keys. Per spec, each bare name
   * is resolved by finding an exercise in exercises.json whose `sub` matches and taking
   * its `group` — an exact join, never fuzzy.
   */
  alsoTrainsKeys: Map<number, string[]>
  /**
   * `alsoTrains` names that no `sub` in exercises.json matches, so they can't be converted.
   * These are the eight library spellings (e.g. "Mid" vs "Mid (flat)"); surfaced rather
   * than guessed at.
   */
  unresolvedAlsoTrains: string[]
}

export function buildInjuryIndex(injury: InjuryData, exercises: Exercise[]): InjuryIndex {
  const byId = new Map(injury.exercises.map((r) => [r.id, r]))
  const pains = new Map(injury.pains.map((p) => [p.id, p]))

  const subToGroup = new Map<string, string>()
  for (const e of exercises) subToGroup.set(e.sub, e.group)

  const alsoTrainsKeys = new Map<number, string[]>()
  const unresolved = new Set<string>()
  for (const e of exercises) {
    const keys: string[] = []
    for (const also of e.alsoTrains) {
      const group = subToGroup.get(also)
      if (group) keys.push(`${group} > ${also}`)
      else unresolved.add(also)
    }
    alsoTrainsKeys.set(e.id, keys)
  }

  return { byId, pains, alsoTrainsKeys, unresolvedAlsoTrains: [...unresolved].sort() }
}

/**
 * One exercise against one pain. The five rules are evaluated in this exact order and the
 * first match wins — the order is the rule, not a preference.
 */
export function verdictForPain(
  exerciseId: number,
  painId: string,
  side: Side,
  injury: InjuryData,
  index: InjuryIndex,
): PainVerdict {
  const rec = index.byId.get(exerciseId)
  const rule = injury.rules[painId]
  const pain = index.pains.get(painId)
  const base = { painId, painLabel: pain?.label ?? painId, side }

  if (!rec || !rule || !pain) return { ...base, verdict: 'OK', reason: '' }

  const tagReason = (tag: string) => injury.loadTags[tag] ?? tag

  // 1. PRIORITY — in a priority sub-region AND flagged corrective. Both, not either.
  if (rule.prioritySubRegions.includes(rec.key) && rec.corrective) {
    return { ...base, verdict: 'PRIORITY', reason: rec.key }
  }

  // 2. REMOVE — sub-region is removed, or the exercise carries a removed load tag.
  const removedSub = rule.removeSubRegions.includes(rec.key)
  const removedTag = rec.loadTags.find((t) => rule.removeTags.includes(t))
  if (removedSub || removedTag) {
    const reason = removedSub ? rec.key : tagReason(removedTag!)
    // 3. SIDE_ONLY — a removal, but the pain is one-sided and the exercise is unilateral,
    //    so it survives on the pain-free side.
    if (pain.sided && (side === 'Left' || side === 'Right') && rec.unilateral) {
      return { ...base, verdict: 'SIDE_ONLY', reason }
    }
    return { ...base, verdict: 'REMOVE', reason }
  }

  // 4. CAUTION — cautioned sub-region, cautioned load tag, or a secondary muscle that
  //    lands in a removed or cautioned sub-region.
  if (rule.cautionSubRegions.includes(rec.key)) {
    return { ...base, verdict: 'CAUTION', reason: rec.key }
  }
  const cautionTag = rec.loadTags.find((t) => rule.cautionTags.includes(t))
  if (cautionTag) {
    return { ...base, verdict: 'CAUTION', reason: tagReason(cautionTag) }
  }
  const alsoHit = (index.alsoTrainsKeys.get(exerciseId) ?? []).find(
    (k) => rule.removeSubRegions.includes(k) || rule.cautionSubRegions.includes(k),
  )
  if (alsoHit) {
    return { ...base, verdict: 'CAUTION', reason: alsoHit }
  }

  // 5. OK
  return { ...base, verdict: 'OK', reason: '' }
}

/**
 * Combine across every ticked pain.
 *
 * REMOVE from any pain wins outright — the spec is explicit that a PRIORITY from one pain
 * must not resurrect an exercise another pain removed. After that: PRIORITY, SIDE_ONLY,
 * CAUTION, OK. (injury.json's `precedence` array lists PRIORITY first; the written rule
 * overrides it, since it states the REMOVE case directly.)
 */
export function combineVerdicts(perPain: PainVerdict[]): ExerciseVerdict {
  const interacting = perPain.filter((v) => v.verdict !== 'OK')
  const pick = (v: Verdict) => interacting.find((p) => p.verdict === v)

  for (const v of ['REMOVE', 'PRIORITY', 'SIDE_ONLY', 'CAUTION'] as const) {
    const hit = pick(v)
    if (hit) return { verdict: v, byPain: interacting, decidedBy: hit }
  }
  return { verdict: 'OK', byPain: [] }
}

export function evaluateAll(
  exercises: Exercise[],
  selection: PainSelection,
  injury: InjuryData,
  index: InjuryIndex,
): Map<number, ExerciseVerdict> {
  const ticked = Object.entries(selection)
  const out = new Map<number, ExerciseVerdict>()
  for (const e of exercises) {
    if (ticked.length === 0) {
      out.set(e.id, { verdict: 'OK', byPain: [] })
      continue
    }
    out.set(
      e.id,
      combineVerdicts(
        ticked.map(([painId, side]) => verdictForPain(e.id, painId, side, injury, index)),
      ),
    )
  }
  return out
}

/** Badge/tooltip text from injury.json's copy block, with the placeholders filled in. */
export function copyFor(
  injury: InjuryData,
  key: string,
  vars: Record<string, string | number>,
): string {
  let out = injury.copy[key] ?? ''
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}
