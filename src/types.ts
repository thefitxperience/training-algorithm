import type { EquipmentTier } from './lib/equipment'
import type { PainSelection } from './lib/injury'
import type { Structure } from './lib/structure'
import type { AbsPlacement } from './lib/abs'
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

/** One of the four ways the conditioning block can be performed. */
export interface ConditioningModality {
  id: string
  label: string
  /** true where the modality lands through the foot — dropped on ankle/knee/Achilles/foot pain */
  impact: boolean
  default?: boolean
}

export interface SessionLengthData {
  band: {
    default: [number, number]
    /** null for a bracket with no band at all — 6-12 has none */
    byAge: Record<string, [number, number] | null>
    note: string
  }
  workSeconds: Record<string, number>
  warmupMinutes: number
  defaultStructure: Record<string, string>
  levers: {
    order: number
    id: string
    appliesTo: string
    /** rest lever: the ceiling rest may be raised to, per goal */
    maxRest?: Record<string, number>
    /** rest lever: seconds per step */
    step?: number
    /** conditioning lever: the most conditioning that may be prescribed */
    maxMinutes?: number
    why: string
  }[]
  conditioning: {
    blockName: string
    placement: string
    roundToMinutes: number
    rounding: string
    modalities: ConditioningModality[]
    /** pain ids that rule out an impact modality */
    nonImpactPains: string[]
    excludeAges: string[]
    countsTowardVolume: boolean
    note: string
  }
  interactionWithTimeCap: { rule: string; buttonLeverOrder: string }
  volumeTablesUnchanged: boolean
  rejected: Record<string, string>
  /** the upstream measurement this app's own figure is compared against */
  validated: { inBand: number; over: number; short: number; note: string }
}

/** data/fit.json — fitting every session into a one-hour session (see lib/fit.ts) */
export interface FitData {
  note: string
  sessionMinutes: number
  setsPerSession: Record<string, Record<string, number>>
  older: { fromAge: number; maxSets: number; why: string }
  setsCount: string
  time: {
    setupSeconds: Record<string, number>
    setupFrom: string
    rampSecondsPerMainLift: Record<string, number>
    why: string
  }
  warmup: { generalMinutes: number; minimumMinutes: number; rule: string }
  correctives: {
    sets: { abnormal: number; borderline: number }
    reps: string
    maxLoad: number
    excludeTypes: string[]
    skipWhenSubTrained: boolean
    why: string
  }
  pairing: {
    protectMainLiftsAllGoals: boolean
    competing: [string, string][]
    limitPairs: { levels: string[]; fromAge: number; max: number }
    neverPairTypes: string[]
    competingGroups: [string, string][]
    sharedRest: string
    why: string
  }
  trim: {
    levers: { id: string; cost: number; after?: string; minSets?: number; compromises: string }[]
    redundant: { groups: string[]; subs: string[]; frontRaiseWithPress: boolean; frontRaiseAlways: boolean; sameSubTwice: boolean }
    compoundFloor: { sets: number; whileIsolationAbove: number; why: string }
    mainLifts: { keep: Record<string, number>; dropFirst: string[]; why: string }
    protect: string
  }
  reps: {
    smallFloor: number
    smallRange: string
    smallGroups: string[]
    smallTypes: string[]
    heavyMinLoad: number
    heavyMaxReps: number
    heavyRange: string
    holdSeconds: number
    carryMetres: number
    why: string
    unilateralLowerFloor: number
    unilateralLowerRange: string
    unilateralLowerWhy: string
    coreCompoundFloor: number
    coreCompoundRange: string
  }
  mainLiftFamilies: { families: string[][]; why: string }
  mainLiftsPerSession: Record<string, number | string>
  heavyHinge: { subs: string[]; types: string[]; minLoad: number; perSession: number; notOnConsecutiveDays: boolean }
  order: { smallGroups: string[]; lastTypes: string[]; rule: string }
  fullBody: {
    lower: string[]
    push: string[]
    pull: string[]
    rule: string
    addMissing: { lower: string; push: string; pull: string; sets: number; why: string }
    /** what counts as the push (a press, not a front raise) */
    pushPress?: string[]
  }
  kindCompoundMinSets: { sets: number; why: string }
  rest: {
    neverAbovePrescription: boolean
    isolationMaxSeconds: number
    why: string
    heavyFloor: { seconds: number; midRepsSeconds: number; midRepsUpTo: number; lowRepsSeconds: number; lowRepsUpTo: number; why: string }
  }
  conditioningMaxMinutes: Record<string, number | string>
  /** goals made from others (Shape Up): their tables come from one goal, their prescription blends two */
  derivedGoals?: Record<string, {
    tablesFrom: string
    blend: Record<string, number>
    fatHighBlend: Record<string, number>
    /** the blend stays as is with an InBody (high body fat adds conditioning instead) */
    fixedBlend?: boolean
    structure: string
    plannedConditioning?: {
      minutes: number
      sessions: number
      sessionsFatHigh: number
      intervals: { fromLevel: string[]; underAge: number }
      why: string
    }
    /** pair isolation work by default (supersets), so the conditioning fits */
    pairIsolation?: boolean
    why: string
  }>
  perSessionCaps?: { groups: string[]; max: number; maxSetsEach?: number; why: string }[]
  frontRaiseOnlyWithoutPress?: { why: string }
  neckFromAge: { age: number; why: string }
  pressesPerSession: { subs: string[]; max: number; why: string }
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
  sessionlength: SessionLengthData
  fit: FitData
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
  /** where the abs work sits in the session; never changes what the work is */
  absPlacement: AbsPlacement
  /** body-composition scan; empty means the InBody layer is inert */
  inbody: InBodyInput
  /** asymmetry readings per test code; empty means the VALD layer is inert */
  vald: ValdInput
  /** posture readings per indicator code; empty means no corrective slots are added */
  bodydot: BodyDotInput
  /** slot pins from the amend layer; empty means the generator runs unconstrained */
  pins: Pin[]
  /**
   * Days the client asked to bring down to the band ceiling. Only read with `fitHour: false`:
   * otherwise every session is fitted to the hour at generation and there is nothing to ask for.
   */
  caps?: CapPin[]
  /**
   * Fit every session into a one-hour personal-training session (data/fit.json): on unless this
   * is false. False is the spec's behaviour — sessions 55-75 minutes, trimmed only on request —
   * which the layer tests run against so each layer is tested on its own.
   */
  fitHour?: boolean
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
