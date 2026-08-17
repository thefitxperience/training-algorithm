import type { ClientInput } from '../types'
import type { Badge, Structure } from '../lib/structure'
import { Field, Note } from './ui'

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

/**
 * How the session is run, shown beside the program rather than in the client's details.
 *
 * It belongs here because it is the one setting worth flipping back and forth: it changes no
 * exercise and no set, only how long the session takes, so the thing it should be judged
 * against is the day cards underneath it — not a form filled in before any of them exist.
 */
export function StructurePicker({
  input,
  setInput,
  options,
  note,
}: {
  input: ClientInput
  setInput: (i: ClientInput) => void
  options: StructureOption[]
  /** why triset was stepped down, if it was */
  note: string
}) {
  const current = options.find((o) => o.structure === input.structure)

  return (
    <div className="space-y-3">
      <Field
        label="How the session is run"
        hint="This changes the pace, never the work. Every set survives whichever you pick."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => {
            const selected = o.structure === input.structure
            const delta = current ? Math.round(o.minutes - current.minutes) : 0
            return (
              <button
                key={o.structure}
                type="button"
                onClick={() => setInput({ ...input, structure: o.structure })}
                // The cost in time is shown BEFORE the change is committed to.
                title={`${STRUCTURE_BLURB[o.structure]} ${
                  selected
                    ? `Sessions average ${Math.round(o.minutes)} min.`
                    : `This would take about ${Math.round(o.minutes)} min a session instead of ${Math.round(
                        current?.minutes ?? o.minutes,
                      )}.`
                }`}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  selected
                    ? 'border-udra-blue bg-udra-blue text-white'
                    : 'border-udra-linen-300 bg-white hover:border-udra-blue-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold capitalize">{o.structure}</span>
                  {o.badge === 'RECOMMENDED' && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        selected ? 'bg-white/20 text-white' : 'bg-udra-neon text-black'
                      }`}
                    >
                      Recommended
                    </span>
                  )}
                </div>
                <div
                  className={`mt-0.5 text-[12px] ${selected ? 'text-white/80' : 'text-udra-ink-500'}`}
                >
                  {STRUCTURE_BLURB[o.structure]}
                </div>
                <div
                  className={`tnum mt-1 text-[12px] font-semibold ${
                    selected ? 'text-white' : 'text-udra-ink-700'
                  }`}
                >
                  ~{Math.round(o.minutes)} min a session
                  {!selected && delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta})`}
                </div>
              </button>
            )
          })}
        </div>
      </Field>

      {input.structure === 'triset' && (
        <Note>
          Triset where legal — many blocks still come out as pairs, because no legal third
          exercise exists for them.
        </Note>
      )}
      {note && <Note tone="neon">{note}</Note>}
    </div>
  )
}
