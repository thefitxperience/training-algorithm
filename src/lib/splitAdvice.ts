import type { ClientInput, SplitBadge, Splits } from '../types'
import { splitsKey } from './generate'

export interface SplitOption {
  split: string
  /** null when splits.json has no row for this combination */
  row: SplitBadge | null
}

export interface SplitAdvice {
  options: SplitOption[]
  /** the split(s) badged "Recommended" for this goal / days / level */
  recommended: SplitOption[]
  /**
   * Top-ranked split whether or not anything is badged Recommended — 25 of the 45
   * goal/days/level combinations in splits.json have no Recommended row at all, and
   * "nothing to suggest" is a worse answer than a labelled best-available.
   */
  best: SplitOption | null
  /** how many other splits tie `best` on badge and volumePct */
  tiedWithBest: number
  /**
   * splits.json only carries rows for age 18-29. For any other bracket the advice is read
   * from the 18-29 reference rows; the UI must label it as such rather than implying the
   * data covers this client's age.
   */
  fromReferenceBracket: boolean
}

const RANK: Record<string, number> = { Recommended: 0, Available: 1, Adjusted: 2 }

export function splitAdvice(
  splits: Splits,
  input: Pick<ClientInput, 'goal' | 'days' | 'level' | 'split'>,
  allSplits: string[],
  ageBracket: string,
): SplitAdvice {
  const options: SplitOption[] = allSplits.map((split) => ({
    split,
    row: splits[splitsKey({ ...input, split })] ?? null,
  }))

  const sorted = [...options].sort((a, b) => {
    const r = (RANK[a.row?.badge ?? ''] ?? 9) - (RANK[b.row?.badge ?? ''] ?? 9)
    if (r !== 0) return r
    return (b.row?.volumePct ?? 0) - (a.row?.volumePct ?? 0)
  })

  const best = sorted.find((o) => o.row !== null) ?? null
  const tiedWithBest = best
    ? sorted.filter(
        (o) =>
          o !== best && o.row?.badge === best.row?.badge && o.row?.volumePct === best.row?.volumePct,
      ).length
    : 0

  return {
    options,
    recommended: sorted.filter((o) => o.row?.badge === 'Recommended'),
    best,
    tiedWithBest,
    fromReferenceBracket: ageBracket !== '18-29',
  }
}
