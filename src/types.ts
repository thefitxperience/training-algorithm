import type { EquipmentTier } from './lib/equipment'

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

export interface DataBundle {
  config: Config
  allocation: Allocation
  exercises: Exercise[]
  prescription: Prescription
  splits: Splits
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
}
