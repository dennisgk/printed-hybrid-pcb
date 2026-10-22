import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
export function NumberField({ label, value, onChange, min = 0, max = Infinity, step = .1, suffix = 'mm' }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const [text, setText] = useState(String(Math.round(value * 10000) / 10000))
  useEffect(() => { setText(String(Math.round(value * 10000) / 10000)) }, [value])
  const commit = () => { const n = Number(text); if (text.trim() && Number.isFinite(n) && n >= min && n <= max) { if (n !== value) onChange(n) } else setText(String(value)) }
  return <label className="field"><span>{label}</span><div className="input-wrap"><input aria-label={label} type="number" value={text} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} step={step} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />{suffix && <small>{suffix}</small>}</div></label>
}
export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (text: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return <label className="field"><span>{label}</span><input aria-label={label} value={text} placeholder={placeholder} onChange={e => setText(e.target.value)} onBlur={() => { const v = text.trim(); if (v) { if (v !== value) onChange(v) } else setText(value) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
}
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="field-group"><h4>{title}</h4>{children}</section> }
