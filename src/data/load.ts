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
  AmendData,
  TimeCapData,
  SessionLengthData,
  FitData,
  Prescription,
  Splits,
} from '../types'
import { withDerivedGoals } from '../lib/goals'
import { withModalityInjury, type ModalitiesData } from '../lib/modality'

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
      const [config, allocation, exercises, prescription, splits, injury, structure, inbody, vald, bodydot, load, amend, timecap, sessionlength, fit] = await Promise.all([
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
        fetchJson<AmendData>('amend.json'),
        fetchJson<TimeCapData>('timecap.json'),
        fetchJson<SessionLengthData>('sessionlength.json'),
        fetchJson<FitData>('fit.json'),
      ])
      const [modalities, injuryExtra] = await Promise.all([
        fetchJson<ModalitiesData>('modalities.json'),
        fetchJson<{ exercises: InjuryData['exercises'] }>('injury-modalities.json'),
      ])
      // Shape Up and any other goal made from others (fit.json): in the goal lists and every table.
      return withDerivedGoals({ config, allocation, exercises, prescription, splits, injury: withModalityInjury(injury, injuryExtra), structure, inbody, vald, bodydot, load, amend, timecap, sessionlength, fit, modalities })
    })()
  }
  return bundlePromise
}
