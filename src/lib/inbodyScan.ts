import type { InBodyInput } from './inbody'
import {
  joinedKg,
  joinedPercent,
  numeric,
  range,
  rowText,
  toRows,
  type Row,
  type Token,
} from './inbodyTokens'

/**
 * Reads an InBody result sheet into the fourteen figures this app's InBody layer takes.
 *
 * The sheet arrives two ways and they fail in opposite directions, which is what shapes this
 * file. A PDF carries exact coordinates but almost no label text — InBody draws "Total Body
 * Water", "Skeletal Muscle Mass", "Segmental Fat Analysis" and even the client's sex as
 * vector artwork, so the text layer is a list of bare numbers. A photograph carries the
 * labels perfectly well and mangles the numbers: on the sample here OCR read the weight
 * 71.1 as "TAN" until the image was enlarged, and still turns 36.5 into 365.
 *
 * So every figure is looked for twice — once by its printed label, once by where it sits —
 * and each source covers the other's blind spot. Where two readings of the same quantity can
 * be had, they are compared: the weight in the composition table against the weight under the
 * Muscle-Fat bar, percent body fat against fat mass over weight. A sheet whose two answers
 * disagree is reported rather than quietly halved.
 *
 * What the sheet does not print is not invented — see `NOT_PRINTED`.
 */

export interface InBodyScan {
  model: string | null
  memberId?: string
  name?: string
  /** ISO yyyy-mm-dd */
  testDate?: string
  heightCm?: number
  age?: number
  weightKg?: number
  bodyFatKg?: number
  fatFreeKg?: number
  readings: InBodyInput
  sources: Partial<Record<keyof InBodyInput, string>>
  /** fields the layer wants that this sheet does not carry */
  missing: (keyof InBodyInput)[]
  /** anything that did not add up, in plain words */
  warnings: string[]
  ocr: boolean
}

/**
 * The ranges an InBody sheet does not print as text.
 *
 * The percent-body-fat bar has a grey "Normal" band drawn across it — 10.0 to 20.0 on the
 * male sheets here — but those figures exist only as artwork, on every model. Skeletal muscle
 * mass carries its range in Research Parameters on the 270S; the 270 prints Fat Free Mass in
 * that row instead and gives no muscle range at all.
 *
 * They are left empty rather than filled from InBody's published constants. A range is the
 * whole of what decides Under / Normal / Over, so a guessed one does not produce a slightly
 * wrong verdict — it produces a confident wrong one, and the goal rewrite that follows from
 * it looks exactly like a measured result.
 */
export const NOT_PRINTED: Partial<Record<keyof InBodyInput, string>> = {
  pbfLow: 'the percent body fat range is drawn as the grey band on the bar, never written out — on any InBody model',
  pbfHigh: 'the percent body fat range is drawn as the grey band on the bar, never written out — on any InBody model',
  smmLow: 'this sheet has no Skeletal Muscle Mass row in Research Parameters — the 270S prints one, the 270 does not',
  smmHigh: 'this sheet has no Skeletal Muscle Mass row in Research Parameters — the 270S prints one, the 270 does not',
}

const ALL_FIELDS: (keyof InBodyInput)[] = [
  'smm', 'smmLow', 'smmHigh',
  'pbf', 'pbfLow', 'pbfHigh',
  'tbw', 'tbwLow', 'tbwHigh',
  'fatLArm', 'fatRArm', 'fatTrunk', 'fatLLeg', 'fatRLeg',
]

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * OCR damage that is safe to undo. Everything here is a case where the intended character is
 * not in doubt; anything less certain is left alone, because a repair that guesses is worse
 * than a field reported as unread.
 *
 *   - punctuation swept up at the end of a word — "94.0%," for "94.0%"
 *   - the open bracket of "(L)" read as nothing at all
 *   - a decimal point read as a colon or semicolon — "15:3" for "15.3". Restricted to a
 *     single digit after the separator, which is what keeps the clock out of it: a time is
 *     always "16:04", never "16:4".
 */
function tidy(tokens: Token[]): Token[] {
  return tokens
    .map((t) => {
      let text = t.text.trim().replace(/[,.;:]+$/, '')
      if (/^[Ll]\)$/.test(text)) text = '(L)'
      if (/^\d+[:;]\d$/.test(text)) text = text.replace(/[:;]/, '.')
      // Inside a range there is no clock to confuse it with, so both figures can be repaired.
      if (text.includes('~')) text = text.replace(/(\d)[:;](\d)/g, '$1.$2')
      return { ...t, text }
    })
    .filter((t) => t.text.length > 0)
}

// ---------------------------------------------------------------------------
// finding things by label, which works on a photograph and not on a PDF

/** Rows whose text contains the label, nearest the top of the page first. */
function labelled(rows: Row[], label: RegExp): { row: Row; at: number }[] {
  const out: { row: Row; at: number }[] = []
  for (const row of rows) {
    const m = label.exec(rowText(row))
    if (!m) continue
    // Where the label ends, in x — the figure it introduces is to the right of it.
    const words = m[0].split(/\s+/)
    const last = words[words.length - 1].toLowerCase()
    const token = row.find((t) => t.text.toLowerCase().replace(/[^a-z]/g, '') === last.replace(/[^a-z]/g, ''))
    out.push({ row, at: token ? token.x : -Infinity })
  }
  return out
}

/** A labelled row's `value ( low ~ high )`, taking only what sits right of the label. */
function labelledRange(
  rows: Row[],
  label: RegExp,
): { value: number; low: number; high: number } | undefined {
  for (const { row, at } of labelled(rows, label)) {
    const right = row.filter((t) => t.x > at)
    const spanAt = right.findIndex((t) => range(t.text) !== undefined)
    if (spanAt < 0) continue
    const span = range(right[spanAt].text)!
    const value = right
      .slice(0, spanAt)
      .map((t) => numeric(t.text))
      .filter((n) => n !== undefined)
      .pop()
    if (value !== undefined) return { value, low: span[0], high: span[1] }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// finding things by position, which works on a PDF and not on a photograph

/** "[InBody270S]" -> "InBody270S". */
function readModel(rows: Row[]): string | null {
  for (const r of rows) {
    // OCR capitalises the marker unevenly — "INBody270S" — so the brand is written back the
    // way InBody writes it and only the model number is taken as read.
    const m = /\[\s*InBody\s*([\w-]+)\s*\]/i.exec(rowText(r))
    if (m) return `InBody${m[1].replace(/\s+/g, '')}`
  }
  return null
}

/**
 * The header strip: member ID, height, age, test date. Sex is deliberately not taken from
 * here — the PDFs draw it as artwork — so it comes from the client record, which is a better
 * source anyway.
 */
function readHeader(rows: Row[], scan: InBodyScan) {
  let headerAt = -1
  for (const [i, r] of rows.entries()) {
    const text = rowText(r)
    const h = /(\d{2,3}(?:\.\d)?)\s*cm/.exec(text)
    const d = /(\d{2})\.(\d{2})\.(\d{4})\.?\s+(\d{2}:\d{2})/.exec(text)
    if (!h || !d) continue
    headerAt = i
    scan.heightCm = Number(h[1])
    scan.testDate = `${d[3]}-${d[2]}-${d[1]}`
    const id = r.find((t) => /^\d{6,}$/.test(t.text))
    if (id) scan.memberId = id.text
    // Age is the bare 1–3 digit token between the height and the date.
    const hx = r.find((t) => /cm/.test(t.text))?.x ?? 0
    const age = r.find((t) => t.x > hx && /^\d{1,3}$/.test(t.text))
    if (age) scan.age = Number(age.text)
    break
  }
  // Some sheets print the client's name in brackets directly under the ID. Searched only
  // there: further down the page "(kg)" is a bracketed word too.
  if (headerAt < 0) return
  for (const r of rows.slice(headerAt + 1, headerAt + 3)) {
    const m = /^\(([^()]+)\)$/.exec(rowText(r).trim())
    if (m && /[A-Za-z]{2}/.test(m[1]) && !/\d/.test(m[1]) && m[1].trim().length > 2) {
      scan.name = m[1].trim()
      break
    }
  }
}

/**
 * Body Composition Analysis: five rows of `unit value ( low ~ high )`, always in the order
 * Total Body Water, Protein, Minerals, Body Fat Mass, Weight. Total Body Water is the only
 * row in litres so it names itself; the rest are counted from the bottom, Weight last and
 * Body Fat Mass above it.
 */
interface CompositionRow {
  unit: string
  value: number
  low: number
  high: number
}

function readComposition(rows: Row[]): CompositionRow[] {
  const out: CompositionRow[] = []
  for (const r of rows) {
    const unit = r.find((t) => /^\((kg|L|l)\)$/.test(t.text.trim()))
    if (!unit) continue
    const spanAt = r.findIndex((t) => range(t.text) !== undefined)
    if (spanAt < 0) continue
    const span = range(r[spanAt].text)!
    const value = r
      .filter((t) => t.x > unit.x && t.x < r[spanAt].x)
      .map((t) => numeric(t.text))
      .find((n) => n !== undefined)
    if (value === undefined) continue
    out.push({ unit: unit.text.replace(/[()]/g, '').toLowerCase(), value, low: span[0], high: span[1] })
  }
  return out
}

/**
 * The Muscle-Fat and Obesity bar charts: a row of eleven scale numbers with the measured
 * value printed on the line below, in reading order — Weight, Skeletal Muscle Mass, Body Fat
 * Mass, then BMI and Percent Body Fat. Nothing here names itself, so the order is the whole
 * identification, which is why the caller checks the first value against the weight from the
 * composition table before believing any of them.
 */
function readBarValues(rows: Row[], pageWidth: number): number[] {
  const values: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const scale = rows[i].filter((t) => numeric(t.text) !== undefined)
    if (scale.length < 8) continue
    const left = Math.min(...scale.map((t) => t.x))
    const right = Math.max(...scale.map((t) => t.x))
    // A scale spans the chart. Measured against the page, because the same sheet arrives as
    // points from a PDF and as pixels from a photograph.
    if (right - left < pageWidth * 0.25) continue
    for (let j = i + 1; j < Math.min(i + 4, rows.length); j++) {
      const candidates = rows[j].filter(
        (t) => numeric(t.text) !== undefined && t.x >= left && t.x <= right,
      )
      if (candidates.length === 1) {
        values.push(numeric(candidates[0].text)!)
        break
      }
      if (candidates.length > 1) break // another scale row — this chart printed no value
    }
  }
  return values
}

/**
 * Research Parameters rows — `value unit ( low ~ high )` — with the composition table's rows
 * excluded. A composition row carries its unit in brackets, "(kg)"; a research row prints a
 * bare "kg" or "kcal". That is what tells the two blocks apart without knowing where either
 * sits on the page.
 */
function researchRows(rows: Row[]): { value: number; span: [number, number]; kg: boolean }[] {
  const out: { value: number; span: [number, number]; kg: boolean }[] = []
  for (const r of rows) {
    if (r.some((t) => /^\((kg|L|l)\)$/.test(t.text.trim()))) continue
    const spanAt = r.findIndex((t) => range(t.text) !== undefined)
    if (spanAt < 0) continue
    const span = range(r[spanAt].text)!
    // The value is the nearest number LEFT of the range, not the first on the line: a research
    // row shares its baseline with a bar-chart value on the far side of the page.
    const value = r
      .slice(0, spanAt)
      .map((t) => numeric(t.text))
      .filter((n) => n !== undefined)
      .pop()
    // The bare unit separates the mass rows from the rest of the block — Skeletal Muscle Mass
    // and Fat Free Mass are in kg where Basal Metabolic Rate is in kcal and Obesity Degree
    // is a percentage.
    if (value !== undefined) out.push({ value, span, kg: r.some((t) => /^kg$/i.test(t.text.trim())) })
  }
  return out
}

/**
 * The two segmental panels, printed side by side as three rows each — arms (two figures),
 * trunk (one), legs (two). Both panels have the same shape, so shape alone cannot say which
 * is the fat one, and getting it backwards would hand the layer lean percentages to judge
 * body fat by.
 *
 * Two independent ways to tell, because the two input paths break differently:
 *
 *   - The panel headings. A photograph reads "Segmental Lean Analysis" and "Segmental Fat
 *     Analysis" cleanly; a PDF has neither, they are artwork.
 *   - The masses above each percentage. Segmental fat masses sum to roughly the whole-body
 *     Body Fat Mass already read from the composition table — within about 1.2 kg on the
 *     sheets here — where the lean masses land some 40 kg away. A PDF reads those masses
 *     exactly; OCR turns "3.01kg" into ".3:01kg" often enough not to be relied on.
 *
 * Within a panel the sheet labels its own edges "Left" and "Right", left column first.
 */
interface Segmental {
  lArm: number
  rArm: number
  trunk: number
  lLeg: number
  rLeg: number
}

function readSegmental(
  rows: Row[],
  bodyFatKg: number | undefined,
): { fat?: Segmental; note?: string; how?: string } {
  const pctRows = rows
    .map((r) => r.filter((t) => joinedPercent(t.text) !== undefined))
    .filter((r) => r.length >= 2)
  if (pctRows.length !== 3)
    return { note: `the segmental panels should hold three rows of percentages, this sheet gave ${pctRows.length}` }
  if (pctRows.some((r) => r.length % 2 !== 0))
    return { note: 'the two segmental panels do not hold the same number of readings' }

  const halves = (r: Row) => [r.slice(0, r.length / 2), r.slice(r.length / 2)] as const

  // -- heading test
  let fatSide: 0 | 1 | null = null
  let how: string | undefined
  const heading = rows.find((r) => /segmental.*segmental/is.test(rowText(r)))
  if (heading) {
    const lean = heading.find((t) => /^lean$/i.test(t.text))
    const fat = heading.find((t) => /^fat$/i.test(t.text))
    if (lean && fat) {
      const split = (lean.x + fat.x) / 2
      const sides = pctRows.map((r) => (halves(r)[1][0].x > split ? 1 : 0))
      if (sides.every((s) => s === sides[0])) {
        fatSide = sides[0] as 0 | 1
        how = 'the panel headings'
      }
    }
  }

  // -- mass test
  const kgRows = rows
    .map((r) => r.filter((t) => joinedKg(t.text) !== undefined))
    .filter((r) => r.length >= 2 && r.length % 2 === 0)
  let byMass: 0 | 1 | null = null
  if (kgRows.length === 3 && bodyFatKg !== undefined) {
    const sumOf = (side: 0 | 1) =>
      kgRows.reduce((s, r) => s + halves(r)[side].reduce((a, t) => a + joinedKg(t.text)!, 0), 0)
    byMass = Math.abs(sumOf(0) - bodyFatKg) < Math.abs(sumOf(1) - bodyFatKg) ? 0 : 1
  }

  let note: string | undefined
  if (fatSide !== null && byMass !== null && fatSide !== byMass)
    note = 'the segmental headings and the segmental masses disagree about which panel is the fat one, so the headings were followed'
  if (fatSide === null) {
    if (byMass === null)
      return {
        note: 'the fat panel could not be told from the lean one — neither the headings nor the segmental masses were readable',
      }
    fatSide = byMass
    how = 'the segmental masses, checked against whole-body Body Fat Mass'
  }

  const pick = (row: Row) => halves(row)[fatSide as 0 | 1].map((t) => joinedPercent(t.text)!)
  const [arms, trunk, legs] = pctRows.map(pick)
  if (arms.length !== 2 || trunk.length !== 1 || legs.length !== 2)
    return { note: 'the segmental panel is not shaped like arms / trunk / legs' }

  return {
    fat: { lArm: arms[0], rArm: arms[1], trunk: trunk[0], lLeg: legs[0], rLeg: legs[1] },
    note,
    how,
  }
}

// ---------------------------------------------------------------------------

/**
 * @param tolerance how far apart two baselines may be and still count as one printed line.
 *   A PDF's points and a photograph's pixels are not the same size, so the caller sets it
 *   from the thing it is actually looking at.
 */
export function readInBodyTokens(rawTokens: Token[], ocr = false, tolerance = 3): InBodyScan {
  const tokens = tidy(rawTokens)
  const rows = toRows(tokens, tolerance)
  const scan: InBodyScan = {
    model: readModel(rows),
    readings: {},
    sources: {},
    missing: [],
    warnings: [],
    ocr,
  }
  readHeader(rows, scan)

  const set = <K extends keyof InBodyInput>(key: K, value: number, from: string) => {
    scan.readings[key] = round1(value) as InBodyInput[K]
    scan.sources[key] = from
  }

  // ---- total body water
  const comp = readComposition(rows)
  const tbw =
    labelledRange(rows, /total\s+body\s+water/i) ??
    (() => {
      const litres = comp.find((c) => c.unit === 'l')
      return litres ? { value: litres.value, low: litres.low, high: litres.high } : undefined
    })()
  if (tbw) {
    const src = 'Body Composition Analysis, Total Body Water'
    set('tbw', tbw.value, src)
    set('tbwLow', tbw.low, src)
    set('tbwHigh', tbw.high, src)
  }

  // ---- weight and body fat mass, which everything else is checked against
  const labelledWeight = labelledRange(rows, /sum\s+of\s+the\s+above|^weight\b/i)
  const labelledFat = labelledRange(rows, /body\s+fat\s+mass/i)
  // Counting Weight and Body Fat Mass off the end of the table only means anything if the
  // whole table parsed — Protein, Minerals, Body Fat Mass, Weight. Lose one row to a smudged
  // digit and the count silently reads Body Fat Mass as the weight, which is exactly what a
  // photograph of this sheet did. Labels first, and the count only when it is whole.
  const kgRows = comp.filter((c) => c.unit === 'kg')
  const wholeTable = kgRows.length === 4
  scan.weightKg = labelledWeight?.value ?? (wholeTable ? kgRows[3].value : undefined)
  scan.bodyFatKg = labelledFat?.value ?? (wholeTable ? kgRows[2].value : undefined)
  // Fat Free Mass is the larger of the two kilogram rows in Research Parameters; the smaller
  // is Skeletal Muscle Mass, and on a 270 there is only the one. Taken by unit and size
  // rather than by position, so it does not matter which model printed which row first.
  const kgResearch = researchRows(rows)
    .filter((r) => r.kg)
    .map((r) => r.value)
  scan.fatFreeKg =
    labelledRange(rows, /fat\s+free\s+mass/i)?.value ??
    (kgResearch.length ? Math.max(...kgResearch) : undefined)

  // A sheet's three masses are one identity — fat free mass and body fat mass are what weight
  // is the sum of, and on all three sample sheets they add up to the printed weight exactly.
  // So any one of them recovers from the other two, which is what saves the photograph here:
  // OCR read 15.3 kg of fat and 55.8 kg of lean off it cleanly and turned the weight into
  // "a.". Recovering it is arithmetic the sheet itself asserts, not an estimate.
  const identity = (a?: number, b?: number) => (a !== undefined && b !== undefined ? a + b : undefined)
  if (scan.weightKg === undefined) {
    const recovered = identity(scan.bodyFatKg, scan.fatFreeKg)
    if (recovered !== undefined) {
      scan.weightKg = round1(recovered)
      scan.warnings.push(
        `weight was not legible on this sheet, so it was recovered as body fat ${scan.bodyFatKg} kg plus fat free mass ${scan.fatFreeKg} kg`,
      )
    }
  } else if (scan.bodyFatKg === undefined && scan.fatFreeKg !== undefined) {
    scan.bodyFatKg = round1(scan.weightKg - scan.fatFreeKg)
    scan.warnings.push(
      `body fat mass was not legible on this sheet, so it was recovered as weight less fat free mass`,
    )
  } else if (
    scan.weightKg !== undefined &&
    scan.bodyFatKg !== undefined &&
    scan.fatFreeKg !== undefined &&
    Math.abs(scan.weightKg - scan.bodyFatKg - scan.fatFreeKg) > 0.15
  ) {
    scan.warnings.push(
      `the sheet's masses do not add up: ${scan.bodyFatKg} kg fat and ${scan.fatFreeKg} kg lean against a weight of ${scan.weightKg} kg`,
    )
  }

  if (
    scan.weightKg !== undefined &&
    scan.bodyFatKg !== undefined &&
    scan.bodyFatKg >= scan.weightKg
  ) {
    scan.warnings.push(
      `the composition table reads body fat ${scan.bodyFatKg} kg against a weight of ${scan.weightKg} kg, which cannot be right — neither row was used`,
    )
    scan.weightKg = undefined
    scan.bodyFatKg = undefined
  }

  // ---- skeletal muscle mass, and its range where the sheet carries one
  const xs = tokens.map((t) => t.x)
  const pageWidth = Math.max(...xs) - Math.min(...xs)
  const bars = readBarValues(rows, pageWidth)
  const barsAgree =
    scan.weightKg !== undefined && bars.length >= 3 && Math.abs(bars[0] - scan.weightKg) < 0.15

  const research = labelledRange(rows, /skeletal\s+muscle\s+mass/i)
  if (research) {
    set('smm', research.value, 'Research Parameters, Skeletal Muscle Mass')
    set('smmLow', research.low, 'Research Parameters, Skeletal Muscle Mass')
    set('smmHigh', research.high, 'Research Parameters, Skeletal Muscle Mass')
    if (barsAgree && Math.abs(bars[1] - research.value) > 0.15)
      scan.warnings.push(
        `Research Parameters gives skeletal muscle mass as ${research.value} kg where the Muscle-Fat bar reads ${bars[1]} kg`,
      )
  } else if (barsAgree) {
    set('smm', bars[1], 'Muscle-Fat Analysis, Skeletal Muscle Mass')
    // No label to go on, so the research row is found by its value matching the bar's. On a
    // 270 nothing matches, because that model has no muscle row there at all.
    const span = researchRows(rows).find((r) => Math.abs(r.value - bars[1]) < 0.05)?.span
    if (span) {
      set('smmLow', span[0], 'Research Parameters, Skeletal Muscle Mass')
      set('smmHigh', span[1], 'Research Parameters, Skeletal Muscle Mass')
    }
  } else if (bars.length) {
    scan.warnings.push(
      scan.weightKg === undefined
        ? 'the Muscle-Fat bars could not be checked against the composition table, so skeletal muscle mass was not taken from them'
        : `the first Muscle-Fat bar reads ${bars[0]} where the composition table says ${scan.weightKg} kg, so the bar figures were not trusted`,
    )
  }

  // ---- percent body fat. The machine's own printed figure wins wherever the bar sequence has
  // been shown to line up, because InBody computes it from unrounded internals: 17.7 kg over
  // 87.4 kg gives 20.3% where the sheet, working from the figures behind those, prints 20.2%.
  // Fat mass over weight is the fallback — the only route on a photograph, where the bars do
  // not survive OCR — and the check either way.
  const derivedPbf =
    scan.weightKg !== undefined && scan.bodyFatKg !== undefined && scan.weightKg > 0
      ? (scan.bodyFatKg / scan.weightKg) * 100
      : undefined
  const printedPbf = barsAgree && bars.length >= 5 ? bars[4] : undefined
  if (printedPbf !== undefined) set('pbf', printedPbf, 'Obesity Analysis, Percent Body Fat')
  else if (derivedPbf !== undefined)
    set('pbf', derivedPbf, 'Body Fat Mass over Weight, from the composition table')
  if (printedPbf !== undefined && derivedPbf !== undefined && Math.abs(printedPbf - derivedPbf) > 0.6)
    scan.warnings.push(
      `the sheet prints percent body fat as ${printedPbf}% where its own fat mass and weight give ${round1(derivedPbf)}%`,
    )

  // ---- segmental fat
  const seg = readSegmental(rows, scan.bodyFatKg)
  if (seg.fat) {
    const src = `Segmental Fat Analysis, told from the lean panel by ${seg.how}`
    set('fatLArm', seg.fat.lArm, src)
    set('fatRArm', seg.fat.rArm, src)
    set('fatTrunk', seg.fat.trunk, src)
    set('fatLLeg', seg.fat.lLeg, src)
    set('fatRLeg', seg.fat.rLeg, src)
  }
  if (seg.note) scan.warnings.push(seg.note)

  scan.missing = ALL_FIELDS.filter((f) => scan.readings[f] === undefined)
  return scan
}
