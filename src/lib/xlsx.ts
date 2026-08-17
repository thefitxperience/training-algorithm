/**
 * Just enough .xlsx to read a VALD DynaMo export: one sheet, shared strings, no formulas,
 * no styles. An .xlsx is a ZIP of XML, and both halves are things the platform already
 * has — `DecompressionStream('deflate-raw')` and `DOMParser` — so this costs no dependency.
 *
 * Deliberately narrow. It reads the first worksheet as a grid of strings and stops there;
 * anything richer belongs in a real library, and nothing here needs one.
 */

interface ZipEntry {
  name: string
  compression: number
  data: Uint8Array
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

/**
 * Read the ZIP through its END-OF-CENTRAL-DIRECTORY record, not by scanning for local
 * headers. Local headers can carry zeroed sizes with the real ones in a trailing data
 * descriptor, which a forward scan silently truncates; the central directory always holds
 * the true sizes.
 */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf)
  const view = dv(b)

  // EOCD signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found).')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)

  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const compression = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen))

    // The local header's own name/extra lengths decide where the payload starts — they can
    // differ from the central directory's.
    const lNameLen = view.getUint16(localOffset + 26, true)
    const lExtraLen = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + lNameLen + lExtraLen
    entries.push({ name, compression, data: b.subarray(start, start + compressedSize) })

    p += 46 + nameLen + extraLen + commentLen
  }

  const out = new Map<string, Uint8Array>()
  for (const e of entries) {
    if (e.compression === 0) {
      out.set(e.name, e.data)
      continue
    }
    if (e.compression !== 8) continue // only stored and deflate appear in an .xlsx
    const stream = new Blob([e.data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    out.set(e.name, new Uint8Array(await new Response(stream).arrayBuffer()))
  }
  return out
}

/** "BC" -> 54. Column letters are base-26 with no zero. */
export function colToIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

/** A worksheet as rows of cells, indexed by column, with gaps preserved as ''. */
export type Grid = string[][]

export async function readFirstSheet(buf: ArrayBuffer): Promise<Grid> {
  const files = await unzip(buf)
  const decode = (name: string) => {
    const raw = files.get(name)
    return raw ? new TextDecoder().decode(raw) : null
  }
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

  // Shared strings: every `<si>` is one string, possibly split across `<t>` runs.
  const shared: string[] = []
  const ssXml = decode('xl/sharedStrings.xml')
  if (ssXml) {
    for (const si of parse(ssXml).getElementsByTagName('si')) {
      let s = ''
      for (const t of si.getElementsByTagName('t')) s += t.textContent ?? ''
      shared.push(s)
    }
  }

  // Follow the workbook's relationships rather than assuming sheet1.xml — exports from
  // other tools name the part differently and the first sheet is not always sheet1.
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wbXml = decode('xl/workbook.xml')
  const relXml = decode('xl/_rels/workbook.xml.rels')
  if (wbXml && relXml) {
    const firstSheet = parse(wbXml).getElementsByTagName('sheet')[0]
    const rid = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttribute('id')
    if (rid) {
      for (const rel of parse(relXml).getElementsByTagName('Relationship')) {
        if (rel.getAttribute('Id') !== rid) continue
        const target = rel.getAttribute('Target') ?? ''
        sheetPath = target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, '')}`
      }
    }
  }

  const sheetXml = decode(sheetPath)
  if (!sheetXml) throw new Error('That .xlsx has no readable worksheet.')

  const grid: Grid = []
  for (const row of parse(sheetXml).getElementsByTagName('row')) {
    const cells: string[] = []
    for (const c of row.getElementsByTagName('c')) {
      const at = colToIndex(c.getAttribute('r') ?? '')
      const type = c.getAttribute('t')
      let value = ''
      if (type === 'inlineStr') {
        for (const t of c.getElementsByTagName('t')) value += t.textContent ?? ''
      } else {
        const v = c.getElementsByTagName('v')[0]
        value = v?.textContent ?? ''
        if (type === 's' && value !== '') value = shared[Number(value)] ?? ''
      }
      if (at >= 0) {
        while (cells.length < at) cells.push('')
        cells[at] = value
      }
    }
    grid.push(cells)
  }
  return grid
}

/** Excel serial date -> ISO yyyy-mm-dd. Day 1 is 1900-01-01, with the 1900 leap-year bug. */
export function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  const ms = (serial - 25569) * 86400000
  const d = new Date(Math.round(ms))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
