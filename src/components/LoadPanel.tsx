import type { LoadData } from '../types'
import type { LoadPrescription, LoadResult, LoadTier } from '../lib/weight'

const TIER_STYLE: Record<LoadTier, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-900',
  DERIVED: 'bg-sky-100 text-sky-900',
  BRIDGED: 'bg-amber-100 text-amber-900',
  NONE: 'bg-slate-100 text-slate-500',
}

const kg = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * One exercise's weight, for the program table. The band width is the message: a 60-100 kg
 * bench next to a 42.5-52.5 kg pushdown tells a coach which number to trust without a word
 * of explanation, so it is never narrowed to look more confident and the midpoint is never
 * shown as a target.
 */
export function LoadCell({
  load,
  compact,
}: {
  load: LoadPrescription | undefined
  compact?: boolean
}) {
  if (!load) return <span className="text-slate-300">—</span>

  // With no number, say what to prescribe instead. Falling back to the tier label here
  // would read "Broad estimate" against a push-up, implying an estimate that does not exist.
  if (!load.range) {
    const instead: Record<string, string> = {
      age: 'No load at this age',
      bodyweight: 'Reps / RIR',
      carry: 'Time',
      unreachable: 'Not estimated',
    }
    return (
      <span className="text-[11px] text-slate-400" title={load.reason}>
        {instead[load.insteadOf ?? 'unreachable']}
      </span>
    )
  }

  // A CAUTION verdict is prescribed at the bottom of the range only, and the range itself
  // is withheld — showing the top would invite a client with a flagged joint to chase it.
  if (load.capped) {
    return (
      <span className="whitespace-nowrap">
        <span className="font-mono font-semibold text-amber-900">≤ {kg(load.range.low)} kg</span>
        <span
          className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900"
          title="You reported a pain that makes this exercise one to be careful with, so the prescription is capped at the bottom of the estimate rather than given as a range."
        >
          CAUTION CAP
        </span>
      </span>
    )
  }

  const both = load.sides.length === 2
  const different = both && (load.sides[0].low !== load.sides[1].low || load.sides[0].high !== load.sides[1].high)

  return (
    <span className="whitespace-nowrap">
      {different ? (
        // Two loads for one exercise is this layer doing its job, not a display glitch.
        <span className="font-mono font-semibold text-slate-800">
          {load.sides.map((s) => `${s.side[0]} ${kg(s.low)}-${kg(s.high)}`).join(' · ')} kg
        </span>
      ) : (
        <span className="font-mono font-semibold text-slate-800">
          {kg(load.range.low)}-{kg(load.range.high)} kg
        </span>
      )}
      {load.perHand && <span className="ml-1 text-[10px] text-slate-500">per hand</span>}
      {load.unilateral && !different && <span className="ml-1 text-[10px] text-slate-500">per side</span>}
      {(
        <span
          className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${TIER_STYLE[load.tier]}`}
          title={
            load.bridgedFrom
              ? `Borrowed from your ${load.sourceTest} test via ${load.bridgedFrom} at ${load.bridgeRatio}x (${load.bridgeQuality} bridge). Start at the lower end and work up.`
              : `From your ${load.sourceTest} test. Start at the lower end and work up.`
          }
        >
          {compact ? load.tierLabel.split(' ')[0] : load.tierLabel}
        </span>
      )}
      {load.flattened && (
        <span
          className="ml-1 text-[9px] text-slate-500"
          title="At beginner level the 20% cut to the top of this estimate lands below its own bottom, so the range collapses to a single figure. Start here and work up."
        >
          beginner cap
        </span>
      )}
    </span>
  )
}

export function LoadPanel({
  data,
  result,
  compact,
}: {
  data: LoadData
  result: LoadResult
  compact?: boolean
}) {
  if (!result.active) {
    return (
      <div className="space-y-1">
        <h2 className="text-sm font-bold text-slate-800">Working weights</h2>
        <p className="text-[11px] text-slate-500">
          Enter left and right newtons on the tests above and every exercise the readings reach
          gets an estimated working weight. With none entered every exercise reads{' '}
          <em>not estimated</em>, which is a designed state, not a failure.
        </p>
      </div>
    )
  }

  const estimated = result.counts.MATCHED + result.counts.DERIVED + result.counts.BRIDGED

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-slate-800">
        Working weights
        <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
          {estimated} exercises
        </span>
      </h2>

      <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900">
        <span className="font-bold">Start at the lower end and work up.</span> The range is the
        estimate's confidence, not a target — the middle of it means nothing.
      </div>

      {result.suppressedByAge && (
        <div className="rounded border-2 border-red-400 bg-red-50 px-2 py-1.5 text-[11px] text-red-900">
          <span className="font-bold">No weights at this age.</span> No external load is
          prescribed for a client in the {data.noLoadAges.join(', ')} bracket, at any confidence
          tier, for any exercise.
        </div>
      )}

      <div>
        <div className="mb-0.5 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
          Reference per test
        </div>
        <ul className="space-y-0.5">
          {result.references.map((r) => (
            <li key={r.code} className="flex items-center gap-1.5 text-[10px]">
              <span className="font-semibold text-slate-700">{r.test}</span>
              <span className="text-slate-600">
                {r.left !== null && `L ${r.left.toFixed(1)} kg`}
                {r.left !== null && r.right !== null && ' · '}
                {r.right !== null && `R ${r.right.toFixed(1)} kg`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-1">
        {(['MATCHED', 'DERIVED', 'BRIDGED', 'NONE'] as LoadTier[]).map((t) => (
          <span key={t} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TIER_STYLE[t]}`}>
            {data.tierLabel[t]} {result.counts[t]}
          </span>
        ))}
      </div>

      {!compact && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer font-semibold">Known limits of this layer</summary>
          <ul className="mt-1 space-y-1">
            <li>
              <span className="font-semibold">These are seeded constants, not measurements.</span>{' '}
              The 17 newtons-to-kilograms constants are estimates, and every number inherits
              their error. Each exercise carries a correction factor, currently{' '}
              {data.correctionFactorDefault.toFixed(2)} everywhere; once performance logging
              exists, setting it to actual ÷ estimated self-corrects everything downstream.
            </li>
            <li>
              <span className="font-semibold">Neck is deliberately unbridged.</span> All three
              neck sub-regions stay <em>not estimated</em> — there is no defensible route from a
              limb dynamometer to neck loading.
            </li>
            {result.anchorGaps.length > 0 && (
              <li>
                <span className="font-semibold">
                  {result.anchorGaps.length} sub-regions name an anchor that no exercise carries
                </span>{' '}
                ({result.anchorGaps.map((g) => `${g.code} → "${g.named}"`).join('; ')}). The
                per-exercise flag is authoritative and is not re-derived, so nothing in those
                sub-regions can read <em>Measured</em>; they top out at <em>Estimated</em>.
              </li>
            )}
            <li>
              <span className="font-semibold">Three deliberate divergences from the source.</span>{' '}
              {data.notes.divergences.join(' ')} Hip Abduction and Hip Flexion were also given
              anchors the source marked as having no loadable exercise.
            </li>
          </ul>
        </details>
      )}
    </div>
  )
}
