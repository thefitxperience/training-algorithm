import type { Program } from './generate'

/**
 * Whole-number sets for the client-facing (simple) view.
 *
 * Allocation sets are fractional (2.5, 3.5) because they are a weekly average spread over
 * the exercises hitting a muscle. A program a client actually follows has to be decisive,
 * but rounding every fraction the same way drifts badly — all-up is +11% on the week,
 * all-down is -11%.
 *
 * So: carry a running error per MUSCLE GROUP. The first fraction in a group rounds up
 * (error +0.5), the next rounds down (error back to 0), and so on. Each group therefore
 * lands within 0.5 sets of its target instead of accumulating.
 *
 * Within a group the picks are ordered heaviest-primary-first, so the extra set goes to the
 * main compound and the shave comes off the accessory — 4 sets on the incline press, 3 on
 * the cable fly, never the reverse.
 */

const TIER_ORDER: Record<string, number> = { primary: 0, secondary: 1, accessory: 2 }

export interface Rounding {
  /** `${dayIndex}:${position}` -> whole-number sets */
  byPick: Map<string, number>
  /** rounded set total per day, in day order */
  dayTotals: number[]
  rawWeekTotal: number
  roundedWeekTotal: number
  /** rounded minus raw, per muscle group */
  driftByGroup: Record<string, number>
  maxDrift: number
}

export function pickKey(dayIndex: number, position: number) {
  return `${dayIndex}:${position}`
}

export function roundSets(program: Program): Rounding {
  const picks = program.days.flatMap((day, dayIndex) =>
    day.exercises.map((c, position) => ({ key: pickKey(dayIndex, position), dayIndex, c })),
  )

  const byGroup = new Map<string, typeof picks>()
  for (const p of picks) {
    const g = p.c.exercise.group
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(p)
  }

  const byPick = new Map<string, number>()
  const driftByGroup: Record<string, number> = {}

  for (const [group, groupPicks] of byGroup) {
    // whole numbers pass straight through
    for (const p of groupPicks) {
      if (Number.isInteger(p.c.sets)) byPick.set(p.key, p.c.sets)
    }

    const fractional = groupPicks
      .filter((p) => !Number.isInteger(p.c.sets))
      .sort((a, b) => {
        const m = Number(b.c.exercise.mainLift) - Number(a.c.exercise.mainLift)
        if (m !== 0) return m
        const t = (TIER_ORDER[a.c.exercise.tier] ?? 9) - (TIER_ORDER[b.c.exercise.tier] ?? 9)
        if (t !== 0) return t
        if (b.c.exercise.load !== a.c.exercise.load) return b.c.exercise.load - a.c.exercise.load
        return a.c.exercise.id - b.c.exercise.id
      })

    let error = 0
    for (const p of fractional) {
      // error <= 0 means we owe the group volume, so round up; otherwise give it back
      const rounded = error <= 0 ? Math.ceil(p.c.sets) : Math.floor(p.c.sets)
      byPick.set(p.key, rounded)
      error += rounded - p.c.sets
    }
    driftByGroup[group] = error
  }

  const dayTotals = program.days.map((day, dayIndex) =>
    day.exercises.reduce((sum, _, position) => sum + (byPick.get(pickKey(dayIndex, position)) ?? 0), 0),
  )

  const drifts = Object.values(driftByGroup)

  return {
    byPick,
    dayTotals,
    rawWeekTotal: program.days.reduce((s, d) => s + d.totalSets, 0),
    roundedWeekTotal: dayTotals.reduce((s, t) => s + t, 0),
    driftByGroup,
    maxDrift: drifts.length ? Math.max(...drifts.map(Math.abs)) : 0,
  }
}
