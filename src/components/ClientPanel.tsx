import type { ClientDraft, Config, Sex, Splits } from '../types'
import { splitAdvice } from '../lib/splitAdvice'
import { Button, Field, NumberInput, Pill, Segmented, Select } from './ui'

const DAY_OPTIONS = [2, 3, 4, 5, 6]
const SEXES: Sex[] = ['Male', 'Female']

/**
 * Everything the generator needs before it can produce anything. Shown on its own at the
 * start, and reachable again from the program header — a client's details change, and
 * re-entering them should not mean starting over.
 *
 * It opens on one client rather than a menu of named ones — see `defaultDraft`. Every field
 * here can still be cleared, and a cleared one produces no program at all: none of these can
 * be guessed back from the others.
 */
export function ClientPanel({
  draft,
  setDraft,
  config,
  splits,
  ageBracket,
  effectiveGoal,
}: {
  draft: ClientDraft
  setDraft: (d: ClientDraft) => void
  config: Config
  splits: Splits
  /** empty until an age is entered */
  ageBracket: string
  /** dominant goal after any InBody blend — split badges are recomputed against it */
  effectiveGoal?: string
}) {
  const set = <K extends keyof ClientDraft>(k: K, v: ClientDraft[K]) => setDraft({ ...draft, [k]: v })

  // Splits are rated per goal / days / level, so there is nothing to rate until all three are
  // answered. Age is required too — not for the rating, which is age-blind, but for the note
  // saying the rating came from the 18-29 rows, which would otherwise appear on every client.
  const ratable =
    draft.goal !== null && draft.days !== null && draft.level !== null && draft.age !== null

  // The blended goal feeds the split engine, so a badge can move once a scan is entered.
  const advice = ratable
    ? splitAdvice(
        splits,
        {
          goal: effectiveGoal ?? draft.goal!,
          days: draft.days!,
          level: draft.level!,
          split: draft.split ?? '',
        },
        config.splits,
        ageBracket,
      )
    : null
  const rebadged = Boolean(effectiveGoal && effectiveGoal !== draft.goal)
  const suggestion = advice ? (advice.recommended[0] ?? advice.best) : null
  const isBadged = suggestion?.row?.badge === 'Recommended'
  const onSuggestion = suggestion?.split === draft.split

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sex">
          <Segmented
            className="w-full"
            value={draft.sex}
            onChange={(v) => set('sex', v)}
            options={SEXES.map((s) => ({ value: s, label: s }))}
          />
        </Field>

        <Field label="Age" hint={ageBracket ? `age bracket ${ageBracket}` : undefined}>
          <NumberInput
            min={6}
            max={99}
            placeholder="—"
            value={draft.age ?? ''}
            onChange={(e) => set('age', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>

        <Field label="Level">
          <Select value={draft.level ?? ''} onChange={(e) => set('level', e.target.value || null)}>
            {draft.level === null && <option value="">Choose a level…</option>}
            {config.levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </Field>

        <Field label="Goal">
          <Select value={draft.goal ?? ''} onChange={(e) => set('goal', e.target.value || null)}>
            {draft.goal === null && <option value="">Choose a goal…</option>}
            {config.goals.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>

        <Field label="Days per week">
          <Segmented
            className="w-full"
            value={draft.days}
            onChange={(v) => set('days', v)}
            options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))}
          />
        </Field>

        <Field
          label="Split"
          className="sm:col-span-2 lg:col-span-3"
          hint={ratable ? undefined : 'Needs an age, a level, a goal and a day count first.'}
        >
          <Select
            value={draft.split ?? ''}
            disabled={!advice}
            onChange={(e) => set('split', e.target.value || null)}
          >
            {draft.split === null && <option value="">Choose a split…</option>}
            {advice?.options.map((o) => (
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
      {advice && (
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
                  No split is badged <em>Recommended</em> for {draft.goal} / {draft.days} days /{' '}
                  {draft.level} — this is the highest-ranked <em>{suggestion.row.badge}</em> option
                  {advice.tiedWithBest > 0 &&
                    `, tied with ${advice.tiedWithBest} other${advice.tiedWithBest === 1 ? '' : 's'}`}
                  .
                </div>
              )}
            </>
          ) : (
            <span className="text-udra-ink-500">
              No split ratings are available for {draft.goal} / {draft.days} days / {draft.level}.
            </span>
          )}
          {rebadged && (
            <div className="mt-2 border-t border-udra-linen-300 pt-2 text-[12px] text-udra-blue-900">
              Re-rated against the blended goal ({effectiveGoal}) rather than the stated one,
              because the body-composition scan shifted the balance.
            </div>
          )}
          {advice.fromReferenceBracket && (
            <div className="mt-2 border-t border-udra-linen-300 pt-2 text-[12px] text-udra-ink-500">
              Split ratings cover ages 18-29 only. This comes from the 18-29 guidance for the same
              goal, days and level — it is not tailored to the {ageBracket} bracket.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
