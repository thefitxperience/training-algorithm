import type { Allocation, Config, DataBundle, Exercise, Prescription, Splits } from '../types'

/**
 * allocation.json is ~3 MB. The promise is cached at module scope so the fetch and
 * JSON.parse happen exactly once per page load, no matter how often components render.
 */
let bundlePromise: Promise<DataBundle> | null = null

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!res.ok) throw new Error(`Failed to load data/${file}: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export function loadData(): Promise<DataBundle> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const [config, allocation, exercises, prescription, splits] = await Promise.all([
        fetchJson<Config>('config.json'),
        fetchJson<Allocation>('allocation.json'),
        fetchJson<Exercise[]>('exercises.json'),
        fetchJson<Prescription>('prescription.json'),
        fetchJson<Splits>('splits.json'),
      ])
      return { config, allocation, exercises, prescription, splits }
    })()
  }
  return bundlePromise
}
