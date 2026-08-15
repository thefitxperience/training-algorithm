import { useState } from 'react'
import type { ValdData } from '../types'
import type { ValdInput, ValdResult, WeakSide } from '../lib/vald'

const SIDES: WeakSide[] = ['Left', 'Right']

const BRACKET_STYLE: Record<string, string> = {
  'Perfect symmetry': 'bg-slate-100 text-slate-500',
  'Normal symmetry': 'bg-slate-100 text-slate-500',
  Weakness: 'bg-amber-100 text-amber-900',
  Problem: 'bg-amber-100 text-amber-900',
  'Major problem': 'bg-orange-100 text-orange-900',
  'Risk of injury': 'bg-red-100 text-red-900',
}

export function ValdPanel({
  data,
  input,
  setInput,
  result,
  compact,
}: {
  data: ValdData
  input: ValdInput
  setInput: (i: ValdInput) => void
  result: ValdResult
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const entered = Object.keys(input).length
  const showFields = !compact || open

  // The four ratio pairs are read together — the ratio is the meaningful output, not
  // either number on its own.
  const ratioPartner = new Map<string, string>()
  for (const [a, b] of data.readAsRatios) {
    const ca = data.tests.find((t) => t.test === a)?.code
    const cb = data.tests.find((t) => t.test === b)?.code
    if (ca && cb) {
      ratioPartner.set(ca, cb)
      ratioPartner.set(cb, ca)
    }
  }

  const set = (code: string, patch: Partial<{ asymmetry: number; weakSide: WeakSide }>) => {
    const next = { ...input }
    const current = next[code] ?? { asymmetry: 0, weakSide: 'Left' as WeakSide }
    next[code] = { ...current, ...patch }
    setInput(next)
  }

  const clear = (code: string) => {
    const next = { ...input }
    delete next[code]
    setInput(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">
          VALD DynaMo
          {entered > 0 && (
            <span className="ml-1.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
              {entered} tests
            </span>
          )}
        </h2>
        <div className="flex gap-1">
          {entered > 0 && (
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
              {open ? 'Hide' : 'Enter results'}
            </button>
          )}
        </div>
      </div>

      {!entered && !showFields && (
        <p className="text-[11px] text-slate-500">
          Optional. Asymmetry % and which side is weak, per test. With none entered the program
          is unchanged.
        </p>
      )}

      {showFields && (
        <div className={compact ? 'grid gap-1 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-1'}>
          {data.tests.map((t) => {
            const reading = input[t.code]
            const partner = ratioPartner.get(t.code)
            return (
              <div
                key={t.code}
                className="flex items-center gap-1.5 rounded border border-slate-200 px-1.5 py-1"
                title={`${t.caveat}\n\nLibrary coverage: ${t.totalExercises} exercises, ${t.nativeUnilateral} native unilateral, ${t.convertible} convertible (${t.verdict})`}
              >
                <span className="flex-1 truncate text-[11px] text-slate-700">
                  {t.test.replace(' Strength Asymmetry', '')}
                  {partner && (
                    <span className="ml-1 text-[9px] text-teal-600" title="read as a ratio with its pair">
                      ratio
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  step="0.1"
                  placeholder="%"
                  value={reading?.asymmetry ?? ''}
                  onChange={(e) =>
                    e.target.value === ''
                      ? clear(t.code)
                      : set(t.code, { asymmetry: Number(e.target.value) })
                  }
                  className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px]"
                />
                <div className="flex">
                  {SIDES.map((s) => (
                    <button
                      key={s}
                      onClick={() => set(t.code, { weakSide: s })}
                      disabled={!reading}
                      className={`px-1 py-0.5 text-[10px] font-semibold first:rounded-l last:rounded-r ${
                        reading?.weakSide === s
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40'
                      }`}
                    >
                      {s[0]}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {result.active && (
        <div className="space-y-2 border-t border-slate-200 pt-2">
          {result.referrals.length > 0 && (
            <div className="rounded border-2 border-red-400 bg-red-50 px-2 py-1.5 text-[11px] text-red-900">
              <span className="font-bold">Refer.</span> {result.referrals.length} reading
              {result.referrals.length === 1 ? '' : 's'} at or above {data.referralThreshold}% —{' '}
              {result.referrals.map((f) => `${f.test.test.replace(' Strength Asymmetry', '')} ${f.asymmetry}%`).join(', ')}
              . This escalates by referral, not by more sets: it gets the same +2 as a 20-29%
              reading.
            </div>
          )}

          <div>
            <div className="mb-0.5 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              Findings
            </div>
            <ul className="space-y-0.5">
              {result.findings.map((f) => {
                const filled = result.bumps
                  .filter((b) => b.code === f.code)
                  .reduce((s, b) => s + b.extraSets, 0)
                return (
                  <li key={f.code} className="flex items-center gap-1.5 text-[10px]">
                    <span className={`rounded px-1 py-0.5 font-semibold ${BRACKET_STYLE[f.bracket.name] ?? ''}`}>
                      {f.bracket.name}
                    </span>
                    <span className="text-slate-700">
                      {f.test.test.replace(' Strength Asymmetry', '')} {f.asymmetry}%
                    </span>
                    {f.setsAdded > 0 && (
                      <span className="text-slate-600">
                        → +{filled} of +{f.setsAdded} sets, {f.weakSide.toLowerCase()} side
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          {result.conflicts.length > 0 && (
            <div className="rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
              <span className="font-bold">Injury outranks this finding.</span>{' '}
              {result.conflicts.map((c) => (
                <span key={c.finding.code}>
                  A reported pain restricts {c.exercise} to the {c.injurySide.toLowerCase()} side,
                  but the {c.finding.weakSide.toLowerCase()} side tested weak — no extra sets were
                  added. Worth a look before the next session.
                </span>
              ))}
            </div>
          )}

          {result.unfilled.length > 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
              <span className="font-semibold">Could not be filled:</span>
              <ul className="mt-0.5 space-y-0.5">
                {result.unfilled.map((u) => (
                  <li key={u.finding.code}>
                    {u.finding.test.test.replace(' Strength Asymmetry', '')} — {u.owed} set
                    {u.owed === 1 ? '' : 's'} short: {u.reason}.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
