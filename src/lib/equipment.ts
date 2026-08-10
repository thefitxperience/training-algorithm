import type { Exercise } from '../types'

/**
 * `equipment` in exercises.json is a "/"-separated list of ALTERNATIVES ("BB / DB / Smith"),
 * so an exercise is available if ANY one of its options is available to the client.
 *
 * The 28 distinct tokens in the file are bucketed below. Anything unrecognised is treated
 * as gym-only, so a new token upstream fails closed rather than silently appearing in a
 * bodyweight program.
 */
const BODYWEIGHT = new Set(['BW', 'BW + ball', 'manual', 'sliders', 'dowel'])
const BANDS = new Set(['Bd', 'Bd-assisted'])
const PORTABLE_LOAD = new Set([
  'DB',
  'KB',
  'EZ',
  'plate',
  'bench',
  'weighted',
  'DB between feet',
  'DB on knees',
  'wheel',
  'wrist roller',
])

export const EQUIPMENT_TIERS = ['Full gym', 'Home (DB, KB, bands)', 'Bodyweight only'] as const
export type EquipmentTier = (typeof EQUIPMENT_TIERS)[number]

export const TIER_DESCRIPTION: Record<EquipmentTier, string> = {
  'Full gym': 'Everything — barbells, machines, cables, Smith, GHD, specialty bars.',
  'Home (DB, KB, bands)': 'Dumbbells, kettlebells, EZ/plates, a bench, bands, bodyweight. No barbell, machine or cable.',
  'Bodyweight only': 'Bodyweight and unloaded variations only. No bands, no external load.',
}

function allowedTokens(tier: EquipmentTier): Set<string> | null {
  if (tier === 'Full gym') return null // no filtering
  if (tier === 'Bodyweight only') return BODYWEIGHT
  return new Set([...BODYWEIGHT, ...BANDS, ...PORTABLE_LOAD])
}

export function equipmentOptions(ex: Exercise): string[] {
  return ex.equipment.split('/').map((t) => t.trim())
}

export function isTokenAvailable(token: string, tier: EquipmentTier): boolean {
  const allowed = allowedTokens(tier)
  return allowed === null || allowed.has(token)
}

export function isEquipmentAvailable(ex: Exercise, tier: EquipmentTier): boolean {
  return equipmentOptions(ex).some((t) => isTokenAvailable(t, tier))
}

/** How much of the library survives the filter — a headline diagnostic for the panel. */
export function libraryCoverage(exercises: Exercise[], tier: EquipmentTier) {
  const usable = exercises.filter((e) => e.type !== 'mobility')
  return {
    available: usable.filter((e) => isEquipmentAvailable(e, tier)).length,
    total: usable.length,
  }
}
