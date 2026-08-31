import type { ClientInput, DataBundle, Sex } from '../types'
import { EQUIPMENT_TIERS, type EquipmentTier } from './equipment'
import { STRUCTURES, type Structure } from './structure'
import { ABS_PLACEMENTS, type AbsPlacement } from './abs'
import { parseRange, realBands, type BodyDotInput } from './bodydot'
import type { ValdInput, WeakSide } from './vald'
import type { InBodyInput } from './inbody'
import type { PainSelection, Side } from './injury'
import { generate } from './generate'

/**
 * A whole made-up client, for trying the thing out quickly.
 *
 * Every figure is drawn inside the range the real instrument reports it in, because a sample
 * whose numbers could not have come off a machine tests nothing: an asymmetry of 300% or a
 * skeletal muscle mass above body weight would exercise paths no client will ever reach while
 * leaving the ordinary ones untried.
 *
 * The draw is seeded, so a sample that turns up something odd can be reached again by its
 * seed rather than described from memory.
 */

export interface SampleOptions {
  /** up to two reported pains. Off unless asked for, like the three machines. */
  pain?: boolean
  vald?: boolean
  inbody?: boolean
  bodydot?: boolean
}

/** mulberry32 — small, and identical wherever it runs, which `Math.random` is not. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)]
const between = (rng: () => number, lo: number, hi: number, dp = 1) => {
  const n = lo + rng() * (hi - lo)
  const f = 10 ** dp
  return Math.round(n * f) / f
}
const chance = (rng: () => number, p: number) => rng() < p

/** Splits the data file actually rates for this goal, day count and level. */
function splitsFor(data: DataBundle, goal: string, days: number, level: string): string[] {
  const prefix = `${goal}|${days}|${level}|`
  const found = Object.keys(data.splits)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
  return found.length ? found : data.config.splits
}

/**
 * Pains, at most two. More than two is not implausible, but it stops being a sample of an
 * ordinary client and becomes a test of the injury layer's stacking, which has its own checks.
 */
function samplePains(data: DataBundle, rng: () => number): PainSelection {
  const count = chance(rng, 0.45) ? (chance(rng, 0.3) ? 2 : 1) : 0
  const out: PainSelection = {}
  const pool = [...data.injury.pains]
  for (let i = 0; i < count && pool.length; i++) {
    const pain = pool.splice(Math.floor(rng() * pool.length), 1)[0]
    out[pain.id] = pain.sided ? pick(rng, ['Left', 'Right', 'Both'] as Side[]) : 'Both'
  }
  return out
}

/**
 * A DynaMo battery. Asymmetries cluster low — most people are close to even, and a reading
 * over 30% is the referral case rather than the ordinary one — so the draw is weighted rather
 * than flat, which is what keeps a sample from firing every bracket at once.
 */
function sampleVald(data: DataBundle, rng: () => number): ValdInput {
  const tests = data.vald.tests
  // An upper or a lower battery, or the lot: what a trainer actually runs in one sitting.
  const region = pick(rng, ['upper', 'lower', 'all'] as const)
  const chosen = tests.filter((t) => {
    if (region === 'all') return true
    const lower = /^(Hip|Knee|Trunk)\b/.test(t.test)
    return region === 'lower' ? lower : !lower
  })

  const out: ValdInput = {}
  for (const t of chosen) {
    if (chance(rng, 0.15)) continue // not every movement gets measured
    const roll = rng()
    const pct = roll < 0.55 ? between(rng, 0, 8) : roll < 0.85 ? between(rng, 8, 20) : between(rng, 20, 38)
    const weakSide: WeakSide = chance(rng, 0.5) ? 'Left' : 'Right'
    // Newtons consistent with the percentage, so the reading does not contradict itself: the
    // strong side is drawn, and the weak side follows from it.
    const strong = between(rng, 90, 520, 0)
    const weak = Math.round(strong * (1 - pct / 100))
    out[t.code] = {
      asymmetry: pct,
      weakSide,
      leftN: weakSide === 'Left' ? weak : strong,
      rightN: weakSide === 'Left' ? strong : weak,
    }
  }
  return out
}

/**
 * A body-composition scan, built the way the sheet is: a weight and a body fat percentage are
 * drawn, and everything else follows from them. Drawing the fourteen figures independently
 * would produce a client whose muscle mass and body water contradict their weight.
 */
function sampleInBody(rng: () => number, sex: Sex): InBodyInput {
  const weight = between(rng, sex === 'Male' ? 58 : 45, sex === 'Male' ? 115 : 95)
  const pbf = between(rng, sex === 'Male' ? 8 : 16, sex === 'Male' ? 38 : 46)
  // InBody's own normal band, which is the one printed as the grey stripe on the bar.
  const [pbfLow, pbfHigh] = sex === 'Male' ? [10, 20] : [18, 28]

  const lean = weight * (1 - pbf / 100)
  const smm = Math.round(lean * 0.55 * 10) / 10
  // The normal band sits around a standard body of this height; ±10% of the measured figure
  // reproduces the width the sheets actually print.
  const smmMid = smm * between(rng, 0.92, 1.1, 3)
  const tbw = Math.round(lean * 0.73 * 10) / 10
  const tbwMid = tbw * between(rng, 0.94, 1.08, 3)

  const seg = () => between(rng, 60, 220)
  return {
    smm,
    smmLow: Math.round(smmMid * 0.9 * 10) / 10,
    smmHigh: Math.round(smmMid * 1.1 * 10) / 10,
    pbf,
    pbfLow,
    pbfHigh,
    tbw,
    tbwLow: Math.round(tbwMid * 0.9 * 10) / 10,
    tbwHigh: Math.round(tbwMid * 1.1 * 10) / 10,
    fatLArm: seg(),
    fatRArm: seg(),
    fatTrunk: seg(),
    fatLLeg: seg(),
    fatRLeg: seg(),
  }
}

/**
 * A posture scan. Each indicator is drawn against its own printed band rather than from a
 * shared scale — the sheet mixes degrees and centimetres, and a number that is unremarkable
 * for one is off the chart for another.
 */
function sampleBodyDot(data: DataBundle, rng: () => number): BodyDotInput {
  const out: BodyDotInput = {}
  for (const band of realBands(data.bodydot)) {
    if (chance(rng, 0.1)) continue // a cancelled step measures nothing
    const normal = parseRange(band.normal)
    if (!normal) continue
    const [lo, hi] = normal
    const width = hi - lo || 1
    const roll = rng()
    // Most readings sit inside the band; the tail is what produces corrective work.
    const value =
      roll < 0.6
        ? between(rng, lo, hi, 2)
        : roll < 0.85
          ? between(rng, hi, hi + width * 0.6, 2)
          : between(rng, hi + width * 0.6, hi + width * 1.6, 2)
    out[band.code] = {
      value,
      side: chance(rng, 0.5) ? 'Left' : 'Right',
    }
  }
  return out
}

/**
 * One sample client, guaranteed to generate.
 *
 * A drawn combination can be one the allocation has no block for, and handing the UI a client
 * that cannot produce a program would make the button look broken. So a draw that does not
 * generate is redrawn rather than returned, and the seed that produced it is skipped — up to
 * a bound, after which a known-good client is returned rather than looping.
 */
export function sampleClient(
  data: DataBundle,
  options: SampleOptions,
  seed: number,
): { input: ClientInput; seed: number } {
  for (let attempt = 0; attempt < 40; attempt++) {
    const used = seed + attempt
    const rng = rngFrom(used)
    const sex: Sex = chance(rng, 0.5) ? 'Male' : 'Female'
    const age = Math.round(between(rng, 15, 72, 0))
    const level = pick(rng, data.config.levels)
    const goal = pick(rng, data.config.goals)
    const days = pick(rng, [2, 3, 4, 5, 6])
    const split = pick(rng, splitsFor(data, goal, days, level))

    const input: ClientInput = {
      sex,
      age,
      level,
      goal,
      days,
      split,
      equipment: pick(rng, EQUIPMENT_TIERS as readonly EquipmentTier[]),
      structure: pick(rng, STRUCTURES as readonly Structure[]),
      absPlacement: pick(rng, ABS_PLACEMENTS as readonly AbsPlacement[]),
      pains: options.pain ? samplePains(data, rng) : {},
      inbody: options.inbody ? sampleInBody(rng, sex) : {},
      vald: options.vald ? sampleVald(data, rng) : {},
      bodydot: options.bodydot ? sampleBodyDot(data, rng) : {},
      pins: [],
      caps: [],
    }
    if (generate(data, input).ok) return { input, seed: used }
  }
  // Forty consecutive draws that all fail would mean the library itself has a hole. Falling
  // back to a known-good client keeps the button working and is visibly not a random one.
  return { input: FALLBACK, seed }
}

/** The most ordinary client the library has, used only when every draw above failed. */
const FALLBACK: ClientInput = {
  sex: 'Male',
  age: 28,
  level: 'Intermediate',
  goal: 'Build Muscle',
  days: 4,
  split: 'Upper / Lower',
  equipment: 'Full gym',
  structure: 'straight',
  absPlacement: 'end',
  pains: {},
  inbody: {},
  vald: {},
  bodydot: {},
  pins: [],
  caps: [],
}
