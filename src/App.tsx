import { useEffect, useMemo, useState } from 'react'
import { loadData } from './data/load'
import { ageBracket, generate } from './lib/generate'
import { buildAudit } from './lib/audit'
import { roundSets } from './lib/rounding'
import { PRESETS } from './lib/presets'
import { ClientPanel } from './components/ClientPanel'
import { ProgramPanel } from './components/ProgramPanel'
import { MedicalDisclaimer, PainPanel } from './components/PainPanel'
import { InBodyPanel } from './components/InBodyPanel'
import { ValdPanel } from './components/ValdPanel'
import { WORKED_EXAMPLE, hasAnyInput, type InBodyInput } from './lib/inbody'
import { hasAnyReading, type ValdInput } from './lib/vald'
import { hasAnyBodyDot, type BodyDotInput } from './lib/bodydot'
import { BodyDotPanel } from './components/BodyDotPanel'
import { LoadPanel } from './components/LoadPanel'
import { PinsPanel, type AmendWiring } from './components/AmendPanel'
import type { Pin } from './lib/amend'
import { AuditPanel } from './components/AuditPanel'
import { EQUIPMENT_TIERS, type EquipmentTier } from './lib/equipment'
import type { PainSelection, Side } from './lib/injury'
import { STRUCTURES, structureBadges, type Structure } from './lib/structure'
import type { ClientInput, DataBundle } from './types'

export type View = 'simple' | 'detailed'

/** Client state lives in the query string so a given program is a linkable regression case. */
function painsFromUrl(q: URLSearchParams): PainSelection | null {
  const raw = q.get('pains')
  if (raw === null) return null
  // pains=SHOULDER:Left,LOWBACK:Both
  return Object.fromEntries(
    raw
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [id, side] = entry.split(':')
        return [id, (side as Side) || 'Both']
      }),
  ) as PainSelection
}

/** inbody=smm:30.1,pbf:26.4,… or inbody=example for the spec's worked client */
function inbodyFromUrl(q: URLSearchParams): InBodyInput | null {
  const raw = q.get('inbody')
  if (raw === null) return null
  if (raw === 'example') return WORKED_EXAMPLE
  return Object.fromEntries(
    raw
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [k, v] = entry.split(':')
        return [k, Number(v)]
      }),
  ) as InBodyInput
}

/**
 * vald=Q-KD:25:L:400:380 — asymmetry %, weak side, left newtons, right newtons, per test
 * code. All four are independent and optional, so any field can be left empty:
 * `Q-KD:::400:380` is forces only, `Q-KD:25:L` is the original two-field form.
 */
function valdFromUrl(q: URLSearchParams): ValdInput | null {
  const raw = q.get('vald')
  if (raw === null) return null
  const maybe = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v))
  return Object.fromEntries(
    raw
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [code, pct, side, leftN, rightN] = entry.split(':')
        return [
          code,
          {
            asymmetry: maybe(pct),
            weakSide: side === 'R' ? 'Right' : side === 'L' ? 'Left' : undefined,
            leftN: maybe(leftN),
            rightN: maybe(rightN),
          },
        ]
      }),
  ) as ValdInput
}

/** bodydot=S05:52,F05:-4:L — reading and, on a lateral indicator, the side it was found on */
function bodydotFromUrl(q: URLSearchParams): BodyDotInput | null {
  const raw = q.get('bodydot')
  if (raw === null) return null
  return Object.fromEntries(
    raw
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [code, value, side] = entry.split(':')
        return [code, { value: Number(value), side: side === 'R' ? 'Right' : side === 'L' ? 'Left' : undefined }]
      }),
  ) as BodyDotInput
}

/** pins=0|Extension|0;123;124;;client;1;1755300000000 — one pin per comma-separated entry */
function pinsFromUrl(q: URLSearchParams): Pin[] | null {
  const raw = q.get('pins')
  if (raw === null) return null
  return raw
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [slotId, from, to, equipment, actor, accepted, timestamp] = entry.split(';')
      return {
        slotId,
        from: Number(from),
        to: Number(to),
        equipment: equipment || undefined,
        actor: actor || 'client',
        timestamp: new Date(Number(timestamp) || 0).toISOString(),
        ...(accepted === '1' ? { accepted: true } : accepted === '0' ? { accepted: false } : {}),
      } as Pin
    })
}

function inputFromUrl(): ClientInput {
  const q = new URLSearchParams(window.location.search)
  const presetName = q.get('preset')
  if (presetName) {
    const p = PRESETS.find((x) => x.name.toLowerCase() === presetName.toLowerCase())
    // a preset fixes the client, but pains layer on top of it
    if (p)
      return {
        ...p.input,
        pains: painsFromUrl(q) ?? p.input.pains,
        inbody: inbodyFromUrl(q) ?? p.input.inbody,
        vald: valdFromUrl(q) ?? p.input.vald,
        bodydot: bodydotFromUrl(q) ?? p.input.bodydot,
        pins: pinsFromUrl(q) ?? p.input.pins,
        structure: STRUCTURES.includes(q.get('structure') as Structure)
          ? (q.get('structure') as Structure)
          : p.input.structure,
      }
  }
  const base = PRESETS[0].input
  return {
    sex: (q.get('sex') as ClientInput['sex']) ?? base.sex,
    age: Number(q.get('age')) || base.age,
    level: q.get('level') ?? base.level,
    goal: q.get('goal') ?? base.goal,
    days: Number(q.get('days')) || base.days,
    split: q.get('split') ?? base.split,
    equipment: EQUIPMENT_TIERS.includes(q.get('equipment') as EquipmentTier)
      ? (q.get('equipment') as EquipmentTier)
      : base.equipment,
    pains: painsFromUrl(q) ?? base.pains,
    inbody: inbodyFromUrl(q) ?? base.inbody,
    vald: valdFromUrl(q) ?? base.vald,
    bodydot: bodydotFromUrl(q) ?? base.bodydot,
    pins: pinsFromUrl(q) ?? base.pins,
    structure: STRUCTURES.includes(q.get('structure') as Structure)
      ? (q.get('structure') as Structure)
      : base.structure,
  }
}

export default function App() {
  const [data, setData] = useState<DataBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [input, setInput] = useState<ClientInput>(inputFromUrl)
  const [view, setView] = useState<View>(
    new URLSearchParams(window.location.search).get('view') === 'detailed' ? 'detailed' : 'simple',
  )

  useEffect(() => {
    loadData()
      .then(setData)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(
      Object.entries(input)
        .filter(([k]) => k !== 'pains' && k !== 'inbody' && k !== 'vald' && k !== 'bodydot' && k !== 'pins')
        .map(([k, v]) => [k, String(v)]) as [string, string][],
    )
    const pains = Object.entries(input.pains)
    if (pains.length) q.set('pains', pains.map(([id, side]) => `${id}:${side}`).join(','))
    if (hasAnyInput(input.inbody))
      q.set(
        'inbody',
        Object.entries(input.inbody)
          .map(([k, v]) => `${k}:${v}`)
          .join(','),
      )
    if (hasAnyReading(input.vald))
      q.set(
        'vald',
        Object.entries(input.vald)
          .map(([code, r]) =>
            [code, r.asymmetry ?? '', r.weakSide?.[0] ?? '', r.leftN ?? '', r.rightN ?? '']
              .join(':')
              .replace(/:+$/, ''),
          )
          .join(','),
      )
    if (hasAnyBodyDot(input.bodydot))
      q.set(
        'bodydot',
        Object.entries(input.bodydot)
          .map(([code, r]) => `${code}:${r.value}${r.side ? `:${r.side[0]}` : ''}`)
          .join(','),
      )
    if (input.pins.length)
      q.set(
        'pins',
        input.pins
          .map((p) =>
            [
              p.slotId,
              p.from,
              p.to,
              p.equipment ?? '',
              p.actor,
              p.accepted === true ? '1' : p.accepted === false ? '0' : '',
              Date.parse(p.timestamp) || 0,
            ].join(';'),
          )
          .join(','),
      )
    q.set('view', view)
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [input, view])

  const bracket = useMemo(
    () => (data ? ageBracket(input.age, data.config.ages) : ''),
    [data, input.age],
  )

  const result = useMemo(() => (data ? generate(data, input) : null), [data, input])

  const audit = useMemo(
    () =>
      data && result?.ok ? buildAudit(result.program, data.exercises, input.sex, data.config) : null,
    [data, result, input.sex],
  )

  // What each structure would cost this client, so the change can be previewed before it
  // is committed to. Volume is held, so a slower structure simply takes longer.
  const structureInfo = useMemo(() => {
    if (!data) return null
    const badges = structureBadges(data.structure, {
      goal: input.goal,
      ageBracket: bracket,
      level: input.level,
    })
    const options = STRUCTURES.map((s) => {
      const r = generate(data, { ...input, structure: s })
      const minutes = r.ok
        ? r.program.days.reduce((sum, d) => sum + d.minutes, 0) / r.program.days.length
        : 0
      return { structure: s, badge: badges.badges[s], minutes }
    })
    return { options, note: badges.trisetDowngraded ? badges.downgradeReason : '' }
  }, [data, input, bracket])

  // pains / inbody / vald are objects, so they need comparing by value, not identity.
  const OBJECT_FIELDS: (keyof ClientInput)[] = ['pains', 'inbody', 'vald', 'bodydot', 'pins']
  const objectKey = (p: ClientInput) =>
    OBJECT_FIELDS.map((f) => JSON.stringify(Object.entries(p[f] ?? {}).sort())).join('|')
  const activePreset =
    PRESETS.find(
      (p) =>
        (Object.keys(p.input) as (keyof ClientInput)[])
          .filter((k) => !OBJECT_FIELDS.includes(k))
          .every((k) => p.input[k] === input[k]) && objectKey(p.input) === objectKey(input),
    )?.name ?? null

  if (loadError) {
    return (
      <div className="p-8">
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load data.</strong> {loadError}
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-sm text-slate-500">Loading the program library…</div>
  }

  const hasPains = Object.keys(input.pains).length > 0

  // An amend is a pin: it re-runs the generator holding the choice rather than editing the
  // output, so a re-test or a new scan cannot silently discard it.
  const amendWiring: AmendWiring | undefined = result?.ok
    ? {
        data: data.amend,
        exercises: data.exercises,
        pins: input.pins,
        setPins: (pins) => setInput({ ...input, pins }),
        ageBracket: bracket,
        equipment: input.equipment,
        verdictOf: (id) => result.program.verdicts.get(id)?.verdict ?? 'OK',
        actor: 'client',
      }
    : undefined

  const programOrError = result?.ok ? (
    <ProgramPanel
      program={result.program}
      input={input}
      view={view}
      injury={data.injury}
      amend={amendWiring}
    />
  ) : (
    <div className="rounded border-2 border-red-300 bg-red-50 px-4 py-3">
      <div className="text-sm font-bold text-red-900">Cannot generate a program</div>
      <div className="mt-1 text-sm text-red-800">{result?.error}</div>
    </div>
  )

  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-base font-bold text-slate-900">UDRA Training Program Generator</h1>
        <div className="flex items-center gap-1 rounded border border-slate-300 p-0.5">
          {(['simple', 'detailed'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2.5 py-1 text-xs font-semibold capitalize transition ${
                view === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {v} view
            </button>
          ))}
        </div>
      </header>

      {view === 'simple' ? (
        // Simple view: client controls run horizontally across the top, program in day
        // sections underneath.
        <div className="mx-auto max-w-7xl space-y-4 p-4">
          <ClientPanel
            input={input}
            setInput={setInput}
            config={data.config}
            splits={data.splits}
            ageBracket={bracket}
            activePreset={activePreset}
            layout="bar"
            structureOptions={structureInfo?.options ?? []}
            structureNote={structureInfo?.note ?? ''}
            effectiveGoal={result?.ok ? result.program.inbody.dominantGoal || undefined : undefined}
          />
          {result?.ok && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <InBodyPanel
                data={data.inbody}
                input={input.inbody}
                setInput={(inbody) => setInput({ ...input, inbody })}
                result={result.program.inbody}
                compact
              />
            </div>
          )}
          {result?.ok && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <ValdPanel
                data={data.vald}
                input={input.vald}
                setInput={(vald) => setInput({ ...input, vald })}
                result={result.program.vald}
                compact
              />
              <div className="mt-3 border-t border-slate-200 pt-3">
                <LoadPanel data={data.load} result={result.program.load} compact />
              </div>
            </div>
          )}
          {result?.ok && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <BodyDotPanel
                data={data.bodydot}
                input={input.bodydot}
                setInput={(bodydot) => setInput({ ...input, bodydot })}
                result={result.program.bodydot}
                compact
              />
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <PainPanel
              injury={data.injury}
              pains={input.pains}
              setPains={(pains) => setInput({ ...input, pains })}
              compact
            />
          </div>
          {result?.ok && amendWiring && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <PinsPanel program={result.program} wiring={amendWiring} />
            </div>
          )}
          {hasPains && <MedicalDisclaimer injury={data.injury} />}
          {programOrError}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[16rem_minmax(0,1fr)_24rem]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
              <ClientPanel
                input={input}
                setInput={setInput}
                config={data.config}
                splits={data.splits}
                    ageBracket={bracket}
                activePreset={activePreset}
                structureOptions={structureInfo?.options ?? []}
                structureNote={structureInfo?.note ?? ''}
                effectiveGoal={result?.ok ? result.program.inbody.dominantGoal || undefined : undefined}
              />
              {result?.ok && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <InBodyPanel
                    data={data.inbody}
                    input={input.inbody}
                    setInput={(inbody) => setInput({ ...input, inbody })}
                    result={result.program.inbody}
                  />
                </div>
              )}
              {result?.ok && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <ValdPanel
                    data={data.vald}
                    input={input.vald}
                    setInput={(vald) => setInput({ ...input, vald })}
                    result={result.program.vald}
                  />
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <LoadPanel data={data.load} result={result.program.load} />
                  </div>
                </div>
              )}
              {result?.ok && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <BodyDotPanel
                    data={data.bodydot}
                    input={input.bodydot}
                    setInput={(bodydot) => setInput({ ...input, bodydot })}
                    result={result.program.bodydot}
                  />
                </div>
              )}
              <div className="mt-4 border-t border-slate-200 pt-3">
                <PainPanel
                  injury={data.injury}
                  pains={input.pains}
                  setPains={(pains) => setInput({ ...input, pains })}
                />
              </div>
              {result?.ok && amendWiring && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <PinsPanel program={result.program} wiring={amendWiring} />
                </div>
              )}
            </div>
          </aside>

          <main className="space-y-4">
            {hasPains && <MedicalDisclaimer injury={data.injury} />}
            {programOrError}
          </main>

          <aside className="lg:sticky lg:top-4 lg:self-start">
            {audit && result?.ok ? (
              <AuditPanel
                audit={audit}
                config={data.config}
                sex={input.sex}
                rounding={roundSets(result.program)}
              />
            ) : (
              <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-500">
                No audit — no program generated.
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
