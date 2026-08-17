import { useEffect, useRef, useState } from 'react'
import type { ClientInput, DataBundle } from '../types'
import { sampleClient, type SampleOptions } from '../lib/sample'
import { Button, Pill } from './ui'

/**
 * A whole made-up client in one press — details, pains, and whichever machines are ticked.
 *
 * The machines are separate ticks on purpose. Most of what is worth trying is how one layer
 * behaves on its own: a posture scan with no body composition behind it, or a client with
 * nothing measured at all. Generating everything every time makes each layer's contribution
 * impossible to see.
 *
 * The seed is shown because a sample that turns something up has to be reachable again, and
 * "the one with the odd trunk reading" is not a way of finding it.
 */
export function QuickTest({
  data,
  onGenerate,
}: {
  data: DataBundle
  onGenerate: (input: ClientInput) => void
}) {
  const [open, setOpen] = useState(false)
  // Everything off to start: the plain client is the one worth seeing first, and each tick
  // then says exactly what it added.
  const [options, setOptions] = useState<SampleOptions>({ pain: false })
  const [seed, setSeed] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const run = () => {
    // A fresh seed each press, so the button keeps producing new clients rather than one.
    const next = Math.floor(Math.random() * 0xffffffff)
    const result = sampleClient(data, options, next)
    setSeed(result.seed)
    onGenerate(result.input)
  }

  const toggle = (key: keyof SampleOptions) =>
    setOptions((o) => ({ ...o, [key]: !(o[key] ?? false) }))

  const TICKS: { key: keyof SampleOptions; label: string; hint: string }[] = [
    { key: 'pain', label: 'Pain or injury', hint: 'up to two reported pains' },
    { key: 'vald', label: 'VALD DynaMo', hint: 'an upper, lower or whole battery' },
    { key: 'inbody', label: 'InBody scan', hint: 'a scan built around one weight and body fat' },
    { key: 'bodydot', label: 'BodyDot posture', hint: 'readings against each indicator’s own band' },
  ]

  return (
    <div className="relative" ref={box}>
      <Button size="sm" onClick={() => setOpen((v) => !v)} title="Fill everything in with a made-up client">
        Quick test
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-udra-linen-200 bg-white p-3 shadow-xl">
          <div className="text-[12px] font-bold">Generate a sample client</div>
          <p className="mt-0.5 text-[11px] text-udra-ink-500">
            Age, level, goal, days, split and equipment are always drawn. Tick what else to
            measure.
          </p>

          <div className="mt-2 space-y-1">
            {TICKS.map((t) => {
              const on = options[t.key] ?? false
              return (
                <button
                  key={t.key}
                  onClick={() => toggle(t.key)}
                  className={`flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition ${
                    on ? 'border-udra-blue bg-udra-blue-50' : 'border-udra-linen-300 hover:border-udra-blue-200'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] leading-none font-bold ${
                      on ? 'border-udra-blue bg-udra-blue text-white' : 'border-udra-linen-300 text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold">{t.label}</span>
                    <span className="block text-[11px] text-udra-ink-500">{t.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={run}>
              Generate client
            </Button>
            {seed !== null && (
              <span className="tnum text-[11px] text-udra-ink-500">
                seed <Pill>{seed}</Pill>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
