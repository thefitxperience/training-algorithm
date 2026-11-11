/**
 * Imports source/UDRA-new-modality-exercises_1.xlsx into public/data/exercises.json:
 *
 *   - "New exercises": 214 rows, added with ids 1000 + their "#" (stable across re-imports)
 *   - "Calisthenics ladders": every rung, so library rows on a ladder (hands-elevated push-up,
 *     pull-up, dead hang…) get their family and rung too
 *   - "Already in gym library": the modality ticked on the existing row instead of a duplicate
 *
 * Re-runnable: rows it added before are dropped and every modality field is rebuilt from the
 * sheet, so the coaches edit the sheet and this is run again.
 *
 *   npx tsx scripts/importModalities.ts [path.xlsx]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { readSheets, type Grid } from '../src/lib/xlsx'
import type { Exercise, Ladder, Modality } from '../src/types'
import { injuryRecord } from './modalityInjury'

;(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser

const SOURCE = process.argv[2] ?? join(process.cwd(), 'source', 'UDRA-new-modality-exercises_1.xlsx')
const OUT = join(process.cwd(), 'public', 'data', 'exercises.json')
/** injury records for the new rows: the spec's injury.json is never edited, this sits beside it */
const INJURY_OUT = join(process.cwd(), 'public', 'data', 'injury-modalities.json')
const ID_BASE = 1000
const MODALITIES = ['Gym', 'Calisthenics', 'CrossFit', 'Mat Pilates', 'Reformer Pilates'] as const

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

async function main() {
  const buf = readFileSync(SOURCE)
  const sheets = await readSheets(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const sheet = (name: string): Grid => {
    const g = sheets.get(name)
    if (!g) throw new Error(`Sheet "${name}" is missing from ${SOURCE}`)
    return g
  }

  const all: Exercise[] = JSON.parse(readFileSync(OUT, 'utf8'))
  // Start from the library as it was before any import: no imported rows, no modality fields.
  const library = all
    .filter((e) => e.id < ID_BASE)
    .map(({ modalities: _m, ladders: _l, tags: _t, ...e }) => e as Exercise)
  const subOfCode = new Map(library.map((e) => [e.code, e.sub]))
  const byName = new Map(library.map((e) => [norm(e.name), e]))
  const problems: string[] = []

  // ---- New exercises ---------------------------------------------------------------------
  const rows = sheet('New exercises')
  const head = rows[0].map((h) => h.trim())
  const col = (h: string) => {
    const i = head.indexOf(h)
    if (i < 0) throw new Error(`Column "${h}" is missing from "New exercises"`)
    return i
  }
  const C = Object.fromEntries(
    ['#', 'Modality', 'Muscle group', 'Sub-region', 'Code', 'Exercise', 'Equipment', 'Also trains', 'Tags', 'Movement type', 'Tier', 'Skill (1-5)', 'Load (1-5)', 'Avoid ages', 'Progression family', 'Level', ...MODALITIES].map((h) => [h, col(h)]),
  )
  const added: Exercise[] = []
  for (const r of rows.slice(1)) {
    const n = Number(r[C['#']])
    const name = (r[C.Exercise] ?? '').trim()
    if (!n || !name) continue
    if (byName.has(norm(name))) problems.push(`"${name}" is already in the library — tick its modality in "Already in gym library" instead`)
    const code = r[C.Code].trim()
    const sub = subOfCode.get(code)
    if (!sub) problems.push(`"${name}": code ${code} is not a sub-region in the library`)
    const alsoCodes = (r[C['Also trains']] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const alsoTrains = alsoCodes.map((c) => {
      const s = subOfCode.get(c)
      if (!s) problems.push(`"${name}": also-trains code ${c} is not a sub-region`)
      return s ?? c
    })
    const modalities = MODALITIES.filter((m) => (r[C[m]] ?? '').trim().toLowerCase() === 'yes')
    if (!modalities.includes(r[C.Modality].trim() as (typeof MODALITIES)[number]))
      problems.push(`"${name}": its own modality (${r[C.Modality]}) is not ticked`)
    const type = r[C['Movement type']].trim().toLowerCase() as Exercise['type']
    const tier = r[C.Tier].trim().toLowerCase() as Exercise['tier']
    const load = Number(r[C['Load (1-5)']])
    const family = (r[C['Progression family']] ?? '').trim()
    const rung = Number(r[C.Level])
    added.push({
      id: ID_BASE + n,
      name,
      group: r[C['Muscle group']].trim(),
      sub: sub ?? r[C['Sub-region']].trim(),
      code,
      equipment: equipmentOf(r[C.Equipment]),
      alsoTrains,
      type,
      tier,
      skill: Number(r[C['Skill (1-5)']]),
      load,
      avoidAges: (r[C['Avoid ages']] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      // A heavy loaded compound leads its family in the session, as the library's main lifts do.
      mainLift: tier === 'primary' && type === 'compound' && load >= 4 && /\bBB\b/.test(r[C.Equipment]),
      modalities: [...modalities],
      ...(family && rung ? { ladders: [{ family, rung }] } : {}),
      tags: (r[C.Tags] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    })
  }
  const byNameAll = new Map([...library, ...added].map((e) => [norm(e.name), e]))

  // ---- Already in gym library: tick the modality on the existing row -----------------------
  const tick = new Map<number, Set<Modality>>()
  const already = sheet('Already in gym library')
  for (const r of already) {
    const modality = (r[0] ?? '').trim()
    if (!MODALITIES.includes(modality as (typeof MODALITIES)[number])) continue
    for (const raw of (r[2] ?? '').split(',')) {
      const want = norm(raw.replace(/,?\s*light$/i, ''))
      if (!want) continue
      const ex = byName.get(want) ?? library.find((e) => norm(e.name).startsWith(want))
      if (!ex) {
        problems.push(`"Already in gym library": no library row called "${raw.trim()}" (${modality})`)
        continue
      }
      if (!tick.has(ex.id)) tick.set(ex.id, new Set())
      tick.get(ex.id)!.add(modality as Modality)
    }
  }

  // ---- Calisthenics ladders: every rung, library rows included ------------------------------
  const ladderOf = new Map<number, Ladder[]>()
  let family = ''
  for (const r of sheet('Calisthenics ladders')) {
    if (r[0]?.trim() === 'New equipment tokens introduced by these exercises') break
    if (r[0]?.trim()) family = r[0].trim()
    const rung = Number(r[1])
    const name = (r[2] ?? '').trim()
    if (!family || !rung || !name || family === 'Progression family') continue
    // "Scapular pull-up / dead-hang retraction" and "Pull-up" are library names, as written.
    const ex = byNameAll.get(norm(name)) ?? [...library, ...added].find((e) => norm(e.name).startsWith(norm(name.split('/')[0])))
    if (!ex) {
      problems.push(`Ladder "${family}" rung ${rung}: no exercise called "${name}"`)
      continue
    }
    if (!ladderOf.has(ex.id)) ladderOf.set(ex.id, [])
    const list = ladderOf.get(ex.id)!
    if (!list.some((l) => l.family === family)) list.push({ family, rung })
  }

  // ---- Write ----------------------------------------------------------------------------------
  const out: Exercise[] = [
    ...library.map((e) => {
      const extra = tick.get(e.id)
      const ladders = ladderOf.get(e.id)
      // A library row on a calisthenics ladder is calisthenics work too.
      const modalities = new Set<Modality>(['Gym', ...(extra ?? []), ...(ladders ? (['Calisthenics'] as Modality[]) : [])])
      return { ...e, ...(modalities.size > 1 && { modalities: [...modalities] }), ...(ladders && { ladders }) }
    }),
    ...added.map((e) => {
      const ladders = ladderOf.get(e.id)
      return ladders ? { ...e, ladders } : e
    }),
  ]
  writeFileSync(OUT, JSON.stringify(out))

  // Every new row gets an injury record, keyed the way the library's rows with its code are.
  const injury = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'injury.json'), 'utf8')) as {
    exercises: { id: number; key: string }[]
  }
  const keyById = new Map(injury.exercises.map((r) => [r.id, r.key]))
  const keyOfCode = new Map<string, string>()
  for (const e of library) if (keyById.has(e.id) && !keyOfCode.has(e.code)) keyOfCode.set(e.code, keyById.get(e.id)!)
  const records = added.map((e) => injuryRecord(e, keyOfCode))
  writeFileSync(
    INJURY_OUT,
    JSON.stringify(
      {
        note: 'Injury records for the modality sheet\'s new exercises (scripts/modalityInjury.ts), merged into injury.json\'s exercises at load. Generated: edit the rules there, not this file.',
        exercises: records,
      },
      null,
      1,
    ) + '\n',
  )
  for (const r of records) if ('unreviewed' in r) problems.push(`"${r.name}": no injury rule matched — add one in scripts/modalityInjury.ts`)

  const count = (m: Modality) => out.filter((e) => (e.modalities ?? ['Gym']).includes(m)).length
  console.log(`${library.length} library rows, ${added.length} added, ${tick.size} library rows ticked, ${ladderOf.size} on ladders`)
  console.log(MODALITIES.map((m) => `${m}: ${count(m)}`).join(' · '))
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exitCode = 1
  }
}

/**
 * The sheet writes a reformer exercise as "reformer / straps" — the reformer AND its straps,
 * not alternatives the way "/" reads everywhere else in the library. Every reformer comes with
 * straps and a box; the jumpboard is the one add-on a studio may not own.
 */
function equipmentOf(raw: string): string {
  const s = raw.trim()
  if (/^reformer/i.test(s)) return /jumpboard/i.test(s) ? 'reformer + jumpboard' : 'reformer'
  return s
}

main()
