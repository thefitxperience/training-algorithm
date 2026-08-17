import { useMemo, useRef, useState } from 'react'
import type { ClientInput, DataBundle } from '../types'
import type { Program } from '../lib/generate'
import { hasAnyReading } from '../lib/vald'
import { hasAnyInput } from '../lib/inbody'
import { hasAnyBodyDot } from '../lib/bodydot'
import {
  BATTERY_LABEL,
  readValdFile,
  toValdInput,
  type ImportedSession,
  type ValdImport,
} from '../lib/valdImport'
import type { BodyDotImport } from '../lib/bodydotApi'
import { BodyDotConnect } from './BodyDotConnect'
import { ValdPanel } from './ValdPanel'
import { InBodyPanel } from './InBodyPanel'
import { BodyDotPanel } from './BodyDotPanel'
import { LoadPanel } from './LoadPanel'
import { Button, Card, Note, Pill, controlClass, type Tone } from './ui'

/**
 * The three machines, offered only once a program exists — a test result adjusts a program,
 * it does not produce one. Each card states in one line what it has done to the program, so
 * a reading is never just "loaded".
 *
 * Colour is load-bearing here: each machine keeps its own tertiary throughout the app, so a
 * badge on an exercise can be traced back to the box it came out of.
 */

type MachineTone = Extract<Tone, 'cyan' | 'orange' | 'primary'>

/** A day can hold both an upper and a lower test, so the battery is part of a test's identity. */
const sessionId = (s: ImportedSession) => `${s.name}|${s.date}|${s.battery}`

function Machine({
  name,
  tone,
  blurb,
  active,
  summary,
  action,
  forceOpen = false,
  children,
}: {
  name: string
  tone: MachineTone
  blurb: string
  active: boolean
  summary?: string
  action?: React.ReactNode
  /** an action that reveals something below has to open the card itself, or it shows nothing */
  forceOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const shown = open || forceOpen
  const accent = { cyan: 'bg-udra-cyan', orange: 'bg-udra-orange', primary: 'bg-udra-blue' }[tone]

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{name}</h3>
            {active ? (
              <Pill tone={tone}>in the program</Pill>
            ) : (
              <Pill>not added</Pill>
            )}
          </div>
          <p className="mt-1 text-[12px] text-udra-ink-500">{summary || blurb}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-udra-linen-200 px-4 py-2.5">
        {action}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={forceOpen}
          onClick={() => setOpen((v) => !v)}
        >
          {shown ? 'Hide' : active ? 'Show readings' : 'Enter by hand'}
        </Button>
      </div>

      {shown && <div className="border-t border-udra-linen-200 p-4">{children}</div>}
    </Card>
  )
}

// ---- VALD ------------------------------------------------------------------

function ValdCard({
  data,
  input,
  setInput,
  program,
}: {
  data: DataBundle
  input: ClientInput
  setInput: (i: ClientInput) => void
  program: Program
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [imported, setImported] = useState<ValdImport | null>(null)
  const [chosen, setChosen] = useState<ImportedSession | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A gym-wide export runs to hundreds of tests; a scrolling list of them is not a chooser.
  const shortlist = useMemo(() => {
    const all = imported?.sessions ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 8)
    return all.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20)
  }, [imported, query])

  // The upper and lower halves of the same day, when the client did both.
  const otherHalf = useMemo(
    () =>
      chosen?.pairedSameDay
        ? (imported?.sessions.find(
            (s) => s.name === chosen.name && s.date === chosen.date && s.battery !== chosen.battery,
          ) ?? null)
        : null,
    [imported, chosen],
  )

  const active = hasAnyReading(input.vald)
  const firing = program.vald.firing.length
  const bumps = program.vald.bumps.length
  const summary = active
    ? `${Object.keys(input.vald).length} tests read · ${firing} asymmetr${firing === 1 ? 'y' : 'ies'} over threshold · ${bumps} exercise${bumps === 1 ? '' : 's'} now one-sided`
    : undefined

  const load = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const result = await readValdFile(file, data.vald)
      if (result.sessions.length === 0) {
        setError('No DynaMo test rows were found in that file.')
        setImported(null)
        setChosen(null)
      } else {
        setImported(result)
        // One athlete, one date — nothing to choose, so apply it. An export covering a whole
        // gym holds hundreds, and picking the wrong person's is worse than one more click.
        setChosen(null)
        if (result.sessions.length === 1) apply(result.sessions[0])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setImported(null)
      setChosen(null)
    } finally {
      setBusy(false)
    }
  }

  const apply = (session: ImportedSession) => {
    setChosen(session)
    setInput({ ...input, vald: toValdInput(session) })
  }

  return (
    <Machine
      name="VALD DynaMo"
      tone="cyan"
      blurb="Upload the DynaMo Excel export. Asymmetries add sets to the weaker side; the newton figures estimate working weights."
      active={active}
      summary={summary}
      action={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void load(f)
              e.target.value = ''
            }}
          />
          <Button variant="primary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Reading…' : 'Upload export'}
          </Button>
          {active && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setImported(null)
                setChosen(null)
                setQuery('')
                setInput({ ...input, vald: {} })
              }}
            >
              Clear
            </Button>
          )}
        </>
      }
    >
      {error && <Note tone="flame" title="That file could not be read">{error}</Note>}

      {imported && imported.sessions.length > 1 && (
        <div className="mb-4">
          <div className="mb-2 text-[12px] font-bold">
            That export holds {imported.sessions.length} tests. Pick the one to use:
          </div>
          <input
            className={`${controlClass} mb-2`}
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {shortlist.map((s) => {
              const id = `${s.name}|${s.date}|${s.battery}`
              const picked = chosen !== null && id === sessionId(chosen)
              // A test can survive the import with nothing usable in it — a trunk bend done on
              // one side only, say. It is still listed, because a trainer looking for it should
              // see that it exists, but there is nothing to apply.
              const empty = s.tests.length === 0
              return (
                <button
                  key={id}
                  disabled={empty}
                  onClick={() => apply(s)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                    empty
                      ? 'cursor-not-allowed border-udra-linen-300 opacity-50'
                      : picked
                        ? 'border-udra-blue bg-udra-blue-50'
                        : 'border-udra-linen-300 hover:border-udra-blue'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{s.name}</span>
                    <span className="tnum text-[11px] text-udra-ink-500">
                      {s.date} ·{' '}
                      {empty ? 'nothing this app can read' : `${s.tests.length} movements`}
                    </span>
                  </span>
                  {/* Which battery this is, so an upper-body test is never mistaken for a
                      whole-body picture of the client. */}
                  <Pill tone={s.battery === 'full' ? 'cyan' : undefined}>
                    {BATTERY_LABEL[s.battery]}
                  </Pill>
                </button>
              )
            })}
            {shortlist.length === 0 && (
              <div className="text-[12px] text-udra-ink-500">No test matches that name.</div>
            )}
            {shortlist.length < imported.sessions.length && (
              <div className="text-[12px] text-udra-ink-500">
                Showing {shortlist.length} of {imported.sessions.length} — type to search.
              </div>
            )}
          </div>
        </div>
      )}

      {imported && (
        <div className="mb-4 space-y-1 text-[12px] text-udra-ink-500">
          <div>
            Read {imported.rowsRead} rows into{' '}
            {imported.sessions.reduce((n, s) => n + s.tests.length, 0)} mapped movements across{' '}
            {imported.sessions.length} test{imported.sessions.length === 1 ? '' : 's'}.
          </div>
          {chosen && (
            <div className="text-udra-ink-700">
              Using <span className="font-bold">{chosen.name}</span>, {chosen.date} —{' '}
              {BATTERY_LABEL[chosen.battery].toLowerCase()}, {chosen.tests.length} movements.
              {/* A movement done more than once is a rep that was redone. Which attempt was
                  kept is a judgement, so it is stated rather than assumed. */}
              {chosen.tests.some((t) => t.attempts > 1) && (
                <>
                  {' '}
                  {chosen.tests.filter((t) => t.attempts > 1).length} movement
                  {chosen.tests.filter((t) => t.attempts > 1).length === 1 ? ' was' : 's were'}{' '}
                  measured more than once; the last good attempt is the one used.
                </>
              )}
            </div>
          )}
          {/* An upper-body test says nothing about the legs. Where the other half exists on the
              same day it is offered, because half a picture silently reads as a whole one. */}
          {chosen?.pairedSameDay && (
            <div className="text-udra-ink-700">
              The same day also holds{' '}
              {chosen.battery === 'upper' ? 'a lower-body test' : 'an upper-body test'} for this
              client — this reading covers only the {chosen.battery} half.
              {otherHalf && (
                <>
                  {' '}
                  <button
                    className="font-bold text-udra-blue underline underline-offset-2"
                    onClick={() => apply(otherHalf)}
                  >
                    Use the other half instead
                  </button>
                  .
                </>
              )}
            </div>
          )}
          {/* A short import is never silent: anything the data file does not name is listed. */}
          {chosen && chosen.unmapped.length > 0 && (
            <div className="text-udra-ink-700">
              Not used, because this app has no test for them:{' '}
              {[...new Set(chosen.unmapped.map((u) => `${u.bodyRegion} ${u.movement}`))].join(', ')}
              .
            </div>
          )}
        </div>
      )}

      <ValdPanel
        data={data.vald}
        input={input.vald}
        setInput={(vald) => setInput({ ...input, vald })}
        result={program.vald}
        compact
      />
      <div className="mt-4 border-t border-udra-linen-200 pt-4">
        <LoadPanel data={data.load} result={program.load} compact />
      </div>
    </Machine>
  )
}

// ---- InBody ----------------------------------------------------------------

function InBodyCard({
  data,
  input,
  setInput,
  program,
}: {
  data: DataBundle
  input: ClientInput
  setInput: (i: ClientInput) => void
  program: Program
}) {
  const active = hasAnyInput(input.inbody)
  const r = program.inbody
  const summary = active
    ? `${r.notes.length} rule${r.notes.length === 1 ? '' : 's'} fired · ${
        r.dominantGoal && r.dominantGoal !== input.goal
          ? `training as ${r.dominantGoal}`
          : 'goal unchanged'
      }`
    : undefined

  return (
    <Machine
      name="InBody scan"
      tone="orange"
      blurb="Upload the printout as a PDF or a photo. Muscle, fat, hydration and segmental fat reset sets, reps and rest."
      active={active}
      summary={summary}
      action={
        <>
          <Button
            size="sm"
            onClick={() => setInput({ ...input, inbody: WORKED })}
            title="Load the spec's worked example — useful for checking the layer end to end."
          >
            Load worked example
          </Button>
          {active && (
            <Button size="sm" variant="danger" onClick={() => setInput({ ...input, inbody: {} })}>
              Clear
            </Button>
          )}
        </>
      }
    >
      <InBodyPanel
        data={data.inbody}
        input={input.inbody}
        setInput={(inbody) => setInput({ ...input, inbody })}
        result={program.inbody}
        compact
      />
    </Machine>
  )
}

// ---- BodyDot ---------------------------------------------------------------

function BodyDotCard({
  data,
  input,
  setInput,
  program,
}: {
  data: DataBundle
  input: ClientInput
  setInput: (i: ClientInput) => void
  program: Program
}) {
  const [connecting, setConnecting] = useState(false)
  const [source, setSource] = useState<{
    client: string
    date: string
    imported: BodyDotImport
  } | null>(null)

  const active = hasAnyBodyDot(input.bodydot)
  const findings = program.bodydot.findings.length
  const correctives = program.bodydot.correctives.length
  const summary = active
    ? `${findings} finding${findings === 1 ? '' : 's'} outside their normal band · ${correctives} corrective exercise${correctives === 1 ? '' : 's'} added to every session`
    : undefined

  return (
    <Machine
      name="BodyDot posture"
      tone="primary"
      blurb="Pull a client's latest posture scan. Findings outside their band add corrective work to the end of every session."
      active={active}
      summary={summary}
      forceOpen={connecting}
      action={
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setConnecting((v) => !v)}
          >
            {connecting ? 'Cancel' : active ? 'Pull another scan' : 'Pull a scan'}
          </Button>
          {active && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setSource(null)
                setInput({ ...input, bodydot: {} })
              }}
            >
              Clear
            </Button>
          )}
        </>
      }
    >
      {connecting && (
        <div className="mb-4 rounded-xl border border-udra-blue-200 bg-udra-blue-50 p-3">
          <BodyDotConnect
            data={data.bodydot}
            onApply={(readings, imported, client, session) => {
              setSource({
                client: client.name,
                date: session.createdAt.slice(0, 10),
                imported,
              })
              setConnecting(false)
              setInput({ ...input, bodydot: readings })
            }}
          />
        </div>
      )}

      {source && (
        <div className="mb-4 space-y-1 text-[12px]">
          <div className="font-bold">
            {source.client} · scanned {source.date}
          </div>
          <div className="text-udra-ink-500">
            Read {source.imported.indicators.length} of 26 indicators from{' '}
            {source.imported.analyzedSteps.length} analyzed step
            {source.imported.analyzedSteps.length === 1 ? '' : 's'}.
          </div>
          {/* An incomplete scan is stated, never quietly treated as a full one. */}
          {!source.imported.validity.valid && (
            <div className="text-udra-flame">
              Only {source.imported.validity.analyzed} of {source.imported.validity.total} steps in
              that test were analyzed, so this is a partial reading.
            </div>
          )}
          {source.imported.missing.length > 0 && (
            <div className="text-udra-ink-500">
              Not measured: {source.imported.missing.map((m) => m.indicator).join(', ')}.
            </div>
          )}
          {/* Where the scan reports each side, the WORSE one is the finding — said out loud,
              because the other side's number is on the client's Bodydot report. */}
          {source.imported.indicators.some((i) => i.bySide) && (
            <details>
              <summary className="cursor-pointer text-udra-ink-500">
                Both sides were measured on{' '}
                {source.imported.indicators.filter((i) => i.bySide).length} indicators — the worse
                side is the one used
              </summary>
              <ul className="mt-1 space-y-0.5">
                {source.imported.indicators
                  .filter((i) => i.bySide)
                  .map((i) => (
                    <li key={i.code} className="tnum text-udra-ink-500">
                      {i.indicator}: L {i.bySide!.left.toFixed(1)} / R {i.bySide!.right.toFixed(1)} →{' '}
                      <span className="font-semibold">
                        {i.side} {i.value.toFixed(1)}
                      </span>{' '}
                      ({i.tier})
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <BodyDotPanel
        data={data.bodydot}
        input={input.bodydot}
        setInput={(bodydot) => setInput({ ...input, bodydot })}
        result={program.bodydot}
        compact
      />
    </Machine>
  )
}

const WORKED = {
  smm: 30.1,
  smmLow: 31.6,
  smmHigh: 38.6,
  pbf: 26.4,
  pbfLow: 10,
  pbfHigh: 20,
  tbw: 39.2,
  tbwLow: 38.4,
  tbwHigh: 46.9,
  fatLArm: 128,
  fatRArm: 131,
  fatTrunk: 178,
  fatLLeg: 96,
  fatRLeg: 94,
}

export function TestStrip(props: {
  data: DataBundle
  input: ClientInput
  setInput: (i: ClientInput) => void
  program: Program
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ValdCard {...props} />
      <InBodyCard {...props} />
      <BodyDotCard {...props} />
    </div>
  )
}
