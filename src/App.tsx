import { useEffect, useMemo, useState } from 'react'
import { loadData } from './data/load'
import { ageBracket, generate } from './lib/generate'
import { buildAudit } from './lib/audit'
import { PRESETS } from './lib/presets'
import { ClientPanel } from './components/ClientPanel'
import { ProgramPanel } from './components/ProgramPanel'
import { AuditPanel } from './components/AuditPanel'
import { EQUIPMENT_TIERS, type EquipmentTier } from './lib/equipment'
import type { ClientInput, DataBundle } from './types'

export type View = 'simple' | 'detailed'

/** Client state lives in the query string so a given program is a linkable regression case. */
function inputFromUrl(): ClientInput {
  const q = new URLSearchParams(window.location.search)
  const presetName = q.get('preset')
  if (presetName) {
    const p = PRESETS.find((x) => x.name.toLowerCase() === presetName.toLowerCase())
    if (p) return p.input
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
      Object.entries(input).map(([k, v]) => [k, String(v)]) as [string, string][],
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

  const activePreset =
    PRESETS.find((p) => (Object.keys(p.input) as (keyof ClientInput)[]).every((k) => p.input[k] === input[k]))
      ?.name ?? null

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
    return <div className="p-8 text-sm text-slate-500">Loading data (allocation.json is ~3 MB)…</div>
  }

  const programOrError = result?.ok ? (
    <ProgramPanel program={result.program} input={input} view={view} />
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
            exercises={data.exercises}
            ageBracket={bracket}
            activePreset={activePreset}
            layout="bar"
          />
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
                exercises={data.exercises}
                ageBracket={bracket}
                activePreset={activePreset}
              />
            </div>
          </aside>

          <main>{programOrError}</main>

          <aside className="lg:sticky lg:top-4 lg:self-start">
            {audit && result?.ok ? (
              <AuditPanel audit={audit} config={data.config} sex={input.sex} />
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
