import type { ClientInput } from '../types'

export interface Preset {
  name: string
  input: ClientInput
  /** what this preset is meant to catch, from the acceptance criteria */
  expectation: string
}

export const PRESETS: Preset[] = [
  {
    name: 'Reference',
    input: { sex: 'Male', age: 28, level: 'Intermediate', goal: 'Build Muscle', days: 4, split: 'Upper / Lower', equipment: 'Full gym' },
    expectation: '4 days, ~40 exercises, sessions roughly 54–75 min, no fallback warnings.',
  },
  {
    name: 'New client',
    input: { sex: 'Female', age: 34, level: 'Beginner', goal: 'Lose Fat', days: 3, split: 'Full Body', equipment: 'Full gym' },
    expectation: 'Beginner skill cap (skill ≤ 2) with female target overrides applied.',
  },
  {
    name: 'Youth strength',
    input: { sex: 'Male', age: 17, level: 'Advanced', goal: 'Get Stronger', days: 5, split: 'Push / Pull / Legs', equipment: 'Full gym' },
    expectation: 'Get Stronger days should open on main lifts.',
  },
  {
    name: 'Older adult',
    input: { sex: 'Female', age: 68, level: 'Beginner', goal: 'Get Stronger', days: 4, split: 'Upper / Lower', equipment: 'Full gym' },
    expectation:
      'No ab wheel rollout, no deep full-ROM squat, no pull-up, no Copenhagen plank. Expect machines, cables, goblet squats, chest-supported rows.',
  },
  {
    name: 'Stress test',
    input: { sex: 'Male', age: 10, level: 'Beginner', goal: 'Build Muscle', days: 5, split: 'Muscle Group Per Day', equipment: 'Full gym' },
    expectation: '5 days requested comes back as 3 delivered with the age-cap note, and no exercise with load > 3.',
  },
]
