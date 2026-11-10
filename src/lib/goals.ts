import type { DataBundle } from '../types'

/**
 * Goals made from other goals (fit.json's derivedGoals): Shape Up builds muscle and loses fat together. The spec's
 * tables are keyed by its three goals, so a derived goal gets its entries made here, once per bundle, and the rest
 * of the generator treats it like any goal: the allocation and splits of the goal it takes its tables from (the
 * same rows, not copies), and its prescription, rest, work time and rest floors blended from the goals it mixes.
 * The data files themselves are never edited.
 */
const cache = new WeakMap<DataBundle, DataBundle>()

type Blend = Record<string, number>
const mix = (blend: Blend, value: (goal: string) => number) =>
  Object.entries(blend).reduce((s, [g, w]) => s + w * value(g), 0)
const round5 = (n: number) => Math.round(n / 5) * 5

/** "12-15" and "8-12" blended: each end, then rounded (rest to five seconds). */
function blendRange(blend: Blend, of: (goal: string) => string, step = 1): string {
  const ends = (s: string) => {
    const m = s.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/)
    const lo = m ? Number(m[1]) : 0
    return [lo, m?.[2] ? Number(m[2]) : lo]
  }
  const round = (n: number) => (step === 5 ? round5(n) : Math.round(n))
  const lo = round(mix(blend, (g) => ends(of(g))[0]))
  const hi = round(mix(blend, (g) => ends(of(g))[1]))
  return lo === hi ? String(lo) : `${lo}-${hi}`
}

export function withDerivedGoals(data: DataBundle): DataBundle {
  const derived = data.fit?.derivedGoals
  if (!derived || !Object.keys(derived).length) return data
  const hit = cache.get(data)
  if (hit) return hit

  const config = { ...data.config, goals: [...data.config.goals], restMid: { ...data.config.restMid } }
  const allocation = { ...data.allocation }
  const splits = { ...data.splits }
  const prescription = Object.fromEntries(Object.entries(data.prescription).map(([k, row]) => [k, { ...row }]))
  const structure = { ...data.structure, workSeconds: { ...data.structure.workSeconds }, recommendedDefault: { ...data.structure.recommendedDefault } }
  const timecap = {
    ...data.timecap,
    restFloor: Object.fromEntries(Object.entries(data.timecap.restFloor).map(([age, row]) => [age, { ...row }])),
    beginnerRestFloor: { ...data.timecap.beginnerRestFloor },
    timeModel: { ...data.timecap.timeModel, workSeconds: { ...data.timecap.timeModel.workSeconds } },
  }
  const sessionlength = {
    ...data.sessionlength,
    workSeconds: { ...data.sessionlength.workSeconds },
    defaultStructure: { ...data.sessionlength.defaultStructure },
    levers: data.sessionlength.levers.map((l) => (l.maxRest ? { ...l, maxRest: { ...l.maxRest } } : l)),
  }

  for (const [goal, d] of Object.entries(derived)) {
    const from = d.tablesFrom
    const b = d.blend
    if (!config.goals.includes(goal)) config.goals.push(goal)
    config.restMid[goal] = round5(mix(b, (g) => data.config.restMid[g] ?? 0))
    // The allocation and the split fits: the source goal's rows, under this goal's key.
    for (const [k, v] of Object.entries(data.allocation)) {
      const parts = k.split('|')
      if (parts[1] === from) allocation[[parts[0], goal, ...parts.slice(2)].join('|')] = v
    }
    for (const [k, v] of Object.entries(data.splits)) {
      const parts = k.split('|')
      if (parts[0] === from) splits[[goal, ...parts.slice(1)].join('|')] = v
    }
    for (const row of Object.values(prescription)) {
      const r = row as Record<string, { reps: string; rest: string; setsRange: string }>
      if (!r[from]) continue
      r[goal] = {
        reps: blendRange(b, (g) => r[g]?.reps ?? r[from].reps),
        rest: blendRange(b, (g) => r[g]?.rest ?? r[from].rest, 5),
        setsRange: r[from].setsRange,
      }
    }
    structure.workSeconds[goal] = Math.round(mix(b, (g) => data.structure.workSeconds[g] ?? 40))
    structure.recommendedDefault[goal] = d.structure
    for (const row of Object.values(timecap.restFloor)) row[goal] = round5(mix(b, (g) => row[g] ?? 0))
    timecap.beginnerRestFloor[goal] = round5(mix(b, (g) => data.timecap.beginnerRestFloor[g] ?? 0))
    timecap.timeModel.workSeconds[goal] = structure.workSeconds[goal]
    sessionlength.workSeconds[goal] = structure.workSeconds[goal]
    sessionlength.defaultStructure[goal] = d.structure
    for (const l of sessionlength.levers) if (l.maxRest) l.maxRest[goal] = round5(mix(b, (g) => l.maxRest![g] ?? 0))
  }

  const out = { ...data, config, allocation, splits, prescription, structure, timecap, sessionlength } as DataBundle
  cache.set(data, out)
  cache.set(out, out)
  return out
}

/** A derived goal's blend for the InBody layer: toward fat loss when body fat is over range. */
export function derivedWeights(data: DataBundle, goal: string, fatOver: boolean): Record<string, number> | null {
  const d = data.fit?.derivedGoals?.[goal]
  if (!d) return null
  const w: Record<string, number> = { 'Lose Fat': 0, 'Build Muscle': 0, 'Get Stronger': 0 }
  for (const [g, v] of Object.entries(fatOver && !d.fixedBlend ? d.fatHighBlend : d.blend)) w[g] = v
  return w
}
