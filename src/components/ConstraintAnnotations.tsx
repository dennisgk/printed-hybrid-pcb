import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Annotation, Constraint, Definition, Feature, Point, Tool, Viewport } from '../lib/model'
import { angularVertices, centerObjects, constraintPosition, featureLine, features, normalFor, objectCenter, parallelLines } from '../lib/constraints'
import { annotationText, layoutAnnotations } from '../lib/annotation-layout'
import type { AnnotationPlacement } from '../lib/annotation-layout'
import { projectSegment } from '../lib/geometry'
import { ExpressionInput } from './ConstraintProperties'

type Props = { definition: Definition; tool: Tool; first: Feature | null; hover: Feature | null; pending: Constraint | null; selectedId?: string; editingId: string | null; edit: (id: string | null) => void; select: (id: string) => void; apply: (c: Constraint, expression: string, value: number) => boolean; moveAnnotation: (c: Constraint, annotation: Annotation) => boolean; cancel: () => void; zoom: number; camera: Viewport; size: { width: number; height: number }; host: HTMLDivElement | null }
type Drag = { c: Constraint; kind: 'label' | 'line'; x: number; y: number; initial: Annotation; placement: AnnotationPlacement; moved: boolean; annotation: Annotation }

export function ConstraintOverlay({ definition: d, tool, first, hover, pending, selectedId, editingId, edit, select, apply, moveAnnotation, cancel, zoom, camera, size, host }: Props) {
  const mode = tool === 'parallel' || tool === 'angular' || tool === 'central', stroke = 1.3 / zoom
  const [dragPreview, setDragPreview] = useState<{ id: string; annotation: Annotation } | null>(null), drag = useRef<Drag | null>(null)
  const constraints = useMemo(() => [...(d.constraints ?? []), ...(pending ? [pending] : [])].map(c => dragPreview?.id === c.id ? { ...c, annotation: dragPreview.annotation } : c), [d.constraints, pending, dragPreview])
  const placements = useMemo(() => layoutAnnotations(d, constraints, zoom, { minX: camera.x - size.width / zoom / 2 + 10 / zoom, maxX: camera.x + size.width / zoom / 2 - 10 / zoom, minY: camera.y - size.height / zoom / 2 + 50 / zoom, maxY: camera.y + size.height / zoom / 2 - 40 / zoom }), [d, constraints, zoom, camera.x, camera.y, size.width, size.height])
  const editing = constraints.find(c => c.id === editingId)
  const centerMark = (p: Point, color: string, radius = 6) => <g pointerEvents="none" stroke={color} strokeWidth={1.4 / zoom} fill="none"><circle cx={p.x} cy={p.y} r={radius / zoom} /><path d={`M ${p.x - (radius + 3) / zoom} ${p.y} H ${p.x + (radius + 3) / zoom} M ${p.x} ${p.y - (radius + 3) / zoom} V ${p.y + (radius + 3) / zoom}`} /></g>
  function highlight(f: Feature, color: string, reference = first, central = tool === 'central') {
    try {
      if (central) return centerMark(objectCenter(d, f), color, 9)
      let normal: Point | undefined, sign = 1
      if (f.feature === 'circle' && reference) {
        normal = normalFor(d, reference)
        const [a] = featureLine(d, reference), object = f.owner === 'pin' ? d.pins.find(p => p.id === f.id)! : d.zones.find(z => z.id === f.id)!
        const centerSign = (object.x - a.x) * normal.x + (object.y - a.y) * normal.y >= 0 ? 1 : -1
        sign = f.circleMode === 'far' ? centerSign : -centerSign
      }
      const [a, b] = featureLine(d, f, normal, sign)
      return <g pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={3 / zoom} strokeLinecap="round" />{[a, b].map((p, n) => <circle key={n} cx={p.x} cy={p.y} r={3 / zoom} fill={color} />)}</g>
    } catch { return null }
  }
  function start(e: ReactPointerEvent<SVGElement>, c: Constraint, kind: 'label' | 'line') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    const placement = placements.get(c.id)
    if (!placement) return
    const origin = constraintPosition(d, c), initial: Annotation = { ...c.annotation, labelOffset: { x: placement.label.x - origin.x, y: placement.label.y - origin.y }, lineOffset: placement.lineOffset, ...(placement.radius > 0 ? { radius: placement.radius } : {}) }
    drag.current = { c, kind, x: e.clientX, y: e.clientY, initial, placement, moved: false, annotation: initial }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (c.id !== pending?.id) select(c.id)
  }
  function move(e: ReactPointerEvent<SVGElement>) {
    const active = drag.current
    if (!active) return
    e.stopPropagation()
    const dx = (e.clientX - active.x) / zoom, dy = -(e.clientY - active.y) / zoom
    if (!active.moved && Math.hypot(dx, dy) * zoom < 3) return
    active.moved = true
    const annotation = { ...active.initial, labelOffset: { ...active.initial.labelOffset! } }
    if (active.kind === 'line' && active.c.kind === 'parallel') {
      const { normal } = parallelLines(d, active.c), tangent = { x: -normal.y, y: normal.x }, offset = dx * tangent.x + dy * tangent.y
      annotation.lineOffset = active.initial.lineOffset! + offset
      annotation.labelOffset!.x += tangent.x * offset; annotation.labelOffset!.y += tangent.y * offset
    } else if (active.kind === 'line' && active.c.kind === 'angular' && host) {
      const r = host.getBoundingClientRect(), p = { x: camera.x + (e.clientX - r.left - size.width / 2) / zoom, y: camera.y - (e.clientY - r.top - size.height / 2) / zoom }, origin = constraintPosition(d, active.c)
      annotation.radius = Math.max(10 / zoom, Math.hypot(p.x - origin.x, p.y - origin.y))
      const direction = active.initial.labelOffset!, length = Math.hypot(direction.x, direction.y) || 1
      annotation.labelOffset = { x: direction.x / length * (annotation.radius + 18 / zoom), y: direction.y / length * (annotation.radius + 18 / zoom) }
    } else { annotation.labelOffset!.x += dx; annotation.labelOffset!.y += dy }
    active.annotation = annotation; setDragPreview({ id: active.c.id, annotation })
  }
  function finish(e: ReactPointerEvent<SVGElement>) {
    const active = drag.current
    if (!active) return
    e.stopPropagation(); drag.current = null; setDragPreview(null)
    if (active.moved) moveAnnotation(active.c, active.annotation)
    else if (active.kind === 'label' && active.c.kind !== 'central') edit(active.c.id)
  }
  const cancelDrag = (e: ReactPointerEvent<SVGElement>) => { e.stopPropagation(); drag.current = null; setDragPreview(null) }
  const interaction = (c: Constraint, kind: 'label' | 'line') => ({ onPointerDown: (e: ReactPointerEvent<SVGElement>) => start(e, c, kind), onPointerMove: move, onPointerUp: finish, onPointerCancel: cancelDrag })
  function annotation(c: Constraint) {
    try {
      const placement = placements.get(c.id)
      if (!placement) return null
      const selected = c.id === selectedId || c.id === editingId || c.id === pending?.id, color = selected ? '#d2edb5' : '#92b3bd', position = placement.label, text = annotationText(c)
      let geometry, handle
      if (c.kind === 'parallel') {
        const { reference, target, normal, signedDistance } = parallelLines(d, c), a = placement.a!, b = placement.b!, tick = { x: -normal.y * 4 / zoom, y: normal.x * 4 / zoom }
        const refFoot = projectSegment(a, ...reference), targetFoot = projectSegment(b, ...target)
        geometry = <><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><path d={`M ${refFoot.x} ${refFoot.y} L ${a.x} ${a.y} M ${targetFoot.x} ${targetFoot.y} L ${b.x} ${b.y}`} strokeDasharray={`${3 / zoom} ${3 / zoom}`} />{[a, b].map((p, n) => { const sign = (signedDistance >= 0 ? 1 : -1) * (n ? -1 : 1), x = p.x + normal.x * sign * 5 / zoom, y = p.y + normal.y * sign * 5 / zoom; return <g key={n}><line x1={p.x - tick.x} y1={p.y - tick.y} x2={p.x + tick.x} y2={p.y + tick.y} /><polygon points={`${p.x},${p.y} ${x + tick.x / 2},${y + tick.y / 2} ${x - tick.x / 2},${y - tick.y / 2}`} fill={color} stroke="none" /></g> })}</>
        handle = <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dimension-line-handle" stroke="transparent" strokeWidth={12 / zoom} {...interaction(c, 'line')}><title>Drag to move the dimension line</title></line>
      } else if (c.kind === 'angular') {
        const [a, b, endPoint] = angularVertices(d, c), startAngle = Math.atan2(a.y - b.y, a.x - b.x), endAngle = Math.atan2(endPoint.y - b.y, endPoint.x - b.x)
        let delta = endAngle - startAngle; while (delta > Math.PI) delta -= Math.PI * 2; while (delta < -Math.PI) delta += Math.PI * 2
        const radius = placement.radius, p = { x: b.x + radius * Math.cos(startAngle), y: b.y + radius * Math.sin(startAngle) }, q = { x: b.x + radius * Math.cos(startAngle + delta), y: b.y + radius * Math.sin(startAngle + delta) }
        const arc = `M ${p.x} ${p.y} A ${radius} ${radius} 0 0 ${delta > 0 ? 1 : 0} ${q.x} ${q.y}`
        geometry = <><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} opacity=".35" /><line x1={b.x} y1={b.y} x2={endPoint.x} y2={endPoint.y} opacity=".35" /><path d={arc} />{centerMark(b, color, 3)}</>
        handle = <path d={arc} fill="none" stroke="transparent" strokeWidth={12 / zoom} className="dimension-line-handle" {...interaction(c, 'line')}><title>Drag to change the annotation arc radius</title></path>
      } else { geometry = centerMark(objectCenter(d, c.target), color); handle = null }
      const leader = placement.anchor
      return <g key={c.id} className="constraint-annotation"><g fill="none" stroke={color} strokeWidth={stroke} pointerEvents="none">{geometry}<line x1={leader.x} y1={leader.y} x2={position.x} y2={position.y} opacity=".45" /></g>{handle}{selected && c.kind === 'parallel' && <>{highlight(c.reference, '#98c6dc', null, false)}{highlight(c.target, '#d2edb5', c.reference, false)}</>}<g transform={`translate(${position.x} ${position.y}) scale(${1 / zoom} ${-1 / zoom})`} role="button" tabIndex={0} className="dimension-label-handle" aria-label={`${c.kind === 'central' ? 'Select central constraint' : `Edit ${c.kind === 'parallel' ? 'distance' : 'angle'}`} ${text}`} {...interaction(c, 'label')} onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); if (c.id !== pending?.id) select(c.id); if (c.kind !== 'central') edit(c.id) } }}><title>{c.kind === 'central' ? 'Drag to move this label' : 'Click to edit; drag to move this label'}</title><rect x={-text.length * 3.4 - 8} y="-11" width={text.length * 6.8 + 16} height="22" rx="4" fill="#1b2b2a" stroke={color} strokeWidth=".8" /><text textAnchor="middle" dominantBaseline="central" fill={color} fontSize="11" fontFamily="Consolas, monospace">{text}</text></g></g>
    } catch { return null }
  }
  let editor = null
  if (editing && editing.kind !== 'central' && host) {
    const point = placements.get(editing.id)?.label ?? camera
    const left = Math.max(12, Math.min(size.width - 295, size.width / 2 + (point.x - camera.x) * zoom - 130)), top = Math.max(45, Math.min(size.height - 150, size.height / 2 - (point.y - camera.y) * zoom + 12))
    editor = createPortal(<div className="constraint-inline-editor" style={{ left, top }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><ExpressionInput key={`${editing.id}:${editing.expression}`} label={editing.kind === 'parallel' ? 'Driving distance' : 'Driving angle'} expression={editing.expression} unit={editing.kind === 'parallel' ? 'mm' : '°'} autoFocus onCommit={(expression, value) => apply(editing, expression, value)} onCancel={cancel} /><button className="text-button" onClick={cancel}>Cancel</button></div>, host)
  }
  return <><g className="constraints-layer">{mode && tool !== 'central' && features(d, tool === 'angular').filter(f => f.feature === 'midX' || f.feature === 'midY').map(f => { const [a, b] = featureLine(d, f); return <line key={`${f.owner}:${f.id}:${f.feature}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6d8f91" strokeWidth={1 / zoom} opacity=".5" strokeDasharray={`${5 / zoom} ${4 / zoom}`} pointerEvents="none" /> })}{tool === 'central' && centerObjects(d).map(ref => <g key={`${ref.owner}:${ref.id}`} opacity=".5">{centerMark(objectCenter(d, ref), '#88ada7', 4)}</g>)}{first && highlight(first, '#abd6b7')}{hover && highlight(hover, '#f3d3a0')}{constraints.map(annotation)}</g>{editor}</>
}
