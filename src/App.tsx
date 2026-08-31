import { useEffect, useMemo, useState } from 'react'
import { loadData } from './data/load'
import { ageBracket, generate } from './lib/generate'
import { buildAudit } from './lib/audit'
import { roundSets } from './lib/rounding'
import { completeClient, defaultDraft, missingFrom } from './lib/draft'
import { ClientPanel } from './components/ClientPanel'
import { StructurePicker } from './components/StructurePicker'
import { QuickTest } from './components/QuickTest'
import { ProgramPanel, type CapWiring } from './components/ProgramPanel'
import { MedicalDisclaimer, PainPanel } from './components/PainPanel'
import { TestStrip } from './components/TestStrip'
import { WORKED_EXAMPLE, hasAnyInput, type InBodyInput } from './lib/inbody'
import { hasAnyReading, type ValdInput } from './lib/vald'
import { hasAnyBodyDot, type BodyDotInput } from './lib/bodydot'
import { PinsPanel, type AmendWiring } from './components/AmendPanel'
import type { Pin } from './lib/amend'
import type { CapPin } from './lib/timecap'
import { AuditPanel } from './components/AuditPanel'
import { EQUIPMENT_TIERS, type EquipmentTier } from './lib/equipment'
import type { PainSelection, Side } from './lib/injury'
import { STRUCTURES, structureBadges, type Structure } from './lib/structure'
import { ABS_PLACEMENTS, type AbsPlacement } from './lib/abs'
import { Button, Card, Logo, Note, Pill, SectionTitle } from './components/ui'
import type { ClientDraft, DataBundle } from './types'

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

/** caps=0;client;1755300000000,2;client;1755300000000 — one pressed day per entry */
function capsFromUrl(q: URLSearchParams): CapPin[] | null {
  const raw = q.get('caps')
  if (raw === null) return null
  return raw
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [dayIndex, actor, timestamp] = entry.split(';')
      return {
        dayIndex: Number(dayIndex),
        actor: actor || 'client',
        timestamp: new Date(Number(timestamp) || 0).toISOString(),
      }
    })
}

/**
 * The client the URL describes, over the one the form opens on. Anything the query string does
 * not carry keeps its default, so a link that names only a goal is still a whole client.
 */
function draftFromUrl(): ClientDraft {
  const q = new URLSearchParams(window.location.search)
  const base = defaultDraft()
  const text = (k: string) => q.get(k) || null
  const number = (k: string) => Number(q.get(k)) || null
  const sex = q.get('sex')
  return {
    sex: sex === 'Male' || sex === 'Female' ? sex : base.sex,
    age: number('age') ?? base.age,
    level: text('level') ?? base.level,
    goal: text('goal') ?? base.goal,
    days: number('days') ?? base.days,
    split: text('split') ?? base.split,
    equipment: EQUIPMENT_TIERS.includes(q.get('equipment') as EquipmentTier)
      ? (q.get('equipment') as EquipmentTier)
      : base.equipment,
    pains: painsFromUrl(q) ?? base.pains,
    inbody: inbodyFromUrl(q) ?? base.inbody,
    vald: valdFromUrl(q) ?? base.vald,
    bodydot: bodydotFromUrl(q) ?? base.bodydot,
    pins: pinsFromUrl(q) ?? base.pins,
    caps: capsFromUrl(q) ?? base.caps,
    structure: STRUCTURES.includes(q.get('structure') as Structure)
      ? (q.get('structure') as Structure)
      : base.structure,
    absPlacement: ABS_PLACEMENTS.includes(q.get('absPlacement') as AbsPlacement)
      ? (q.get('absPlacement') as AbsPlacement)
      : base.absPlacement,
  }
}

/**
 * Two phases, in the order the work actually happens: set the client up, generate, then
 * attach test results to a program that already exists. A link that already carries a whole
 * client opens on the program, so a shared URL lands where it is useful; a partial one opens
 * on the form with what it did carry already filled in.
 */
type Phase = 'setup' | 'program'

export default function App() {
  const [data, setData] = useState<DataBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ClientDraft>(draftFromUrl)
  // A bare URL always opens on the form, even though the form already holds a whole client:
  // the default is a starting point to change, not a program somebody asked for.
  const [phase, setPhase] = useState<Phase>(() =>
    window.location.search.length > 1 && completeClient(draftFromUrl()) ? 'program' : 'setup',
  )

  // Nothing downstream ever sees a half-filled client: this is the only way through.
  const client = useMemo(() => completeClient(draft), [draft])

  useEffect(() => {
    loadData()
      .then(setData)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(
      Object.entries(draft)
        .filter(
          ([k, v]) =>
            // An unanswered field is left out of the URL entirely. Writing `age=null` would
            // make a half-filled form share as a client with a nonsense age.
            v !== null &&
            k !== 'pains' &&
            k !== 'inbody' &&
            k !== 'vald' &&
            k !== 'bodydot' &&
            k !== 'pins' &&
            k !== 'caps',
        )
        .map(([k, v]) => [k, String(v)]) as [string, string][],
    )
    const pains = Object.entries(draft.pains)
    if (pains.length) q.set('pains', pains.map(([id, side]) => `${id}:${side}`).join(','))
    if (hasAnyInput(draft.inbody))
      q.set(
        'inbody',
        Object.entries(draft.inbody)
          .map(([k, v]) => `${k}:${v}`)
          .join(','),
      )
    if (hasAnyReading(draft.vald))
      q.set(
        'vald',
        Object.entries(draft.vald)
          .map(([code, r]) =>
            [code, r.asymmetry ?? '', r.weakSide?.[0] ?? '', r.leftN ?? '', r.rightN ?? '']
              .join(':')
              .replace(/:+$/, ''),
          )
          .join(','),
      )
    if (hasAnyBodyDot(draft.bodydot))
      q.set(
        'bodydot',
        Object.entries(draft.bodydot)
          .map(([code, r]) => `${code}:${r.value}${r.side ? `:${r.side[0]}` : ''}`)
          .join(','),
      )
    if (draft.pins.length)
      q.set(
        'pins',
        draft.pins
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
    if (draft.caps.length)
      q.set(
        'caps',
        draft.caps
          .map((c) => [c.dayIndex, c.actor, Date.parse(c.timestamp) || 0].join(';'))
          .join(','),
      )
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [draft])

  const bracket = useMemo(
    () => (data && draft.age !== null ? ageBracket(draft.age, data.config.ages) : ''),
    [data, draft.age],
  )

  const result = useMemo(() => (data && client ? generate(data, client) : null), [data, client])

  const audit = useMemo(
    () =>
      data && client && result?.ok
        ? buildAudit(result.program, data.exercises, client.sex, data.config)
        : null,
    [data, client, result],
  )

  // What each structure would cost this client, so the change can be previewed before it
  // is committed to. Volume is held, so a slower structure simply takes longer.
  const structureInfo = useMemo(() => {
    if (!data || !client) return null
    const badges = structureBadges(data.structure, {
      goal: client.goal,
      ageBracket: bracket,
      level: client.level,
    })
    const options = STRUCTURES.map((s) => {
      // Without `caps`, deliberately. Every capped day reads 60 min whatever the structure,
      // so leaving them in would flatten the very comparison this preview exists to make —
      // and it would re-run the time-cap search three more times on every keystroke.
      const r = generate(data, { ...client, structure: s, caps: [] })
      const minutes = r.ok
        ? r.program.days.reduce((sum, d) => sum + d.wholeSetMinutes, 0) / r.program.days.length
        : 0
      return { structure: s, badge: badges.badges[s], minutes }
    })
    return { options, note: badges.trisetDowngraded ? badges.downgradeReason : '' }
  }, [data, client, bracket])

  if (loadError) {
    return (
      <Shell>
        <Card className="p-6">
          <Note tone="flame" title="Could not load the program library">
            {loadError}
          </Note>
        </Card>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell>
        <p className="text-sm text-udra-ink-500">Loading the program library…</p>
      </Shell>
    )
  }

  // One press fills in a whole client — details, pains, and whichever machines are ticked.
  const quickTest = (
    <QuickTest
      data={data}
      onGenerate={(sample) => {
        setDraft(sample)
        setPhase('program')
      }}
    />
  )

  const hasPains = Object.keys(draft.pains).length > 0

  // Named, not counted. "2 pains reported" says a filter ran; it does not say which library
  // was cut, and that is the one thing about the program the summary cannot leave implicit.
  const reportedPains = Object.entries(draft.pains).map(([id, side]) => {
    const pain = data.injury.pains.find((p) => p.id === id)
    const label = pain?.label ?? id
    return pain?.sided && side !== 'Both' ? `${label} (${side.toLowerCase()})` : label
  })

  // An amend is a pin: it re-runs the generator holding the choice rather than editing the
  // output, so a re-test or a new scan cannot silently discard it.
  const amendWiring: AmendWiring | undefined = result?.ok
    ? {
        data: data.amend,
        exercises: data.exercises,
        pins: draft.pins,
        setPins: (pins) => setDraft({ ...draft, pins }),
        ageBracket: bracket,
        equipment: draft.equipment,
        verdictOf: (id) => result.program.verdicts.get(id)?.verdict ?? 'OK',
        actor: 'client',
      }
    : undefined

  const capWiring: CapWiring = {
    caps: draft.caps,
    setCaps: (caps) => setDraft({ ...draft, caps }),
    actor: 'client',
  }

  // ---- phase 1: set the client up ------------------------------------------
  // Also the landing state: with nothing filled in there is no client, so there is nothing a
  // program could be built from and no page two to be on.
  if (phase === 'setup' || !client) {
    const missing = missingFrom(draft)
    return (
      <Shell action={quickTest}>
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="pt-2 pb-1">
            <h1 className="text-2xl font-extrabold tracking-tight">Build a training program</h1>
            <p className="mt-1 text-sm text-udra-ink-500">
              Start with who the client is and anything that hurts. Test results — VALD, InBody,
              BodyDot — are attached afterwards, to a program that already exists.
            </p>
          </div>

          <Card className="p-5">
            <ClientPanel
              draft={draft}
              setDraft={setDraft}
              config={data.config}
              splits={data.splits}
              ageBracket={bracket}
              effectiveGoal={result?.ok ? result.program.inbody.dominantGoal || undefined : undefined}
            />
          </Card>

          <Card className="p-5">
            <SectionTitle hint="Anything reported here is filtered out of the whole library before a single exercise is chosen. Nothing that would load a painful area survives it.">
              Pain or injury
            </SectionTitle>
            <div className="mt-3">
              <PainPanel
                injury={data.injury}
                pains={draft.pains}
                setPains={(pains) => setDraft({ ...draft, pains })}
                compact
                showTitle={false}
              />
            </div>
          </Card>

          {hasPains && <MedicalDisclaimer injury={data.injury} />}

          {result && !result.ok && (
            <Note tone="flame" title="No program exists for this combination">
              {result.error}
            </Note>
          )}

          {/* What is missing is named, not counted: a disabled button that does not say why
              reads as broken, and "4 fields remaining" does not say which four. */}
          <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-3">
            {missing.length > 0 && (
              <span className="rounded-xl bg-udra-linen-200 px-3 py-2 text-sm text-udra-ink-700">
                Still needed: {missing.join(', ')}
              </span>
            )}
            <Button
              variant="primary"
              size="lg"
              disabled={!result?.ok}
              onClick={() => setPhase('program')}
              className="shadow-lg"
            >
              Generate program
              <span aria-hidden>→</span>
            </Button>
          </div>
        </div>
      </Shell>
    )
  }

  // ---- phase 2: the program, plus anything measured ------------------------
  return (
    <Shell action={quickTest}>
      <div className="mx-auto max-w-[1600px] space-y-4">
        <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">
              {client.sex}, {client.age}
            </span>
            <span className="text-udra-linen-300">·</span>
            <span className="font-semibold">{client.goal}</span>
            <span className="text-udra-linen-300">·</span>
            <span>{client.level}</span>
            <span className="text-udra-linen-300">·</span>
            <span>
              {client.days} days · {client.split}
            </span>
            {/* No structure pill: the picker further down says which one is running, and
                names it beside the minutes it costs. Twice is once too many. */}
            {reportedPains.map((label) => (
              <Pill key={label} tone="flame" title="Reported as painful — filtered out of the library before anything was chosen">
                {label}
              </Pill>
            ))}
          </div>
          <Button className="ml-auto" onClick={() => setPhase('setup')}>
            Edit client
          </Button>
        </Card>

        {result?.ok ? (
          <>
            <TestStrip
              data={data}
              input={client}
              setInput={setDraft}
              program={result.program}
            />

            {hasPains && <MedicalDisclaimer injury={data.injury} />}

            {amendWiring && (result.program.amend.active || client.pins.length > 0) && (
              <Card className="p-4">
                <PinsPanel program={result.program} wiring={amendWiring} />
              </Card>
            )}

            {/* Beside the program, not in the client's details: it changes no exercise and no
                set, only how long a session takes, so the thing to judge it against is the day
                cards directly underneath. */}
            <Card className="p-4">
              <StructurePicker
                input={client}
                setInput={setDraft}
                options={structureInfo?.options ?? []}
                note={structureInfo?.note ?? ''}
              />
            </Card>

            <ProgramPanel
              program={result.program}
              input={client}
              injury={data.injury}
              amend={amendWiring}
              cap={capWiring}
            />

            {/* One view means one view. What used to be the detailed view is engineering
                output — kept, because it is how the program is checked, but folded away so
                it is not the first thing anyone reads. */}
            <details className="rounded-2xl border border-udra-linen-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
                Technical detail
                <span className="ml-2 font-normal text-udra-ink-500">
                  volume audit, fallback events, allocation key
                </span>
              </summary>
              <div className="border-t border-udra-linen-200 p-4">
                {audit && (
                  <AuditPanel
                    audit={audit}
                    config={data.config}
                    sex={client.sex}
                    rounding={roundSets(result.program)}
                  />
                )}
                <div className="mt-3 font-mono text-[11px] text-udra-ink-500">
                  {result.program.key}
                </div>
              </div>
            </details>
          </>
        ) : (
          <Note tone="flame" title="Cannot generate a program">
            {result?.error}
          </Note>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-udra-linen-200 bg-udra-linen/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
          <Logo className="h-8" />
          <span className="hidden text-sm font-semibold text-udra-ink-500 sm:inline">
            Program Generator
          </span>
          {action && <div className="ml-auto">{action}</div>}
        </div>
      </header>
      <main className="p-4 pb-16">{children}</main>
    </div>
  )
}
