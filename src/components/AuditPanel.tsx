import type { Audit } from '../lib/audit'
import type { Rounding } from '../lib/rounding'
import type { Config } from '../types'

const BAND: Record<string, string> = {
  green: 'bg-green-100 text-green-900',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-900',
  none: 'bg-slate-100 text-slate-500',
  // Deliberately removed by the injury layer — distinct from a delivery failure, so it
  // never reads as red.
  removed: 'bg-sky-100 text-sky-900',
}

const n1 = (v: number) => v.toFixed(1)

export function AuditPanel({
  audit,
  config,
  sex,
  rounding,
}: {
  audit: Audit
  config: Config
  sex: string
  rounding: Rounding
}) {
  const overrides = sex === 'Female' ? config.femaleOverrides : config.maleOverrides

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div>
        <h2 className="text-sm font-bold text-slate-800">Volume audit</h2>
        <p className="text-xs text-slate-500">
          Delivered volume is recalculated from the exercises actually chosen, not copied from the
          plan — so if it diverges from the plan's own estimate, the program has drifted from what
          was intended.
        </p>
      </div>

      <div
        className={`rounded px-2 py-1.5 text-xs font-semibold ${
          audit.substantiveWithin25 === audit.substantiveTotal
            ? 'bg-green-100 text-green-900'
            : audit.substantiveWithin25 >= audit.substantiveTotal - 2
              ? 'bg-amber-100 text-amber-900'
              : 'bg-red-100 text-red-900'
        }`}
      >
        {audit.substantiveWithin25} of {audit.substantiveTotal} substantive groups within ±25%
        {audit.removedGroupCount > 0 && (
          <div className="mt-0.5 font-normal">
            {audit.removedGroupCount} group{audit.removedGroupCount === 1 ? '' : 's'} excluded —
            removed on purpose because of reported pain, not a delivery failure.
          </div>
        )}
      </div>

      <table className="w-full text-left text-[11px]">
        <thead className="text-[10px] tracking-wide text-slate-500 uppercase">
          <tr className="border-b border-slate-200">
            <th className="py-1 pr-1 font-semibold">Group</th>
            <th className="px-1 py-1 text-right font-semibold">Target</th>
            <th className="px-1 py-1 text-right font-semibold">Deliv.</th>
            <th className="px-1 py-1 text-right font-semibold" title="what the plan expected to deliver">
              Exp.
            </th>
            <th className="py-1 pl-1 text-right font-semibold">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {audit.rows.map((r) => {
            const drift = Math.abs(r.delivered - r.expected)
            return (
              <tr key={r.group} className="border-b border-slate-100 last:border-0">
                <td className="py-1 pr-1">
                  <span className={r.isPlaceholder ? 'text-slate-400 italic' : 'text-slate-800'}>
                    {r.group}
                  </span>
                  {r.isPlaceholder && (
                    <span
                      className="ml-1 rounded bg-slate-200 px-1 text-[9px] font-bold text-slate-500"
                      title="Placeholder group — deliberately deprioritised, excluded from the summary"
                    >
                      PH
                    </span>
                  )}
                  {overrides[r.group] !== undefined && (
                    <span
                      className="ml-1 text-[9px] font-semibold text-indigo-600"
                      title={`${sex} override applied to target: ${r.rawTarget} → ${r.target}`}
                    >
                      {overrides[r.group] > 0 ? '+' : ''}
                      {overrides[r.group]}
                    </span>
                  )}
                </td>
                <td className="px-1 py-1 text-right font-mono text-slate-700">{n1(r.target)}</td>
                <td className="px-1 py-1 text-right font-mono text-slate-900">{n1(r.delivered)}</td>
                <td
                  className={`px-1 py-1 text-right font-mono ${drift > 1 ? 'text-orange-700' : 'text-slate-400'}`}
                  title={drift > 1 ? `differs from the plan's estimate by ${n1(drift)} sets` : ''}
                >
                  {n1(r.expected)}
                </td>
                <td className="py-1 pl-1 text-right">
                  <span
                    className={`rounded px-1 py-0.5 font-mono font-semibold ${BAND[r.band]}`}
                    title={
                      r.removedByPain
                        ? `Removed on purpose: ${r.removedByPainLabels.join(', ')}. ${
                            r.delivered > 0
                              ? `The ${n1(r.delivered)} shown is indirect credit from exercises that load it secondarily.`
                              : ''
                          }`
                        : ''
                    }
                  >
                    {r.removedByPain ? 'removed' : r.ratio === null ? '—' : r.ratio.toFixed(2)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="space-y-1 text-[10px] text-slate-500">
        <div>
          <span className="rounded bg-green-100 px-1 text-green-900">0.75–1.25</span>{' '}
          <span className="rounded bg-amber-100 px-1 text-amber-900">0.60–1.50</span>{' '}
          <span className="rounded bg-red-100 px-1 text-red-900">outside</span>
        </div>
        <div>
          <span className="font-semibold">PH</span> = placeholder group ({config.placeholderGroups.join(', ')}).
          Deliberately deprioritised; excluded from the summary count.
        </div>
        <div>
          An exercise also earns {config.indirectCredit} × its sets for each secondary muscle it
          works. Targets include the {sex.toLowerCase()} adjustments.
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <span className="font-semibold">Simple view rounds to whole sets:</span>{' '}
          {rounding.roundedWeekTotal} vs {rounding.rawWeekTotal} planned
          {rounding.rawWeekTotal > 0 &&
            ` (${((rounding.roundedWeekTotal / rounding.rawWeekTotal - 1) * 100).toFixed(1)}%)`}
          . Worst single group drifts {rounding.maxDrift.toFixed(1)} sets. The figures above use the
          exact planned values.
        </div>
        {audit.unmappedAlsoTrains.length > 0 && (
          <div className="rounded border border-orange-200 bg-orange-50 px-1.5 py-1 text-orange-800">
            <span className="font-semibold">Data note:</span> {audit.unmappedAlsoTrains.length}{' '}
            secondary-muscle name{audit.unmappedAlsoTrains.length === 1 ? '' : 's'} in this program
            don't match any sub-region in the exercise library, so they earn no secondary credit:{' '}
            {audit.unmappedAlsoTrains.map((s) => `"${s}"`).join(', ')}. Matched exactly, never
            guessed.
          </div>
        )}
      </div>
    </div>
  )
}
