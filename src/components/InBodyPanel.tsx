import { useState } from 'react'
import type { InBodyData } from '../types'
import { WORKED_EXAMPLE, hasAnyInput, type InBodyInput, type InBodyResult } from '../lib/inbody'

const COMPOSITION: { key: keyof InBodyInput; label: string }[] = [
  { key: 'smm', label: 'SMM' },
  { key: 'smmLow', label: 'SMM low' },
  { key: 'smmHigh', label: 'SMM high' },
  { key: 'pbf', label: 'Body fat %' },
  { key: 'pbfLow', label: 'PBF low' },
  { key: 'pbfHigh', label: 'PBF high' },
  { key: 'tbw', label: 'TBW' },
  { key: 'tbwLow', label: 'TBW low' },
  { key: 'tbwHigh', label: 'TBW high' },
]

const SEGMENTAL: { key: keyof InBodyInput; label: string }[] = [
  { key: 'fatLArm', label: 'Left arm' },
  { key: 'fatRArm', label: 'Right arm' },
  { key: 'fatTrunk', label: 'Trunk' },
  { key: 'fatLLeg', label: 'Left leg' },
  { key: 'fatRLeg', label: 'Right leg' },
]

const STATE_STYLE: Record<string, string> = {
  Under: 'bg-sky-100 text-sky-900',
  Over: 'bg-amber-100 text-amber-900',
  Low: 'bg-sky-100 text-sky-900',
  High: 'bg-amber-100 text-amber-900',
  Normal: 'bg-slate-100 text-slate-600',
}

export function InBodyPanel({
  data,
  input,
  setInput,
  result,
  compact,
}: {
  data: InBodyData
  input: InBodyInput
  setInput: (i: InBodyInput) => void
  result: InBodyResult
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const active = hasAnyInput(input)
  const showFields = !compact || open

  const field = (key: keyof InBodyInput, label: string) => (
    <label key={key} className="block">
      <span className="mb-0.5 block text-[10px] font-semibold text-slate-500 uppercase">{label}</span>
      <input
        type="number"
        step="0.1"
        value={input[key] ?? ''}
        onChange={(e) => {
          const next = { ...input }
          if (e.target.value === '') delete next[key]
          else next[key] = Number(e.target.value)
          setInput(next)
        }}
        className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs shadow-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">
          InBody scan
          {active && (
            <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
              active
            </span>
          )}
        </h2>
        <div className="flex gap-1">
          <button
            onClick={() => setInput(WORKED_EXAMPLE)}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
          >
            Load worked example
          </button>
          {active && (
            <button
              onClick={() => setInput({})}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              Clear
            </button>
          )}
          {compact && (
            <button
              onClick={() => setOpen(!open)}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              {open ? 'Hide' : 'Enter scan'}
            </button>
          )}
        </div>
      </div>

      {!active && !showFields && (
        <p className="text-[11px] text-slate-500">
          Optional. With no scan entered the program is unchanged.
        </p>
      )}

      {showFields && (
        <div className={compact ? 'grid gap-3 lg:grid-cols-2' : 'space-y-3'}>
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              Body composition
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {COMPOSITION.map((f) => field(f.key, f.label))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              Segmental fat %
            </div>
            <div className="grid grid-cols-5 gap-1.5">{SEGMENTAL.map((f) => field(f.key, f.label))}</div>
          </div>
        </div>
      )}

      {result.active && (
        <div className="space-y-2 border-t border-slate-200 pt-2">
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['SMM', result.states.smm],
                ['Body fat', result.states.pbf],
                ['Hydration', result.states.tbw],
                ['Arms', result.states.ARMS],
                ['Trunk', result.states.TRUNK],
                ['Legs', result.states.LEGS],
              ] as [string, string | null][]
            ).map(([label, state]) =>
              state ? (
                <span
                  key={label}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATE_STYLE[state] ?? ''}`}
                >
                  {label} {state}
                </span>
              ) : null,
            )}
            {result.tbwRatio !== null && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                ratio {result.tbwRatio.toFixed(3)}
              </span>
            )}
          </div>

          <div className="text-[11px] text-slate-700">
            <span className="font-semibold">Goal blend:</span>{' '}
            {Object.entries(result.weights)
              .filter(([, v]) => v > 0)
              .map(([g, v]) => `${g} ${Math.round(v * 100)}%`)
              .join(' · ')}
          </div>
          <div className="text-[11px] text-slate-600">
            Sets {result.setsRange[0].toFixed(1)}–{result.setsRange[1].toFixed(1)} · reps{' '}
            {result.reps[0]}–{result.reps[1]} · rest {result.rest}s (floor {result.restFloor}s)
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              Rules fired — every change is overridable
            </div>
            <ul className="space-y-1">
              {result.notes.map((n, i) => (
                <li key={i} className="rounded border border-violet-200 bg-violet-50 px-1.5 py-1 text-[10px] text-violet-900">
                  <span className="font-bold">{n.rule}</span> — measured {n.measured}. {n.changed}
                </li>
              ))}
              {result.notes.length === 0 && (
                <li className="text-[10px] text-slate-500">
                  Nothing fired: the scan reads inside range on every measure.
                </li>
              )}
            </ul>
          </div>

          {result.filler && (
            <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-700">
              <span className="font-semibold">Inter-set filler</span> (isolation slots only, never
              between sets of a compound or a main lift): {result.filler.bouts} ×{' '}
              {result.filler.seconds}s — {result.filler.movement}
            </div>
          )}

          {result.rule4Regions.length > 0 && (
            <div className="text-[10px] text-slate-600">
              Fat-burning structure on: {result.rule4Regions.join(', ')} — never on{' '}
              {data.unownedGroups.join(', ')}, and never on a main lift.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
