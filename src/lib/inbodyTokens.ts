/**
 * A positioned word, and the geometry helpers the InBody reader works in.
 *
 * The reader is deliberately built on coordinates rather than on labels. An InBody sheet
 * draws almost every label — "Total Body Water", "SMM", "Segmental Fat Analysis", even the
 * client's sex — as vector artwork, so a PDF's text layer is very nearly a bare list of
 * numbers. Anchoring on label text finds nothing; anchoring on the layout finds everything.
 *
 * Keeping the token type minimal means the same reader serves both sources: pdf.js text
 * items and Tesseract word boxes are each reduced to this before parsing.
 */

export interface Token {
  /** left edge, in the page's own units */
  x: number
  /** baseline, measured upward from the bottom of the page */
  y: number
  text: string
}

export type Row = Token[]

/**
 * Tokens into printed lines, top of the page first, each sorted left to right.
 *
 * The tolerance is not cosmetic. InBody sets a row's unit and its value on baselines a point
 * or two apart — "(kg)" at y 697 with "12.4" at y 696 — so a strict grouping splits every
 * composition row in half and the value loses its range.
 *
 * The gap is measured against the token before it, not against the first token of the row.
 * A line whose parts step down by a point at a time — a scale, a unit, then the value, each
 * one point lower — walks past a fixed distance from the first token and loses its tail,
 * which on these sheets meant a Research Parameters row keeping its range but dropping the
 * figure the range belongs to.
 */
export function toRows(tokens: Token[], tolerance = 3): Row[] {
  const sorted = [...tokens].sort((a, b) => b.y - a.y)
  const rows: Row[] = []
  let current: Row = []

  for (const t of sorted) {
    if (current.length === 0 || Math.abs(t.y - current[current.length - 1].y) <= tolerance) {
      current.push(t)
    } else {
      rows.push(current.sort((a, b) => a.x - b.x))
      current = [t]
    }
  }
  if (current.length) rows.push(current.sort((a, b) => a.x - b.x))
  return rows
}

/** The row's text, single-spaced — for matching a whole line rather than a token. */
export const rowText = (row: Row) => row.map((t) => t.text).join(' ')

/** A bare number, or undefined. Rejects anything with other characters attached. */
export function numeric(text: string): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(text.trim())) return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

/**
 * "37.9~46.3" -> [37.9, 46.3]. The tilde is InBody's own range separator.
 *
 * One repair. OCR loses the decimal point in the upper figure often enough to matter —
 * "29.9~36.5" comes back as "29.9~365" — and it is safe to undo only because an InBody normal
 * range is narrow: no range on these sheets has an upper end even twice its lower one, so a
 * value more than three times the lower end is not a range that was printed, it is a decimal
 * that was dropped. Anything that does not land back above the lower end is left alone, and
 * a genuinely wide range is never touched: 1545~1806 kcal passes through untouched.
 */
export function range(text: string): [number, number] | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*[~〜]\s*(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return undefined
  const lo = Number(m[1])
  let hi = Number(m[2])
  if (hi > lo * 3 && hi / 10 >= lo) hi = hi / 10
  return hi >= lo ? [lo, hi] : undefined
}

/** "3.64kg" -> 3.64. Only the joined form, which is unique to the segmental panels. */
export function joinedKg(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*kg$/i.exec(text.trim())
  return m ? Number(m[1]) : undefined
}

/** "113.3%" -> 113.3. Only the joined form; scale rows print "%" as its own token. */
export function joinedPercent(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(text.trim())
  return m ? Number(m[1]) : undefined
}
