import type { ClientDraft, DataBundle, Modality } from '../types'
import { ALL_STYLES, planStyles, splitDays } from '../lib/modality'
import type { Plan } from '../lib/plan'
import type { PilatesSession } from '../lib/pilates'
import type { GeneratedDay } from '../lib/generate'
import { Button, Card, Note, Pill, SectionTitle } from './ui'

/**
 * The training style picker. Order matters: the first style picked is the main one (with Pilates
 * and a strength style together, it decides who gets the larger share of the week). A
 * combination that does not make sense says why instead of building anything.
 */
export function StylePicker({ data, draft, setDraft }: { data: DataBundle; draft: ClientDraft; setDraft: (d: ClientDraft) => void }) {
  const m = data.modalities
  if (!m) return null
  const picked: Modality[] = draft.modalities?.length ? draft.modalities : ['Gym']
  const toggle = (s: Modality) => {
    const next = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s]
    setDraft({ ...draft, modalities: next.length ? next : ['Gym'] })
  }
  const plan = planStyles(data, { modalities: picked, equipment: draft.equipment })
  const days = draft.days ? (plan.ok ? splitDays(plan, draft.days) : null) : null
  return (
    <div>
      <SectionTitle hint="Pick one or more, the main one first. Gym, calisthenics and CrossFit share a session; Pilates gets days of its own.">
        Training style
      </SectionTitle>
      <div className="mt-3 flex flex-wrap gap-2">
        {ALL_STYLES.map((s) => {
          const at = picked.indexOf(s)
          return (
            <button
              key={s}
              type="button"
              title={m.modalities[s].why}
              onClick={() => toggle(s)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                at >= 0 ? 'border-udra-blue bg-udra-blue text-white' : 'border-udra-linen-300 bg-white text-udra-ink-500 hover:text-black'
              }`}
            >
              {m.modalities[s].label}
              {at === 0 && picked.length > 1 && <span className="ml-1.5 rounded bg-white/25 px-1 text-[10px] uppercase">main</span>}
              {at > 0 && <span className="ml-1.5 rounded bg-white/25 px-1 text-[10px]">{at + 1}</span>}
            </button>
          )
        })}
      </div>
      {!plan.ok ? (
        <div className="mt-3">
          <Note tone="flame" title="These styles do not combine">
            {plan.error}
          </Note>
        </div>
      ) : (
        <div className="mt-2 space-y-1 text-[12px] text-udra-ink-500">
          {plan.reasons.map((r) => (
            <div key={r}>{r}</div>
          ))}
          {days && days.pilates > 0 && days.strength > 0 && (
            <div className="font-semibold text-udra-ink-700">
              {draft.days} days: {days.strength} {plan.strength.join(' + ')} and {days.pilates} {plan.pilates.join(' + ')}.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The client's rung on each calisthenics ladder: the trainer moves it up when it is clean. A
 * rung the trainer sets may sit above what the level would start on; the default is shown as such.
 */
export function RungsPanel({ plan, draft, setDraft, data }: { plan: Plan; draft: ClientDraft; setDraft: (d: ClientDraft) => void; data: DataBundle }) {
  const rungs = plan.strength?.styles.rungs ?? []
  if (!rungs.length) return null
  const set = (family: string, rung: number | null) => {
    const next = { ...(draft.rungs ?? {}) }
    if (rung === null) delete next[family]
    else next[family] = rung
    setDraft({ ...draft, rungs: next })
  }
  const clean = data.modalities?.ladders.cleanWhen
  const styles = plan.strength?.styles
  const focus = styles?.focus ?? []
  const asked = draft.focusSkills ?? []
  const max = data.modalities?.ladders.focus?.max ?? 3
  const toggleFocus = (f: string) => {
    const next = asked.includes(f) ? asked.filter((x) => x !== f) : asked.length < max ? [...asked, f] : asked
    setDraft({ ...draft, focusSkills: next })
  }
  return (
    <Card className="p-4">
      <SectionTitle hint={`Up to ${max}. A skill picked here opens most sessions with more sets, instead of every skill taking its turn, and the rest of the program leans on the work that leads to it.`}>
        Skills to master
      </SectionTitle>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-2">
        {(styles?.skillLadders ?? []).map((f) => {
          const on = asked.includes(f)
          return (
            <button
              key={f}
              type="button"
              onClick={() => toggleFocus(f)}
              disabled={!on && asked.length >= max}
              className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
                on ? 'border-udra-blue bg-udra-blue text-white' : 'border-udra-linen-300 bg-white text-udra-ink-500 hover:text-black'
              }`}
            >
              {on && '★ '}
              {f}
            </button>
          )
        })}
        {!asked.length && <span className="text-[12px] text-udra-ink-500">None picked: every skill takes its turn.</span>}
        {asked.length > 0 && !focus.length && (
          <span className="text-[12px] text-udra-flame">None of the picked skills can be trained now: why is below each.</span>
        )}
        {focus.length > 0 && <span className="text-[12px] text-udra-ink-500">Working towards: {focus.join(', ')}.</span>}
      </div>
      {(styles?.focusRefused ?? []).map((r) => (
        <div key={r.family} className="mb-3">
          <Note tone="flame" title={`${r.family} cannot be a focus right now`}>
            {r.reason}.
          </Note>
        </div>
      ))}
      <SectionTitle hint={`One rung per ladder, never the level: move a rung up when it is clean (${clean?.reps ?? ''}; holds: ${clean?.hold ?? ''}). Easier rungs become warm-up drills.`}>
        Calisthenics ladders
      </SectionTitle>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rungs.map((r) => (
          <div key={r.family} className={`rounded-xl border bg-white px-3 py-2 ${focus.includes(r.family) ? 'border-udra-blue' : 'border-udra-linen-200'}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">
                {focus.includes(r.family) && <span className="text-udra-blue">★ </span>}
                {r.family}
              </span>
              <span className="tnum text-[11px] text-udra-ink-500">
                step {r.step} of {r.steps}
              </span>
              {!r.set && <Pill title="Where this level starts; set it by moving it">start</Pill>}
              <span className="ml-auto flex gap-1">
                <Button size="sm" disabled={r.prevRung === undefined} onClick={() => r.prevRung !== undefined && set(r.family, r.prevRung)} aria-label={`${r.family} down a rung`}>
                  −
                </Button>
                <Button size="sm" disabled={r.nextRung === undefined} onClick={() => r.nextRung !== undefined && set(r.family, r.nextRung)} aria-label={`${r.family} up a rung`}>
                  +
                </Button>
                {r.set && (
                  <Button size="sm" onClick={() => set(r.family, null)} title="Back to where the level starts">
                    ↺
                  </Button>
                )}
              </span>
            </div>
            <div className="mt-1 text-[12px]">{r.exercises.join(' / ')}</div>
            {r.next.length > 0 && <div className="text-[11px] text-udra-ink-500">next: {r.next.join(' / ')}</div>}
          </div>
        ))}
      </div>
    </Card>
  )
}

/** A Pilates session: sections in order, reps, springs, the posture moves marked. */
export function PilatesPanel({ session, dayNumber }: { session: PilatesSession; dayNumber: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-udra-linen-200 bg-udra-linen/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="tnum flex h-7 w-7 items-center justify-center rounded-full bg-udra-blue text-xs font-bold text-white">{dayNumber}</span>
          <div>
            <div className="text-sm font-bold">{session.label}</div>
            <div className="text-[10px] tracking-[0.08em] text-udra-ink-500 uppercase">Day {dayNumber}</div>
          </div>
        </div>
        <span className="tnum rounded-full bg-black px-2.5 py-0.5 text-xs font-bold text-white">{session.minutes} min</span>
      </div>
      <WarmupStrip moves={session.warmup} />
      <div className="divide-y divide-udra-linen-200">
        {session.sections.map((sec) => (
          <div key={sec.name} className="px-4 py-2">
            <div className="text-[10px] font-bold tracking-[0.1em] text-udra-ink-500 uppercase">{sec.name}</div>
            <ul className="mt-1 space-y-0.5">
              {sec.items.map((it) => (
                <li key={it.exercise.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="font-semibold">{it.exercise.name}</span>
                  <span className="tnum text-udra-ink-500">{it.reps}</span>
                  {it.springs && <span className="text-[11px] text-udra-ink-500">springs: {it.springs}</span>}
                  {it.forPosture && (
                    <Pill tone="primary" title={`Answers the U-Body finding: ${it.forPosture}`}>
                      U-Body · {it.forPosture}
                    </Pill>
                  )}
                  {it.weakSideFirst && <Pill tone="cyan">{it.weakSideFirst.toLowerCase()} first</Pill>}
                  {it.caution && (
                    <Pill tone="flame" title={`Kept with care: you reported ${it.caution}. One spring lighter; stop if it hurts.`}>
                      May aggravate · {it.caution.toLowerCase()}
                    </Pill>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {session.notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-udra-linen-200 bg-udra-linen/30 px-4 py-2 text-[11px] text-udra-ink-500">
          {session.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** The five-move warm-up, on one line: easier rungs of the session's own ladders are marked. */
export function WarmupStrip({ moves }: { moves?: { name: string; fromLadder?: string; seconds: number }[] }) {
  if (!moves?.length) return null
  return (
    <div className="border-b border-udra-linen-200 bg-udra-cyan/10 px-4 py-2 text-[12px]">
      <span className="mr-2 rounded bg-udra-cyan/40 px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">Warm-up · 5 min</span>
      {moves.map((m, i) => (
        <span key={m.name}>
          {i > 0 && <span className="text-udra-ink-300"> · </span>}
          {m.name}
          {m.fromLadder && <span className="text-udra-ink-500"> ({m.fromLadder} drill)</span>}
        </span>
      ))}
      <span className="text-udra-ink-500"> · {moves[0].seconds} s each</span>
    </div>
  )
}

/** The week in order, when it mixes strength days and Pilates days. */
export function WeekStrip({ plan, days }: { plan: Plan; days: GeneratedDay[] }) {
  if (!plan.pilates.length || !plan.strength) return null
  return (
    <Card className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
      <span className="font-bold">Your week</span>
      {plan.week.map((w, i) => (
        <Pill key={i} tone={w.kind === 'pilates' ? 'cyan' : 'primary'}>
          Day {i + 1} · {w.kind === 'strength' ? days[w.dayIndex]?.label : plan.pilates[w.index]?.label}
        </Pill>
      ))}
      {plan.strengthSplit && (
        <span className="text-[12px] text-udra-ink-500">
          {plan.strengthSplit.from} has no {plan.strengthSplit.days}-day table, so the strength days run {plan.strengthSplit.to}.
        </span>
      )}
    </Card>
  )
}
