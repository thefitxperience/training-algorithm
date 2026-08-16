import { useMemo } from 'react'
import type { View } from '../App'
import type { Program } from '../lib/generate'
import { pickKey, roundSets } from '../lib/rounding'
import { equipmentOptions, isTokenAvailable } from '../lib/equipment'
import { copyFor, type Side } from '../lib/injury'
import { sessionMinutes } from '../lib/structure'
import { LoadCell } from './LoadPanel'
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

/** Rest follows the structure: "60-90" at ×1.15 becomes "69-104". */
function scaleRest(rest: string, multiplier: number): string {
  if (multiplier === 1) return rest
  return rest
    .split('-')
    .map((part) => Math.round(Number(part.trim()) * multiplier))
    .join('-')
}

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
  // The column only exists once force readings do, so a program without them is untouched.
  const showLoad = program.load.active

  // Simple view prescribes whole sets; session length follows from those, not from the
  // fractional allocation values.
  const rounding = useMemo(() => roundSets(program), [program])
  const setsFor = (dayIndex: number, position: number, raw: number) =>
    detailed ? raw : (rounding.byPick.get(pickKey(dayIndex, position)) ?? raw)
  // Simple view prescribes whole sets, so its session length follows from those. Corrective
  // work is already whole-numbered and sits outside the block model, so it is added on.
  const minutesFor = (day: (typeof days)[number]) =>
    detailed
      ? day.minutes
      : sessionMinutes(
          day.blocks,
          (i) => rounding.byPick.get(pickKey(day.index, i)) ?? day.exercises[i].sets,
          program.timeParams,
        ) + day.correctiveMinutes

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
                {showLoad && (
                  <th
                    className={`font-semibold whitespace-nowrap ${detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'}`}
                  >
                    Weight
                  </th>
                )}
                {detailed && <th className="px-3 py-1.5 font-semibold">Equipment</th>}
              </tr>
            </thead>
            {/* One tbody per block, so paired work reads as a unit rather than a flat list. */}
            {day.blocks.map((blk, bi) => (
            <tbody key={bi} className={blk.indices.length > 1 ? 'border-l-4 border-l-violet-400' : ''}>
              {blk.indices.length > 1 && (
                <tr className="bg-violet-50/70">
                  <td
                    colSpan={(detailed ? 6 : 3) + (showLoad ? 1 : 0)}
                    className={detailed ? 'px-3 py-1' : 'px-4 py-1.5'}
                  >
                    <span className="rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-violet-900 uppercase">
                      {blk.structure}
                    </span>
                    <span className="ml-2 text-[11px] text-violet-900">
                      {blk.indices.length} exercises back to back · {blk.reason}
                      {program.loadAdjustment !== 0 &&
                        ` · load ${(program.loadAdjustment * 100).toFixed(0)}%`}
                      {program.restMultiplier !== 1 &&
                        ` · rest ×${program.restMultiplier.toFixed(2)}`}
                    </span>
                  </td>
                </tr>
              )}
              {blk.indices.map((i) => {
                const c = day.exercises[i]
                return (
                <tr
                  key={`${c.exercise.id}-${i}`}
                  className={`border-b border-slate-100 ${detailed ? '' : 'odd:bg-slate-50/60'}`}
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
                    {c.unilateral && (
                      <span
                        className="ml-1.5 rounded bg-teal-100 px-1 py-0.5 text-[10px] font-bold text-teal-800"
                        title={`One side at a time. ${c.unilateral.extraSets} extra set${
                          c.unilateral.extraSets === 1 ? '' : 's'
                        } on the ${c.unilateral.weakSide.toLowerCase()} side, which tested weaker. ${
                          c.unilateral.form === 'already'
                            ? 'This exercise is already one-sided.'
                            : c.unilateral.form === 'swapped'
                              ? 'Swapped in for a one-sided version of the same movement.'
                              : 'Run one side at a time — a bilateral exercise cannot carry a one-side-only set.'
                        }`}
                      >
                        {c.unilateral.weakSide.toUpperCase()} +{c.unilateral.extraSets}
                        <span className="ml-1 font-normal opacity-70">{c.unilateral.form}</span>
                      </span>
                    )}
                    {c.rule4 && (
                      <span
                        className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold text-violet-800"
                        title="Your scan shows high fat in this body region, so these slots run as supersets with shorter rest and reps at the top of the range. Volume and exercise choice are unchanged."
                      >
                        FAT-BURN
                      </span>
                    )}
                    {c.loadAdjustment !== undefined && c.loadAdjustment !== 0 && (
                      <span
                        className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-bold text-slate-700"
                        title="Load adjustment for this slot — a faster structure means slightly less weight on the bar."
                      >
                        {(c.loadAdjustment * 100).toFixed(0)}%
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
                    {scaleRest(c.rest, program.restMultiplier)}s
                  </td>
                  {showLoad && (
                    <td
                      className={`whitespace-nowrap ${
                        detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'
                      }`}
                    >
                      <LoadCell load={program.load.byExercise.get(c.exercise.id)} compact={!detailed} />
                    </td>
                  )}
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
                )
              })}
            </tbody>
            ))}
          </table>

          {/* Corrective work sits at the end of every session, visually apart from the main
              work — it is added volume, not part of the muscle-group allocation. */}
          {(day.correctives.length > 0 || day.correctiveStretches.length > 0) && (
            <div className="border-t-2 border-fuchsia-300 bg-fuchsia-50/50">
              <div className="flex flex-wrap items-center gap-2 px-4 py-1.5">
                <span className="rounded bg-fuchsia-200 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-fuchsia-900 uppercase">
                  Corrective (BodyDot)
                </span>
                <span className="text-[11px] text-fuchsia-900">
                  end of session · every session · {day.correctiveMinutes.toFixed(0)} min
                </span>
              </div>
              <table className={`w-full text-left ${detailed ? 'text-xs' : 'text-[13px]'}`}>
                <tbody>
                  {day.correctives.map((c, ci) => (
                    <tr key={`c-${ci}`} className="border-t border-fuchsia-100">
                      <td className={detailed ? 'px-3 py-1.5' : 'px-4 py-2'}>
                        <span className="font-medium text-slate-800">{c.prescribedName}</span>
                        {c.prescribedName.toLowerCase() !== c.exercise.name.toLowerCase() && (
                          <span className="ml-1 text-[10px] text-slate-500">({c.exercise.name})</span>
                        )}
                        <span
                          className="ml-1.5 rounded bg-fuchsia-100 px-1 py-0.5 text-[10px] font-bold text-fuchsia-800"
                          title={`Added because your ${c.indicators.join(' and ')} reading sits outside its normal band.`}
                        >
                          {c.indicators.join(' · ')}
                        </span>
                        {c.side !== 'both' && (
                          <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 text-[10px] font-bold text-white">
                            {c.side.toUpperCase()} SIDE ONLY
                          </span>
                        )}
                      </td>
                      <td
                        className={`font-mono whitespace-nowrap text-slate-800 ${
                          detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right font-semibold'
                        }`}
                      >
                        {/* A mobility corrective is timed, never counted in reps. */}
                        {c.reps === null ? `${c.sets} × ${c.seconds}s` : `${c.sets} × ${c.reps}`}
                      </td>
                      <td
                        className={`whitespace-nowrap text-slate-600 ${
                          detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'
                        }`}
                      >
                        30s
                      </td>
                      {showLoad && (
                        <td
                          className={`whitespace-nowrap ${
                            detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right'
                          }`}
                        >
                          <LoadCell load={program.load.byExercise.get(c.exercise.id)} compact={!detailed} />
                        </td>
                      )}
                    </tr>
                  ))}
                  {day.correctiveStretches.map((s, si) => (
                    <tr key={`s-${si}`} className="border-t border-fuchsia-100">
                      <td className={detailed ? 'px-3 py-1.5' : 'px-4 py-2'}>
                        <span className="text-slate-700">{s.name}</span>
                        {s.libraryName && s.libraryName !== s.name && (
                          <span className="ml-1 text-[10px] text-slate-500">({s.libraryName})</span>
                        )}
                        <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-bold text-slate-700">
                          STRETCH
                        </span>
                        {s.unmapped && (
                          <span
                            className="ml-1.5 text-[10px] text-slate-500"
                            title="No match in the exercise library — prescribed as written, with the timer."
                          >
                            no library match
                          </span>
                        )}
                      </td>
                      <td
                        className={`font-mono whitespace-nowrap text-slate-800 ${
                          detailed ? 'px-3 py-1.5' : 'px-4 py-2 text-right font-semibold'
                        }`}
                      >
                        {s.seconds}s
                      </td>
                      <td className={detailed ? 'px-3 py-1.5' : 'px-4 py-2'} />
                      {showLoad && <td className={detailed ? 'px-3 py-1.5' : 'px-4 py-2'} />}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        ))}
      </div>

      {/* Anything the posture layer could not place stays visible next to the program. */}
      {program.bodydot.active &&
        (program.bodydot.deferred.length > 0 || program.bodydot.unfilled.length > 0) && (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-3">
            <div className="text-sm font-bold text-slate-800">Posture findings not prescribed</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {program.bodydot.deferred.map((d) => (
                <li key={`d-${d.code}`}>
                  <span className="font-semibold">{d.indicator}</span> — {d.names.join(', ')}:{' '}
                  {d.reason}.
                </li>
              ))}
              {program.bodydot.unfilled.map((u) => (
                <li key={`u-${u.code}`}>
                  <span className="font-semibold">{u.indicator}</span> {u.value} — {u.reason}.
                </li>
              ))}
            </ul>
          </div>
        )}
    </div>
  )
}
