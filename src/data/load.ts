import type {
  Allocation,
  Config,
  DataBundle,
  Exercise,
  InjuryData,
  StructureData,
  InBodyData,
  ValdData,
  BodyDotData,
  LoadData,
  Prescription,
  Splits,
} from '../types'

/**
 * allocation.json is ~3 MB. The promise is cached at module scope so the fetch and
 * JSON.parse happen exactly once per page load, no matter how often components render.
 */
let bundlePromise: Promise<DataBundle> | null = null

async function fetchJson<T>(file: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}data/${file}`
  const res = await fetch(url)
  if (!res.ok) {
    // Keep the specifics in the console for debugging; the UI shows a plain message.
    console.error(`Failed to load ${url}: ${res.status} ${res.statusText}`)
    throw new Error('The program library could not be loaded. Please refresh and try again.')
  }
  return (await res.json()) as T
}

export function loadData(): Promise<DataBundle> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const [config, allocation, exercises, prescription, splits, injury, structure, inbody, vald, bodydot, load] = await Promise.all([
        fetchJson<Config>('config.json'),
        fetchJson<Allocation>('allocation.json'),
        fetchJson<Exercise[]>('exercises.json'),
        fetchJson<Prescription>('prescription.json'),
        fetchJson<Splits>('splits.json'),
        fetchJson<InjuryData>('injury.json'),
        fetchJson<StructureData>('structure.json'),
        fetchJson<InBodyData>('inbody.json'),
        fetchJson<ValdData>('vald.json'),
        fetchJson<BodyDotData>('bodydot.json'),
        fetchJson<LoadData>('load.json'),
      ])
      return { config, allocation, exercises, prescription, splits, injury, structure, inbody, vald, bodydot, load }
    })()
  }
  return bundlePromise
}
