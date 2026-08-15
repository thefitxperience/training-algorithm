import type { ClientInput, Config, Exercise, Sex, SplitBadge, Splits } from '../types'
import { splitsKey } from '../lib/generate'
import { PRESETS } from '../lib/presets'
import { splitAdvice } from '../lib/splitAdvice'
import { type Badge, type Structure } from '../lib/structure'
import {
  EQUIPMENT_TIERS,
  TIER_DESCRIPTION,
  libraryCoverage,
  type EquipmentTier,
} from '../lib/equipment'

const BADGE_STYLES: Record<string, string> = {
  Recommended: 'bg-green-100 text-green-800 border-green-300',
  Available: 'bg-amber-100 text-amber-800 border-amber-300',
  Adjusted: 'bg-slate-200 text-slate-700 border-slate-300',
}

const DAY_OPTIONS = [2, 3, 4, 5, 6]
const SEXES: Sex[] = ['Male', 'Female']

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}

const selectClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none'

/** 'sidebar' = the detailed view's left column. 'bar' = the simple view's horizontal strip. */
export type PanelLayout = 'sidebar' | 'bar'

export interface StructureOption {
  structure: Structure
  badge: Badge
  /** average session length for this client under this structure */
  minutes: number
}

const STRUCTURE_BLURB: Record<Structure, string> = {
  straight: 'One exercise at a time, rest, repeat.',
  superset: 'Two exercises back to back, then rest.',
  triset: 'Three back to back where legal, then rest.',
}

export function ClientPanel({
  input,
  setInput,
  config,
  splits,
  exercises,
  ageBracket,
  activePreset,
  layout = 'sidebar',
  structureOptions,
  structureNote,
}: {
  input: ClientInput
  setInput: (i: ClientInput) => void
  config: Config
  splits: Splits
  exercises: Exercise[]
  ageBracket: string
  activePreset: string | null
  layout?: PanelLayout
  structureOptions: StructureOption[]
  /** why triset was stepped down, if it was */
  structureNote: string
}) {
  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setInput({ ...input, [k]: v })

  const advice = splitAdvice(splits, input, config.splits, ageBracket)
  const suggestion = advice.recommended[0] ?? advice.best
  const isBadged = suggestion?.row?.badge === 'Recommended'
  const onSuggestion = suggestion?.split === input.split
  const coverage = libraryCoverage(exercises, input.equipment)
  const bar = layout === 'bar'

  const key = splitsKey(input)
  const badgeRow: SplitBadge | undefined = ageBracket === '18-29' ? splits[key] : undefined
  const badgeMissingReason =
    ageBracket !== '18-29'
      ? `Split ratings are only available for ages 18-29, so there is none for the ${ageBracket} bracket.`
      : !splits[key]
        ? 'There is no rating for this combination of goal, days and level.'
        : null

  // ---- controls, shared by both layouts -------------------------------------
  const presets = (
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.map((p) => (
        <button
          key={p.name}
          onClick={() => setInput(p.input)}
          title={p.expectation}
          className={`rounded border px-2 py-1 text-xs font-medium transition ${
            activePreset === p.name
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          {p.name}
        </button>
      ))}
    </div>
  )

  const sexField = (
    <Field label="Sex">
      <select className={selectClass} value={input.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
        {SEXES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </Field>
  )

  const ageField = (
    <Field label={bar ? 'Age' : `Age (bracket: ${ageBracket})`}>
      <input
        type="number"
        min={6}
        max={99}
        className={selectClass}
        value={input.age}
        onChange={(e) => set('age', Number(e.target.value))}
      />
    </Field>
  )

  const levelField = (
    <Field label="Level">
      <select className={selectClass} value={input.level} onChange={(e) => set('level', e.target.value)}>
        {config.levels.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
    </Field>
  )

  const goalField = (
    <Field label="Goal">
      <select className={selectClass} value={input.goal} onChange={(e) => set('goal', e.target.value)}>
        {config.goals.map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
    </Field>
  )

  const daysField = (
    <Field label="Days per week">
      <select className={selectClass} value={input.days} onChange={(e) => set('days', Number(e.target.value))}>
        {DAY_OPTIONS.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
    </Field>
  )

  const splitField = (className?: string) => (
    <Field label="Split" className={className}>
      <select className={selectClass} value={input.split} onChange={(e) => set('split', e.target.value)}>
        {advice.options.map((o) => (
          <option key={o.split} value={o.split}>
            {o.split}
            {/* badges are 18-29 rows; don't label other brackets with them */}
            {!advice.fromReferenceBracket && (o.row ? ` — ${o.row.badge}` : ' — no data')}
          </option>
        ))}
      </select>
    </Field>
  )

  const equipmentField = (
    <Field label="Equipment">
      <select
        className={selectClass}
        value={input.equipment}
        onChange={(e) => set('equipment', e.target.value as EquipmentTier)}
        title={TIER_DESCRIPTION[input.equipment]}
      >
        {EQUIPMENT_TIERS.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <div className="mt-1 text-[10px] text-slate-500">
        {!bar && TIER_DESCRIPTION[input.equipment]}
        <div
          className={`mt-0.5 font-semibold ${
            coverage.available < coverage.total * 0.3 ? 'text-amber-700' : 'text-slate-600'
          }`}
        >
          {coverage.available} of {coverage.total} exercises available
          {coverage.available < coverage.total && !bar && ' — expect substitutions and dropped slots below'}
        </div>
      </div>
    </Field>
  )

  const current = structureOptions.find((o) => o.structure === input.structure)
  const structureField = (className?: string) => (
    <Field label="Structure" className={className}>
      <div className="grid grid-cols-3 gap-1">
        {structureOptions.map((o) => {
          const selected = o.structure === input.structure
          const delta = current ? Math.round(o.minutes - current.minutes) : 0
          return (
            <button
              key={o.structure}
              onClick={() => set('structure', o.structure)}
              // The client sees what a change costs in time BEFORE committing to it.
              title={`${STRUCTURE_BLURB[o.structure]} ${
                selected
                  ? `Sessions average ${Math.round(o.minutes)} min.`
                  : `This will take about ${Math.round(o.minutes)} min a session instead of ${Math.round(
                      current?.minutes ?? o.minutes,
                    )}.`
              }`}
              className={`rounded border px-1.5 py-1 text-left transition ${
                selected
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="text-[11px] font-semibold capitalize">{o.structure}</div>
              <div
                className={`text-[10px] font-bold ${
                  selected
                    ? 'text-slate-300'
                    : o.badge === 'RECOMMENDED'
                      ? 'text-green-700'
                      : 'text-slate-400'
                }`}
              >
                {o.badge === 'RECOMMENDED' ? 'Recommended' : 'Available'}
              </div>
              <div className={`text-[10px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                ~{Math.round(o.minutes)} min
                {!selected && delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta})`}
              </div>
            </button>
          )
        })}
      </div>
      {input.structure === 'triset' && (
        <div className="mt-1 text-[10px] text-slate-500">
          Triset where legal — many blocks come out as pairs because no legal third exists.
        </div>
      )}
      {structureNote && <div className="mt-1 text-[10px] text-amber-700">{structureNote}</div>}
    </Field>
  )

  const suggestionBlock = (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
      {suggestion?.row ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-slate-500">
                {isBadged ? 'Recommended for this client:' : 'Best available for this client:'}
              </span>{' '}
              <span className={`font-bold ${isBadged ? 'text-green-800' : 'text-amber-800'}`}>
                {suggestion.split}
              </span>
            </div>
            {!onSuggestion && (
              <button
                onClick={() => set('split', suggestion.split)}
                className="shrink-0 rounded border border-slate-700 bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-slate-800"
              >
                Use
              </button>
            )}
          </div>
          {onSuggestion ? (
            <div className="mt-0.5 font-semibold text-green-700">
              ✓ currently selected{bar ? '' : ' — details below'}
            </div>
          ) : (
            <div className="mt-0.5 text-slate-500">
              {suggestion.row.pattern} · volume {Math.round(suggestion.row.volumePct * 100)}% · major
              freq {suggestion.row.majorFreq}×
            </div>
          )}
          {!isBadged && (
            <div className="mt-0.5 text-amber-700">
              No split is badged <em>Recommended</em> for {input.goal} / {input.days} days /{' '}
              {input.level} — this is the highest-ranked <em>{suggestion.row.badge}</em> row
              {advice.tiedWithBest > 0 &&
                `, tied with ${advice.tiedWithBest} other${advice.tiedWithBest === 1 ? '' : 's'}`}
              .
            </div>
          )}
          {isBadged && advice.recommended.length > 1 && (
            <div className="mt-0.5 text-slate-500">
              Also recommended: {advice.recommended.slice(1).map((o) => o.split).join(', ')}
            </div>
          )}
        </>
      ) : (
        <span className="text-slate-500">
          No split ratings are available for {input.goal} / {input.days} days / {input.level}.
        </span>
      )}
      {advice.fromReferenceBracket && (
        <div className="mt-1 border-t border-slate-200 pt-1 text-[10px] text-amber-700">
          Split ratings cover ages 18-29 only. This suggestion comes from the 18-29 guidance for
          the same goal, days and level — it is not tailored to the {ageBracket} bracket.
        </div>
      )}
    </div>
  )

  const badgeBlock = badgeRow ? (
    <div
      className={`rounded border px-2 py-1.5 text-xs ${BADGE_STYLES[badgeRow.badge] ?? BADGE_STYLES.Adjusted}`}
      title={`volumePct ${badgeRow.volumePct} · majorFreq ${badgeRow.majorFreq}${badgeRow.note ? ` · ${badgeRow.note}` : ''}`}
    >
      <span className="font-bold">{badgeRow.badge}</span>
      <span className="ml-1 opacity-80">· {badgeRow.pattern}</span>
      <div className="mt-0.5 opacity-70">
        volume {Math.round(badgeRow.volumePct * 100)}% · major freq {badgeRow.majorFreq}×
      </div>
    </div>
  ) : (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
      No badge available. {badgeMissingReason}
    </div>
  )

  // ---- horizontal strip (simple view) ---------------------------------------
  if (bar) {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Presets</span>
          {presets}
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            age bracket {ageBracket}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 md:grid-cols-4">
          {sexField}
          {ageField}
          {levelField}
          {goalField}
          {daysField}
          {splitField('md:col-span-2')}
          {equipmentField}
          {structureField('col-span-2 md:col-span-2')}
          <div className="col-span-2 md:col-span-2">{suggestionBlock}</div>
        </div>
      </div>
    )
  }

  // ---- sidebar (detailed view) ----------------------------------------------
  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-800">Presets</h2>
        {presets}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-800">Client</h2>
        {sexField}
        {ageField}
        {levelField}
        {goalField}
        {daysField}
        {splitField()}
        {suggestionBlock}
        {badgeBlock}
        {equipmentField}
        {structureField()}
      </section>
    </div>
  )
}
