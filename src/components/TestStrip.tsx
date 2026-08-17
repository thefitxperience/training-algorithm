import { useRef, useState } from 'react'
import type { ClientInput, DataBundle } from '../types'
import type { Program } from '../lib/generate'
import { hasAnyReading, type ValdInput } from '../lib/vald'
import { hasAnyInput } from '../lib/inbody'
import { hasAnyBodyDot } from '../lib/bodydot'
import { readValdFile, toValdInput, type ValdImport } from '../lib/valdImport'
import { ValdPanel } from './ValdPanel'
import { InBodyPanel } from './InBodyPanel'
import { BodyDotPanel } from './BodyDotPanel'
import { LoadPanel } from './LoadPanel'
import { Button, Card, Note, Pill, type Tone } from './ui'

/**
 * The three machines, offered only once a program exists — a test result adjusts a program,
 * it does not produce one. Each card states in one line what it has done to the program, so
 * a reading is never just "loaded".
 *
 * Colour is load-bearing here: each machine keeps its own tertiary throughout the app, so a
 * badge on an exercise can be traced back to the box it came out of.
 */

type MachineTone = Extract<Tone, 'cyan' | 'orange' | 'primary'>

function Machine({
  name,
  tone,
  blurb,
  active,
  summary,
  action,
  children,
}: {
  name: string
  tone: MachineTone
  blurb: string
  active: boolean
  summary?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
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
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : active ? 'Show readings' : 'Enter by hand'}
        </Button>
      </div>

      {open && <div className="border-t border-udra-linen-200 p-4">{children}</div>}
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      } else {
        setImported(result)
        // One athlete, one date — nothing to choose, so apply it.
        if (result.sessions.length === 1) apply(toValdInput(result.sessions[0]))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setImported(null)
    } finally {
      setBusy(false)
    }
  }

  const apply = (vald: ValdInput) => setInput({ ...input, vald })

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
            <Button size="sm" variant="danger" onClick={() => { setImported(null); apply({}) }}>
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
          <div className="space-y-1.5">
            {imported.sessions.map((s) => (
              <button
                key={`${s.name}|${s.date}`}
                onClick={() => apply(toValdInput(s))}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-udra-linen-300 px-3 py-2 text-left text-sm transition hover:border-udra-blue"
              >
                <span className="font-semibold">{s.name}</span>
                <span className="tnum text-[12px] text-udra-ink-500">
                  {s.date} · {s.tests.length} movements
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {imported && (
        <div className="mb-4 space-y-1 text-[12px] text-udra-ink-500">
          <div>
            Read {imported.rowsRead} rows into{' '}
            {imported.sessions.reduce((n, s) => n + s.tests.length, 0)} mapped movements.
          </div>
          {/* A short import is never silent: anything the data file does not name is listed. */}
          {imported.sessions.some((s) => s.unmapped.length > 0) && (
            <div className="text-udra-ink-700">
              Not used, because this app has no test for them:{' '}
              {[
                ...new Set(
                  imported.sessions.flatMap((s) =>
                    s.unmapped.map((u) => `${u.bodyRegion} ${u.movement}`),
                  ),
                ),
              ].join(', ')}
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
      action={
        active ? (
          <Button size="sm" variant="danger" onClick={() => setInput({ ...input, bodydot: {} })}>
            Clear
          </Button>
        ) : undefined
      }
    >
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
