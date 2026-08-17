import { readInBodyTokens, type InBodyScan } from './inbodyScan'
import type { Token } from './inbodyTokens'

/**
 * Turns an uploaded InBody sheet — a PDF export or a photograph of the printout — into
 * positioned words for `readInBodyTokens`.
 *
 * A PDF is tried through its text layer first: it is exact, instant, and needs nothing
 * downloaded. Only if that yields no sheet does the page get rasterised and read by OCR,
 * which is also the path a photograph always takes.
 *
 * Everything heavy is imported at the moment it is needed. Tesseract pulls several megabytes
 * of engine and language data, and a trainer who only ever uploads PDF exports should never
 * pay for it.
 */

export type ScanProgress = (stage: string, fraction?: number) => void

/** Enough of a sheet to be worth trusting: the composition table and the segmental panel. */
function looksRead(scan: InBodyScan): boolean {
  return scan.weightKg !== undefined && scan.readings.tbw !== undefined
}

async function pdfjs() {
  const lib = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  lib.GlobalWorkerOptions.workerSrc = worker
  return lib
}

/** The text layer, straight from the PDF: exact coordinates and no download. */
async function tokensFromTextLayer(data: ArrayBuffer): Promise<Token[]> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: data.slice(0) }).promise
  const out: Token[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      out.push({ x: item.transform[4], y: item.transform[5], text: item.str.trim() })
    }
  }
  return out
}

/**
 * A page or a photograph, enlarged onto white.
 *
 * The size is not incidental. Tesseract read the weight on the sample photograph as "TAN" at
 * its native 1640 px and as "71.1" at 2400, and the same enlargement is what recovers the
 * segmental headings the fat panel is identified by. PDFs are rasterised at the same width
 * for the same reason.
 */
const OCR_WIDTH = 3000

async function canvasFromImage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.max(1, OCR_WIDTH / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas
}

async function canvasesFromPdf(data: ArrayBuffer): Promise<HTMLCanvasElement[]> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: data.slice(0) }).promise
  const out: HTMLCanvasElement[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: OCR_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    // A PDF renders onto transparency; OCR needs it on white.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    out.push(canvas)
  }
  return out
}

/**
 * OCR, as positioned words rather than as a block of text. Word boxes are the whole point:
 * the reader tells the fat panel from the lean one, and a research row from a composition
 * row, by where things sit, and a flattened transcript throws that away.
 *
 * `y` is negated because image coordinates run downward and page coordinates run up.
 */
async function tokensFromCanvases(
  canvases: HTMLCanvasElement[],
  onProgress?: ScanProgress,
): Promise<{ tokens: Token[]; tolerance: number }> {
  const { createWorker, PSM } = await import('tesseract.js')
  onProgress?.('Loading the text reader')
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.('Reading the sheet', m.progress)
    },
  })
  try {
    // An InBody sheet is two columns of small labelled blocks, not flowing prose.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    const tokens: Token[] = []
    const heights: number[] = []
    let offset = 0
    for (const canvas of canvases) {
      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      for (const block of data.blocks ?? [])
        for (const para of block.paragraphs ?? [])
          for (const line of para.lines ?? [])
            for (const word of line.words ?? []) {
              if (!word.text.trim()) continue
              heights.push(word.bbox.y1 - word.bbox.y0)
              tokens.push({ x: word.bbox.x0, y: -(word.bbox.y0 + offset), text: word.text.trim() })
            }
      offset += canvas.height
    }
    // Baselines that count as one line, taken from the type on this particular sheet rather
    // than from a constant: a PDF measures in points and a photograph in pixels.
    heights.sort((a, b) => a - b)
    const median = heights[Math.floor(heights.length / 2)] ?? 6
    return { tokens, tolerance: Math.max(3, Math.round(median / 2)) }
  } finally {
    await worker.terminate()
  }
}

/**
 * The words on the page, however they have to be got at. Exported separately from the reader
 * so what the page actually said can be inspected when a sheet reads short — the difference
 * between "the parser is wrong" and "OCR turned 71.1 into TAN" is not one to guess at.
 */
export async function tokensFromFile(
  file: File,
  onProgress?: ScanProgress,
): Promise<{ tokens: Token[]; tolerance: number; ocr: boolean }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

  if (isPdf) {
    const data = await file.arrayBuffer()
    onProgress?.('Reading the PDF')
    const tokens = await tokensFromTextLayer(data)
    if (looksRead(readInBodyTokens(tokens, false, 3))) return { tokens, tolerance: 3, ocr: false }
    // Some exports carry no text layer at all. Rasterise and read the page as a picture.
    onProgress?.('That PDF holds no text, reading it as a picture')
    return { ...(await tokensFromCanvases(await canvasesFromPdf(data), onProgress)), ocr: true }
  }

  onProgress?.('Preparing the image')
  return { ...(await tokensFromCanvases([await canvasFromImage(file)], onProgress)), ocr: true }
}

export async function readInBodyFile(file: File, onProgress?: ScanProgress): Promise<InBodyScan> {
  const { tokens, tolerance, ocr } = await tokensFromFile(file, onProgress)
  return readInBodyTokens(tokens, ocr, tolerance)
}
