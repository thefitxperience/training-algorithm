import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientInput, DataBundle } from '../types'
import type { Program } from '../lib/generate'
import { hasAnyReading } from '../lib/vald'
import { hasAnyInput } from '../lib/inbody'
import { readInBodyFile } from '../lib/inbodyImport'
import { NOT_PRINTED, type InBodyScan } from '../lib/inbodyScan'
import { hasAnyBodyDot } from '../lib/bodydot'
import {
  BATTERY_LABEL,
  mergeSessions,
  readValdFile,
  sessionLabel,
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
  revealOn,
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
  /**
   * Bumped whenever something worth seeing arrives in the body — an import landing, say. The
   * card opens itself, because the alternative is a button that reads as having done nothing.
   * Unlike `forceOpen` this leaves Hide working.
   */
  revealOn?: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const shown = open || forceOpen

  useEffect(() => {
    if (revealOn) setOpen(true)
  }, [revealOn])
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
  // Several tests can be used at once, but only ever one client's — see `pick`.
  const [chosen, setChosen] = useState<ImportedSession[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped on every upload, so a second upload re-opens the card after a Hide.
  const [uploads, setUploads] = useState(0)

  // A gym-wide export runs to hundreds of tests; a scrolling list of them is not a chooser.
  const shortlist = useMemo(() => {
    const all = imported?.sessions ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 8)
    return all.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20)
  }, [imported, query])

  const client = chosen[0]?.name ?? null
  /** Everything else on record for the client whose tests are in use. */
  const otherTests = useMemo(
    () =>
      client === null
        ? []
        : (imported?.sessions ?? []).filter(
            (s) => s.name === client && s.tests.length > 0 && !chosen.includes(s),
          ),
    [imported, chosen, client],
  )
  const merged = useMemo(() => mergeSessions(chosen), [chosen])

  const active = hasAnyReading(input.vald)
  const firing = program.vald.firing.length
  const bumps = program.vald.bumps.length
  const waiting = imported !== null && imported.sessions.length > 1 && !active
  const summary = active
    ? `${Object.keys(input.vald).length} tests read · ${firing} asymmetr${firing === 1 ? 'y' : 'ies'} over threshold · ${bumps} exercise${bumps === 1 ? '' : 's'} now one-sided`
    : // An export covering the whole gym applies nothing until a client is picked. Said in the
      // header too, so the card never reads as having ignored the file.
      waiting
      ? `${imported.sessions.length} tests in that export — pick whose to use`
      : undefined

  const load = async (file: File) => {
    setBusy(true)
    setError(null)
    setUploads((n) => n + 1)
    try {
      const result = await readValdFile(file, data.vald)
      if (result.sessions.length === 0) {
        setError('No DynaMo test rows were found in that file.')
        setImported(null)
        setChosen([])
      } else {
        setImported(result)
        // One athlete, one date — nothing to choose, so apply it. An export covering a whole
        // gym holds hundreds, and picking the wrong person's is worse than one more click.
        setChosen([])
        if (result.sessions.length === 1) apply([result.sessions[0]])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setImported(null)
      setChosen([])
    } finally {
      setBusy(false)
    }
  }

  const apply = (sessions: ImportedSession[]) => {
    setChosen(sessions)
    setInput({ ...input, vald: toValdInput(sessions) })
  }

  /**
   * One row clicked. Tests belonging to the client already in use toggle on and off, so an
   * upper and a lower can be read together; a different client replaces the selection outright,
   * because a program is for one person and merging two people's readings is never a thing
   * anyone means to do.
   */
  const pick = (s: ImportedSession) => {
    if (client !== null && s.name !== client) return apply([s])
    const without = chosen.filter((c) => c !== s)
    // Never leave nothing selected — clicking the only chosen test keeps it.
    apply(without.length === chosen.length ? [...chosen, s] : without.length ? without : [s])
  }

  return (
    <Machine
      name="VALD DynaMo"
      tone="cyan"
      blurb="Upload the DynaMo Excel export. Asymmetries add sets to the weaker side; the newton figures estimate working weights."
      active={active}
      summary={summary}
      revealOn={uploads}
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
                setChosen([])
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
            That export holds {imported.sessions.length} tests. Pick whose to use — a client's
            tests can be combined.
          </div>
          <input
            className={`${controlClass} mb-2`}
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {shortlist.map((s) => {
              const id = sessionId(s)
              const picked = chosen.includes(s)
              // A test can survive the import with nothing usable in it — a trunk bend done on
              // one side only, say. It is still listed, because a trainer looking for it should
              // see that it exists, but there is nothing to apply.
              const empty = s.tests.length === 0
              return (
                <button
                  key={id}
                  disabled={empty}
                  onClick={() => pick(s)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition ${
                    empty
                      ? 'cursor-not-allowed border-udra-linen-300 opacity-50'
                      : picked
                        ? 'border-udra-blue bg-udra-blue-50'
                        : 'border-udra-linen-300 hover:border-udra-blue'
                  }`}
                >
                  {/* A tick, not a radio: more than one of a client's tests can be on at once. */}
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] leading-none font-bold ${
                      picked
                        ? 'border-udra-blue bg-udra-blue text-white'
                        : 'border-udra-linen-300 text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
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
          {client !== null && (
            <div className="text-udra-ink-700">
              Using <span className="font-bold">{client}</span> —{' '}
              {chosen.map(sessionLabel).join(' + ').toLowerCase()}, {merged.tests.length} movements
              in all.
              {/* A movement done more than once is a rep that was redone. Which attempt was
                  kept is a judgement, so it is stated rather than assumed. */}
              {merged.tests.some((t) => t.attempts > 1) && (
                <>
                  {' '}
                  {merged.tests.filter((t) => t.attempts > 1).length} movement
                  {merged.tests.filter((t) => t.attempts > 1).length === 1 ? ' was' : 's were'}{' '}
                  measured more than once; the last good attempt is the one used.
                </>
              )}
            </div>
          )}
          {/* Merging silently is how a six-month-old shoulder reading ends up shaping today's
              program with nothing on screen to say so. */}
          {merged.overlaps.length > 0 && (
            <div className="text-udra-ink-700">
              Measured in more than one of those tests, so the latest reading is used:{' '}
              {merged.overlaps
                .map((o) => `${o.test} (${o.kept.toLowerCase()}, over ${o.dropped.length} older)`)
                .join('; ')}
              .
            </div>
          )}
          {/* An upper-body test says nothing about the legs, so anything else on record for this
              client is offered rather than left to be noticed. */}
          {otherTests.length > 0 && (
            <div className="text-udra-ink-700">
              This client has {otherTests.length} other test{otherTests.length === 1 ? '' : 's'} in
              the export.{' '}
              {otherTests.map((s) => (
                <button
                  key={sessionId(s)}
                  className="mr-1.5 font-bold text-udra-blue underline underline-offset-2"
                  onClick={() => apply([...chosen, s])}
                >
                  Add {sessionLabel(s).toLowerCase()}
                </button>
              ))}
              {otherTests.length > 1 && (
                <button
                  className="font-bold text-udra-blue underline underline-offset-2"
                  onClick={() => apply([...chosen, ...otherTests])}
                >
                  Add all
                </button>
              )}
            </div>
          )}
          {/* A short import is never silent: anything the data file does not name is listed. */}
          {chosen.some((s) => s.unmapped.length > 0) && (
            <div className="text-udra-ink-700">
              Not used, because this app has no test for them:{' '}
              {[
                ...new Set(
                  chosen.flatMap((s) => s.unmapped.map((u) => `${u.bodyRegion} ${u.movement}`)),
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
  const fileRef = useRef<HTMLInputElement>(null)
  const [scan, setScan] = useState<InBodyScan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState(0)

  const active = hasAnyInput(input.inbody)
  const r = program.inbody
  const summary = active
    ? `${r.notes.length} rule${r.notes.length === 1 ? '' : 's'} fired · ${
        r.dominantGoal && r.dominantGoal !== input.goal
          ? `training as ${r.dominantGoal}`
          : 'goal unchanged'
      }`
    : undefined

  const load = async (file: File) => {
    setBusy('Opening the file')
    setError(null)
    setUploads((n) => n + 1)
    try {
      const result = await readInBodyFile(file, (stage, fraction) =>
        setBusy(fraction === undefined ? stage : `${stage} — ${Math.round(fraction * 100)}%`),
      )
      setScan(result)
      if (Object.keys(result.readings).length === 0)
        setError(
          'Nothing on that page looked like an InBody result sheet. If it is a photograph, a straight-on shot of the whole sheet reads best.',
        )
      // Whatever the sheet did carry goes in; whatever it did not is left for the fields below.
      else setInput({ ...input, inbody: { ...input.inbody, ...result.readings } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setScan(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Machine
      name="InBody scan"
      tone="orange"
      blurb="Upload the printout as a PDF or a photo. Muscle, fat, hydration and segmental fat reset sets, reps and rest."
      active={active}
      summary={summary}
      revealOn={uploads}
      action={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void load(f)
              e.target.value = ''
            }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {busy ?? 'Upload scan'}
          </Button>
          {active && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setScan(null)
                setInput({ ...input, inbody: {} })
              }}
            >
              Clear
            </Button>
          )}
        </>
      }
    >
      {error && <Note tone="flame" title="That scan could not be read">{error}</Note>}
      {scan && <ScanSummary scan={scan} />}

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

/**
 * What the sheet gave up, and what it does not carry. The second half is the important one:
 * an InBody sheet never writes down the percent body fat range, so a scan that looks complete
 * still leaves a rule unable to run, and the only honest thing is to say which.
 */
function ScanSummary({ scan }: { scan: InBodyScan }) {
  const read = Object.keys(scan.readings).length
  const notPrinted = scan.missing.filter((f) => NOT_PRINTED[f])
  const reasons = [...new Set(notPrinted.map((f) => NOT_PRINTED[f]!))]

  return (
    <div className="mb-4 space-y-1 text-[12px]">
      <div className="font-bold">
        {scan.model ?? 'InBody'} scan{scan.name ? ` · ${scan.name}` : ''}
        {scan.testDate ? ` · ${scan.testDate}` : ''}
      </div>
      <div className="text-udra-ink-500">
        {read} of 14 figures read{scan.ocr ? ' by reading the picture' : ' from the file'}
        {scan.weightKg !== undefined && ` · ${scan.weightKg} kg`}
        {scan.bodyFatKg !== undefined && ` · ${scan.bodyFatKg} kg fat`}.
      </div>
      {reasons.length > 0 && (
        <div className="text-udra-ink-700">
          Left blank because the sheet does not print{' '}
          {notPrinted.includes('pbfLow') && notPrinted.includes('smmLow')
            ? 'them'
            : notPrinted.includes('pbfLow')
              ? 'it'
              : 'it'}
          : {reasons.join('; ')}. Fill those in below to let the rules that need them run.
        </div>
      )}
      {scan.warnings.map((w) => (
        <div key={w} className="text-udra-flame">
          {w}
        </div>
      ))}
      <details>
        <summary className="cursor-pointer text-udra-ink-500">Where each figure came from</summary>
        <ul className="mt-1 space-y-0.5">
          {Object.entries(scan.sources).map(([field, from]) => (
            <li key={field} className="tnum text-udra-ink-500">
              <span className="font-semibold">{field}</span>{' '}
              {String(scan.readings[field as keyof typeof scan.readings])} — {from}
            </li>
          ))}
        </ul>
      </details>
    </div>
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
