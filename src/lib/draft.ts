import type { ClientDraft, ClientInput } from '../types'

/**
 * Turning a half-filled form into a client, or refusing to.
 *
 * The form opens on a real client, not a blank one — see `defaultDraft` — but any of these six
 * can be cleared, and none of them can be guessed back: sex, age, level, goal, days and split
 * all change what is prescribed. So a draft missing one produces no program at all rather than
 * a program for a client nobody described, and the form says which one is missing.
 */
export const REQUIRED_FIELDS = ['sex', 'age', 'level', 'goal', 'days', 'split'] as const

export type RequiredField = (typeof REQUIRED_FIELDS)[number]

const LABEL: Record<RequiredField, string> = {
  sex: 'sex',
  age: 'age',
  level: 'level',
  goal: 'goal',
  days: 'days per week',
  split: 'split',
}

/**
 * The client the form opens on.
 *
 * One starting point, not a menu of them: the five named presets that used to sit above the
 * form are gone, because Quick test covers that ground better — it draws across the whole legal
 * space rather than five points in it.
 *
 * The split is the one splits.json badges Recommended for this exact combination, so the
 * advice line underneath reads "currently selected" rather than offering to change it on
 * arrival. An acceptance check holds that true, so a change upstream fails the run instead of
 * quietly leaving the form disagreeing with its own advice.
 */
export function defaultDraft(): ClientDraft {
  return {
    sex: 'Male',
    age: 25,
    level: 'Beginner',
    goal: 'Build Muscle',
    days: 4,
    split: 'Full Body',
    equipment: 'Full gym',
    // Not the goal's recommended default, deliberately: the picker badges that one, and a
    // badge that is already applied cannot be told apart from a choice somebody made.
    structure: 'straight',
    absPlacement: 'end',
    pains: {},
    inbody: {},
    vald: {},
    bodydot: {},
    pins: [],
    caps: [],
  }
}

/** What is still missing, in the order the form asks for it, for naming rather than counting. */
export function missingFrom(draft: ClientDraft): string[] {
  return REQUIRED_FIELDS.filter((f) => draft[f] === null).map((f) => LABEL[f])
}

/** A complete client, or null. The only route from a draft to anything the generator accepts. */
export function completeClient(draft: ClientDraft): ClientInput | null {
  if (REQUIRED_FIELDS.some((f) => draft[f] === null)) return null
  return draft as ClientInput
}
