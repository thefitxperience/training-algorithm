import type { EquipmentTier } from './lib/equipment'
import type { PainSelection } from './lib/injury'
import type { Structure } from './lib/structure'
import type { InBodyInput } from './lib/inbody'
import type { ValdInput } from './lib/vald'

export type Sex = 'Male' | 'Female'
export type Tier = 'primary' | 'secondary' | 'accessory'
export type ExerciseType = 'compound' | 'isolation' | 'carry' | 'isometric' | 'mobility'

export interface Config {
  indirectCredit: number
  timeCeiling: Record<string, number>
  warmupMinutes: number
  repsMid: Record<string, number>
  restMid: Record<string, number>
  placeholderGroups: string[]
  majorGroups: string[]
  groups: string[]
  ages: string[]
  levels: string[]
  goals: string[]
  splits: string[]
  femaleOverrides: Record<string, number>
  maleOverrides: Record<string, number>
}

/** [subRegion, exerciseCount, setsPerExercise] */
export type Slot = [string, number, number]

export interface AllocationDay {
  label: string
  slots: Slot[]
}

export interface AllocationBlock {
  deliveredDays: number
  note: string
  cap: number
  days: AllocationDay[]
  targets: Record<string, number>
  delivered: Record<string, number>
}

export type Allocation = Record<string, AllocationBlock>

export interface Exercise {
  id: number
  name: string
  group: string
  sub: string
  /** sub-region code, e.g. "C-MID". Used by later rule layers; unused today. */
  code: string
  equipment: string
  alsoTrains: string[]
  type: ExerciseType
  tier: Tier
  skill: number
  load: number
  avoidAges: string[]
  mainLift: boolean
}

export interface PrescriptionEntry {
  reps: string
  rest: string
  setsRange: string
}

/** keyed "{sex}|{days}|{age}|{level}" then by goal */
export type Prescription = Record<string, Record<string, PrescriptionEntry>>

export interface SplitBadge {
  badge: 'Recommended' | 'Available' | 'Adjusted' | string
  majorFreq: number
  volumePct: number
  pattern: string
  note: string
}

/** keyed "{goal}|{days}|{level}|{split}" — age 18-29 only */
export type Splits = Record<string, SplitBadge>

export interface Pain {
  id: string
  label: string
  region: string
  sided: boolean
  description: string
}

export interface PainRule {
  removeSubRegions: string[]
  removeTags: string[]
  cautionSubRegions: string[]
  cautionTags: string[]
  prioritySubRegions: string[]
}

/** One record per exercise, joined to exercises.json on `id` — never on sub-region text. */
export interface InjuryExercise {
  id: number
  name: string
  /** "Muscle group > Sub-region", in the injury library's spelling */
  key: string
  loadTags: string[]
  unilateral: boolean
  corrective: boolean
}

export interface InjuryData {
  pains: Pain[]
  rules: Record<string, PainRule>
  loadTags: Record<string, string>
  exercises: InjuryExercise[]
  reroute: unknown[]
  copy: Record<string, string>
  precedence: string[]
  emptiedGroups: Record<string, unknown>
}

export interface StructureData {
  /** sub-region -> joints involved, keyed on the skeleton spelling in exercises.json */
  joints: Record<string, string[]>
  antagonists: { a: string[]; b: string[] }[]
  workSeconds: Record<string, number>
  transitionSeconds: number
  restMultiplier: Record<string, number>
  loadAdjustment: Record<string, number>
  blockSize: Record<string, number>
  recommendedDefault: Record<string, string>
  trisetDowngradeAges: string[]
  trisetDowngradeLevels: string[]
  mainLiftProtectedGoals: string[]
  pairingReasons: string[]
  rejections: string[]
}

export interface InBodyData {
  inputs: string[]
  thresholds: {
    tbwLow: number
    tbwHigh: number
    segmentalOver: number
    segmentalUnder: number
    hysteresis: number
  }
  baseTargets: Record<string, Record<string, number>>
  goalVectors: Record<string, { weights: Record<string, number>; volume: Record<string, number> }>
  restFloor: Record<string, Record<string, number>>
  beginnerRestFloor: Record<string, number>
  regionOfGroup: Record<string, string>
  unownedGroups: string[]
  rule4: { structure: string; restMultiplier: number; loadAdjustment: number }
  modifiers: {
    pbfUnderVolume: number
    pbfUnderLoad: number
    tbwLowLoad: number
    tbwLowRest: number
  }
  loadClamp: number
  filler: Record<string, { movement: string; bouts: number | null; seconds: number | null }>
  fillerNonImpactPains: string[]
  baseSets: Record<string, number[]>
  baseReps: Record<string, number[]>
  baseRest: Record<string, number[]>
}

export interface ValdTest {
  test: string
  group: string
  code: string
  subRegion: string
  totalExercises: number
  nativeUnilateral: number
  convertible: number
  verdict: string
  caveat: string
}

export interface ValdData {
  brackets: { name: string; min: number; max: number | null; setsAdded: number }[]
  hysteresis: number
  tests: ValdTest[]
  budgetPerTestedSubRegion: number
  unilateralNamePattern: string
  convertibleEquipmentPattern: string
  unilateralFormPreference: string[]
  timeCost: { unilateralWorkMultiplier: number; note: string }
  trimOrder: string[]
  precedence: string
  referralThreshold: number
  readAsRatios: string[][]
}

export interface DataBundle {
  config: Config
  allocation: Allocation
  exercises: Exercise[]
  prescription: Prescription
  splits: Splits
  injury: InjuryData
  structure: StructureData
  inbody: InBodyData
  vald: ValdData
}

export interface ClientInput {
  sex: Sex
  age: number
  level: string
  goal: string
  days: number
  split: string
  /** what the client can train with — filters the exercise library, see lib/equipment.ts */
  equipment: EquipmentTier
  /** ticked pains and their side — empty means the injury layer is a no-op */
  pains: PainSelection
  /** how the work is performed; never changes what the work is */
  structure: Structure
  /** body-composition scan; empty means the InBody layer is inert */
  inbody: InBodyInput
  /** asymmetry readings per test code; empty means the VALD layer is inert */
  vald: ValdInput
}
