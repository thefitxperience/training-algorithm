import { useState } from 'react'
import type { BodyDotData } from '../types'
import {
  arsenalFor,
  isDeadBorderline,
  isLateral,
  realBands,
  type BodyDotInput,
  type BodyDotResult,
  type BodySide,
  type Tier,
} from '../lib/bodydot'

const SIDES: BodySide[] = ['Left', 'Right']

const TIER_STYLE: Record<Tier, string> = {
  normal: 'bg-slate-100 text-slate-500',
  borderline: 'bg-amber-100 text-amber-900',
  abnormal: 'bg-orange-100 text-orange-900',
  unbanded: 'bg-slate-200 text-slate-700',
}

export function BodyDotPanel({
  data,
  input,
  setInput,
  result,
  compact,
}: {
  data: BodyDotData
  input: BodyDotInput
  setInput: (i: BodyDotInput) => void
  result: BodyDotResult
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const bands = realBands(data)
  const entered = Object.keys(input).length
  const showFields = !compact || open

  const views = [...new Set(bands.map((b) => b.view))]

  const set = (code: string, patch: Partial<{ value: number; side: BodySide }>) => {
    const next = { ...input }
    next[code] = { ...(next[code] ?? { value: 0 }), ...patch }
    setInput(next)
  }
  const clear = (code: string) => {
    const next = { ...input }
    delete next[code]
    setInput(next)
  }

  const tierOf = (code: string) => result.classifications.find((c) => c.band.code === code)?.tier

  // Four arsenal exercises are MEDIUM-confidence readings of Dr. Raul's shorthand rather
  // than exact matches — the ones to watch in practice.
  const watch = data.arsenal.flatMap((a) =>
    a.exercises
      .filter((e) => e.confidence === 'MEDIUM')
      .map((e) => ({ code: a.code, indicator: a.indicator, ...e })),
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">
          BodyDot posture
          {entered > 0 && (
            <span className="ml-1.5 rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-800">
              {entered} measured
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
              {open ? 'Hide' : 'Enter readings'}
            </button>
          )}
        </div>
      </div>

      {!entered && !showFields && (
        <p className="text-[11px] text-slate-500">
          Optional. 26 posture readings. Anything outside its normal band adds corrective work to
          the end of every session. With none entered the program is unchanged.
        </p>
      )}

      {showFields && (
        <div className="space-y-2">
          {views.map((view) => (
            <div key={view}>
              <div className="mb-0.5 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
                {view}
              </div>
              <div className={compact ? 'grid gap-1 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-1'}>
                {bands
                  .filter((b) => b.view === view)
                  .map((b) => {
                    const reading = input[b.code]
                    const lateral = isLateral(data, b.code)
                    const tier = tierOf(b.code)
                    return (
                      <div
                        key={b.code}
                        className="flex items-center gap-1.5 rounded border border-slate-200 px-1.5 py-1"
                        title={`${b.indicator} (${b.code})\nNormal ${b.normal} ${b.unit}\n${
                          b.inArsenal
                            ? 'Has a corrective protocol.'
                            : 'Measured, no protocol yet — nothing can be prescribed from this one.'
                        }`}
                      >
                        <span className="flex-1 truncate text-[11px] text-slate-700">
                          {b.indicator}
                          {!b.inArsenal && (
                            <span className="ml-1 text-[9px] text-slate-400">no protocol</span>
                          )}
                        </span>
                        {tier && tier !== 'normal' && (
                          <span
                            className={`rounded px-1 py-0.5 text-[9px] font-bold ${TIER_STYLE[tier]}`}
                          >
                            {tier}
                          </span>
                        )}
                        <input
                          type="number"
                          step="0.1"
                          placeholder={b.unit}
                          value={reading?.value ?? ''}
                          onChange={(e) =>
                            e.target.value === ''
                              ? clear(b.code)
                              : set(b.code, { value: Number(e.target.value) })
                          }
                          className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px]"
                        />
                        {lateral && (
                          <div className="flex">
                            {SIDES.map((s) => (
                              <button
                                key={s}
                                onClick={() => set(b.code, { side: s })}
                                disabled={!reading}
                                className={`px-1 py-0.5 text-[10px] font-semibold first:rounded-l last:rounded-r ${
                                  reading?.side === s
                                    ? 'bg-slate-800 text-white'
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40'
                                }`}
                              >
                                {s[0]}
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

      {result.active && (
        <div className="space-y-2 border-t border-slate-200 pt-2">
          <div>
            <div className="mb-0.5 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              Findings
            </div>
            {result.findings.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                Every reading entered sits inside its normal band. No corrective work added.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {result.findings.map((f) => {
                  const entry = f.edge ? arsenalFor(data, f.code, f.edge) : null
                  return (
                    <li key={f.code} className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className={`rounded px-1 py-0.5 font-semibold ${TIER_STYLE[f.tier]}`}>
                        {f.tier}
                      </span>
                      <span className="text-slate-700">
                        {f.indicator} {f.value}
                        {f.unit === 'deg' ? '°' : ' cm'}
                        {f.measuredSide && (
                          <span className="text-slate-400"> ({f.measuredSide.toLowerCase()})</span>
                        )}
                      </span>
                      {/* The resolved side, never the measured one — a left finding that
                          produces right-side work has to read that way on the page. */}
                      {f.resolvedSide && f.resolvedSide !== 'both' && (
                        <span
                          className="rounded bg-fuchsia-100 px-1 py-0.5 font-bold text-fuchsia-900"
                          title={`Measured on the ${f.measuredSide?.toLowerCase()} side. ${
                            entry?.laterality === 'OPPOSITE side'
                              ? 'This finding is corrected by training the opposite side.'
                              : 'This finding is corrected on the same side.'
                          }`}
                        >
                          train {f.resolvedSide.toLowerCase()}
                        </span>
                      )}
                      {f.limitedToFirst && (
                        <span className="text-slate-500">borderline — first exercise only</span>
                      )}
                      {f.unfilledReason && <span className="text-slate-500">— {f.unfilledReason}</span>}
                      {f.edge && isDeadBorderline(data, f.code, f.edge) && (
                        <span
                          className="text-slate-400"
                          title="The borderline strip on this edge is a fraction of the abnormal region, so this indicator effectively jumps from normal straight to abnormal."
                        >
                          (no practical borderline zone)
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {result.correctives.length > 0 && (
            <div className="rounded border border-fuchsia-300 bg-fuchsia-50 px-2 py-1.5 text-[10px] text-fuchsia-900">
              <span className="font-bold">
                {result.correctives.length} corrective exercise
                {result.correctives.length === 1 ? '' : 's'}
              </span>{' '}
              added to the end of every session (cap {result.cap}), plus{' '}
              {result.stretches.length} stretch{result.stretches.length === 1 ? '' : 'es'} at{' '}
              {data.stretchSeconds}s. Bilateral correctives take {result.standardSets} sets — what
              the rest of the program is doing.
            </div>
          )}

          {result.deferred.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
              <span className="font-semibold">Deferred:</span>
              <ul className="mt-0.5 space-y-0.5">
                {result.deferred.map((d) => (
                  <li key={d.code}>
                    {d.indicator} — {d.names.join(', ')}: {d.reason}.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.trimmed.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
              <span className="font-semibold">Dropped to stay inside the time ceiling:</span>
              <ul className="mt-0.5 space-y-0.5">
                {result.trimmed.map((t, i) => (
                  <li key={i}>
                    Day {t.dayIndex + 1} — {t.what}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.unfilled.length > 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
              <span className="font-semibold">Measured, nothing prescribed:</span>
              <ul className="mt-0.5 space-y-0.5">
                {result.unfilled.map((u) => (
                  <li key={u.code}>
                    {u.indicator} {u.value} — {u.reason}.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showFields && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer font-semibold">Known limits of this layer</summary>
          <ul className="mt-1 space-y-1">
            <li>
              <span className="font-semibold">
                {bands.filter((b) => !b.inArsenal).length} of {bands.length} indicators have no
                corrective protocol.
              </span>{' '}
              Their bands are still computed and shown; they can never prescribe anything.
            </li>
            <li>
              <span className="font-semibold">
                {data.deadBorderlineEdges.length} of 21 edges have no practical borderline zone.
              </span>{' '}
              The zone is 10% of the threshold, so where the threshold is small it is a sliver of
              the abnormal region: {data.deadBorderlineEdges.map(([c, e]) => `${c} ${e}`).join(', ')}
              . Those jump from normal straight to abnormal.
            </li>
            <li>
              <span className="font-semibold">
                {data.unmappedStretches.length} stretches have no library match
              </span>{' '}
              ({data.unmappedStretches.join(', ')}). They are prescribed as free text with the{' '}
              {data.stretchSeconds}s timer and consume no corrective slot.
            </li>
            <li>
              <span className="font-semibold">{watch.length} arsenal exercises are MEDIUM confidence</span>{' '}
              — a reading of the shorthand rather than an exact match:{' '}
              {watch.map((w) => `${w.code} "${w.arsenalName}" → ${w.libraryName}`).join('; ')}.
            </li>
            <li>
              <span className="font-semibold">HKA (F06) is deliberately swapped</span> relative to
              the source spreadsheet. {data.f06Gate.note}
            </li>
          </ul>
        </details>
      )}
    </div>
  )
}
