import type { ArsenalEntry, ArsenalItem, BodyDotBand, BodyDotData, Exercise } from '../types'

export type Edge = 'low' | 'high'
export type BodySide = 'Left' | 'Right'
export type Tier = 'normal' | 'borderline' | 'abnormal' | 'unbanded'
/** 'both' for a bilateral entry; null when a side was needed and none was recorded */
export type ResolvedSide = 'both' | BodySide

export interface BodyDotReading {
  value: number
  /** the side the finding names — only meaningful on a lateral indicator */
  side?: BodySide
}

/** keyed by indicator code, e.g. "S05" */
export type BodyDotInput = Record<string, BodyDotReading>

/**
 * Work 40s, rest 30s, per corrective set. From `timeCost` in bodydot.json:
 *   "exercises x sets x (work 40 + rest 30) + stretches x 40"
 * A corrective block runs at its own pace, not the program's rest interval. The acceptance
 * suite asserts these two constants still match the string in the data file.
 */
export const CORRECTIVE_WORK_SECONDS = 40
export const CORRECTIVE_REST_SECONDS = 30

const BILATERAL = 'bilateral'
const OPPOSITE = 'OPPOSITE side'

// ---- bands -----------------------------------------------------------------

/** bands[0] in the data file is the spreadsheet's header row, not an indicator. */
export function realBands(data: BodyDotData): BodyDotBand[] {
  return data.bands.filter((b) => b.code !== 'Code')
}

/** "-5.5 to -5.0" -> [-5.5, -5.0]. "-" means this edge has no band at all. */
export function parseRange(s: string): [number, number] | null {
  if (!s || s.trim() === '-') return null
  const parts = s.split(' to ')
  if (parts.length !== 2) return null
  const lo = Number(parts[0])
  const hi = Number(parts[1])
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

/**
 * The full measurable span of an indicator — the outermost edges of every band it defines.
 * Ranking compares readings in degrees against readings in centimetres, so the distance
 * outside the band only means anything as a fraction of this.
 */
export function indicatorRange(band: BodyDotBand): number {
  const ranges = [band.normal, band.borderlineLow, band.abnormalLow, band.borderlineHigh, band.abnormalHigh]
    .map(parseRange)
    .filter((r): r is [number, number] => r !== null)
  if (ranges.length === 0) return 0
  return Math.max(...ranges.map((r) => r[1])) - Math.min(...ranges.map((r) => r[0]))
}

export interface Classification {
  band: BodyDotBand
  value: number
  tier: Tier
  /** which edge was crossed — this selects the arsenal entry, not the sign of the reading */
  edge: Edge | null
  /** distance outside the normal band, as a fraction of the indicator's full range */
  fractionOutside: number
  measuredSide?: BodySide
}

/**
 * Step 1. Bands in the file are adjacent and both ends are inclusive, so a value sitting
 * exactly on a boundary would match two tiers; the milder one always wins.
 *
 * A reading outside the normal band on an edge the file leaves as "-" is `unbanded`: it is
 * out of range, but the indicator defines no tiers in that direction, so no tier is claimed
 * for it. Those are reported, never silently treated as normal.
 */
export function classify(band: BodyDotBand, value: number, measuredSide?: BodySide): Classification {
  const normal = parseRange(band.normal)
  const base = { band, value, measuredSide }
  if (!normal) return { ...base, tier: 'unbanded', edge: null, fractionOutside: 0 }

  if (value >= normal[0] && value <= normal[1]) {
    return { ...base, tier: 'normal', edge: null, fractionOutside: 0 }
  }

  const edge: Edge = value < normal[0] ? 'low' : 'high'
  const borderline = parseRange(edge === 'low' ? band.borderlineLow : band.borderlineHigh)
  const abnormal = parseRange(edge === 'low' ? band.abnormalLow : band.abnormalHigh)
  const span = indicatorRange(band)
  const distance = edge === 'low' ? normal[0] - value : value - normal[1]
  const fractionOutside = span > 0 ? distance / span : 0

  let tier: Tier
  if (!borderline && !abnormal) tier = 'unbanded'
  else if (borderline && value >= borderline[0] && value <= borderline[1]) tier = 'borderline'
  else tier = 'abnormal'

  return { ...base, tier, edge, fractionOutside }
}

/** The 10% rule collapses to a strip too narrow to land in — surfaced, not hidden. */
export function isDeadBorderline(data: BodyDotData, code: string, edge: Edge): boolean {
  return data.deadBorderlineEdges.some(([c, e]) => c === code && e === edge)
}

// ---- arsenal ---------------------------------------------------------------

/** Step 2. Matched on (code, edge); an `any` entry answers for either edge. */
export function arsenalFor(data: BodyDotData, code: string, edge: Edge): ArsenalEntry | null {
  return data.arsenal.find((a) => a.code === code && (a.edge === edge || a.edge === 'any')) ?? null
}

/** True where any arsenal entry for this indicator prescribes one-sided work. */
export function isLateral(data: BodyDotData, code: string): boolean {
  return data.arsenal.some((a) => a.code === code && a.laterality !== BILATERAL)
}

/**
 * Step 3. A left-hiked pelvis is levelled by training the RIGHT side to hike, so an
 * `OPPOSITE side` entry inverts the side the finding names. This is the reverse of VALD,
 * where the weak side is the one that gets the work — the two conventions must not leak
 * into each other.
 */
export function resolveSide(laterality: string, measured?: BodySide): ResolvedSide | null {
  if (laterality === BILATERAL) return 'both'
  if (!measured) return null
  if (laterality === OPPOSITE) return measured === 'Left' ? 'Right' : 'Left'
  return measured
}

/** `{Side}` / `{side}` come from the RESOLVED side, after the opposite-side rule. */
export function fillPlaceholders(name: string, side: ResolvedSide): string {
  if (side === 'both') {
    return name
      .replace(/\{Side\}\s*/g, '')
      .replace(/\s*\{side\}/g, '')
      .trim()
  }
  return name.replace(/\{Side\}/g, side).replace(/\{side\}/g, side.toLowerCase())
}

// ---- findings --------------------------------------------------------------

export interface BodyDotFinding {
  code: string
  indicator: string
  view: string
  unit: string
  value: number
  tier: Exclude<Tier, 'normal'>
  edge: Edge | null
  fractionOutside: number
  measuredSide?: BodySide
  entry: ArsenalEntry | null
  resolvedSide: ResolvedSide | null
  /** 0 is the highest priority; drives both allocation order and the trim order */
  rank: number
  /** set when this finding can prescribe nothing */
  unfilledReason?: string
  /** borderline bilateral takes the first arsenal exercise only — stated, not silent */
  limitedToFirst: boolean
}

export interface CorrectiveSlot {
  exercise: Exercise
  /** the arsenal's own wording, placeholders filled */
  prescribedName: string
  /** indicator codes this slot answers; the first one owns the prescription */
  codes: string[]
  indicators: string[]
  side: ResolvedSide
  sets: number
  /** null on a mobility exercise — it is timed instead of counted */
  reps: string | null
  seconds: number | null
  rank: number
}

export interface CorrectiveStretch {
  name: string
  exerciseId: number | null
  libraryName: string | null
  seconds: number
  codes: string[]
  /** no library match: free text with the timer */
  unmapped: boolean
  rank: number
}

export interface DeferredCorrective {
  code: string
  indicator: string
  names: string[]
  reason: string
}

export interface UnfilledIndicator {
  code: string
  indicator: string
  value: number
  reason: string
}

export interface BodyDotResult {
  active: boolean
  /** every measured indicator, normal ones included */
  classifications: Classification[]
  findings: BodyDotFinding[]
  /** the block placed at the end of every session, before any per-session time trim */
  correctives: CorrectiveSlot[]
  stretches: CorrectiveStretch[]
  deferred: DeferredCorrective[]
  unfilled: UnfilledIndicator[]
  /** what the time trim removed, per session */
  trimmed: { dayIndex: number; what: string }[]
  cap: number
  standardSets: number
}

export const INERT_BODYDOT: BodyDotResult = {
  active: false,
  classifications: [],
  findings: [],
  correctives: [],
  stretches: [],
  deferred: [],
  unfilled: [],
  trimmed: [],
  cap: 0,
  standardSets: 0,
}

export function hasAnyBodyDot(input: BodyDotInput): boolean {
  if (!input) return false
  return Object.values(input).some((r) => typeof r?.value === 'number' && !Number.isNaN(r.value))
}

export interface BodyDotContext {
  library: Exercise[]
  /** sets a bilateral corrective inherits from the rest of the program */
  standardSets: number
  reps: string
  /** injury REMOVE — outranks a corrective, so the exercise is never added */
  removed: (ex: Exercise) => boolean
  /** age / level / equipment screen, mobility permitted */
  allowedExercise: (ex: Exercise) => boolean
  /** stretches carry no load, so only pain and equipment apply */
  allowedStretch: (ex: Exercise) => boolean
}

interface Candidate {
  finding: BodyDotFinding
  items: { item: ArsenalItem; ex: Exercise; prescribedName: string }[]
  sets: number
  side: ResolvedSide
  /** how many of `items` the tier actually prescribes */
  limit: number
}

/**
 * Steps 1-6. The one machine in the stack that ADDS slots, so everything it cannot place is
 * reported rather than dropped: deferred exercises name themselves, and an indicator that
 * can prescribe nothing says why.
 */
export function evaluateBodyDot(
  input: BodyDotInput,
  data: BodyDotData,
  ctx: BodyDotContext,
): BodyDotResult {
  if (!hasAnyBodyDot(input)) return INERT_BODYDOT

  const byId = new Map(ctx.library.map((e) => [e.id, e]))
  const bands = realBands(data)
  const bandOrder = new Map(bands.map((b, i) => [b.code, i]))

  // ---- steps 1-2 ----------------------------------------------------------
  const classifications: Classification[] = []
  for (const band of bands) {
    const reading = input[band.code]
    if (!reading || typeof reading.value !== 'number' || Number.isNaN(reading.value)) continue
    classifications.push(classify(band, reading.value, reading.side))
  }

  const unfilled: UnfilledIndicator[] = []
  const findings: BodyDotFinding[] = []

  for (const c of classifications) {
    if (c.tier === 'normal') continue
    const entry = c.edge ? arsenalFor(data, c.band.code, c.edge) : null
    const resolvedSide = entry ? resolveSide(entry.laterality, c.measuredSide) : null

    const finding: BodyDotFinding = {
      code: c.band.code,
      indicator: c.band.indicator,
      view: c.band.view,
      unit: c.band.unit,
      value: c.value,
      tier: c.tier,
      edge: c.edge,
      fractionOutside: c.fractionOutside,
      measuredSide: c.measuredSide,
      entry,
      resolvedSide,
      rank: 0,
      limitedToFirst: false,
    }

    if (c.tier === 'unbanded') {
      finding.unfilledReason =
        'outside the normal band, but this indicator defines no band on that side — no tier is claimed for it'
    } else if (!entry) {
      finding.unfilledReason = 'measured, no protocol yet — no arsenal entry for this indicator'
    } else if (!resolvedSide) {
      finding.unfilledReason = 'this finding prescribes one-sided work, but no side was recorded'
    }
    findings.push(finding)
  }

  // ---- step 5, ranking ----------------------------------------------------
  // Abnormal before borderline, then by how far outside the band the reading sits as a
  // fraction of the indicator's range, then by file order so two runs agree exactly.
  const TIER_RANK: Record<string, number> = { abnormal: 0, borderline: 1, unbanded: 2 }
  findings.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      b.fractionOutside - a.fractionOutside ||
      (bandOrder.get(a.code) ?? 0) - (bandOrder.get(b.code) ?? 0),
  )
  findings.forEach((f, i) => {
    f.rank = i
  })

  // ---- step 4, set counts -------------------------------------------------
  const candidates: Candidate[] = []
  for (const f of findings) {
    if (f.unfilledReason || !f.entry || !f.resolvedSide) {
      if (f.unfilledReason)
        unfilled.push({ code: f.code, indicator: f.indicator, value: f.value, reason: f.unfilledReason })
      continue
    }
    const bilateral = f.resolvedSide === 'both'
    const sets = bilateral
      ? ctx.standardSets
      : f.tier === 'abnormal'
        ? data.sets.abnormalUnilateral
        : data.sets.borderlineUnilateral
    // Only the bilateral column varies the exercise count by tier; a unilateral finding
    // takes the whole entry and varies its sets instead.
    const limitToFirst = bilateral && f.tier === 'borderline'
    f.limitedToFirst = limitToFirst

    const resolved = f.entry.exercises
      .map((item) => {
        const ex = item.exerciseId === null ? undefined : byId.get(item.exerciseId)
        return ex ? { item, ex, prescribedName: fillPlaceholders(item.arsenalName, f.resolvedSide!) } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const removed = resolved.filter((r) => ctx.removed(r.ex))
    const blocked = resolved.filter((r) => !ctx.removed(r.ex) && !ctx.allowedExercise(r.ex))
    const usable = resolved.filter((r) => !ctx.removed(r.ex) && ctx.allowedExercise(r.ex))

    if (usable.length === 0) {
      const reason = removed.length
        ? `every exercise for this finding is removed by a pain you reported (${removed.map((r) => r.ex.name).join(', ')})`
        : blocked.length
          ? `no exercise for this finding suits this client's age, level or equipment (${blocked.map((r) => r.ex.name).join(', ')})`
          : 'this entry lists no exercise that resolves to the library'
      f.unfilledReason = reason
      unfilled.push({ code: f.code, indicator: f.indicator, value: f.value, reason })
      continue
    }

    candidates.push({
      finding: f,
      items: usable,
      sets,
      side: f.resolvedSide,
      limit: limitToFirst ? 1 : usable.length,
    })
  }

  // ---- step 5, allocation -------------------------------------------------
  // Two passes. Without the reservation pass a single three-exercise entry swallows the
  // whole cap and the next finding gets nothing at all.
  const cap = data.correctiveSlotCapPerSession
  const placed: CorrectiveSlot[] = []
  const placedIds = new Set<number>()

  const wanted = (c: Candidate) => c.items.slice(0, c.limit)
  const servedBy = (c: Candidate) => placed.find((p) => wanted(c).some((w) => w.ex.id === p.exercise.id))
  const nextFor = (c: Candidate) => wanted(c).find((w) => !placedIds.has(w.ex.id))

  const place = (c: Candidate, w: { ex: Exercise; prescribedName: string }) => {
    const mobility = w.ex.type === 'mobility'
    placed.push({
      exercise: w.ex,
      prescribedName: w.prescribedName,
      codes: [c.finding.code],
      indicators: [c.finding.indicator],
      side: c.side,
      sets: c.sets,
      reps: mobility ? null : ctx.reps,
      seconds: mobility ? data.stretchSeconds : null,
      rank: c.finding.rank,
    })
    placedIds.add(w.ex.id)
  }

  /** one arsenal exercise can answer two findings — the higher-ranked one owns the sets */
  const attribute = (c: Candidate, slot: CorrectiveSlot) => {
    if (!slot.codes.includes(c.finding.code)) {
      slot.codes.push(c.finding.code)
      slot.indicators.push(c.finding.indicator)
    }
  }

  // pass 1 — reservation: one exercise each, in rank order
  for (const c of candidates) {
    const already = servedBy(c)
    if (already) {
      attribute(c, already)
      continue
    }
    if (placed.length >= cap) continue
    const w = nextFor(c)
    if (w) place(c, w)
  }

  // pass 2 — top-up: hold back a slot for every candidate pass 1 could not serve
  for (const c of candidates) {
    let w = nextFor(c)
    while (w) {
      const reserved = candidates.filter((o) => o !== c && !servedBy(o) && nextFor(o)).length
      if (placed.length + reserved >= cap) break
      place(c, w)
      w = nextFor(c)
    }
  }

  // Pass 1 interleaves findings, so the block reads out of order. Grouping by rank is a
  // stable sort — placement order survives inside a rank, which is what the trim's
  // last-placed-first tie-break depends on.
  placed.sort((a, b) => a.rank - b.rank)

  // ---- what did not fit ---------------------------------------------------
  const deferred: DeferredCorrective[] = []
  for (const c of candidates) {
    const missed = wanted(c).filter((w) => !placedIds.has(w.ex.id))
    if (missed.length === 0) continue
    const anyPlaced = servedBy(c) !== undefined
    deferred.push({
      code: c.finding.code,
      indicator: c.finding.indicator,
      names: missed.map((w) => w.prescribedName),
      reason: anyPlaced
        ? `the session cap of ${cap} corrective exercises was reached — this block is partially placed`
        : `the session cap of ${cap} corrective exercises was reached before this finding was served`,
    })
    if (!anyPlaced && !c.finding.unfilledReason) {
      c.finding.unfilledReason = `the session cap of ${cap} corrective exercises was reached before this finding was served`
    }
  }

  // ---- stretches ----------------------------------------------------------
  // Timed, not set-counted, and they never consume a corrective slot. They accompany their
  // block, so a finding that placed nothing brings no stretches with it.
  const stretches: CorrectiveStretch[] = []
  for (const c of candidates) {
    if (!servedBy(c)) continue
    for (const s of c.finding.entry!.stretches) {
      const ex = s.exerciseId === null ? undefined : byId.get(s.exerciseId)
      if (ex && (ctx.removed(ex) || !ctx.allowedStretch(ex))) continue
      const name = fillPlaceholders(s.arsenalName, c.side)
      const existing = stretches.find((x) => x.name === name)
      if (existing) {
        if (!existing.codes.includes(c.finding.code)) existing.codes.push(c.finding.code)
        continue
      }
      stretches.push({
        name,
        exerciseId: ex?.id ?? null,
        libraryName: ex?.name ?? null,
        seconds: data.stretchSeconds,
        codes: [c.finding.code],
        unmapped: !ex,
        rank: c.finding.rank,
      })
    }
  }

  return {
    active: true,
    classifications,
    findings,
    correctives: placed,
    stretches,
    deferred,
    unfilled,
    trimmed: [],
    cap,
    standardSets: ctx.standardSets,
  }
}

// ---- step 7, time ----------------------------------------------------------

export function correctiveSeconds(
  slots: CorrectiveSlot[],
  stretches: CorrectiveStretch[],
  stretchSeconds: number,
): number {
  const work = slots.reduce(
    (s, c) => s + c.sets * (CORRECTIVE_WORK_SECONDS + CORRECTIVE_REST_SECONDS),
    0,
  )
  return work + stretches.length * stretchSeconds
}

/**
 * Step 7's per-session trim is gone. `trimOrder` in the data file named four things to give
 * up against a time ceiling, and there is no longer a ceiling at generation to give them up
 * to: the allocation guarantees volume only, and session length is the client's decision,
 * taken with the time-cap button.
 *
 * Corrective work is still the thing given up when a session is too long — but at a stated
 * price (3 points borderline, 12 abnormal), inside a search that weighs it against every
 * other lever, rather than silently and always first. `bodydot.trimmed` is still populated,
 * now by whatever the time cap dropped. See lib/timecap.ts.
 */
