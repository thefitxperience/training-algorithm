import type { EquipmentTier } from './lib/equipment'
import type { PainSelection } from './lib/injury'
import type { Structure } from './lib/structure'
import type { InBodyInput } from './lib/inbody'
import type { ValdInput } from './lib/vald'
import type { BodyDotInput } from './lib/bodydot'
import type { Pin } from './lib/amend'
import type { CapPin } from './lib/timecap'

export type Sex = 'Male' | 'Female'
export type Tier = 'primary' | 'secondary' | 'accessory'
export type ExerciseType = 'compound' | 'isolation' | 'carry' | 'isometric' | 'mobility'

export interface Config {
  indirectCredit: number
  /**
   * The goal's old per-session ceiling. Nothing reads it any more: the allocation guarantees
   * volume only, nothing trims a session at generation, and session length is the client's
   * decision, taken with the time-cap button. Kept because data files are never edited here.
   */
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

export interface BodyDotBand {
  code: string
  indicator: string
  view: string
  unit: string
  /** "35.0 to 45.0", or "-" where the indicator defines no band on that edge */
  normal: string
  borderlineLow: string
  abnormalLow: string
  borderlineHigh: string
  abnormalHigh: string
  inArsenal: boolean
}

/** Already resolved to a library id — the arsenal's shorthand never name-matches. */
export interface ArsenalItem {
  arsenalName: string
  exerciseId: number | null
  libraryName: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'GAP' | string
  reasoning?: string
}

export interface ArsenalEntry {
  code: string
  indicator: string
  edge: 'low' | 'high' | 'any'
  /** "bilateral" | "same side" | "OPPOSITE side" */
  laterality: string
  region: string
  exercises: ArsenalItem[]
  stretches: ArsenalItem[]
  /** the two F06 rows are deliberately swapped relative to the source spreadsheet */
  correctedFromSource: boolean
  meaning: string | null
}

export interface BodyDotData {
  /** bands[0] is the spreadsheet header row, not an indicator */
  bands: BodyDotBand[]
  arsenal: ArsenalEntry[]
  tiers: { borderlineDeltaFraction: number; note: string }
  sets: {
    borderlineUnilateral: number
    abnormalUnilateral: number
    borderlineBilateral: string
    abnormalBilateral: string
  }
  correctiveSlotCapPerSession: number
  stretchSeconds: number
  timeCost: string
  trimOrder: string[]
  precedence: string
  lateralityRule: Record<string, string>
  f06Gate: { enabled: boolean; note: string }
  deadBorderlineEdges: [string, string][]
  unmappedStretches: string[]
}

/** Pre-computed per exercise — class, modifier, laterality and anchor status are resolved
 *  upstream and are never re-derived here from names or equipment. */
export interface LoadExercise {
  id: number
  /** sub-region code, the same one exercises.json carries */
  code: string
  class: string
  modifier: number
  modifiersApplied: string[]
  unilateral: boolean
  perHand: boolean
  isAnchor: boolean
  /** calibration hook: actual / estimated once performance logging exists. Nothing sets it
   *  yet, so every exercise falls back to correctionFactorDefault. */
  correctionFactor?: number
}

export interface LoadBridge {
  borrowsFrom: string | null
  ratio: number | null
  quality: string
}

export interface LoadData {
  gravity: number
  /** newtons-to-reference constant, keyed by test name (no " Strength Asymmetry" suffix) */
  k: Record<string, number>
  testSubRegion: Record<string, string>
  anchors: Record<string, string>
  bridges: Record<string, LoadBridge>
  classRatio: Record<string, number>
  modifiers: Record<string, number>
  lateralityBilateral: number
  tierBand: Record<string, number>
  tierLabel: Record<string, string>
  compoundFreeWeightCap: number
  beginnerTopCap: number
  roundToKg: number
  noLoadAges: string[]
  correctionFactorDefault: number
  exercises: LoadExercise[]
  notes: { anchorsFilled: string[]; divergences: string[] }
}

export interface AmendTypeSpec {
  name: string
  detect: string
  requiresAcceptance: boolean
  recomputes: string[]
}

export interface AmendData {
  types: Record<string, AmendTypeSpec>
  badges: Record<string, string>
  blocks: Record<string, string>
  precedence: string[]
  ranking: string[]
  shortlistMax: number
  mainSlotClassField: string
  /** the library's movement type, not the Load layer's mechanical class — see lib/amend.ts */
  mainSlotAllowed: string[]
  siblingSubRegions: Record<string, string[]>
  widenOnEmpty: boolean
  /** sub-regions each pain leaves with no freely available candidate */
  emptyShortlistByPain: Record<string, string[]>
  driftTolerance: number
  pinFields: string[]
  typeCWarning: string
  openItems: Record<string, string>
}

export interface TimeCapLever {
  id: string
  cost: number
  label?: string
  /** present on the three rest levers — a rest minute costs a different amount per goal */
  goal?: string
  step?: string
  limit?: string
  floor?: string
  /** the main lift, and only the main lift; the search never generates it */
  blocked?: boolean
  compromises: string
}

export interface TimeCapData {
  target: number
  showButtonWhen: string
  strict: boolean
  levers: TimeCapLever[]
  search: {
    type: string
    order: string[]
    optimal: string
    rebuildLeversEachNode: boolean
  }
  timeModel: {
    workSeconds: Record<string, number>
    restMultiplier: Record<string, number>
    transitionSeconds: number
    fillerBoutSeconds: number
    warmupMinutes: number
    block: string
    session: string
  }
  floors: {
    rest: string
    sessionMinSets: number
    mainLift: string
    structureStepsPerDay: string
  }
  /** [ageBracket][goal] -> seconds */
  restFloor: Record<string, Record<string, number>>
  beginnerRestFloor: Record<string, number>
  onUnreachable: string
  persistence: string
  driftCheck: string
  openItems: Record<string, string>
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
  bodydot: BodyDotData
  load: LoadData
  amend: AmendData
  timecap: TimeCapData
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
  /** posture readings per indicator code; empty means no corrective slots are added */
  bodydot: BodyDotInput
  /** slot pins from the amend layer; empty means the generator runs unconstrained */
  pins: Pin[]
  /** days the client asked to bring down to 60 minutes; empty means no session is trimmed */
  caps: CapPin[]
}

/**
 * The client's details as the form holds them, which is not the same as what the generator
 * accepts. The form opens on a real client, but any of the six fields that cannot be guessed
 * back may be cleared — so each of them may be absent here, and a `ClientInput` exists only
 * once none of them are. See lib/draft.ts.
 */
export interface ClientDraft
  extends Omit<ClientInput, 'sex' | 'age' | 'level' | 'goal' | 'days' | 'split'> {
  sex: Sex | null
  age: number | null
  level: string | null
  goal: string | null
  days: number | null
  split: string | null
}
