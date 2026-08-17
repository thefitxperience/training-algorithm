import type { ValdData } from '../types'
import { asymmetryFromNewtons, type ValdInput, type WeakSide } from './vald'
import { excelDate, readFirstSheet, type Grid } from './xlsx'

/**
 * Reads a VALD DynaMo Excel export into the readings this app already understands.
 *
 * The join needs no guessing. `vald.json`'s `test` field is literally
 * "{Body Region} {Movement} Strength Asymmetry", and the export carries Body Region and
 * Movement as their own columns — so the mapping is a lookup in the data file, not a table
 * of name equivalences maintained here. A movement the file does not name is reported as
 * unmapped rather than approximated onto a neighbouring test.
 *
 * Columns read (by header text, never by position — DynaMo reorders them between versions):
 *   Name, Date, Time, Movement, Body Region
 *   L Max Force (N), R Max Force (N)   -> the newton figures the Load layer estimates from
 *   Force Asymmetry (%)                -> "22% R", the percentage and the STRONGER side
 *
 * Time matters more than it looks. DynaMo exports newest-first, so the LAST row for a
 * repeated movement is the FIRST attempt — the one a trainer redid because it was wrong.
 * Attempts are therefore ordered by the Time column, not by their position in the file.
 *
 * Both the percentage and the two forces are taken from the sheet as printed. They are not
 * derived from one another: the machine's own figure wins, and where they disagree the
 * consistency check downstream is what surfaces it.
 */

export interface ImportedTest {
  code: string
  test: string
  movement: string
  bodyRegion: string
  asymmetry?: number
  weakSide?: WeakSide
  leftN?: number
  rightN?: number
  /** how many times this movement was measured in the session; the latest attempt is the one kept */
  attempts: number
}

/** The three batteries DynaMo is run as. There is no fourth. */
export type Battery = 'upper' | 'lower' | 'full'

export interface ImportedSession {
  name: string
  /** ISO date, or the raw cell when it is not an Excel serial */
  date: string
  /** which battery this is, read off the movements themselves */
  battery: Battery
  tests: ImportedTest[]
  /** rows whose Body Region + Movement matches no test in the data file */
  unmapped: { movement: string; bodyRegion: string }[]
  /** true when the same day also produced the other half of an upper + lower pair */
  pairedSameDay: boolean
}

export const BATTERY_LABEL: Record<Battery, string> = {
  upper: 'Upper body',
  lower: 'Lower body',
  full: 'Full body',
}

/**
 * Which half a single movement belongs to — the automator's `get_movement_test_type`, with a
 * fallback it does not need.
 *
 * The automator names movements one by one because each has to land in a fixed cell of a
 * workbook, and anything unnamed simply has nowhere to go. Filing a movement under a half is
 * a smaller question than that, and the region answers it on its own: Shoulder Adduction is
 * upper-body work whether or not a template has a cell for it. Without the fallback it would
 * belong to neither half and be filed under both, counting one measurement twice.
 */
export function movementBattery(movement: string, bodyRegion: string): 'upper' | 'lower' | null {
  const m = movement.trim().toLowerCase().replace(/\s+(left|right)$/, '')
  const r = bodyRegion.trim().toLowerCase()
  if (
    (r === 'shoulder' &&
      ['external rotation', 'internal rotation', 'flexion', 'abduction', 'push', 'pull'].includes(m)) ||
    r === 'hand' ||
    (r === 'elbow' && ['extension', 'flexion'].includes(m))
  )
    return 'upper'
  if (
    r === 'trunk' ||
    r === 'knee' ||
    (r === 'hip' && ['flexion', 'extension', 'abduction', 'adduction'].includes(m))
  )
    return 'lower'
  if (['shoulder', 'elbow', 'hand', 'wrist', 'scapula', 'neck'].includes(r)) return 'upper'
  if (['hip', 'knee', 'ankle', 'foot'].includes(r)) return 'lower'
  return null
}

/**
 * Which battery a day's movements add up to — the automator's `detect_test_type`.
 *
 * A full-body test is recognised by its shape rather than by a count: elbow together with
 * knee, and none of the trunk or hip flexion/extension work that only a dedicated lower-body
 * test includes. Anything holding both halves without that shape is not a fourth kind of
 * test — it is an upper and a lower run back to back, so this returns both and the caller
 * splits the day in two, exactly as the automator writes two workbooks.
 *
 * One departure: the side suffix is stripped first. DynaMo writes the trunk as "Lateral
 * Flexion Left" and "Lateral Flexion Right", so an exact match on "lateral flexion" — which
 * is what the automator tests for here — never fires on a real export.
 */
export function detectBatteries(
  pairs: Iterable<{ movement: string; bodyRegion: string }>,
): Battery[] {
  const seen = new Set<string>()
  for (const p of pairs) {
    const m = p.movement.trim().toLowerCase().replace(/\s+(left|right)$/, '')
    seen.add(`${m}|${p.bodyRegion.trim().toLowerCase()}`)
  }
  const any = (...keys: string[]) => keys.some((k) => seen.has(k))

  const hasUpper = any(
    'external rotation|shoulder',
    'internal rotation|shoulder',
    'flexion|shoulder',
    'abduction|shoulder',
    'push|shoulder',
    'pull|shoulder',
    'grip squeeze|hand',
  )
  const hasElbow = any('extension|elbow', 'flexion|elbow')
  const hasKnee = any('extension|knee', 'flexion|knee')
  const hasHipAbdAdd = any('abduction|hip', 'adduction|hip')
  const hasTrunk = any('lateral flexion|trunk')
  const hasHipFlex = any('flexion|hip')
  const lowerOnly = hasTrunk || hasHipFlex || any('extension|hip')

  if (hasElbow && hasKnee && !lowerOnly) return ['full']
  if (hasElbow && hasKnee && hasHipAbdAdd && !hasTrunk && !hasHipFlex) return ['full']

  const anyUpper = hasUpper || hasElbow
  const anyLower = hasKnee || hasHipAbdAdd || lowerOnly
  if (anyUpper && anyLower) return ['upper', 'lower']
  if (anyLower) return ['lower']
  // The automator's fallback when nothing is recognised, and it is only ever reached by a day
  // made entirely of movements this app has no test for.
  return ['upper']
}

export interface ValdImport {
  sessions: ImportedSession[]
  /** rows skipped for a stated reason, so a short import is never silent */
  skipped: { row: number; reason: string }[]
  rowsRead: number
}

/** Header text -> column index, matched case- and space-insensitively. */
function headerMap(header: string[]): Map<string, number> {
  const map = new Map<string, number>()
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, ' ')
    if (key) map.set(key, i)
  })
  return map
}

/** "22% R" -> 22 and the side that tested STRONGER. */
export function parseAsymmetry(raw: string): { pct: number; strong: WeakSide } | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*%\s*([LR])$/i)
  if (!m) return null
  return { pct: Number(m[1]), strong: m[2].toUpperCase() === 'L' ? 'Left' : 'Right' }
}

/**
 * The trunk is the one test the machine cannot score by itself. A side bend loads only one
 * side at a time, so DynaMo writes it as two separate rows — "Lateral Flexion Left" and
 * "Lateral Flexion Right" — each with a neutral force and an asymmetry of "n/a". Neither row
 * on its own names a test in the data file, so reading rows independently drops the trunk
 * entirely; it has to be assembled from the pair.
 *
 * The weaker side is simply the one that pushed less. The percentage is deliberately NOT the
 * automator's, which divides the spread by the mean of the two sides. DynaMo divides by the
 * stronger side — check it on any row of an export: Shoulder Adduction at L 147 N / R 189 N
 * prints "22% R", and 42/189 is 22.2% where 42/168 would be 25.0%. Every other percentage
 * this app handles comes off that column, and every threshold it is measured against — 8%
 * weakness, 30% referral — is calibrated on it. Scoring the trunk on the mean instead would
 * put one test on a scale of its own, always reading high, and 96 N against 155 N would come
 * out at 47% rather than 38% and cross the referral line on the strength of the arithmetic.
 */
interface TrunkSides {
  left?: { force: number; at?: number }
  right?: { force: number; at?: number }
}

export function trunkAsymmetry(sides: TrunkSides): { pct: number; weak: WeakSide } | null {
  const l = sides.left?.force
  const r = sides.right?.force
  // One side alone says nothing about symmetry, and a zero is a rep that did not register.
  if (l === undefined || r === undefined || l <= 0 || r <= 0) return null
  return { pct: asymmetryFromNewtons(l, r), weak: r < l ? 'Right' : 'Left' }
}

const num = (s: string | undefined) => {
  if (s === undefined || s.trim() === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

export function parseValdGrid(grid: Grid, data: ValdData): ValdImport {
  const skipped: { row: number; reason: string }[] = []
  if (grid.length < 2) return { sessions: [], skipped, rowsRead: 0 }

  const h = headerMap(grid[0])
  const need = (...names: string[]) => {
    for (const n of names) {
      const at = h.get(n)
      if (at !== undefined) return at
    }
    return -1
  }
  const cName = need('name')
  const cDate = need('date')
  const cTime = need('time')
  const cMove = need('movement')
  const cRegion = need('body region')
  const cLeft = need('l max force (n)', 'l max force')
  const cRight = need('r max force (n)', 'r max force')
  const cAsym = need('force asymmetry (%)', 'force asymmetry')
  const cNeutral = need('n max force (n)', 'n max force')

  if (cMove < 0 || cRegion < 0)
    throw new Error(
      'That file does not look like a DynaMo export — it has no "Movement" and "Body Region" columns.',
    )

  // "{Body Region} {Movement} Strength Asymmetry" -> code, straight out of the data file.
  const byTestName = new Map(data.tests.map((t) => [t.test.trim().toLowerCase(), t]))

  // Rows are gathered per athlete-day first. Splitting into batteries happens at the end,
  // once every movement of the day is known.
  interface Day {
    name: string
    date: string
    tests: ImportedTest[]
    unmapped: { movement: string; bodyRegion: string }[]
    /** every movement of the day, mapped or not — the battery is read off all of them */
    performed: { movement: string; bodyRegion: string }[]
  }
  const days = new Map<string, Day>()
  // Time-of-day of the attempt each kept test came from, so a later attempt can replace it.
  const takenAt = new Map<string, number>()
  // Trunk side-bends, held back until both sides are in — see the note above `trunkAsymmetry`.
  const trunk = new Map<string, TrunkSides>()
  let rowsRead = 0

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')

    const movement = cell(cMove)
    const region = cell(cRegion)
    if (!movement && !region) continue // trailing blank row
    rowsRead++

    const name = cell(cName) || 'Unnamed athlete'
    const rawDate = cell(cDate)
    const date = excelDate(Number(rawDate)) ?? rawDate ?? ''
    const dayKey = `${name}|${date}`
    if (!days.has(dayKey)) days.set(dayKey, { name, date, tests: [], unmapped: [], performed: [] })
    const day = days.get(dayKey)!
    day.performed.push({ movement, bodyRegion: region })

    // A one-sided trunk bend is held until its partner arrives, rather than reported unmapped.
    const bend = /^lateral flexion\s+(left|right)$/i.exec(movement)
    if (region.trim().toLowerCase() === 'trunk' && bend) {
      const force = num(cell(cNeutral))
      if (force !== undefined) {
        const held = trunk.get(dayKey) ?? {}
        const side = bend[1].toLowerCase() === 'left' ? 'left' : 'right'
        const at = num(cell(cTime))
        // Same latest-attempt rule as everything else.
        if (!held[side] || at === undefined || (held[side]!.at ?? -Infinity) < at)
          held[side] = { force, at }
        trunk.set(dayKey, held)
      }
      continue
    }

    const test = byTestName.get(`${region} ${movement} Strength Asymmetry`.trim().toLowerCase())
    if (!test) {
      day.unmapped.push({ movement, bodyRegion: region })
      skipped.push({ row: r + 1, reason: `no test for "${region} ${movement}"` })
      continue
    }

    const asym = parseAsymmetry(cell(cAsym))
    const entry: ImportedTest = {
      code: test.code,
      test: test.test,
      movement,
      bodyRegion: region,
      leftN: num(cell(cLeft)),
      rightN: num(cell(cRight)),
      attempts: 1,
    }
    if (asym) {
      entry.asymmetry = asym.pct
      // The export names the side that tested STRONGER; this app works in weak sides.
      entry.weakSide = asym.strong === 'Left' ? 'Right' : 'Left'
    }

    // One movement can appear several times in a session — a bad rep, then the redo. Two
    // rules decide which attempt survives, in this order:
    //
    //   1. An attempt that produced a readable asymmetry beats one that did not. A cancelled
    //      rep still writes a row, with "n/a" and a zero on one side; letting it win because
    //      it happened last would throw away the only real measurement.
    //   2. Otherwise the LATEST attempt wins, by the Time column rather than by row order.
    //      DynaMo writes newest-first, so trusting row order keeps the rep that was redone.
    //
    // Both rules are the automator's. Attempts with no readable time keep the first row seen,
    // which is the newest one in that layout.
    const at = num(cell(cTime))
    const attemptKey = `${dayKey}|${entry.code}`
    const existing = day.tests.findIndex((t) => t.code === entry.code)
    if (existing < 0) {
      day.tests.push(entry)
      if (at !== undefined) takenAt.set(attemptKey, at)
      continue
    }
    const held = day.tests[existing]
    entry.attempts = held.attempts + 1
    const prev = takenAt.get(attemptKey)
    const readable = (t: ImportedTest) => t.asymmetry !== undefined
    const wins =
      readable(entry) !== readable(held)
        ? readable(entry)
        : at !== undefined && prev !== undefined && at > prev
    if (wins) {
      day.tests[existing] = entry
      if (at !== undefined) takenAt.set(attemptKey, at)
    } else {
      held.attempts = entry.attempts
    }
  }

  // Now that every row is in, the trunk pairs can be scored.
  const trunkTest = byTestName.get('trunk lateral flexion strength asymmetry')
  for (const [dayKey, sides] of trunk) {
    const day = days.get(dayKey)
    if (!day) continue
    const scored = trunkTest ? trunkAsymmetry(sides) : null
    if (!scored) {
      // Half a pair is not a result. Say which half is missing instead of dropping it silently.
      const have = sides.left ? 'left' : sides.right ? 'right' : 'neither'
      day.unmapped.push({
        movement: `Lateral Flexion (${have} side only)`,
        bodyRegion: 'Trunk',
      })
      continue
    }
    day.tests.push({
      code: trunkTest!.code,
      test: trunkTest!.test,
      movement: 'Lateral Flexion',
      bodyRegion: 'Trunk',
      asymmetry: scored.pct,
      weakSide: scored.weak,
      leftN: sides.left!.force,
      rightN: sides.right!.force,
      attempts: 1,
    })
  }

  // Split each day into the batteries it actually contains. A day that is one battery stays
  // one session and keeps everything; a day holding an upper and a lower becomes two, with
  // each movement filed by its own half. A movement belonging to neither goes to both, since
  // there is no ground for choosing — the same rule the automator applies.
  const list: ImportedSession[] = []
  for (const day of days.values()) {
    const batteries = detectBatteries(day.performed)
    const split = batteries.length > 1
    for (const battery of batteries) {
      const belongs = (m: { movement: string; bodyRegion: string }) => {
        if (!split) return true
        const half = movementBattery(m.movement, m.bodyRegion)
        return half === null || half === battery
      }
      list.push({
        name: day.name,
        date: day.date,
        battery,
        pairedSameDay: split,
        tests: day.tests.filter(belongs),
        unmapped: day.unmapped.filter(belongs),
      })
    }
  }

  const order = new Map(data.tests.map((t, i) => [t.code, i]))
  for (const s of list) s.tests.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
  // Newest first — a trainer importing a history wants the latest test selected. Within a day,
  // the upper half is listed before the lower.
  const rank: Record<Battery, number> = { full: 0, upper: 1, lower: 2 }
  list.sort(
    (a, b) =>
      (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) ||
      a.name.localeCompare(b.name) ||
      rank[a.battery] - rank[b.battery],
  )

  return { sessions: list, skipped, rowsRead }
}

export async function readValdFile(file: File, data: ValdData): Promise<ValdImport> {
  return parseValdGrid(await readFirstSheet(await file.arrayBuffer()), data)
}

/** A session -> the reading map the VALD layer takes. Fields absent from the sheet stay absent. */
export function toValdInput(session: ImportedSession): ValdInput {
  const out: ValdInput = {}
  for (const t of session.tests) {
    out[t.code] = {
      asymmetry: t.asymmetry,
      weakSide: t.weakSide,
      leftN: t.leftN,
      rightN: t.rightN,
    }
  }
  return out
}
