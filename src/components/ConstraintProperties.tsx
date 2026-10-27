import { useState } from 'react'
import { ArrowLeftRight, Link2, WandSparkles } from 'lucide-react'
import type { Constraint, Definition } from '../lib/model'
import { constraintLabel, featureLine, normalFor } from '../lib/constraints'
import { evaluateExpression } from '../lib/expression'
import { Button } from './ui/button'
import { FieldGroup } from './ui/fields'

export function ExpressionInput({ expression, onCommit, label = 'Constraint value', unit, onCancel, autoFocus = false }: { expression: string; onCommit: (expression: string, value: number) => boolean | void; label?: string; unit: string; onCancel?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState(expression), [error, setError] = useState('')
  const apply = () => {
    try { const value = evaluateExpression(text); if (onCommit(text.trim(), value) !== false) setError('') }
    catch (e) { setError((e as Error).message) }
  }
  return <div className="expression-field"><label className="field"><span>{label}</span><div className="input-wrap"><input aria-label={label} type="text" inputMode="text" value={text} autoFocus={autoFocus} onFocus={e => e.currentTarget.select()} onChange={e => { setText(e.target.value); setError('') }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); apply() } if (e.key === 'Escape') { e.preventDefault(); onCancel?.() } }} /><small>{unit}</small></div></label><div className="expression-actions"><span>{error || 'Arithmetic: + − * / ^ ( )'}</span><Button size="sm" variant="outline" onClick={apply}>Apply</Button></div></div>
}
export function ConstraintProperties({ definition, constraint, update }: { definition: Definition; constraint: Constraint; update: (fn: (c: Constraint) => void) => void }) {
  const reset = <Button variant="outline" size="sm" onClick={() => update(c => { delete c.annotation })}><WandSparkles size={13} />Auto-place annotation</Button>
  if (constraint.kind === 'central') return <FieldGroup title="CENTRAL CONSTRAINT"><p className="property-note">The target rectangle or circle stays centered on the ground object. Both target position coordinates are constraint-controlled; sizes stay editable.</p><div className="stat-line"><span>Relationship</span><b>Coincident centers</b></div><Button variant="outline" size="sm" onClick={() => update(c => { if (c.kind === 'central') [c.reference, c.target] = [c.target, c.reference] })}><ArrowLeftRight size={13} />Swap ground and target</Button><div className="annotation-help">Drag labels to move them. Drag dimension lines or arcs to reposition them.</div>{reset}</FieldGroup>
  return <FieldGroup title={constraint.kind === 'parallel' ? 'PARALLEL SIDE CONSTRAINT' : 'ANGULAR CONSTRAINT'}>
    <ExpressionInput key={`${constraint.id}:${constraint.expression}`} expression={constraint.expression} label={constraint.kind === 'parallel' ? 'Driving distance' : 'Driving angle'} unit={constraint.kind === 'parallel' ? 'mm' : '°'} onCommit={(expression, value) => update(c => { c.expression = expression; c.value = value })} />
    <div className="stat-line"><span>Resolved value</span><b>{Number(constraint.value.toFixed(6))} {constraint.kind === 'parallel' ? 'mm' : '°'}</b></div>
    {constraint.kind === 'parallel' ? <>
      <p className="property-note">The first feature is the reference. Different objects move the second object; same-object selections drive a dimension or polygon edge.</p>
      {constraint.reference.id !== constraint.target.id && <Button variant="outline" size="sm" onClick={() => update(c => { if (c.kind === 'parallel') { c.side = c.side === 1 ? -1 : 1; if (c.target.feature === 'circle') c.circleSign = c.circleSign === 1 ? -1 : 1 } })}><ArrowLeftRight size={13} />Flip side</Button>}
      {constraint.target.feature === 'circle' && <label className="field"><span>Circular reference</span><select aria-label="Circular reference" value={constraint.target.circleMode ?? 'near'} onChange={e => update(c => { if (c.kind !== 'parallel') return; c.target.circleMode = e.target.value as 'near' | 'center' | 'far'; const normal = normalFor(definition, c.reference), reference = featureLine(definition, c.reference); const object = c.target.owner === 'pin' ? definition.pins.find(p => p.id === c.target.id)! : definition.zones.find(z => z.id === c.target.id)!; const sign = (object.x - reference[0].x) * normal.x + (object.y - reference[0].y) * normal.y >= 0 ? 1 : -1; c.circleSign = (c.target.circleMode === 'far' ? sign : -sign) as 1 | -1 })}><option value="near">Near tangent</option><option value="center">Center axis</option><option value="far">Far tangent</option></select></label>}
    </> : <p className="property-note">The shared vertex moves on its captured bisector line. The two outer vertices stay fixed. Angles must be between 0° and 180°.</p>}
    <div className="constraint-info"><Link2 size={14} />{constraintLabel(constraint)} controls the marked properties.</div>
    <p className="property-note">Drag a label to reposition it; click it to edit. Drag the dimension line or arc to move it without changing the geometry.</p>{reset}
  </FieldGroup>
}
