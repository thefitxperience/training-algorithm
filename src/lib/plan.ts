import type { ClientInput, DataBundle, Modality } from '../types'
import { ageBracket, allocationKey, generate, type Program } from './generate'
import { evaluateAll, buildInjuryIndex, type ExerciseVerdict } from './injury'
import { planStyles, splitDays, weekOrder, withStyleOverrides } from './modality'
import { buildPilatesSession, type PilatesSession } from './pilates'
import { splitAdvice } from './splitAdvice'
import { withDerivedGoals } from './goals'

/**
 * The whole week for a client's training styles (data/modalities.json). Gym, calisthenics and
 * CrossFit share one strength program (generate); Pilates gets sessions of its own, on days of
 * its own when it is combined with a strength style. A gym-only client gets exactly what
 * generate() gives, with nothing around it.
 */

export type WeekEntry = { kind: 'strength'; dayIndex: number } | { kind: 'pilates'; index: number }

export interface Plan {
  styles: Modality[]
  how: 'single' | 'session' | 'days'
  reasons: string[]
  strength: Program | null
  /** set when the strength part runs on fewer days than asked and the split had to change */
  strengthSplit?: { from: string; to: string; days: number }
  pilates: PilatesSession[]
  week: WeekEntry[]
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; error: string; key: string; ageBracket: string }

export function buildPlan(raw: DataBundle, input: ClientInput): PlanResult {
  const data = withStyleOverrides(withDerivedGoals(raw))
  const ageBr = ageBracket(input.age, data.config.ages)
  const styles = planStyles(data, input)
  if (!styles.ok) return { ok: false, error: styles.error, key: 'styles', ageBracket: ageBr }
  const split = splitDays(styles, input.days)

  let strength: Program | null = null
  let strengthSplit: Plan['strengthSplit']
  if (split.strength > 0) {
    // The strength part on its own days; a split that has no table for that many days gives way to
    // the one the advice ranks best for it.
    let s = input.split
    // Fewer strength days than the week is a different week: the split is re-chosen for them (an
    // Upper / Lower kept on three days trains legs once), unless the client's split is already
    // the one advised for that many days.
    if (split.strength !== input.days && split.strength > 1) {
      const advice = splitAdvice(data.splits, { ...input, days: split.strength }, data.config.splits, ageBr)
      const key = allocationKey({ split: s, goal: input.goal, ageBr, level: input.level, days: split.strength })
      const keep = advice.recommended.some((o) => o.split === s) && !!data.allocation[key]
      const best = advice.best?.split ?? 'Full Body'
      if (!keep && best !== s) {
        strengthSplit = { from: s, to: best, days: split.strength }
        s = best
      }
    }
    // One strength day a week has no table of its own: it is the first day of a two-day Full Body
    // program, which is that client's whole body at half the week's volume.
    const one = split.strength === 1
    if (one) {
      strengthSplit = { from: input.split, to: 'Full Body', days: 1 }
      s = 'Full Body'
    }
    const r = generate(raw, { ...input, days: one ? 2 : split.strength, split: s, modalities: styles.strength })
    if (!r.ok) return r
    strength = one ? { ...r.program, days: r.program.days.slice(0, 1), exerciseCount: r.program.days[0]?.exercises.length ?? 0 } : r.program
  }

  const pilates: PilatesSession[] = []
  if (split.pilates > 0) {
    const verdicts: Map<number, ExerciseVerdict> =
      strength?.verdicts ?? evaluateAll(data.exercises, input.pains, data.injury, buildInjuryIndex(data.injury, data.exercises))
    for (let i = 0; i < split.pilates; i++) {
      const s = buildPilatesSession(data, {
        input,
        ageBr,
        styles: styles.pilates,
        index: i,
        total: split.pilates,
        verdicts,
        equipment: input.equipment,
      })
      if (s) pilates.push(s)
    }
    if (!pilates.length)
      return { ok: false, error: 'No Pilates session could be built for this client: nothing in the repertoire fits their level, age and pains.', key: 'pilates', ageBracket: ageBr }
  }

  const order = weekOrder(strength?.days.length ?? 0, pilates.length)
  let si = 0
  let pi = 0
  const week: WeekEntry[] = order.map((k) => (k === 'strength' ? { kind: 'strength', dayIndex: si++ } : { kind: 'pilates', index: pi++ }))
  return {
    ok: true,
    plan: { styles: styles.styles, how: styles.how, reasons: styles.reasons, strength, ...(strengthSplit && { strengthSplit }), pilates, week },
  }
}
