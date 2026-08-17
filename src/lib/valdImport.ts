import type { ValdData } from '../types'
import type { ValdInput, WeakSide } from './vald'
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
 *   Name, Date, Movement, Body Region
 *   L Max Force (N), R Max Force (N)   -> the newton figures the Load layer estimates from
 *   Force Asymmetry (%)                -> "22% R", the percentage and the STRONGER side
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
}

export interface ImportedSession {
  name: string
  /** ISO date, or the raw cell when it is not an Excel serial */
  date: string
  tests: ImportedTest[]
  /** rows whose Body Region + Movement matches no test in the data file */
  unmapped: { movement: string; bodyRegion: string }[]
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
  const cMove = need('movement')
  const cRegion = need('body region')
  const cLeft = need('l max force (n)', 'l max force')
  const cRight = need('r max force (n)', 'r max force')
  const cAsym = need('force asymmetry (%)', 'force asymmetry')

  if (cMove < 0 || cRegion < 0)
    throw new Error(
      'That file does not look like a DynaMo export — it has no "Movement" and "Body Region" columns.',
    )

  // "{Body Region} {Movement} Strength Asymmetry" -> code, straight out of the data file.
  const byTestName = new Map(data.tests.map((t) => [t.test.trim().toLowerCase(), t]))

  const sessions = new Map<string, ImportedSession>()
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
    const key = `${name}|${date}`
    if (!sessions.has(key)) sessions.set(key, { name, date, tests: [], unmapped: [] })
    const session = sessions.get(key)!

    const test = byTestName.get(`${region} ${movement} Strength Asymmetry`.trim().toLowerCase())
    if (!test) {
      session.unmapped.push({ movement, bodyRegion: region })
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
    }
    if (asym) {
      entry.asymmetry = asym.pct
      // The export names the side that tested STRONGER; this app works in weak sides.
      entry.weakSide = asym.strong === 'Left' ? 'Right' : 'Left'
    }

    // One movement can appear twice in an export (a retest). The later row wins, which is
    // the same rule the rest of the app uses for a repeated measurement.
    const existing = session.tests.findIndex((t) => t.code === entry.code)
    if (existing >= 0) session.tests[existing] = entry
    else session.tests.push(entry)
  }

  const order = new Map(data.tests.map((t, i) => [t.code, i]))
  const list = [...sessions.values()]
  for (const s of list) s.tests.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
  // Newest first — a trainer importing a history wants the latest test selected.
  list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : a.name.localeCompare(b.name)))

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
