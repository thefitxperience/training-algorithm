import type { Exercise } from '../types'

/**
 * Which exercise a sub-region leads with.
 *
 * A program that opens with "Chest press" reads as a real gym program. One that opens with
 * "Banded pec stretch" does not — and the old ranking, which sorted on tier then load then id,
 * had no opinion about either. This one does.
 *
 * It is **a ranking, never a filter**. Hard-filtering on known equipment empties two
 * sub-regions outright, so bodyweight and banded movements rank below the loadable ones and
 * are still picked when nothing else is left. It sits ABOVE the tier ordering and BELOW every
 * eligibility rule: injury verdicts, age restrictions and the main-slot rule all still win.
 */

/**
 * Equipment a gym-goer would name without thinking. Matched against the "/"-separated
 * ALTERNATIVES in exercises.json, so one recognised option is enough — "DB / KB / trap bar"
 * is a dumbbell movement whether or not the trap bar is on the floor.
 */
const KNOWN_LOADABLE = new Set([
  'BB',
  'DB',
  'C',
  'M',
  'Smith',
  'EZ',
  'KB',
  'trap bar',
  'plate',
])

export function onKnownEquipment(ex: Exercise): boolean {
  return ex.equipment.split('/').some((token) => KNOWN_LOADABLE.has(token.trim()))
}

/**
 * Words that make a name read as a coaching cue rather than an exercise. Some are eponyms
 * (Zercher, Kroc), some are anatomy (scapular, prone), some are gym shorthand nobody outside
 * the gym uses (RKC, JM). None of them are wrong — they are just not what a program should
 * open with when an equally good plain-named option exists.
 */
const JARGON = [
  'scaption',
  'copenhagen',
  'pallof',
  'zercher',
  'jefferson',
  'zottman',
  'scapular',
  'anti-',
  'prone',
  'blackburn',
  'cuban',
  'bayesian',
  'svend',
  'kroc',
  'meadows',
  'tate',
  'powell',
  'lu raise',
  'bird dog',
  'dead bug',
  'hollow',
  'rkc',
  'nordic',
  'cossack',
  'sissy',
]

/** Matched as a whole word — "JM press" is jargon, "jam" and "jump" are not. */
const JM = /\bjm\b/

export const MAX_PLAIN_WORDS = 5

export function hasPlainName(ex: Exercise): boolean {
  const name = ex.name
  if (name.trim().split(/\s+/).length > MAX_PLAIN_WORDS) return false
  const lower = name.toLowerCase()
  if (JM.test(lower)) return false
  return !JARGON.some((word) => lower.includes(word))
}

/**
 * The five criteria, in order. Negative when `a` should lead.
 *
 *   1. known loadable equipment   bodyweight and bands rank below, never excluded
 *   2. plain name                 five words or fewer, no jargon
 *   3. lower skill                between two equally plain options
 *   4. more loadable              prefers the version carrying real weight
 *   5. alphabetical               so the same client always sees the same program
 */
export function defaultRank(a: Exercise, b: Exercise): number {
  const known = Number(onKnownEquipment(b)) - Number(onKnownEquipment(a))
  if (known !== 0) return known
  const plain = Number(hasPlainName(b)) - Number(hasPlainName(a))
  if (plain !== 0) return plain
  if (a.skill !== b.skill) return a.skill - b.skill
  if (a.load !== b.load) return b.load - a.load
  return a.name.localeCompare(b.name)
}
