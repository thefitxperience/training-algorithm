import { useState } from 'react'
import type { InjuryData } from '../types'
import { copyFor, type PainSelection, type Side } from '../lib/injury'

const SIDES: Side[] = ['Left', 'Right', 'Both']

export function PainPanel({
  injury,
  pains,
  setPains,
  compact,
}: {
  injury: InjuryData
  pains: PainSelection
  setPains: (p: PainSelection) => void
  /** bar layout in the simple view — collapsed behind a summary until opened */
  compact?: boolean
}) {
  const ticked = Object.keys(pains)
  const [open, setOpen] = useState(false)

  const toggle = (id: string, sided: boolean) => {
    const next = { ...pains }
    if (next[id]) delete next[id]
    else next[id] = sided ? 'Both' : 'Both'
    setPains(next)
  }

  const setSide = (id: string, side: Side) => setPains({ ...pains, [id]: side })

  const regions = [...new Set(injury.pains.map((p) => p.region))]
  const showList = !compact || open

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">
          Pain or injury
          {ticked.length > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
              {ticked.length} reported
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {ticked.length > 0 && (
            <button
              onClick={() => setPains({})}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              Clear all
            </button>
          )}
          {compact && (
            <button
              onClick={() => setOpen(!open)}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              {open ? 'Hide' : 'Report pain'}
            </button>
          )}
        </div>
      </div>

      {ticked.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          {copyFor(injury, 'Re-check prompt', {
            pain: ticked
              .map((id) => injury.pains.find((p) => p.id === id)?.label ?? id)
              .join(' / '),
          })}
        </div>
      )}

      {showList && (
        <div className={compact ? 'grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4' : 'space-y-3'}>
          {regions.map((region) => (
            <div key={region}>
              <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
                {region}
              </div>
              <div className="space-y-1">
                {injury.pains
                  .filter((p) => p.region === region)
                  .map((p) => {
                    const on = Boolean(pains[p.id])
                    return (
                      <div key={p.id}>
                        <label
                          className="flex cursor-pointer items-start gap-1.5 text-[11px] text-slate-700"
                          title={p.description}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(p.id, p.sided)}
                            className="mt-0.5 shrink-0"
                          />
                          <span className={on ? 'font-semibold text-slate-900' : ''}>{p.label}</span>
                        </label>
                        {on && p.sided && (
                          <div className="mt-1 mb-1 ml-5 flex gap-1">
                            {SIDES.map((s) => (
                              <button
                                key={s}
                                onClick={() => setSide(p.id, s)}
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                                  pains[p.id] === s
                                    ? 'border-slate-800 bg-slate-800 text-white'
                                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Shown whenever at least one pain is ticked. Not optional. */
export function MedicalDisclaimer({ injury }: { injury: InjuryData }) {
  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="font-bold">Important. </span>
      {injury.copy['Medical disclaimer']}
    </div>
  )
}
