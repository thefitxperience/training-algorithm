import { useMemo } from 'react'
import type { View } from '../App'
import type { Program } from '../lib/generate'
import { pickKey, roundSets } from '../lib/rounding'
import { equipmentOptions, isTokenAvailable } from '../lib/equipment'
import { copyFor, type Side } from '../lib/injury'
import type { ClientInput, InjuryData } from '../types'

/** The side to actually train is the one the pain is NOT on. */
const otherSide = (painSide?: Side) =>
  painSide === 'Left' ? 'right' : painSide === 'Right' ? 'left' : 'pain-free'

/**
 * The detailed view shows allocation sets as-is, fractions and all — the raw value is what
 * the allocation asked for. The simple view is client-facing and has to be decisive, so it
 * uses the whole numbers from lib/rounding.ts instead.
 */
const fmtSets = (n: number) => String(n)

export function ProgramPanel({
  program,
  input,
  view,
  injury,
}: {
  program: Program
  input: ClientInput
  view: View
  injury: InjuryData
}) {
  const { block, days, warnings } = program
  const short = block.deliveredDays < input.days
  const detailed = view === 'detailed'

  // Simple view prescribes whole sets; session length follows from those, not from the
  // fractional allocation values.
  const rounding = useMemo(() => roundSets(program), [program])
  const setsFor = (dayIndex: number, position: number, raw: number) =>
    detailed ? raw : (rounding.byPick.get(pickKey(dayIndex, position)) ?? raw)
  const minutesFor = (day: (typeof days)[number]) =>
    detailed
      ? day.minutes
      : rounding.dayTotals[day.index] * program.minutesPerSet + program.warmupMinutes

  return (
    <div className="space-y-4">
      {short && (
        <div className="rounded border-2 border-amber-400 bg-amber-50 px-4 py-3">
          <div className="text-sm font-bold text-amber-900">
            {input.days} days requested → {block.deliveredDays} days delivered
          </div>
          <div className="mt-1 text-sm text-amber-800">
            {block.note || 'No further detail available.'}
          </div>
          <div className="mt-1 text-xs text-amber-700">
            This is the real programme outcome for this client, not an error.
          </div>
        </div>
      )}

      {/* Slots lost to pain read as a deliberate removal, never as "nothing found". */}
      {warnings.some((w) => w.kind === 'pain-dropped') && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="text-sm font-bold text-amber-900">Adjusted around your pain</div>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {warnings
              .filter((w) => w.kind === 'pain-dropped')
              .map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
          </ul>
        </div>
      )}

      {/* Collapsed by default — a 60-item list would bury the program — but the count and the
          pains stay visible, so nothing is silently blocked. */}
      {program.removedByPain.length > 0 && (
        <details className="rounded-lg border border-slate-300 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-800">
            {copyFor(injury, 'Removed - list header', {
              n: program.removedByPain.length,
              pains: [...new Set(program.removedByPain.flatMap((r) => r.reasons.map((x) => x.painLabel)))].join(
                ', ',
              ),
            })}
          </summary>
          <div className="mt-2 space-y-2">
            {[...new Set(program.removedByPain.flatMap((r) => r.reasons.map((x) => x.painId)))].map(
              (painId) => {
                const forPain = program.removedByPain.filter((r) =>
                  r.reasons.some((x) => x.painId === painId),
                )
                const label = forPain[0].reasons.find((x) => x.painId === painId)!.painLabel
                return (
                  <div key={painId}>
                    <div className="text-xs font-semibold text-slate-700">
                      {label} — {forPain.length} exercises
                    </div>
                    <ul className="mt-0.5 grid gap-x-4 text-[11px] text-slate-600 sm:grid-cols-2">
                      {forPain.map((r) => (
                        <li key={r.exercise.id}>
                          {copyFor(injury, 'Removed - line', {
                            exercise: r.exercise.name,
                            reason:
                              r.reasons.find((x) => x.painId === painId)?.reason ?? 'not safe for this pain',
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              },
            )}
          </div>
        </details>
      )}

      {detailed && warnings.filter((w) => w.kind !== 'pain-dropped').length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3">
          <div className="text-sm font-bold text-red-900">
            {warnings.filter((w) => w.kind !== 'pain-dropped').length} fallback event
            {warnings.filter((w) => w.kind !== 'pain-dropped').length === 1 ? '' : 's'}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-red-800">
            {warnings.filter((w) => w.kind !== 'pain-dropped').map((w, i) => (
              <li key={i}>
                <span className="rounded bg-red-200 px-1 font-mono text-[10px] uppercase">{w.kind}</span>{' '}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-200 bg-white text-xs text-slate-600 ${
          detailed ? 'rounded px-3 py-2' : 'rounded-xl px-4 py-2.5 shadow-sm ring-1 ring-slate-900/5'
        }`}
      >
        <span>
          <span className="font-semibold text-slate-800">{program.exerciseCount}</span> exercises
        </span>
        <span>
          <span className="font-semibold text-slate-800">{days.length}</span> days
        </span>
        <span>
          reps <span className="font-semibold text-slate-800">{program.prescription.reps}</span>
        </span>
        <span>
          rest <span className="font-semibold text-slate-800">{program.prescription.rest}s</span>
        </span>
        {detailed && (
          <>
            <span>session cap {block.cap}</span>
            <span className="font-mono text-[10px] text-slate-400">{program.key}</span>
          </>
        )}
      </div>

      <div
        className={
          detailed ? 'space-y-4' : 'grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3'
        }
      >
        {days.map((day) => (
        <section
          key={day.index}
          className={`overflow-hidden border border-slate-200 bg-white ${
            detailed ? 'rounded shadow-sm' : 'rounded-xl shadow-sm ring-1 ring-slate-900/5'
          }`}
        >
          <div
            className={`flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 ${
              detailed ? 'bg-slate-50 px-3 py-2' : 'bg-gradient-to-r from-slate-50 to-white px-4 py-3'
            }`}
          >
            {detailed ? (
              <h3 className="text-sm font-bold text-slate-800">
                Day {day.index + 1} · {day.label}
              </h3>
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                  {day.index + 1}
                </span>
                <div>
                  <div className="text-sm font-bold text-slate-900">{day.label}</div>
                  <div className="text-[10px] tracking-wide text-slate-400 uppercase">
                    Day {day.index + 1}
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className={detailed ? '' : 'rounded-full bg-slate-100 px-2 py-0.5 font-medium'}>
                {day.exercises.length} exercises
              </span>
              {detailed && <span>{fmtSets(day.totalSets)} sets</span>}
              <span
                className={
                  day.overCeiling && detailed
                    ? 'rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800'
                    : detailed
                      ? 'font-semibold text-slate-700'
                      : 'rounded-full bg-slate-800 px-2 py-0.5 font-semibold text-white'
                }
              >
                {minutesFor(day).toFixed(0)} min
                {day.overCeiling && detailed && ` — over ${program.timeCeiling} min ceiling`}
              </span>
            </div>
          </div>

          <table className={`w-full text-left ${detailed ? 'text-xs' : 'text-[13px]'}`}>
            <thead className="text-[10px] tracking-wide text-slate-500 uppercase">
              <tr className="border-b border-slate-200">
                <th className={`py-1.5 font-semibold ${detailed ? 'px-3' : 'px-4 py-2'}`}>Exercise</th>
                {detailed && <th className="px-3 py-1.5 font-semibold">Group</th>}
                {detailed && <th className="px-3 py-1.5 font-semibold">Sub-region</th>}
                <th
                  className={`font-semibold whitespace-nowrap ${detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'}`}
                >
                  Sets × reps
                </th>
                <th className={`font-semibold ${detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'}`}>
                  Rest
                </th>
                {detailed && <th className="px-3 py-1.5 font-semibold">Equipment</th>}
              </tr>
            </thead>
            <tbody>
              {day.exercises.map((c, i) => (
                <tr
                  key={`${c.exercise.id}-${i}`}
                  className={`border-b border-slate-100 last:border-0 ${
                    detailed ? '' : 'odd:bg-slate-50/60'
                  }`}
                >
                  <td className={detailed ? 'px-3 py-1.5' : 'px-4 py-2'}>
                    <span className="font-medium text-slate-800">{c.exercise.name}</span>
                    {c.exercise.mainLift && (
                      <span className="ml-1.5 rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-bold text-indigo-800">
                        MAIN
                      </span>
                    )}
                    {c.verdict.decidedBy && c.verdict.verdict === 'PRIORITY' && (
                      <span
                        className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-800"
                        title={copyFor(injury, 'Priority tooltip', {
                          pain: c.verdict.decidedBy.painLabel,
                        })}
                      >
                        {injury.copy['Priority badge']}
                      </span>
                    )}
                    {c.verdict.decidedBy && c.verdict.verdict === 'SIDE_ONLY' && (
                      <span
                        className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-bold text-sky-800"
                        title={copyFor(injury, 'Side-only tooltip', {
                          side: otherSide(c.verdict.decidedBy.side),
                          pain: c.verdict.decidedBy.painLabel,
                        })}
                      >
                        {injury.copy['Side-only badge']} ({otherSide(c.verdict.decidedBy.side)})
                      </span>
                    )}
                    {c.verdict.decidedBy && c.verdict.verdict === 'CAUTION' && (
                      <span
                        className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-800"
                        title={copyFor(injury, 'Caution tooltip', {
                          reason: c.verdict.decidedBy.reason,
                        })}
                      >
                        {copyFor(injury, 'Caution badge', { pain: c.verdict.decidedBy.painLabel })}
                      </span>
                    )}
                    {detailed && c.flag === 'reused' && (
                      <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-bold text-orange-800">
                        REUSED
                      </span>
                    )}
                    {detailed && c.flag === 'substituted' && (
                      <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-bold text-orange-800">
                        SUB
                      </span>
                    )}
                  </td>
                  {detailed && <td className="px-3 py-1.5 text-slate-600">{c.exercise.group}</td>}
                  {detailed && (
                    <td className="px-3 py-1.5 text-slate-600">
                      {c.exercise.sub}
                      {c.exercise.sub !== c.requestedSub && (
                        <span className="text-orange-700"> (slot: {c.requestedSub})</span>
                      )}
                    </td>
                  )}
                  <td
                    className={`font-mono whitespace-nowrap text-slate-800 ${
                      detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right font-semibold'
                    }`}
                  >
                    {fmtSets(setsFor(day.index, i, c.sets))} × {c.reps}
                  </td>
                  <td
                    className={`whitespace-nowrap text-slate-600 ${
                      detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'
                    }`}
                  >
                    {c.rest}s
                  </td>
                  {detailed && (
                    <td className="px-3 py-1.5 text-slate-600">
                      {/* highlight which of the "/"-separated options the client can actually use */}
                      {equipmentOptions(c.exercise).map((opt, j) => {
                        const usable = isTokenAvailable(opt, input.equipment)
                        return (
                          <span key={opt + j}>
                            {j > 0 && <span className="text-slate-300"> / </span>}
                            <span
                              className={usable ? 'text-slate-700' : 'text-slate-300 line-through'}
                            >
                              {opt}
                            </span>
                          </span>
                        )
                      })}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        ))}
      </div>
    </div>
  )
}
