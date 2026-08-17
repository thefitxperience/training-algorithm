import type { BodyDotBand, BodyDotData } from '../types'
import { classify, realBands, type BodySide, type BodyDotInput, type Tier } from './bodydot'

/**
 * Bodydot API Service (BAS) — reading a client's posture scan instead of typing 26 numbers.
 *
 * Requests go through the same Cloudflare CORS proxy the VALD-automator front end uses; BAS
 * itself sends no CORS headers, so a browser cannot call it directly. The proxy returns
 * `Access-Control-Allow-Origin: *` and passes the rate-limit headers through.
 *
 * The OAuth credential below is a Basic base64 of the Bodydot client id and secret. It is
 * NOT a secret this app is leaking: it already ships in Bodydot's own public web bundle and
 * in the VALD-automator bundle, which is why a static site can use it at all. It is read
 * from the environment first so it can be rotated without a code change.
 */

const WORKER = 'https://bdot-proxy.andyayas27.workers.dev'
// `import.meta.env` only exists under Vite. Guarded so this module can also be imported by
// the acceptance suite under plain Node, which is where the indicator map gets checked.
const env: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {}

export const BAS_API = env.VITE_BODYDOT_API || `${WORKER}/v1`
const BAS_CREDS =
  env.VITE_BODYDOT_CREDS ||
  'YmRvdF94NjI2cmg1N2VzYnh0N2pqdTZidTpmOTBkYzg5N2U3NTk2MGY0OTk1OGI5YTIwZTE2ZDg4ODI1MzBkNGI0MGVmY2VkZjYzYmU5ZTFlNjc5MjdlMGVk'

export interface BodyDotOrg {
  id: string
  name: string
}

export const BODYDOT_ORGS: BodyDotOrg[] = [
  { id: '1627c00e-e275-4356-91ae-6f85127bd21c', name: 'Body Masters — Al Aarid' },
  { id: 'bf9ffaec-d3ed-4742-bce9-945f619ea1bc', name: 'Body Motions — Al Sahafa' },
  { id: 'ebce917d-1c31-4516-8396-64283b4cbeaa', name: 'Body Coach' },
]

export interface BasClient {
  id: string
  organizationId: string
  name: string
  gender?: string
  birthDate?: string
}

export interface BasStepResult {
  stepCode: string
  status: string
  data?: { values?: { valueCode: string; value: number }[] }
}

export interface BasSession {
  id: string
  createdAt: string
  sequences?: { code: string; stepResults?: BasStepResult[] }[]
}

// ---- transport -------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * BAS rate-limits at 120 requests per window and answers 429 with `Retry-After`. Firing one
 * request per visible row trips it immediately, so requests are capped and retried rather
 * than dropped — a dropped request here reads as "this client has no tests", which is the
 * worst possible way to be wrong.
 */
const MAX_CONCURRENT = 4
let active = 0
const waiting: (() => void)[] = []
const acquire = () =>
  active < MAX_CONCURRENT
    ? ((active += 1), Promise.resolve())
    : new Promise<void>((res) => waiting.push(res))
const release = () => {
  active -= 1
  const next = waiting.shift()
  if (next) {
    active += 1
    next()
  }
}

async function fetchRetry(url: string, opts: RequestInit, tries = 5): Promise<Response> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    let resp: Response
    try {
      resp = await fetch(url, opts)
    } catch (e) {
      last = e
      await sleep(Math.min(2 ** i, 8) * 1000)
      continue
    }
    if (resp.status === 429 || resp.status >= 500) {
      const ra = Number(resp.headers.get('Retry-After'))
      await sleep((Number.isFinite(ra) && ra > 0 ? ra : Math.min(2 ** i, 8)) * 1000 + Math.random() * 300)
      last = new Error(`HTTP ${resp.status}`)
      continue
    }
    return resp
  }
  throw last instanceof Error ? last : new Error('The Bodydot service did not respond.')
}

let token: string | null = null
let tokenExpiry = 0
let tokenPromise: Promise<string> | null = null

async function getToken(): Promise<string> {
  if (token && Date.now() < tokenExpiry - 60_000) return token
  // Concurrent callers share one token request — a stampede is itself a way to hit the 429.
  if (tokenPromise) return tokenPromise
  tokenPromise = (async () => {
    try {
      const resp = await fetchRetry(`${BAS_API}/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${BAS_CREDS}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
      if (!resp.ok) throw new Error(`Bodydot sign-in failed (HTTP ${resp.status}).`)
      const data = (await resp.json()) as { access_token: string; expires_in: number }
      token = data.access_token
      tokenExpiry = Date.now() + data.expires_in * 1000
      return token
    } finally {
      tokenPromise = null
    }
  })()
  return tokenPromise
}

async function basGet<T>(path: string): Promise<T> {
  await acquire()
  try {
    const resp = await fetchRetry(`${BAS_API}${path}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    })
    if (resp.status === 401) {
      token = null // expired or revoked — one clean retry with a fresh token
      const retry = await fetchRetry(`${BAS_API}${path}`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
      })
      if (!retry.ok) throw new Error(`Bodydot request failed (HTTP ${retry.status}).`)
      return (await retry.json()) as T
    }
    if (!resp.ok) throw new Error(`Bodydot request failed (HTTP ${resp.status}).`)
    return (await resp.json()) as T
  } finally {
    release()
  }
}

const listOf = <T>(data: unknown): T[] =>
  Array.isArray(data) ? (data as T[]) : (((data as { data?: T[] })?.data ?? []) as T[])

export async function listClients(orgId: string): Promise<BasClient[]> {
  const clients = listOf<BasClient>(await basGet(`/clients?organizationId=${encodeURIComponent(orgId)}`))
  return clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

export async function listSessions(clientId: string): Promise<BasSession[]> {
  const list = listOf<BasSession>(await basGet(`/clients/${clientId}/measurement-sessions`))
  return list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0))
}

export async function getSession(clientId: string, sessionId: string): Promise<BasSession> {
  return basGet<BasSession>(`/clients/${clientId}/measurement-sessions/${sessionId}`)
}

// ---- validity --------------------------------------------------------------

/**
 * The MAJORITY rule, as the report generator applies it: a session is valid when its
 * Analyzed step-results outnumber the rest. Only `Analyzed` carries measurements at all —
 * Captured, Pending, Error, Canceled and Deleted are empty.
 */
export function sessionValidity(session: BasSession) {
  let analyzed = 0
  let total = 0
  for (const seq of session.sequences ?? [])
    for (const step of seq.stepResults ?? []) {
      total += 1
      if (step.status === 'Analyzed') analyzed += 1
    }
  return { analyzed, total, valid: analyzed > 0 && analyzed > total - analyzed }
}

/** Several sessions on one day means a failed attempt and its redo; the latest one counts. */
export function latestPerDay(sessions: BasSession[]): BasSession[] {
  const byDay = new Map<string, BasSession>()
  for (const s of sessions) {
    const day = (s.createdAt || '').slice(0, 10)
    if (!day) continue
    const cur = byDay.get(day)
    if (!cur || s.createdAt > cur.createdAt) byDay.set(day, s)
  }
  return [...byDay.values()].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
}

// ---- the indicator map -----------------------------------------------------

/**
 * Where each of the 26 indicators comes from in a session, as `stepCode` + `valueCode`.
 *
 * Read off a real analyzed session rather than copied from the VALD-automator's posture
 * form, which only wires 15 of the 26 — it has no source for the four non-arsenal Kendall
 * angles, T1 pelvic angle, sagittal vertical axis, knee stability, or, more importantly,
 * S07 Anterior Pelvic Tilt, which IS in the arsenal. BAS carries all of them.
 *
 * `left`/`right` mean the scan measures that indicator on each side separately. The Right
 * and Left standing views are two views of one body, but Bodydot reports each view's own
 * figure, and they differ — so both are kept and the worse one is the finding.
 */
/** One reading: which step carries it, and its code inside that step. */
interface Ref {
  step: string
  value: string
}

interface Source {
  /** a single reading, measured once */
  single?: Ref
  /** a reading per side — and the two sides can live in DIFFERENT steps */
  left?: Ref
  right?: Ref
}

const FRONT = (value: string): Ref => ({ step: 'standingFront', value })
const RIGHT = (value: string): Ref => ({ step: 'standingRight', value })
const LEFT = (value: string): Ref => ({ step: 'standingLeft', value })
const SQUAT = (value: string): Ref => ({ step: 'overheadSquatRight', value })
const TOE = (value: string): Ref => ({ step: 'toeTouchingRight', value })

export const INDICATOR_SOURCES: Record<string, Source> = {
  // Standing Front — both sides are measured in the one front view.
  F01: { single: FRONT('headHorizontalAngle') },
  F02: { single: FRONT('shoulderHorizontalAngle') },
  F03: { left: FRONT('leftShoulderSlope'), right: FRONT('rightShoulderSlope') },
  F04: { left: FRONT('leftElbowAngle'), right: FRONT('rightElbowAngle') },
  // Signed: the band runs -2.0 to 2.0, so the sign IS the direction and must survive. The
  // posture form takes an absolute value and puts the side in a separate control; here the
  // signed figure is what gets classified, and the side is read back off the sign.
  F05: { single: FRONT('frontalASISAlignment') },
  F06: { left: FRONT('leftHKAAngle'), right: FRONT('rightHKAAngle') },
  F07: { single: FRONT('coronalBalance') },

  // Sagittal — the Right and Left views are SEPARATE steps, each with its own value codes.
  // Putting both under standingRight silently read the right view twice and left the left
  // view unread, which showed up as every sagittal finding claiming the right side.
  S01: { right: RIGHT('forwardHeadAngle'), left: LEFT('forwardHeadAngleLeft') },
  S02: { right: RIGHT('forwardShoulderAngle'), left: LEFT('forwardShoulderAngleLeft') },
  S03: { right: RIGHT('t1PelvicAngle'), left: LEFT('t1PelvicAngleLeft') },
  S04: { right: RIGHT('sagittalVerticalAxis'), left: LEFT('sagittalVerticalAxisLeft') },
  S05: { right: RIGHT('thoracicKyphosis'), left: LEFT('thoracicKyphosisLeft') },
  S06: { right: RIGHT('lumbarLordosis'), left: LEFT('lumbarLordosisLeft') },
  S07: { right: RIGHT('anteriorPelvicTilt'), left: LEFT('anteriorPelvicTiltLeft') },
  S08: { right: RIGHT('kendallSidePostureKnee'), left: LEFT('kendallSidePostureKneeLeft') },
  S09: { right: RIGHT('kendallSidePostureHip'), left: LEFT('kendallSidePostureHipLeft') },
  S10: { right: RIGHT('kendallSidePostureShoulder'), left: LEFT('kendallSidePostureShoulderLeft') },
  S11: { right: RIGHT('kendallSidePostureEar'), left: LEFT('kendallSidePostureEarLeft') },

  // Overhead Squat and Toe Touch — one camera, one reading each.
  Q01: { single: SQUAT('overheadSquatArmAngle') },
  Q02: { single: SQUAT('overheadSquatTrunkAngle') },
  Q03: { single: SQUAT('overheadSquatKneeDistance') },
  Q04: { single: SQUAT('overheadSquatKneeDepth') },
  Q05: { single: SQUAT('overheadSquatPelvicAngle') },

  T01: { single: TOE('toeTouchKneeAngle') },
  T02: { single: TOE('toeTouchHipAngle') },
  T03: { single: TOE('toeTouchDistance') },
}

/**
 * BAS reports distances in METRES and angles in degrees. Every indicator the data file
 * marks `cm` therefore needs x100 — a rule taken from the unit column rather than a list of
 * codes, so a new distance indicator scales correctly without being remembered here.
 *
 * The evidence: `toeTouchDistance` 0.24 against a -5 to 5 cm band (24 cm — a poor toe
 * touch), `sagittalVerticalAxis` 0.02 (2 cm), `overheadSquatKneeDistance` 0.01 (1 cm). The
 * posture form independently multiplies the toe-touch figure by 100.
 */
export function scaleFor(band: BodyDotBand): number {
  return band.unit === 'cm' ? 100 : 1
}

/**
 * The Left and Right views disagree, and only one number reaches the layer — so the WORSE
 * side is the finding. A screening tool that averaged them could report a shoulder as normal
 * while one side sat outside its band.
 */
const TIER_RANK: Record<Tier, number> = { abnormal: 3, borderline: 2, unbanded: 1, normal: 0 }

export interface ImportedIndicator {
  code: string
  indicator: string
  value: number
  side?: BodySide
  tier: Tier
  /** both sides as measured, when the scan reports each separately */
  bySide?: { left: number; right: number }
}

export interface BodyDotImport {
  readings: BodyDotInput
  indicators: ImportedIndicator[]
  /** indicators this session did not measure, with the step that would have carried them */
  missing: { code: string; indicator: string; step: string }[]
  analyzedSteps: string[]
  validity: ReturnType<typeof sessionValidity>
}

export function readSession(session: BasSession, data: BodyDotData): BodyDotImport {
  // Prefer the `custom` sequence when present, exactly as the posture form does, and
  // normalise the basic assessment's "…Simple" step codes onto the base ones so a
  // basic-only scan fills in rather than coming back empty.
  const sequences = session.sequences ?? []
  const hasCustom = sequences.some((s) => s.code === 'custom')
  const values = new Map<string, number>()
  const analyzedSteps: string[] = []
  for (const seq of sequences) {
    if (hasCustom && seq.code !== 'custom') continue
    for (const step of seq.stepResults ?? []) {
      if (step.status !== 'Analyzed') continue
      const stepCode = (step.stepCode || '').replace(/Simple$/, '')
      analyzedSteps.push(stepCode)
      for (const v of step.data?.values ?? []) values.set(`${stepCode}.${v.valueCode}`, v.value)
    }
  }

  const bands = new Map(realBands(data).map((b) => [b.code, b]))
  const readings: BodyDotInput = {}
  const indicators: ImportedIndicator[] = []
  const missing: { code: string; indicator: string; step: string }[] = []

  for (const [code, src] of Object.entries(INDICATOR_SOURCES)) {
    const band = bands.get(code)
    if (!band) continue
    const scale = scaleFor(band)
    const read = (ref?: Ref) => {
      if (!ref) return undefined
      const raw = values.get(`${ref.step}.${ref.value}`)
      return raw === undefined ? undefined : raw * scale
    }
    const stepOf = (s: Source) => (s.single ?? s.right ?? s.left)!.step

    if (src.single) {
      const v = read(src.single)
      if (v === undefined) {
        missing.push({ code, indicator: band.indicator, step: src.single.step })
        continue
      }
      // F05's sign is the direction the pelvis is tilted; the value stays signed and the
      // side is read off it, matching the posture form's positive-is-Right convention.
      const side: BodySide | undefined = code === 'F05' ? (v >= 0 ? 'Right' : 'Left') : undefined
      readings[code] = { value: v, side }
      indicators.push({ code, indicator: band.indicator, value: v, side, tier: classify(band, v, side).tier })
      continue
    }

    const left = read(src.left)
    const right = read(src.right)
    if (left === undefined && right === undefined) {
      missing.push({ code, indicator: band.indicator, step: stepOf(src) })
      continue
    }
    const options: { side: BodySide; value: number }[] = []
    if (left !== undefined) options.push({ side: 'Left', value: left })
    if (right !== undefined) options.push({ side: 'Right', value: right })
    const scored = options.map((o) => ({ ...o, c: classify(band, o.value, o.side) }))
    scored.sort(
      (a, b) =>
        TIER_RANK[b.c.tier] - TIER_RANK[a.c.tier] ||
        b.c.fractionOutside - a.c.fractionOutside ||
        // Stable last resort, so the same session always imports identically.
        a.side.localeCompare(b.side),
    )
    const worst = scored[0]
    readings[code] = { value: worst.value, side: worst.side }
    indicators.push({
      code,
      indicator: band.indicator,
      value: worst.value,
      side: worst.side,
      tier: worst.c.tier,
      bySide:
        left !== undefined && right !== undefined ? { left, right } : undefined,
    })
  }

  return {
    readings,
    indicators,
    missing,
    analyzedSteps: [...new Set(analyzedSteps)],
    validity: sessionValidity(session),
  }
}
