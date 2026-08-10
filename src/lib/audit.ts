import type { Config, Exercise } from '../types'
import type { Program } from './generate'

export interface AuditRow {
  group: string
  /** allocation target, after sex overrides */
  target: number
  /** target before sex overrides, for reference */
  rawTarget: number
  /** recomputed from the exercises actually chosen */
  delivered: number
  /** what the allocation block claims it delivers */
  expected: number
  ratio: number | null
  band: 'green' | 'amber' | 'red' | 'none'
  isPlaceholder: boolean
}

export interface Audit {
  rows: AuditRow[]
  substantiveTotal: number
  substantiveWithin25: number
  /** alsoTrains names that don't match any `sub` in exercises.json, so earn no credit */
  unmappedAlsoTrains: string[]
}

/** Sex overrides apply to the TARGETS. Female traps has a floor of 2. */
export function applyOverrides(
  targets: Record<string, number>,
  sex: string,
  config: Config,
): Record<string, number> {
  const overrides = sex === 'Female' ? config.femaleOverrides : config.maleOverrides
  const out: Record<string, number> = { ...targets }
  for (const [group, delta] of Object.entries(overrides)) {
    const base = out[group] ?? 0
    out[group] = Math.max(2, base + delta)
  }
  return out
}

function band(ratio: number): AuditRow['band'] {
  if (ratio >= 0.75 && ratio <= 1.25) return 'green'
  if (ratio >= 0.6 && ratio <= 1.5) return 'amber'
  return 'red'
}

export function buildAudit(
  program: Program,
  exercises: Exercise[],
  sex: string,
  config: Config,
): Audit {
  // sub-region -> muscle group, built from exercises.json. Exact match only.
  const subToGroup = new Map<string, string>()
  for (const ex of exercises) subToGroup.set(ex.sub, ex.group)

  const delivered: Record<string, number> = {}
  for (const g of config.groups) delivered[g] = 0
  const unmapped = new Set<string>()

  for (const day of program.days) {
    for (const chosen of day.exercises) {
      const ex = chosen.exercise
      delivered[ex.group] = (delivered[ex.group] ?? 0) + chosen.sets

      // indirect credit: one increment per alsoTrains entry that maps to a group
      for (const also of ex.alsoTrains) {
        const g = subToGroup.get(also)
        if (!g) {
          unmapped.add(also)
          continue
        }
        delivered[g] = (delivered[g] ?? 0) + config.indirectCredit * chosen.sets
      }
    }
  }

  const targets = applyOverrides(program.block.targets, sex, config)

  const rows: AuditRow[] = config.groups.map((group) => {
    const target = targets[group] ?? 0
    const del = delivered[group] ?? 0
    const ratio = target > 0 ? del / target : null
    return {
      group,
      target,
      rawTarget: program.block.targets[group] ?? 0,
      delivered: del,
      expected: program.block.delivered[group] ?? 0,
      ratio,
      band: ratio === null ? 'none' : band(ratio),
      isPlaceholder: config.placeholderGroups.includes(group),
    }
  })

  const substantive = rows.filter((r) => !r.isPlaceholder)

  return {
    rows,
    substantiveTotal: substantive.length,
    substantiveWithin25: substantive.filter((r) => r.ratio !== null && r.ratio >= 0.75 && r.ratio <= 1.25)
      .length,
    unmappedAlsoTrains: [...unmapped].sort(),
  }
}
