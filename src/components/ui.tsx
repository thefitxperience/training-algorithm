import type { ReactNode } from 'react'

/**
 * Brand primitives. Everything visible is built from these so a colour or a radius is
 * changed in one place — the palette is UDRA's, and the rules about which colour carries
 * which meaning live here rather than being re-decided in every panel.
 *
 *   UDRA Blue    the interface: primary actions, selection, focus
 *   Soft Linen   the page ground
 *   Black        text
 *   Flame        something is wrong or was removed
 *   Neon Yellow  something needs a human decision
 *   Cyan         VALD          }  one tertiary per machine, so a reading on the program
 *   Orange       InBody        }  can be traced back to the box it came out of
 *   Blue         BodyDot       }
 */

export type Tone = 'default' | 'primary' | 'flame' | 'neon' | 'cyan' | 'orange'

const PILL: Record<Tone, string> = {
  default: 'bg-udra-linen-200 text-udra-ink-700',
  primary: 'bg-udra-blue-100 text-udra-blue-900',
  flame: 'bg-udra-flame/15 text-udra-flame',
  neon: 'bg-udra-neon text-black',
  cyan: 'bg-udra-cyan/25 text-udra-blue-900',
  orange: 'bg-udra-orange/20 text-udra-ink-700',
}

export function Pill({
  tone = 'default',
  children,
  title,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'aside'
}) {
  return (
    <Tag
      className={`rounded-2xl border border-udra-linen-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {children}
    </Tag>
  )
}

export function SectionTitle({
  children,
  hint,
  right,
}: {
  children: ReactNode
  hint?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-bold tracking-tight">{children}</h2>
      {right}
      {hint && <p className="w-full text-sm text-udra-ink-500">{hint}</p>}
    </div>
  )
}

export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-bold tracking-[0.08em] text-udra-ink-500 uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-udra-ink-500">{hint}</span>}
    </label>
  )
}

export const controlClass =
  'w-full rounded-xl border border-udra-linen-300 bg-white px-3 py-2 text-sm font-medium ' +
  'transition hover:border-udra-blue-200 focus:border-udra-blue focus:outline-none'

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlClass} ${props.className ?? ''}`} />
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={`${controlClass} tnum ${props.className ?? ''}`} />
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-udra-blue text-white hover:bg-udra-blue-700 shadow-sm',
  secondary: 'border border-udra-linen-300 bg-white text-black hover:border-udra-blue hover:text-udra-blue',
  ghost: 'text-udra-ink-500 hover:bg-udra-linen-200 hover:text-black',
  danger: 'border border-udra-flame/40 text-udra-flame hover:bg-udra-flame/10',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizing =
    size === 'lg'
      ? 'px-6 py-3 text-sm'
      : size === 'sm'
        ? 'px-2.5 py-1 text-xs'
        : 'px-3.5 py-2 text-sm'
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON[variant]} ${sizing} ${className}`}
    />
  )
}

/** Segmented control — used wherever the choice is small enough to show all of it. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      className={`inline-flex rounded-xl border border-udra-linen-300 bg-white p-0.5 ${className}`}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[0.6rem] px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition ${
            o.value === value
              ? 'bg-udra-blue text-white shadow-sm'
              : 'text-udra-ink-500 hover:text-black'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A banner that means something. Never decorative — each tone is a different claim. */
export function Note({
  tone = 'default',
  title,
  children,
}: {
  tone?: 'default' | 'flame' | 'neon' | 'primary'
  title?: ReactNode
  children?: ReactNode
}) {
  const styles = {
    default: 'border-udra-linen-300 bg-udra-linen/60 text-udra-ink-700',
    primary: 'border-udra-blue-200 bg-udra-blue-50 text-udra-blue-900',
    flame: 'border-udra-flame/40 bg-udra-flame/8 text-udra-flame',
    neon: 'border-udra-neon bg-udra-neon/30 text-black',
  }[tone]
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${styles}`}>
      {title && <div className="font-bold">{title}</div>}
      {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
    </div>
  )
}

export function Logo({ className = 'h-9' }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}udra-full-logo.png`}
      alt="UDRA"
      className={`${className} w-auto`}
    />
  )
}
