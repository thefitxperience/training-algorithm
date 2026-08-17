import { useMemo } from 'react'
import type { Program } from '../lib/generate'
import { pickKey, roundSets } from '../lib/rounding'
import { copyFor, type Side } from '../lib/injury'
import { LoadCell } from './LoadPanel'
import { AmendControl, type AmendWiring } from './AmendPanel'
import { CORRECTIVE_REST_SECONDS } from '../lib/bodydot'
import type { CapPin } from '../lib/timecap'
import { Button, Card, Note, Pill } from './ui'
import type { ClientInput, InjuryData } from '../types'

export interface CapWiring {
  caps: CapPin[]
  setCaps: (caps: CapPin[]) => void
  actor: string
}

/** The side to actually train is the one the pain is NOT on. */
const otherSide = (painSide?: Side) =>
  painSide === 'Left' ? 'right' : painSide === 'Right' ? 'left' : 'pain-free'

/** Rest follows the structure: "60-90" at ×1.15 becomes "69-104". */
function scaleRest(rest: string, multiplier: number): string {
  if (multiplier === 1) return rest
  return rest
    .split('-')
    .map((part) => Math.round(Number(part.trim()) * multiplier))
    .join('-')
}

/** A badge on an exercise, carrying the colour of whichever machine put it there. */
function Tag({
  tone,
  title,
  children,
}: {
  tone: 'blue' | 'cyan' | 'orange' | 'flame' | 'neon' | 'ink'
  title?: string
  children: React.ReactNode
}) {
  const styles = {
    blue: 'bg-udra-blue text-white',
    cyan: 'bg-udra-cyan/30 text-udra-blue-900',
    orange: 'bg-udra-orange/20 text-udra-ink-700',
    flame: 'bg-udra-flame/15 text-udra-flame',
    neon: 'bg-udra-neon text-black',
    ink: 'bg-udra-linen-200 text-udra-ink-700',
  }[tone]
  return (
    <span
      title={title}
      className={`ml-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-bold ${styles}`}
    >
      {children}
    </span>
  )
}

export function ProgramPanel({
  program,
  input,
  injury,
  amend,
  cap,
}: {
  program: Program
  input: ClientInput
  injury: InjuryData
  amend?: AmendWiring
  cap?: CapWiring
}) {
  const { block, days, warnings } = program
  const short = block.deliveredDays < input.days
  const showLoad = program.load.active

  // The client is prescribed whole sets, so the table shows whole sets and the header
  // shows the length of a session made of them.
  const rounding = useMemo(() => roundSets(program), [program])
  const setsFor = (dayIndex: number, position: number, raw: number) =>
    rounding.byPick.get(pickKey(dayIndex, position)) ?? raw

  const target = program.timecap.target
  const planFor = (dayIndex: number) =>
    program.timecap.applied.find((a) => a.dayIndex === dayIndex)?.plan
  const pressCap = (dayIndex: number) =>
    cap?.setCaps([
      ...cap.caps.filter((c) => c.dayIndex !== dayIndex),
      { dayIndex, actor: cap.actor, timestamp: new Date().toISOString() },
    ])
  const undoCap = (dayIndex: number) => cap?.setCaps(cap.caps.filter((c) => c.dayIndex !== dayIndex))
  const pts = (n: number) => `${n} training point${n === 1 ? '' : 's'}`

  const fallbacks = warnings.filter((w) => w.kind !== 'pain-dropped')

  return (
    <div className="space-y-4">
      {short && (
        <Note tone="neon" title={`${input.days} days requested → ${block.deliveredDays} delivered`}>
          {block.note || 'No further detail available.'} This is the real programme outcome for
          this client, not an error.
        </Note>
      )}

      {/* Slots lost to pain read as a deliberate removal, never as "nothing found". */}
      {warnings.some((w) => w.kind === 'pain-dropped') && (
        <Note tone="flame" title="Adjusted around reported pain">
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {warnings
              .filter((w) => w.kind === 'pain-dropped')
              .map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
          </ul>
        </Note>
      )}

      {/* Collapsed by default — a 60-item list would bury the program — but the count and
          the pains stay visible, so nothing is silently blocked. */}
      {program.removedByPain.length > 0 && (
        <details className="rounded-2xl border border-udra-linen-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-bold">
            {copyFor(injury, 'Removed - list header', {
              n: program.removedByPain.length,
              pains: [
                ...new Set(program.removedByPain.flatMap((r) => r.reasons.map((x) => x.painLabel))),
              ].join(', '),
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
                    <div className="text-xs font-bold">
                      {label} — {forPain.length} exercises
                    </div>
                    <ul className="mt-0.5 grid gap-x-4 text-[11px] text-udra-ink-500 sm:grid-cols-2">
                      {forPain.map((r) => (
                        <li key={r.exercise.id}>
                          {copyFor(injury, 'Removed - line', {
                            exercise: r.exercise.name,
                            reason:
                              r.reasons.find((x) => x.painId === painId)?.reason ??
                              'not safe for this pain',
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

      <Card className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
        <span>
          <span className="tnum font-bold">{program.exerciseCount}</span>{' '}
          <span className="text-udra-ink-500">exercises</span>
        </span>
        <span>
          <span className="tnum font-bold">{days.length}</span>{' '}
          <span className="text-udra-ink-500">days a week</span>
        </span>
        <span>
          <span className="text-udra-ink-500">reps</span>{' '}
          <span className="tnum font-bold">{program.prescription.reps}</span>
        </span>
        <span>
          <span className="text-udra-ink-500">rest</span>{' '}
          <span className="tnum font-bold">{program.prescription.rest}s</span>
        </span>
        {fallbacks.length > 0 && (
          <span
            className="ml-auto"
            title={fallbacks.map((w) => w.message).join('\n')}
          >
            <Pill tone="neon">
              {fallbacks.length} substitution{fallbacks.length === 1 ? '' : 's'}
            </Pill>
          </span>
        )}
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {days.map((day) => {
          const plan = planFor(day.index)
          return (
            <Card key={day.index} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-udra-linen-200 bg-udra-linen/40 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="tnum flex h-7 w-7 items-center justify-center rounded-full bg-udra-blue text-xs font-bold text-white">
                    {day.index + 1}
                  </span>
                  <div>
                    <div className="text-sm font-bold">{day.label}</div>
                    <div className="text-[10px] tracking-[0.08em] text-udra-ink-500 uppercase">
                      Day {day.index + 1}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-udra-ink-500">{day.exercises.length} exercises</span>
                  <span className="tnum rounded-full bg-black px-2.5 py-0.5 font-bold text-white">
                    {day.wholeSetMinutes.toFixed(0)} min
                  </span>
                  {/* Rendered if and only if the day is over the target. At or under it there
                      is nothing useful the button could do. */}
                  {cap && !plan && day.wholeSetMinutes > target && (
                    <Button size="sm" variant="primary" onClick={() => pressCap(day.index)}>
                      Reduce to {target} min
                    </Button>
                  )}
                </div>
              </div>

              {plan && (
                <div className="border-b border-udra-linen-200 bg-udra-neon/25 px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-bold">
                      {plan.reached
                        ? `Reduced to ${target} min — ${plan.minutesBefore.toFixed(0)} → ${plan.minutesAfter.toFixed(0)} min for ${pts(plan.points)}`
                        : `Could not reach ${target} min — ${plan.minutesBefore.toFixed(0)} → ${plan.minutesAfter.toFixed(1)} min, still ${plan.shortfall.toFixed(1)} over`}
                      {plan.reached && !plan.proven && (
                        <Tag tone="ink" title={plan.reason}>
                          not proven cheapest
                        </Tag>
                      )}
                    </span>
                    {cap && (
                      <Button size="sm" onClick={() => undoCap(day.index)}>
                        Undo
                      </Button>
                    )}
                  </div>
                  {/* Never silently, and never by cutting a protected lever. */}
                  {!plan.reached && (
                    <div className="mt-1.5 rounded-lg border border-udra-flame/40 bg-white px-2 py-1 text-[11px] text-udra-flame">
                      {plan.reason}.
                    </div>
                  )}
                  {plan.steps.length > 0 && (
                    <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[11px]">
                      {plan.steps.map((s, i) => (
                        <li key={i}>
                          {s.detail}
                          <span className="ml-1 opacity-50">({s.cost})</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="mt-1.5 text-[11px] italic opacity-80">{plan.gaveUp}</div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[10px] tracking-[0.08em] text-udra-ink-500 uppercase">
                    <tr className="border-b border-udra-linen-200">
                      <th className="px-4 py-2 font-bold">Exercise</th>
                      <th className="px-4 py-2 text-right font-bold whitespace-nowrap">
                        Sets × reps
                      </th>
                      <th className="px-4 py-2 text-right font-bold">Rest</th>
                      {showLoad && (
                        <th className="px-4 py-2 text-right font-bold whitespace-nowrap">Weight</th>
                      )}
                    </tr>
                  </thead>
                  {/* One tbody per block, so paired work reads as a unit. */}
                  {day.blocks.map((blk, bi) => (
                    <tbody
                      key={bi}
                      className={blk.indices.length > 1 ? 'border-l-[3px] border-l-udra-blue' : ''}
                    >
                      {blk.indices.length > 1 && (
                        <tr className="bg-udra-blue-50">
                          <td colSpan={3 + (showLoad ? 1 : 0)} className="px-4 py-1.5">
                            <span className="rounded bg-udra-blue px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                              {blk.structure}
                            </span>
                            <span className="ml-2 text-[11px] text-udra-blue-900">
                              {/* This block's own figures — under triset a block that found
                                  only one legal partner IS a superset, and the program-level
                                  numbers would mislabel it. */}
                              {blk.indices.length} back to back · {blk.reason}
                              {(blk.loadAdjustment ?? 0) !== 0 &&
                                ` · load ${((blk.loadAdjustment ?? 0) * 100).toFixed(0)}%`}
                            </span>
                          </td>
                        </tr>
                      )}
                      {blk.indices.map((i) => {
                        const c = day.exercises[i]
                        return (
                          <tr
                            key={`${c.exercise.id}-${i}`}
                            className="border-b border-udra-linen-200/70 last:border-0"
                          >
                            <td className="px-4 py-2">
                              <span className="font-semibold">{c.exercise.name}</span>
                              {c.exercise.mainLift && <Tag tone="blue">Main</Tag>}
                              {c.verdict.decidedBy && c.verdict.verdict === 'PRIORITY' && (
                                <Tag
                                  tone="neon"
                                  title={copyFor(injury, 'Priority tooltip', {
                                    pain: c.verdict.decidedBy.painLabel,
                                  })}
                                >
                                  {injury.copy['Priority badge']}
                                </Tag>
                              )}
                              {c.verdict.decidedBy && c.verdict.verdict === 'SIDE_ONLY' && (
                                <Tag
                                  tone="flame"
                                  title={copyFor(injury, 'Side-only tooltip', {
                                    side: otherSide(c.verdict.decidedBy.side),
                                    pain: c.verdict.decidedBy.painLabel,
                                  })}
                                >
                                  {injury.copy['Side-only badge']} ({otherSide(c.verdict.decidedBy.side)})
                                </Tag>
                              )}
                              {c.verdict.decidedBy && c.verdict.verdict === 'CAUTION' && (
                                <Tag
                                  tone="flame"
                                  title={copyFor(injury, 'Caution tooltip', {
                                    reason: c.verdict.decidedBy.reason,
                                  })}
                                >
                                  {copyFor(injury, 'Caution badge', {
                                    pain: c.verdict.decidedBy.painLabel,
                                  })}
                                </Tag>
                              )}
                              {c.unilateral && (
                                <Tag
                                  tone="cyan"
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
                                  One side · {c.unilateral.weakSide.toLowerCase()} +
                                  {c.unilateral.extraSets}
                                </Tag>
                              )}
                              {c.rule4 && (
                                <Tag
                                  tone="orange"
                                  title="The scan shows high fat in this body region, so these slots run as supersets with shorter rest and reps at the top of the range. Volume and exercise choice are unchanged."
                                >
                                  Fat-burn
                                </Tag>
                              )}
                              {c.pinned && (
                                <Tag
                                  tone="ink"
                                  title={`This slot was changed to ${c.exercise.name}. It is kept as a pin, so it survives a re-test or a new scan.`}
                                >
                                  Changed
                                  {c.pinned.equipment && ` · ${c.pinned.equipment}`}
                                </Tag>
                              )}
                              {amend && (
                                <span className="ml-1.5 inline-block align-middle">
                                  <AmendControl
                                    slotId={c.slotId}
                                    from={c.exercise}
                                    wiring={amend}
                                    currentEquipment={c.pinned?.equipment}
                                  />
                                </span>
                              )}
                            </td>
                            <td className="tnum px-4 py-2 text-right font-semibold whitespace-nowrap">
                              {/* The extra sets go to ONE side, so a single figure here would
                                  read as "this many per side" and lose the point of the layer. */}
                              {c.unilateral ? (
                                <span className="inline-flex flex-col items-end leading-tight">
                                  {(['Left', 'Right'] as const).map((side) => {
                                    const base = setsFor(day.index, i, c.sets)
                                    const weak = side === c.unilateral!.weakSide
                                    const n = weak ? base + c.unilateral!.extraSets : base
                                    return (
                                      <span
                                        key={side}
                                        className={weak ? 'text-udra-blue' : 'text-udra-ink-500'}
                                      >
                                        {side[0]} {n} × {c.reps}
                                      </span>
                                    )
                                  })}
                                </span>
                              ) : (
                                <>
                                  {setsFor(day.index, i, c.sets)} × {c.reps}
                                </>
                              )}
                            </td>
                            <td className="tnum px-4 py-2 text-right whitespace-nowrap text-udra-ink-500">
                              {/* Scaled by the block this exercise is actually in. */}
                              {scaleRest(c.rest, blk.restMultiplier ?? 1)}s
                            </td>
                            {showLoad && (
                              <td className="px-4 py-2 text-right whitespace-nowrap">
                                <LoadCell
                                  load={program.load.byExercise.get(c.exercise.id)}
                                  compact
                                />
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  ))}
                </table>
              </div>

              {/* Corrective work sits at the end of every session, visually apart from the
                  main work — it is added volume, not part of the muscle-group allocation. */}
              {(day.correctives.length > 0 || day.correctiveStretches.length > 0) && (
                <div className="border-t-2 border-udra-blue/40 bg-udra-blue-50/60">
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <span className="rounded bg-udra-blue px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                      Corrective
                    </span>
                    <span className="text-[11px] text-udra-blue-900">
                      end of session · every session · {day.correctiveMinutes.toFixed(0)} min
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <tbody>
                        {day.correctives.map((c, ci) => (
                          <tr key={`c-${ci}`} className="border-t border-udra-blue-100">
                            <td className="px-4 py-2">
                              <span className="font-semibold">{c.prescribedName}</span>
                              {c.prescribedName.toLowerCase() !== c.exercise.name.toLowerCase() && (
                                <span className="ml-1 text-[10px] text-udra-ink-500">
                                  ({c.exercise.name})
                                </span>
                              )}
                              <Tag
                                tone="blue"
                                title={`Added because the ${c.indicators.join(' and ')} reading sits outside its normal band.`}
                              >
                                {c.indicators.join(' · ')}
                              </Tag>
                              {c.side !== 'both' && <Tag tone="flame">{c.side} side only</Tag>}
                            </td>
                            <td className="tnum px-4 py-2 text-right font-semibold whitespace-nowrap">
                              {/* A mobility corrective is timed, never counted in reps. */}
                              {c.reps === null ? `${c.sets} × ${c.seconds}s` : `${c.sets} × ${c.reps}`}
                            </td>
                            <td className="tnum px-4 py-2 text-right whitespace-nowrap text-udra-ink-500">
                              {CORRECTIVE_REST_SECONDS}s
                            </td>
                            {showLoad && (
                              <td className="px-4 py-2 text-right">
                                <LoadCell
                                  load={program.load.byExercise.get(c.exercise.id)}
                                  compact
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                        {day.correctiveStretches.map((s, si) => (
                          <tr key={`s-${si}`} className="border-t border-udra-blue-100">
                            <td className="px-4 py-2">
                              <span>{s.name}</span>
                              {s.libraryName && s.libraryName !== s.name && (
                                <span className="ml-1 text-[10px] text-udra-ink-500">
                                  ({s.libraryName})
                                </span>
                              )}
                              <Tag tone="ink">Stretch</Tag>
                              {s.unmapped && (
                                <span
                                  className="ml-1.5 text-[10px] text-udra-ink-500"
                                  title="No match in the exercise library — prescribed as written, with the timer."
                                >
                                  no library match
                                </span>
                              )}
                            </td>
                            <td className="tnum px-4 py-2 text-right font-semibold whitespace-nowrap">
                              {s.seconds}s
                            </td>
                            <td className="px-4 py-2" />
                            {showLoad && <td className="px-4 py-2" />}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Anything the posture layer could not place stays visible next to the program. */}
      {program.bodydot.active &&
        (program.bodydot.deferred.length > 0 || program.bodydot.unfilled.length > 0) && (
          <Card className="px-4 py-3">
            <div className="text-sm font-bold">Posture findings not prescribed</div>
            <ul className="mt-1 space-y-0.5 text-[12px] text-udra-ink-500">
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
          </Card>
        )}
    </div>
  )
}
