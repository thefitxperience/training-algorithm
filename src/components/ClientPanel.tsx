import type { ClientInput, Config, Sex, Splits } from '../types'
import { PRESETS } from '../lib/presets'
import { splitAdvice } from '../lib/splitAdvice'
import { Button, Field, NumberInput, Pill, Segmented, Select } from './ui'

const DAY_OPTIONS = [2, 3, 4, 5, 6]
const SEXES: Sex[] = ['Male', 'Female']

/**
 * Everything the generator needs before it can produce anything. Shown on its own at the
 * start, and reachable again from the program header — a client's details change, and
 * re-entering them should not mean starting over.
 */
export function ClientPanel({
  input,
  setInput,
  config,
  splits,
  ageBracket,
  activePreset,
  effectiveGoal,
}: {
  input: ClientInput
  setInput: (i: ClientInput) => void
  config: Config
  splits: Splits
  ageBracket: string
  activePreset: string | null
  /** dominant goal after any InBody blend — split badges are recomputed against it */
  effectiveGoal?: string
}) {
  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setInput({ ...input, [k]: v })

  // The blended goal feeds the split engine, so a badge can move once a scan is entered.
  const advice = splitAdvice(
    splits,
    { ...input, goal: effectiveGoal ?? input.goal },
    config.splits,
    ageBracket,
  )
  const rebadged = Boolean(effectiveGoal && effectiveGoal !== input.goal)
  const suggestion = advice.recommended[0] ?? advice.best
  const isBadged = suggestion?.row?.badge === 'Recommended'
  const onSuggestion = suggestion?.split === input.split

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-udra-ink-500 uppercase">
          Start from
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setInput(p.input)}
            title={p.expectation}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              activePreset === p.name
                ? 'bg-udra-blue text-white'
                : 'bg-udra-linen-200 text-udra-ink-700 hover:bg-udra-blue-100 hover:text-udra-blue-900'
            }`}
          >
            {p.name}
          </button>
        ))}
        <Pill className="ml-auto">age bracket {ageBracket}</Pill>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sex">
          <Segmented
            className="w-full"
            value={input.sex}
            onChange={(v) => set('sex', v)}
            options={SEXES.map((s) => ({ value: s, label: s }))}
          />
        </Field>

        <Field label="Age">
          <NumberInput
            min={6}
            max={99}
            value={input.age}
            onChange={(e) => set('age', Number(e.target.value))}
          />
        </Field>

        <Field label="Level">
          <Select value={input.level} onChange={(e) => set('level', e.target.value)}>
            {config.levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </Field>

        <Field label="Goal">
          <Select value={input.goal} onChange={(e) => set('goal', e.target.value)}>
            {config.goals.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>

        <Field label="Days per week">
          <Segmented
            className="w-full"
            value={input.days}
            onChange={(v) => set('days', v)}
            options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))}
          />
        </Field>

        <Field label="Split" className="sm:col-span-2 lg:col-span-3">
          <Select value={input.split} onChange={(e) => set('split', e.target.value)}>
            {advice.options.map((o) => (
              <option key={o.split} value={o.split}>
                {o.split}
                {/* badges are 18-29 rows; don't label other brackets with them */}
                {!advice.fromReferenceBracket && (o.row ? ` — ${o.row.badge}` : ' — no data')}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* The suggestion is advice, not a default — it says what it would pick and why, and
          leaves the choice where it was. */}
      <div className="rounded-xl border border-udra-linen-200 bg-udra-linen/50 px-3.5 py-2.5 text-sm">
        {suggestion?.row ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-udra-ink-500">
                  {isBadged ? 'Recommended for this client:' : 'Best available for this client:'}
                </span>{' '}
                <span className="font-bold">{suggestion.split}</span>
              </div>
              {onSuggestion ? (
                <Pill tone="primary">currently selected</Pill>
              ) : (
                <Button size="sm" onClick={() => set('split', suggestion.split)}>
                  Use it
                </Button>
              )}
            </div>
            {!onSuggestion && (
              <div className="mt-1 text-[12px] text-udra-ink-500">
                {suggestion.row.pattern} · volume {Math.round(suggestion.row.volumePct * 100)}% ·
                major muscles {suggestion.row.majorFreq}× a week
              </div>
            )}
            {!isBadged && (
              <div className="mt-1 text-[12px] text-udra-ink-700">
                No split is badged <em>Recommended</em> for {input.goal} / {input.days} days /{' '}
                {input.level} — this is the highest-ranked <em>{suggestion.row.badge}</em> option
                {advice.tiedWithBest > 0 &&
                  `, tied with ${advice.tiedWithBest} other${advice.tiedWithBest === 1 ? '' : 's'}`}
                .
              </div>
            )}
          </>
        ) : (
          <span className="text-udra-ink-500">
            No split ratings are available for {input.goal} / {input.days} days / {input.level}.
          </span>
        )}
        {rebadged && (
          <div className="mt-2 border-t border-udra-linen-300 pt-2 text-[12px] text-udra-blue-900">
            Re-rated against the blended goal ({effectiveGoal}) rather than the stated one, because
            the body-composition scan shifted the balance.
          </div>
        )}
        {advice.fromReferenceBracket && (
          <div className="mt-2 border-t border-udra-linen-300 pt-2 text-[12px] text-udra-ink-500">
            Split ratings cover ages 18-29 only. This comes from the 18-29 guidance for the same
            goal, days and level — it is not tailored to the {ageBracket} bracket.
          </div>
        )}
      </div>

    </div>
  )
}
