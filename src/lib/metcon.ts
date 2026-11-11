import type { DataBundle, Exercise, Modality } from '../types'
import type { ExerciseVerdict } from './injury'
import { isEquipmentAvailable, type EquipmentTier } from './equipment'
import { memberOf, type MetconRules } from './modality'

/**
 * CrossFit's metcon: a format (AMRAP, EMOM, for time), a time domain, and three moves that do
 * not fight each other: one for the legs or hips, one for the upper body or gymnastics, one for
 * the engine. Never two grip-heavy moves, never a hinge after the strength part's heavy hinge,
 * nothing the client's level, age, equipment or pain rules out. The days rotate the format and
 * the moves, so the week is not one workout four times.
 */

export type MetconRole = 'lower' | 'upper' | 'engine'
export type MetconUnit = 'reps' | 'cal' | 'metres' | 'du' | 'sled' | 'hsw'

export interface MetconMove {
  exercise: Exercise
  role: MetconRole
  amount: number
  unit: MetconUnit
  /** "10 wall ball shots", "12 cal rowing machine" */
  label: string
  /** a ticked pain cautions this move: used only because nothing safer filled its role */
  caution?: string
}

export interface Metcon {
  format: 'AMRAP' | 'EMOM' | 'For time'
  minutes: number
  /** For time: rounds, with `minutes` as the cap */
  rounds?: number
  moves: MetconMove[]
  /** the whole workout as the coach would write it on the board */
  description: string
  why: string
}

export interface MetconInput {
  level: string
  goal: string
  age: number
  ageBr: string
  equipment: EquipmentTier
  dayIndex: number
  /** the strength part's exercises today: a heavy hinge there keeps hinges out of here */
  strength: Exercise[]
  heavyHingeToday: boolean
  verdicts: Map<number, ExerciseVerdict>
  /** moves the week's earlier metcons used: a different one where the role has one */
  usedThisWeek?: Set<number>
  /** the most this metcon may run: set when the strength part cannot shrink further to fit the hour */
  maxMinutes?: number
  /** rebuild with these moves (a shortened metcon keeps its workout, only its clock changes) */
  moves?: Exercise[]
}

const MAX_SKILL: Record<string, number> = { Beginner: 2, Intermediate: 3, Advanced: 5 }

export function buildMetcon(data: Pick<DataBundle, 'exercises' | 'modalities'>, rules: MetconRules, m: MetconInput): Metcon | null {
  const styles: Modality[] = ['CrossFit']
  const maxSkill = MAX_SKILL[m.level] ?? 2
  const exclude = rules.excludeTags ?? ['Olympic']
  const old = m.age >= 60 ? rules.over60 : undefined
  const usable = (e: Exercise) =>
    styles.some((s) => memberOf(data, e, s)) &&
    e.type !== 'isometric' &&
    e.type !== 'mobility' &&
    !(e.tags ?? []).some((t) => exclude.includes(t) || old?.excludeTags.includes(t)) &&
    !old?.excludeNames.includes(e.name) &&
    !e.mainLift &&
    // A pain's "this side only" is no use in a metcon, so only moves the pain leaves alone or cautions.
    (m.verdicts.get(e.id)?.verdict ?? 'OK') !== 'SIDE_ONLY' &&
    e.skill <= maxSkill &&
    !e.avoidAges.includes(m.ageBr) &&
    !(m.ageBr === '65+' && e.load > 3) &&
    m.verdicts.get(e.id)?.verdict !== 'REMOVE' &&
    isEquipmentAvailable(e, m.equipment)
  const pool = data.exercises.filter(usable)

  const isEngine = (e: Exercise) =>
    (e.tags ?? []).some((t) => rules.roles.engine.tags?.includes(t)) || (rules.roles.engine.names ?? []).includes(e.name)
  const roleOf = (e: Exercise): MetconRole | null => {
    if (isEngine(e)) return 'engine'
    if (rules.roles.lower.subs?.includes(e.sub)) return 'lower'
    if (rules.roles.upper.subs?.includes(e.sub)) return 'upper'
    return null
  }
  const isHinge = (e: Exercise) => e.sub === 'Hams - hinge' || /swing|deadlift|clean|snatch|over shoulder/i.test(e.name)
  const gripHeavy = (e: Exercise) =>
    rules.gripHeavy.names.includes(e.name) ||
    (rules.gripHeavy.subs.includes(e.sub) && e.type !== 'isolation') ||
    e.alsoTrains.some((a) => rules.gripHeavy.alsoTrains.includes(a))
  // A move a pain cautions only when nothing safer fills its role; then Metcon-tagged moves (what a
  // metcon is made of) before fallbacks; harder first for intermediate and advanced, easier for a beginner.
  const caution = (e: Exercise) => (m.verdicts.get(e.id)?.verdict === 'CAUTION' ? 1 : 0)
  const kind = (e: Exercise) => ((e.tags ?? []).includes('Metcon') ? 0 : (e.tags ?? []).includes('Plyometric') ? 1 : isEngine(e) ? 0 : 2)
  const rank = (e: Exercise) => caution(e) * 10 + kind(e)
  const hardFirst = m.level !== 'Beginner'
  // The upper move never trains the day's strength pattern again (pull-ups after 5 × 3 pull-ups).
  const strengthSubs = new Set(m.strength.map((e) => e.sub))

  const byRole = (role: MetconRole) =>
    pool
      .filter((e) => roleOf(e) === role && !(role === 'lower' && m.heavyHingeToday && isHinge(e)))
      .filter((e) => !m.strength.some((s) => s.id === e.id) && !(role === 'upper' && strengthSubs.has(e.sub)))
      .sort((a, b) => rank(a) - rank(b) || (hardFirst ? b.skill - a.skill : a.skill - b.skill) || a.id - b.id)

  const chosen: Exercise[] = m.moves ? [...m.moves] : []
  if (!m.moves) for (const [k, role] of (['lower', 'upper', 'engine'] as MetconRole[]).entries()) {
    const list = byRole(role).filter((e) => !(gripHeavy(e) && chosen.some(gripHeavy)))
    if (!list.length) continue
    // The best few rotate by day, so each session gets a different combination.
    const top = list.filter((e) => rank(e) === rank(list[0]))
    const fresh = top.filter((e) => !m.usedThisWeek?.has(e.id))
    const from = fresh.length ? fresh : top
    const pick = from[(m.dayIndex * 2 + k) % from.length]
    chosen.push(pick)
    m.usedThisWeek?.add(pick.id)
  }
  if (chosen.length < 2) return null

  const lean = m.goal === 'Lose Fat' || m.goal === 'Shape Up'
  // Get Stronger keeps its metcon short: the strength part is the point.
  let minutes = (m.goal === 'Get Stronger' && rules.minutesGetStronger ? rules.minutesGetStronger : lean ? rules.minutesLoseFat : rules.minutes)[m.level] ?? 10
  if (m.age >= 50) minutes = Math.min(minutes, rules.minutesOver50)
  if (m.maxMinutes !== undefined) minutes = Math.min(minutes, m.maxMinutes)
  const formats = (m.level === 'Beginner' ? rules.formatsBeginner : rules.formats) as Metcon['format'][]
  const format = formats[m.dayIndex % formats.length]
  const base = rules.reps[m.level] ?? rules.reps.Beginner
  const factor = format === 'EMOM' ? rules.emomRepsFactor : 1

  const pm = rules.perMove
  const moves: MetconMove[] = chosen.map((e) => {
    const unit: MetconUnit = ((pm?.unit[e.name] ?? rules.unitByName[e.name]) as MetconUnit | undefined) ?? 'reps'
    const raw =
      unit === 'reps' ? base.reps : unit === 'cal' ? base.cal : unit === 'metres' ? base.metres : unit === 'du' ? base.du : unit === 'sled' ? (base.sled ?? 20) : (base.hsw ?? 5)
    // A wall walk or a muscle-up is several burpees' worth: the move's own factor scales the count.
    const per = unit === 'reps' ? (pm?.factor[e.name] ?? 1) : 1
    let amount =
      unit === 'metres' ? Math.max(50, Math.round((raw * factor) / 50) * 50) : unit === 'sled' || unit === 'hsw' ? Math.max(5, Math.round((raw * factor) / 5) * 5) : Math.max(2, Math.round(raw * factor * per))
    // An EMOM minute holds its work in about forty seconds, or it is not every minute on the minute.
    if (format === 'EMOM' && pm) {
      const secs = pm.secondsPerRep[e.name] ?? pm.secondsPerRep[unit === 'reps' ? 'default' : unit] ?? pm.secondsPerRep.default
      const most = Math.floor(pm.emomMaxSeconds / secs)
      if (amount > most) amount = Math.max(unit === 'metres' ? 50 : 1, unit === 'metres' ? Math.floor(most / 50) * 50 : most)
    }
    const name = e.name.toLowerCase()
    const label =
      unit === 'cal'
        ? `${amount} cal ${name}`
        : unit === 'metres' || unit === 'sled' || unit === 'hsw'
          ? `${amount} m ${name}`
          : unit === 'du'
            ? `${amount} double-unders`
            : `${amount} ${plural(name)}`
    const v = m.verdicts.get(e.id)
    const cautionFor = v?.verdict === 'CAUTION' ? v.byPain.filter((x) => x.verdict === 'CAUTION').map((x) => x.painLabel).join(', ') : ''
    return { exercise: e, role: roleOf(e)!, amount, unit, label, ...(cautionFor && { caution: cautionFor }) }
  })

  const list = moves.map((x) => x.label).join(', ')
  let description = ''
  let rounds: number | undefined
  if (format === 'AMRAP') description = `AMRAP ${minutes} min: ${list}. As many rounds as possible.`
  else if (format === 'EMOM') {
    const cycles = Math.max(1, Math.floor(minutes / moves.length))
    minutes = cycles * moves.length
    description = `EMOM ${minutes} min: ${moves.map((x, i) => `minute ${i + 1}, ${x.label}`).join('; ')}. Repeat ${cycles} times; rest what is left of each minute.`
  } else {
    rounds = rules.forTimeRounds[m.level] ?? 3
    description = `For time, ${rounds} rounds: ${list}. Time cap ${minutes} min.`
  }
  return {
    format,
    minutes,
    ...(rounds && { rounds }),
    moves,
    description,
    why: `${format} for ${minutes} minutes: ${moves.map((x) => rules.roles[x.role].label).join(', ')}${m.heavyHingeToday ? '; no hinge after today\'s heavy hinge' : ''}.`,
  }
}

/** "wall ball shot" → "wall ball shots", "devil press" → "devil presses"; "toes-to-bar" stays. */
function plural(name: string): string {
  if (/to-bar$|to-elbow$/.test(name)) return name
  if (/(s|sh|ch|x)$/.test(name)) return `${name}es`
  return `${name}s`
}
