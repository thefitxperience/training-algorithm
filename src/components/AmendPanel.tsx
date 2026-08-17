import { useState } from 'react'
import type { AmendData, Exercise } from '../types'
import type { Program } from '../lib/generate'
import {
  amendType,
  buildShortlist,
  parseSlotId,
  type AmendContext,
  type Badge,
  type Candidate,
  type Pin,
} from '../lib/amend'
import type { EquipmentTier } from '../lib/equipment'
import type { Verdict } from '../lib/injury'

const BADGE_STYLE: Record<Badge, string> = {
  RECOMMENDED: 'bg-emerald-100 text-emerald-900',
  AVAILABLE: 'bg-amber-100 text-amber-900',
  ADAPTED: 'bg-slate-200 text-slate-700',
}

function fill(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v)
  return out
}

export interface AmendWiring {
  data: AmendData
  exercises: Exercise[]
  pins: Pin[]
  setPins: (p: Pin[]) => void
  ageBracket: string
  equipment: EquipmentTier
  verdictOf: (id: number) => Verdict
  actor: string
}

/**
 * The per-slot "change this" control. Free search over 315 exercises is what produces the
 * accidental all-chest program, so the list is the sub-region's, ranked, and capped at 8.
 */
export function AmendControl({
  slotId,
  from,
  wiring,
  currentEquipment,
}: {
  slotId: string
  from: Exercise
  wiring: AmendWiring
  currentEquipment?: string
}) {
  const [open, setOpen] = useState(false)
  const [pendingC, setPendingC] = useState<Candidate | null>(null)

  const slot = parseSlotId(slotId)
  if (!slot) return null

  const ctx: AmendContext = {
    data: wiring.data,
    library: wiring.exercises,
    ageBracket: wiring.ageBracket,
    equipment: wiring.equipment,
    verdictOf: wiring.verdictOf,
  }

  const list = buildShortlist(slot, from, ctx, currentEquipment)
  const existing = wiring.pins.find((p) => p.slotId === slotId)

  const apply = (c: Candidate, accepted?: boolean) => {
    const pin: Pin = {
      slotId,
      from: from.id,
      to: c.exercise.id,
      equipment: c.equipment,
      actor: wiring.actor,
      timestamp: new Date().toISOString(),
      ...(c.requiresAcceptance ? { accepted: accepted === true } : {}),
    }
    wiring.setPins([...wiring.pins.filter((p) => p.slotId !== slotId), pin])
    setPendingC(null)
    setOpen(false)
  }

  return (
    <span>
      <button
        onClick={() => setOpen(!open)}
        className="rounded border border-slate-300 px-1 py-0.5 text-[9px] font-semibold text-slate-500 hover:bg-slate-100"
        title="Swap this exercise for another"
      >
        change
      </button>

      {/* A fixed overlay, not a dropdown. The program table scrolls horizontally to carry the
          weight column, and `overflow-x: auto` computes `overflow-y` to auto with it — an
          absolutely-positioned panel inside it gets clipped to a sliver. */}
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/40 p-4 sm:items-center"
          onClick={() => {
            setOpen(false)
            setPendingC(null)
          }}
        >
        <div
          className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-300 bg-white p-3 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-800">
              Replace {from.name}
              {list.mainSlot && (
                <span className="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-bold text-indigo-800">
                  MAIN SLOT
                </span>
              )}
            </span>
            <button onClick={() => setOpen(false)} className="text-[11px] text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>

          {list.widened && (
            <div className="mb-1 rounded border border-slate-300 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-700">
              Nothing in <strong>{from.sub}</strong> is available to you
              {list.sameSubBlocked > 0 && ` — all ${list.sameSubBlocked} options are ruled out`}. The
              list below widens to neighbouring sub-regions in the same muscle group, which
              changes what you train.
            </div>
          )}

          {list.emptyReason && (
            <div className="rounded border border-amber-400 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-900">
              {list.emptyReason}
            </div>
          )}

          {(['A', 'B', 'C', 'blocked'] as const).map((group) => {
            const rows = list.candidates.filter((c) =>
              group === 'blocked' ? c.blocked : !c.blocked && c.type === group,
            )
            if (rows.length === 0) return null
            const heading =
              group === 'A'
                ? 'Same exercise, different kit'
                : group === 'B'
                  ? `Other ways to train ${from.sub}`
                  : group === 'C'
                    ? 'Nearby muscles — this changes what you train'
                    : 'Not available to you'
            return (
              <div key={group} className="mt-1">
                <div className="mb-0.5 text-[9px] font-bold tracking-wide text-slate-400 uppercase">
                  {heading}
                </div>
          <ul className="space-y-0.5">
            {rows.map((c, i) => (
              <li key={`${c.exercise.id}-${c.equipment ?? ''}-${i}`}>
                <button
                  disabled={c.blocked !== null}
                  onClick={() => (c.requiresAcceptance ? setPendingC(c) : apply(c))}
                  className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] ${
                    c.blocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-100'
                  }`}
                >
                  <span className={`flex-1 ${c.blocked ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                    {c.equipment ? `${c.exercise.name} — ${c.equipment}` : c.exercise.name}
                  </span>
                  {c.blocked ? (
                    <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold text-red-900">
                      {c.blocked.reason}
                    </span>
                  ) : (
                    <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${BADGE_STYLE[c.badge]}`}>
                      {c.badge}
                    </span>
                  )}
                  <span className="w-4 text-right text-[9px] text-slate-400">{c.type}</span>
                </button>
              </li>
            ))}
          </ul>
              </div>
            )
          })}

          {/* Type C changes which muscle is trained, so it stays inactive until accepted. */}
          {pendingC && (
            <div className="mt-1 rounded border-2 border-amber-400 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-900">
              {fill(wiring.data.typeCWarning, {
                from: from.name,
                to: pendingC.exercise.name,
                fromSub: from.sub,
                toSub: pendingC.exercise.sub,
              })}
              <div className="mt-1 flex gap-1">
                <button
                  onClick={() => apply(pendingC, true)}
                  className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-700"
                >
                  Accept
                </button>
                <button
                  onClick={() => setPendingC(null)}
                  className="rounded border border-amber-400 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {existing && (
            <button
              onClick={() => wiring.setPins(wiring.pins.filter((p) => p.slotId !== slotId))}
              className="mt-1 w-full rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              Undo this change
            </button>
          )}
        </div>
        </div>
      )}
    </span>
  )
}

/** Active pins, anything held back or retired, and the volume drift the pins caused. */
export function PinsPanel({
  program,
  wiring,
}: {
  program: Program
  wiring: AmendWiring
}) {
  const { amend } = program
  const byId = new Map(wiring.exercises.map((e) => [e.id, e]))
  const name = (id: number) => byId.get(id)?.name ?? `#${id}`

  if (!amend.active)
    return (
      <div className="space-y-1">
        <h2 className="text-sm font-bold text-slate-800">Your changes</h2>
        <p className="text-[11px] text-slate-500">
          Use <em>change</em> on any exercise to swap it. A change is kept as a pin, so it survives
          a re-test, a new scan or a goal change instead of being silently undone.
        </p>
      </div>
    )

  const all = [...amend.applied, ...amend.pending]

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-slate-800">
        Your changes
        <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
          {amend.applied.length} active
        </span>
        {/* Cutting sets shortens the week too, so a time cap shows up in the same place a
            swap does rather than moving volume with nothing on screen to explain it. */}
        {program.timecap.applied.length > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
            {program.timecap.applied.length} day
            {program.timecap.applied.length === 1 ? '' : 's'} shortened to{' '}
            {program.timecap.target} min
          </span>
        )}
      </h2>

      {all.length > 0 && (
        <ul className="space-y-0.5">
          {all.map((p) => {
            const from = byId.get(p.from)
            const to = byId.get(p.to)
            const type = from && to ? amendType(from, to, p.equipment) : '?'
            const pending = amend.pending.includes(p)
            return (
              <li
                key={p.slotId}
                className={`flex flex-wrap items-center gap-1 rounded border px-1.5 py-1 text-[10px] ${
                  pending ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                }`}
              >
                <span className="text-slate-700">
                  {name(p.from)} → <strong>{name(p.to)}</strong>
                  {p.equipment && <span className="text-slate-500"> ({p.equipment})</span>}
                </span>
                <span className="rounded bg-slate-100 px-1 py-0.5 font-semibold text-slate-600">
                  type {type}
                </span>
                <span className="text-slate-400">
                  {p.actor} · {new Date(p.timestamp).toLocaleDateString()}
                </span>
                {pending && <span className="font-bold text-amber-800">not accepted yet</span>}
                <button
                  onClick={() => wiring.setPins(wiring.pins.filter((x) => x.slotId !== p.slotId))}
                  className="ml-auto rounded border border-slate-300 px-1 py-0.5 font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* A pin the current screen would refuse is never applied — the client is told. */}
      {amend.retired.length > 0 && (
        <div className="rounded border-2 border-red-400 bg-red-50 px-2 py-1.5 text-[10px] text-red-900">
          <div className="font-bold">
            {amend.retired.length} change{amend.retired.length === 1 ? '' : 's'} no longer applied
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {amend.retired.map((r, i) => (
              <li key={i}>
                {name(r.pin.from)} → {name(r.pin.to)}: {r.reason}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reported, never blocked — the client asked for this. */}
      {amend.drift.length > 0 && (
        <div className="rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
          <div className="font-bold">
            {amend.drift.length} muscle{amend.drift.length === 1 ? '' : 's'} now more than{' '}
            {(amend.driftTolerance * 100).toFixed(0)}% off the planned volume
          </div>
          <table className="mt-1 w-full text-left">
            <thead className="text-[9px] tracking-wide text-amber-700 uppercase">
              <tr>
                <th className="font-semibold">Sub-region</th>
                <th className="text-right font-semibold">Planned</th>
                <th className="text-right font-semibold">Now</th>
                <th className="text-right font-semibold">Off by</th>
              </tr>
            </thead>
            <tbody>
              {amend.drift.map((d) => (
                <tr key={d.sub}>
                  <td>
                    {d.sub} <span className="text-amber-700">{d.code}</span>
                  </td>
                  <td className="text-right font-mono">{d.target}</td>
                  <td className="text-right font-mono">{d.delivered}</td>
                  <td className="text-right font-mono font-bold">
                    {d.pct === Infinity ? 'new' : `${d.pct > 0 ? '+' : ''}${(d.pct * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1">
            Your program is still complete and safe — this is reported so you can see what your
            changes moved, not to stop you.
          </div>
        </div>
      )}
    </div>
  )
}
