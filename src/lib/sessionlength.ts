import type { ConditioningModality, SessionLengthData } from '../types'

/**
 * Session length — every workout in 55-75 minutes.
 *
 * Sessions were short because the three volume tables are each calibrated at a different
 * implied frequency: Build Muscle needs 32 sets for a 55-minute session and gets exactly 32,
 * while **Lose Fat needs 46 and gets 23**. That is why a 25-year-old fat-loss client was being
 * handed a 25-minute session.
 *
 * The fix is NOT to rewrite what a client trains. The proposal that came with this — Lose Fat
 * frequency multipliers of 1.00/1.50/2.00/2.50/3.00 — would double fat-loss volume at 4 days
 * and triple it at 6, at which point a fat-loss client out-trains a muscle-building client in
 * 14 of 15 muscle groups. It is recorded in the data file as rejected, and the volume tables
 * are untouched. Length is solved with two levers that add no sets:
 *
 *   1. REST          raise rest until the session reaches the floor, capped per goal
 *   2. CONDITIONING  fill whatever remains, rounded UP to 5 minutes, capped at 35
 *   3. TRIM          anything over the ceiling is the time-cap engine's job
 *
 * Ages 6-12 are excluded from all of it. A ten-year-old should not be given an hour; their
 * session is whatever their volume produces.
 */

export type Band = readonly [number, number]

/** The band for this age, or null where the file gives the bracket none. */
export function bandFor(data: SessionLengthData, ageBracket: string): Band | null {
  const byAge = data.band.byAge
  // `null` in the file is a real answer — no band — and is not the same as an absent key.
  if (Object.prototype.hasOwnProperty.call(byAge, ageBracket)) {
    const found = byAge[ageBracket]
    return found ? [found[0], found[1]] : null
  }
  return [data.band.default[0], data.band.default[1]]
}

const lever = (data: SessionLengthData, id: string) => data.levers.find((l) => l.id === id)

/** The ceiling rest may be raised to for this goal. 0 disables the lever rather than freeing it. */
export function maxRestFor(data: SessionLengthData, goal: string): number {
  return lever(data, 'rest')?.maxRest?.[goal] ?? 0
}

export function restStep(data: SessionLengthData): number {
  return lever(data, 'rest')?.step ?? 5
}

export function maxConditioningMinutes(data: SessionLengthData): number {
  return lever(data, 'conditioning')?.maxMinutes ?? 0
}

/**
 * Rest for one exercise after a boost of `boost` seconds.
 *
 * A boosted rest is snapped up onto the step grid, because a prescribed rest is a number the
 * client reads off a clock: a Lose Fat slot sits at 37.5 s by prescription, and raising it to
 * 42.5 would be arithmetic nobody can follow. Snapping runs only where the lever actually
 * moves — at boost 0 the prescribed value stands exactly as it was.
 *
 * The boost never lowers rest. Where a prescribed rest already sits at or above the goal's
 * ceiling the ceiling has nothing to say and the value stands.
 */
export function boostedRest(base: number, boost: number, maxRest: number, step = 5): number {
  if (boost <= 0) return base
  const snapped = Math.ceil((base + boost) / step) * step
  return Math.max(base, Math.min(snapped, maxRest))
}

/**
 * The largest boost that can change anything. Past this every exercise is at the goal's
 * ceiling, so searching further only burns evaluations.
 */
export function maxBoost(bases: number[], maxRest: number): number {
  const lowest = bases.length ? Math.min(...bases) : maxRest
  return Math.max(0, Math.round(maxRest - lowest))
}

/**
 * The smallest boost, in whole steps, that brings `minutesAt` up to the floor — or the largest
 * boost available when even that cannot reach it. Never overshoots: the lever exists to reach
 * the floor, not to spend a client's evening on rest intervals.
 */
export function solveRestBoost(
  floor: number,
  bases: number[],
  data: SessionLengthData,
  goal: string,
  minutesAt: (boost: number) => number,
): number {
  const ceiling = maxRestFor(data, goal)
  const step = restStep(data)
  const limit = maxBoost(bases, ceiling)
  if (limit <= 0 || minutesAt(0) >= floor) return 0
  for (let boost = step; boost <= limit; boost += step) {
    if (minutesAt(boost) >= floor) return boost
  }
  // Rounded up to a whole step so the prescribed rest is a number a client can read off a
  // clock, even where the ceiling itself is not a multiple of the step.
  return Math.ceil(limit / step) * step
}

/**
 * Conditioning minutes for a session still short of the floor, or 0.
 *
 * Rounded UP to the nearest 5. To the *nearest* 5, a session 1.4 minutes short is given zero
 * conditioning and never reaches the band at all — which on its own left 391 blocks short.
 */
export function conditioningMinutes(
  data: SessionLengthData,
  floor: number,
  minutes: number,
): number {
  const shortfall = floor - minutes
  if (shortfall <= 0) return 0
  const to = data.conditioning.roundToMinutes || 5
  return Math.min(maxConditioningMinutes(data), Math.ceil(shortfall / to) * to)
}

/**
 * The modalities this client may be prescribed, in file order.
 *
 * Impact lands through the foot, so ankle, knee, Achilles or foot pain rules it out — the same
 * list the InBody filler uses, and the same reasoning: conditioning is not worth a flare-up.
 */
export function modalitiesFor(
  data: SessionLengthData,
  pains: string[],
): ConditioningModality[] {
  const painful = new Set(pains)
  const noImpact = data.conditioning.nonImpactPains.some((p) => painful.has(p))
  return data.conditioning.modalities.filter((m) => !(noImpact && m.impact))
}

/** What the block is prescribed as: the file's default, or the first that survived the pains. */
export function defaultModality(
  data: SessionLengthData,
  pains: string[],
): ConditioningModality | null {
  const allowed = modalitiesFor(data, pains)
  return allowed.find((m) => m.default) ?? allowed[0] ?? null
}

/** What a client is actually prescribed at the end of the session. */
export interface Conditioning {
  minutes: number
  modality: ConditioningModality
  /** the other modalities this client could do it as, for a trainer swapping it out */
  alternatives: ConditioningModality[]
  /** an impact modality was withheld, and which pains withheld it */
  impactWithheldFor: string[]
}

export function prescribeConditioning(
  data: SessionLengthData,
  minutes: number,
  pains: string[],
): Conditioning | null {
  if (minutes <= 0) return null
  const modality = defaultModality(data, pains)
  if (!modality) return null
  const painful = new Set(pains)
  return {
    minutes,
    modality,
    alternatives: modalitiesFor(data, pains).filter((m) => m.id !== modality.id),
    impactWithheldFor: data.conditioning.nonImpactPains.filter((p) => painful.has(p)),
  }
}
