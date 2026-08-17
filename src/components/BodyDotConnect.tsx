import { useEffect, useMemo, useState } from 'react'
import type { BodyDotData } from '../types'
import type { BodyDotInput } from '../lib/bodydot'
import {
  BODYDOT_ORGS,
  getSession,
  latestPerDay,
  listClients,
  listSessions,
  readSession,
  sessionValidity,
  type BasClient,
  type BasSession,
  type BodyDotImport,
} from '../lib/bodydotApi'
import { Button, Note, Pill, Select, controlClass } from './ui'

/**
 * Pull a client's posture scan instead of typing 26 numbers. Three steps, in the order a
 * trainer thinks in: which gym, which client, which test.
 *
 * Everything imported stays editable in the panel underneath — the readings are a starting
 * point, not a verdict, and a scan with a cancelled step is reported rather than silently
 * treated as a full one.
 */
export function BodyDotConnect({
  data,
  onApply,
}: {
  data: BodyDotData
  onApply: (readings: BodyDotInput, imported: BodyDotImport, client: BasClient, session: BasSession) => void
}) {
  const [orgId, setOrgId] = useState(BODYDOT_ORGS[0].id)
  const [clients, setClients] = useState<BasClient[] | null>(null)
  const [query, setQuery] = useState('')
  const [client, setClient] = useState<BasClient | null>(null)
  const [sessions, setSessions] = useState<BasSession[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A test with nothing analyzed in it is a real state of the data, not a failure to reach
  // the service. Reporting it as a connection error sends someone to check their network.
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setClients(null)
    setClient(null)
    setSessions(null)
    setError(null)
    setBusy('Loading clients…')
    listClients(orgId)
      .then((list) => !cancelled && setClients(list))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setBusy(null))
    return () => {
      cancelled = true
    }
  }, [orgId])

  // 300+ clients is a search box, not a dropdown.
  const matches = useMemo(() => {
    if (!clients) return []
    const q = query.trim().toLowerCase()
    if (!q) return clients.slice(0, 8)
    return clients.filter((c) => (c.name || '').toLowerCase().includes(q)).slice(0, 20)
  }, [clients, query])

  const pickClient = async (c: BasClient) => {
    setClient(c)
    setSessions(null)
    setError(null)
    setNotice(null)
    setBusy('Loading tests…')
    try {
      // Several sessions on one day means a failed attempt and its redo; keep the latest.
      setSessions(latestPerDay(await listSessions(c.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const pickSession = async (s: BasSession) => {
    if (!client) return
    setError(null)
    setNotice(null)
    setBusy('Reading the scan…')
    try {
      const full = await getSession(client.id, s.id)
      const imported = readSession(full, data)
      if (imported.indicators.length === 0) {
        setNotice(
          'Every step in that test was cancelled or failed, so it carries no measurements. Pick another date.',
        )
        return
      }
      onApply(imported.readings, imported, client, full)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold tracking-[0.08em] text-udra-ink-500 uppercase">
            Gym
          </span>
          <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {BODYDOT_ORGS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold tracking-[0.08em] text-udra-ink-500 uppercase">
            Client{clients && ` (${clients.length})`}
          </span>
          <input
            className={controlClass}
            placeholder="Search by name…"
            value={client ? client.name : query}
            onChange={(e) => {
              setClient(null)
              setSessions(null)
              setQuery(e.target.value)
            }}
          />
        </label>
      </div>

      {busy && <div className="text-[12px] text-udra-ink-500">{busy}</div>}
      {error && <Note tone="flame" title="Bodydot could not be reached">{error}</Note>}
      {notice && <Note tone="neon" title="Nothing to import from that test">{notice}</Note>}

      {!client && clients && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c.id}
              onClick={() => void pickClient(c)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-udra-linen-300 px-3 py-2 text-left text-sm transition hover:border-udra-blue"
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-[11px] text-udra-ink-500">
                {c.gender ?? ''} {c.birthDate ?? ''}
              </span>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="text-[12px] text-udra-ink-500">No client matches that name.</div>
          )}
          {!query && clients.length > matches.length && (
            <div className="text-[12px] text-udra-ink-500">
              Showing {matches.length} of {clients.length} — type to search.
            </div>
          )}
        </div>
      )}

      {client && sessions && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold">
              {sessions.length} test{sessions.length === 1 ? '' : 's'} for {client.name}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { setClient(null); setSessions(null) }}>
              Change client
            </Button>
          </div>
          {sessions.length === 0 && (
            <div className="text-[12px] text-udra-ink-500">
              This client has no posture tests on record.
            </div>
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {sessions.map((s) => {
              // The summary carries step results too, so validity shows before the fetch.
              const v = sessionValidity(s)
              return (
                <button
                  key={s.id}
                  onClick={() => void pickSession(s)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-udra-linen-300 px-3 py-2 text-left text-sm transition hover:border-udra-blue"
                >
                  <span className="tnum font-semibold">{s.createdAt.slice(0, 10)}</span>
                  {v.total > 0 && (
                    <span className="flex items-center gap-2 text-[11px]">
                      <span className="text-udra-ink-500">
                        {v.analyzed} of {v.total} steps analyzed
                      </span>
                      {!v.valid && <Pill tone="flame">incomplete</Pill>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
