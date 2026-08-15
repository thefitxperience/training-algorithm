import type { Exercise, InBodyData } from '../types'

export type Tri = 'Under' | 'Normal' | 'Over'
export type TbwState = 'Low' | 'Normal' | 'High'
export type Region = 'ARMS' | 'TRUNK' | 'LEGS'

/** The 14 printed numbers. All optional — with none entered the layer is inert. */
export interface InBodyInput {
  smm?: number
  smmLow?: number
  smmHigh?: number
  pbf?: number
  pbfLow?: number
  pbfHigh?: number
  tbw?: number
  tbwLow?: number
  tbwHigh?: number
  fatLArm?: number
  fatRArm?: number
  fatTrunk?: number
  fatLLeg?: number
  fatRLeg?: number
}

export const WORKED_EXAMPLE: InBodyInput = {
  smm: 30.1,
  smmLow: 31.6,
  smmHigh: 38.6,
  pbf: 26.4,
  pbfLow: 10,
  pbfHigh: 20,
  tbw: 39.2,
  tbwLow: 38.4,
  tbwHigh: 46.9,
  fatLArm: 128,
  fatRArm: 131,
  fatTrunk: 178,
  fatLLeg: 96,
  fatRLeg: 94,
}

export interface RuleNote {
  rule: string
  measured: string
  changed: string
}

export interface FillerPrescription {
  movement: string
  bouts: number
  seconds: number
}

export interface InBodyResult {
  active: boolean
  states: {
    smm: Tri | null
    pbf: Tri | null
    tbw: TbwState | null
    ARMS: Tri | null
    TRUNK: Tri | null
    LEGS: Tri | null
  }
  tbwRatio: number | null
  weights: Record<string, number>
  vectorKey: string
  /** dominant goal — the CATEGORICAL blend, used for split re-badging */
  dominantGoal: string
  /** blended weekly sets per muscle group */
  volume: Record<string, number>
  /** resolved sets per muscle group, after step 4 (and the step 5 cut) */
  sets: Record<string, number>
  /** what step 4 resolved before the PBF Under cut, so the delivered figure stays honest */
  setsBeforeCut: Record<string, number>
  reps: [number, number]
  setsRange: [number, number]
  /** blended rest, already floored */
  rest: number
  restFloor: number
  /** load applied to every slot regardless of structure (TBW Low, PBF Under) */
  globalLoad: number
  rule4Regions: Region[]
  filler: FillerPrescription | null
  notes: RuleNote[]
}

export const INERT: InBodyResult = {
  active: false,
  states: { smm: null, pbf: null, tbw: null, ARMS: null, TRUNK: null, LEGS: null },
  tbwRatio: null,
  weights: {},
  vectorKey: '',
  dominantGoal: '',
  volume: {},
  sets: {},
  setsBeforeCut: {},
  reps: [0, 0],
  setsRange: [0, 0],
  rest: 0,
  restFloor: 0,
  globalLoad: 0,
  rule4Regions: [],
  filler: null,
  notes: [],
}

export function hasAnyInput(i: InBodyInput): boolean {
  return Object.values(i).some((v) => typeof v === 'number' && !Number.isNaN(v))
}

const num = (v: number | undefined): v is number => typeof v === 'number' && !Number.isNaN(v)

/**
 * Step 1 — six states.
 *
 * The 2% hysteresis needs a previous scan to be meaningful: it widens the band a value has
 * to cross to flip an already-established state. With no scan history stored (this harness
 * keeps none), there is nothing to hold onto, so a first scan classifies directly. `previous`
 * is honoured when supplied.
 */
export function deriveStates(
  input: InBodyInput,
  data: InBodyData,
  previous?: InBodyResult['states'],
) {
  const h = data.thresholds.hysteresis

  const band = (value: number, low: number, high: number, prev: Tri | null | undefined): Tri => {
    // Once Under/Over is established, the value must clear the threshold by 2% to leave it.
    const lo = prev === 'Under' ? low * (1 + h) : low
    const hi = prev === 'Over' ? high * (1 - h) : high
    if (value < lo) return 'Under'
    if (value > hi) return 'Over'
    return 'Normal'
  }

  const smm =
    num(input.smm) && num(input.smmLow) && num(input.smmHigh)
      ? band(input.smm, input.smmLow, input.smmHigh, previous?.smm)
      : null
  const pbf =
    num(input.pbf) && num(input.pbfLow) && num(input.pbfHigh)
      ? band(input.pbf, input.pbfLow, input.pbfHigh, previous?.pbf)
      : null

  let tbwRatio: number | null = null
  let tbw: TbwState | null = null
  if (
    num(input.tbw) &&
    num(input.tbwLow) &&
    num(input.tbwHigh) &&
    num(input.smm) &&
    num(input.smmLow) &&
    num(input.smmHigh)
  ) {
    const tbwPart = input.tbw / ((input.tbwLow + input.tbwHigh) / 2)
    const smmPart = input.smm / ((input.smmLow + input.smmHigh) / 2)
    tbwRatio = tbwPart / smmPart
    const lo = previous?.tbw === 'Low' ? data.thresholds.tbwLow * (1 + h) : data.thresholds.tbwLow
    const hi = previous?.tbw === 'High' ? data.thresholds.tbwHigh * (1 - h) : data.thresholds.tbwHigh
    tbw = tbwRatio < lo ? 'Low' : tbwRatio > hi ? 'High' : 'Normal'
  }

  // Segmental: Over if ANY contributing segment is over, Under if any is under. Arms and
  // legs use both sides.
  const segment = (values: (number | undefined)[], prev: Tri | null | undefined): Tri | null => {
    const present = values.filter(num)
    if (present.length === 0) return null
    const over = prev === 'Over' ? data.thresholds.segmentalOver * (1 - h) : data.thresholds.segmentalOver
    const under = prev === 'Under' ? data.thresholds.segmentalUnder * (1 + h) : data.thresholds.segmentalUnder
    if (present.some((v) => v > over)) return 'Over'
    if (present.some((v) => v < under)) return 'Under'
    return 'Normal'
  }

  return {
    states: {
      smm,
      pbf,
      tbw,
      ARMS: segment([input.fatLArm, input.fatRArm], previous?.ARMS),
      TRUNK: segment([input.fatTrunk], previous?.TRUNK),
      LEGS: segment([input.fatLLeg, input.fatRLeg], previous?.LEGS),
    },
    tbwRatio,
  }
}

/** Step 2 — the goal weight vector. The stated goal never drops below 40%. */
export function goalWeights(
  statedGoal: string,
  states: InBodyResult['states'],
): Record<string, number> {
  const rule1 = states.smm === 'Under' && statedGoal !== 'Build Muscle'
  const rule2 = states.pbf === 'Over' && statedGoal !== 'Lose Fat'

  const w: Record<string, number> = { 'Lose Fat': 0, 'Build Muscle': 0, 'Get Stronger': 0 }
  if (rule1 && rule2) {
    w['Lose Fat'] += 0.3
    w['Build Muscle'] += 0.3
    w[statedGoal] += 0.4
  } else if (rule2) {
    w['Lose Fat'] += 0.6
    w[statedGoal] += 0.4
  } else if (rule1) {
    w['Build Muscle'] += 0.6
    w[statedGoal] += 0.4
  } else {
    w[statedGoal] = 1
  }

  const sum = Object.values(w).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`goal weights must sum to 1.00, got ${sum}`)
  if (w[statedGoal] < 0.4 - 1e-9)
    throw new Error(`stated goal must keep at least 0.40, got ${w[statedGoal]}`)
  return w
}

export function vectorKey(w: Record<string, number>): string {
  return `Lose Fat:${w['Lose Fat'].toFixed(1)}|Build Muscle:${w['Build Muscle'].toFixed(1)}|Get Stronger:${w['Get Stronger'].toFixed(1)}`
}

/** NUMERIC blend: weighted average, rounded once at the end. */
function blendRange(base: Record<string, number[]>, w: Record<string, number>): [number, number] {
  const lo = Object.entries(w).reduce((s, [g, x]) => s + x * (base[g]?.[0] ?? 0), 0)
  const hi = Object.entries(w).reduce((s, [g, x]) => s + x * (base[g]?.[1] ?? 0), 0)
  return [lo, hi]
}

const round5 = (n: number) => Math.round(n / 5) * 5
const roundHalf = (n: number) => Math.round(n * 2) / 2

export interface ResolveContext {
  statedGoal: string
  ageBracket: string
  level: string
  /** the exercises actually chosen, to solve sets against real indirect credit */
  chosen: { exercise: Exercise; group: string }[]
  indirectCredit: number
  /** sub-region name -> muscle group, for alsoTrains */
  subToGroup: Map<string, string>
  pains: string[]
}

export function evaluateInBody(
  input: InBodyInput,
  data: InBodyData,
  ctx: ResolveContext,
): InBodyResult {
  if (!hasAnyInput(input)) return INERT

  const notes: RuleNote[] = []
  const { states, tbwRatio } = deriveStates(input, data)

  // ---- step 2 -------------------------------------------------------------
  const weights = goalWeights(ctx.statedGoal, states)
  const key = vectorKey(weights)
  const vector = data.goalVectors[key]
  const dominantGoal = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0]

  if (weights[ctx.statedGoal] < 1) {
    notes.push({
      rule: states.smm === 'Under' && states.pbf === 'Over' ? 'Rule 1 + Rule 2 (skinny-fat)' : states.pbf === 'Over' ? 'Rule 2' : 'Rule 1',
      measured: `SMM ${states.smm}, body fat ${states.pbf}`,
      changed: `goal blended to ${Object.entries(weights)
        .filter(([, v]) => v > 0)
        .map(([g, v]) => `${g} ${Math.round(v * 100)}%`)
        .join(', ')} — your stated goal keeps ${Math.round(weights[ctx.statedGoal] * 100)}%`,
    })
  }

  // ---- step 3 -------------------------------------------------------------
  const rawSets = blendRange(data.baseSets, weights)
  const rawReps = blendRange(data.baseReps, weights)
  const rawRest = blendRange(data.baseRest, weights)

  // SAFETY: the most protective floor among goals holding >= 40%. Never blended.
  const majorGoals = Object.entries(weights)
    .filter(([, v]) => v >= 0.4 - 1e-9)
    .map(([g]) => g)
  const ageFloors = data.restFloor[ctx.ageBracket] ?? {}
  const floors = majorGoals.map((g) =>
    Math.max(ageFloors[g] ?? 0, ctx.level === 'Beginner' ? (data.beginnerRestFloor[g] ?? 0) : 0),
  )
  const restFloor = floors.length ? Math.max(...floors) : 0

  const reps: [number, number] = [Math.round(rawReps[0]), Math.round(rawReps[1])]
  const setsRange: [number, number] = [rawSets[0], rawSets[1]]
  let rest = Math.max(round5(rawRest[1] > 0 ? (rawRest[0] + rawRest[1]) / 2 : 0), restFloor)
  if (restFloor > 0 && rest < restFloor) rest = restFloor

  // ---- step 4 — resolve sets per group against the blended volume ----------
  const volume = vector ? { ...vector.volume } : {}
  const directCount: Record<string, number> = {}
  for (const c of ctx.chosen) directCount[c.group] = (directCount[c.group] ?? 0) + 1

  const setsMax = setsRange[1]
  const setsMin = setsRange[0]
  // Only groups that actually have slots get a resolved figure — InBody cannot add slots,
  // so a group with none has nothing to resolve.
  const sets: Record<string, number> = {}
  for (const g of Object.keys(volume)) {
    if ((directCount[g] ?? 0) > 0) sets[g] = Math.min(setsMax, 3)
  }

  for (let pass = 0; pass < 20; pass++) {
    const indirect: Record<string, number> = {}
    for (const c of ctx.chosen) {
      const s = sets[c.group] ?? 0
      for (const also of c.exercise.alsoTrains) {
        const g = ctx.subToGroup.get(also)
        if (!g) continue
        indirect[g] = (indirect[g] ?? 0) + ctx.indirectCredit * s
      }
    }
    for (const g of Object.keys(volume)) {
      const count = directCount[g] ?? 0
      if (count === 0) continue
      const need = (volume[g] - (indirect[g] ?? 0)) / count
      sets[g] = roundHalf(Math.min(setsMax, Math.max(1, need)))
    }
  }

  const setsBeforeCut = { ...sets }

  // ---- step 5 — PBF Under -------------------------------------------------
  if (states.pbf === 'Under') {
    for (const g of Object.keys(sets)) {
      const cut = sets[g] * data.modifiers.pbfUnderVolume
      // Re-apply the floors. A group already under the blended range keeps its own value —
      // a volume *cut* must never inflate a group upward.
      const floor = sets[g] >= setsMin ? setsMin : 1
      sets[g] = roundHalf(Math.max(floor, cut))
    }
    const cancelled = Object.keys(sets).filter((g) => sets[g] === setsBeforeCut[g]).length
    notes.push({
      rule: 'Body fat below the printed range',
      measured: `body fat ${input.pbf}% vs ${input.pbfLow}-${input.pbfHigh}%`,
      changed: `volume cut 10% and load reduced 5%; the rest floor cancelled the cut on ${cancelled} of ${Object.keys(sets).length} muscle groups, so the delivered figures are what you see`,
    })
  }

  // ---- step 6 — TBW -------------------------------------------------------
  let globalLoad = 0
  if (states.tbw === 'Low') {
    globalLoad += data.modifiers.tbwLowLoad
    rest = round5(rest * data.modifiers.tbwLowRest)
    if (rest < restFloor) rest = restFloor
    notes.push({
      rule: 'Hydration low',
      measured: `water-to-muscle ratio ${tbwRatio?.toFixed(3)} (low below ${data.thresholds.tbwLow})`,
      changed: `load reduced 10% and rest extended 15%. Low hydration can make a scan understate muscle and overstate fat — these numbers may not reflect your true composition. Re-scan hydrated.`,
    })
  }
  if (states.pbf === 'Under') globalLoad += data.modifiers.pbfUnderLoad

  // ---- step 8 — filler (TBW High only) ------------------------------------
  let filler: FillerPrescription | null = null
  if (states.tbw === 'High') {
    // Several rules can apply at once; take the most restrictive of each field independently.
    const applicable = [data.filler.default]
    const ageRestricted = ctx.ageBracket === '6-12' || ctx.ageBracket === '65+'
    if (ageRestricted) applicable.push(data.filler.age)
    if (ctx.level === 'Beginner') applicable.push(data.filler.beginner)

    const bouts = Math.min(...applicable.map((f) => f.bouts ?? Infinity))
    const seconds = Math.min(...applicable.map((f) => f.seconds ?? Infinity))
    let movement = ageRestricted ? data.filler.age.movement : data.filler.default.movement
    const painNonImpact = ctx.pains.some((p) => data.fillerNonImpactPains.includes(p))
    if (painNonImpact) movement = data.filler.non_impact.movement

    filler = { movement, bouts, seconds }
    notes.push({
      rule: 'Hydration high',
      measured: `water-to-muscle ratio ${tbwRatio?.toFixed(3)} (high above ${data.thresholds.tbwHigh})`,
      changed: `inter-set filler added on isolation slots: ${bouts} × ${seconds}s ${movement}${
        painNonImpact ? ' (non-impact, because of a reported pain)' : ''
      }`,
    })
  }

  // ---- step 7 — segmental fat --------------------------------------------
  const rule4Regions = (['ARMS', 'TRUNK', 'LEGS'] as Region[]).filter((r) => states[r] === 'Over')
  for (const r of rule4Regions) {
    notes.push({
      rule: `Rule 4 — ${r.toLowerCase()} fat high`,
      measured: `${r.toLowerCase()} segmental fat above ${data.thresholds.segmentalOver}%`,
      changed: `those slots run as supersets, rest × ${data.rule4.restMultiplier} (floored at ${restFloor}s), reps at the top of the range. Volume, slot count and exercise choice are unchanged. Main lifts are exempt.`,
    })
  }

  return {
    active: true,
    states,
    tbwRatio,
    weights,
    vectorKey: key,
    dominantGoal,
    volume,
    sets,
    setsBeforeCut,
    reps,
    setsRange,
    rest,
    restFloor,
    globalLoad,
    rule4Regions,
    filler,
    notes,
  }
}

/** Step 8 — per slot, not per program. */
export function slotLoad(
  data: InBodyData,
  result: InBodyResult,
  structureLoadAdjustment: number,
): number {
  const total = structureLoadAdjustment + result.globalLoad
  return Math.max(data.loadClamp, total)
}

/** Which muscle groups a rule-4 region owns. Unowned groups are never affected. */
export function groupsForRegions(data: InBodyData, regions: Region[]): Set<string> {
  const out = new Set<string>()
  for (const [group, region] of Object.entries(data.regionOfGroup)) {
    if (data.unownedGroups.includes(group)) continue
    if (regions.includes(region as Region)) out.add(group)
  }
  return out
}
