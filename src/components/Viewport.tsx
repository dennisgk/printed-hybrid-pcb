import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import type { Definition, Point, Project, Selection, Tool, Zone, ZoneShape, PinShape, Viewport as Camera } from '../lib/model'
import { clone, id } from '../lib/model'
import { anchorKey, bodyPolygon, bounds, connectTarget, createPolygonZone, distance, equal, nearestTarget, normalizePolygonZone, outlineError, pins, projectContentPoints, rect, snap, snapAngle, tracePoints, transform, validateProject, zonePolygon } from '../lib/geometry'
import { installZoomGestures } from '../lib/viewport-input'
import type { Target } from '../lib/geometry'
import { Button } from './ui/button'

type Props = { project: Project; tool: Tool; selection: Selection; select: (s: Selection) => void; commit: (fn: (p: Project) => void) => void; workspace: (fn: (w: Project['workspace']) => void) => void; notify: (message: string) => void; definitionId: string; traceWidth: number; angle: '45' | '90' | 'free'; edgeMode: 'polygon' | 'rectangle'; zoneShape: ZoneShape; pinShape: PinShape; snapEnabled: boolean; fitSignal: number }
const pointsString = (pts: Point[]) => pts.map(p => `${p.x},${p.y}`).join(' ')
const sameSelection = (a: Selection, kind: string, id: string) => a?.kind === kind && a.id === id
export function Viewport(props: Props) {
  const { project, tool, selection, select, commit, workspace, notify, definitionId, traceWidth, angle, edgeMode, zoneShape, pinShape, snapEnabled, fitSignal } = props
  const tab = project.workspace.activeTab, isProject = tab === 'project', mirror = 1, bottom = isProject && project.workspace.side === 'bottom'
  const container = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 900, height: 650 })
  const [camera, setCamera] = useState<Camera>(project.workspace.viewports[tab] ?? { x: 50, y: 40, zoom: 6 })
  const cameraRef = useRef(camera); cameraRef.current = camera
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 })
  const [preview, setPreview] = useState<Project | null>(null)
  const [drawing, setDrawing] = useState<Point[]>([])
  const [routeStart, setRouteStart] = useState<Target | null>(null)
  const [hoverTarget, setHoverTarget] = useState<Target | null>(null)
  const [space, setSpace] = useState(false)
  const pan = useRef<{ x: number; y: number; camera: Camera } | null>(null)
  const drag = useRef<{ origin: Point; selection: NonNullable<Selection>; base: Project; moved: boolean } | null>(null)
  const shown = preview ?? project
  const definition = isProject ? null : shown.workspace.drafts[tab] ?? shown.definitions.find(d => d.id === tab) ?? null
  const projectBounds = bounds(project.board.outline)
  const latest = useRef(props); latest.current = props
  const cancel = () => { setDrawing([]); setRouteStart(null); setPreview(null); drag.current = null; pan.current = null }
  const fit = () => {
    const current = latest.current.project, t = current.workspace.activeTab
    const d = current.workspace.drafts[t] ?? current.definitions.find(d => d.id === t)
    const points = t === 'project' ? projectContentPoints(current) : [...rect(0, 0, d?.width ?? 20, d?.height ?? 30), ...(d?.zones.flatMap(zonePolygon) ?? [])]
    const b = bounds(points.length ? points : rect(-50, -40, 100, 80))
    const view = container.current?.getBoundingClientRect() ?? size
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: Math.max(.01, Math.min((view.width - 160) / Math.max(10, b.maxX - b.minX), (view.height - 160) / Math.max(10, b.maxY - b.minY), 25)) }
    setCamera(c); latest.current.workspace(w => { w.viewports[t] = c })
  }
  useLayoutEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(container.current); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    cancel()
    const saved = project.workspace.viewports[tab]
    if (saved) setCamera(saved); else fit()
    // A camera is restored only when switching documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  useEffect(() => { if (fitSignal) fit() }, [fitSignal]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cancel() }, [tool, project.workspace.side, edgeMode, zoneShape])
  useEffect(() => {
    if (!svg.current) return
    return installZoomGestures(svg.current, () => cameraRef.current, c => {
      cameraRef.current = c; setCamera(c)
      const p = latest.current
      p.workspace(w => { w.viewports[p.project.workspace.activeTab] = c })
    })
  }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[role="dialog"]')) return
      if (e.code === 'Space') { e.preventDefault(); setSpace(true) }
      if (e.key === 'Escape') { cancel(); select(null) }
      if (e.key === 'Enter' && tool === 'edge' && drawing.length >= 3) finishOutline(drawing)
      if (e.key === 'Enter' && tool === 'zone' && zoneShape === 'polygon' && drawing.length >= 3) finishZonePolygon(drawing)
      if (e.key === 'Backspace' && drawing.length) { e.preventDefault(); setDrawing(v => v.slice(0, -1)) }
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    const blur = () => { setSpace(false); pan.current = null }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  })
  function world(clientX: number, clientY: number): Point {
    const r = svg.current!.getBoundingClientRect(), c = cameraRef.current
    return { x: c.x + mirror * (clientX - r.left - size.width / 2) / c.zoom, y: c.y - (clientY - r.top - size.height / 2) / c.zoom }
  }
  const quantize = (p: Point) => snapEnabled ? snap(p, project.board.settings.grid) : p
  const storeCamera = (c: Camera) => { cameraRef.current = c; setCamera(c); workspace(w => { w.viewports[tab] = c }) }
  const acceptChange = (before: Project, candidate: Project) => {
    const existing = new Set(validateProject(before).map(i => `${i.element}:${i.message}`)), issue = validateProject(candidate).find(i => !existing.has(`${i.element}:${i.message}`))
    if (issue) { notify(issue.message); return false }
    return true
  }
  function finishOutline(points: Point[]) {
    if (project.board.outline.length) { notify('A completed boundary already exists. Edit it with Select or delete it before drawing another.'); setDrawing([]); return }
    const error = outlineError(points)
    if (error) { notify(error); return }
    const candidate = clone(project); candidate.board.outline = points
    if (!acceptChange(project, candidate)) return
    commit(p => { p.board.outline = points }); setDrawing([]); select({ kind: 'outline', id: 'outline' })
  }
  function saveZone(zone: Zone) { commit(p => { p.workspace.drafts[tab].zones.push(zone) }); select({ kind: 'zone', id: zone.id }); setDrawing([]) }
  function finishZonePolygon(points: Point[]) {
    const error = outlineError(points)
    if (error) { notify(`Invalid clearance polygon: ${error}`); return }
    saveZone(createPolygonZone(points))
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button === 2) return
    e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId)
    if (e.button === 1 || space) { e.preventDefault(); pan.current = { x: e.clientX, y: e.clientY, camera }; return }
    const raw = world(e.clientX, e.clientY), point = quantize(raw)
    if (tool === 'select') {
      const hit = (e.target as Element).closest('[data-kind]') as SVGElement | null
      if (hit) {
        const s = { kind: hit.dataset.kind, id: hit.dataset.id, ...(hit.dataset.vertex !== undefined ? { vertex: Number(hit.dataset.vertex) } : {}) } as NonNullable<Selection>
        select(s)
        if (s.kind !== 'body' && !(s.kind === 'trace' && s.vertex === undefined) && !(s.kind === 'outline' && s.vertex === undefined)) drag.current = { origin: point, selection: s, base: clone(project), moved: false }
      } else select(null)
      return
    }
    if (isProject && tool === 'component') {
      const d = project.definitions.find(d => d.id === definitionId)
      if (!d) { notify('Create and save a component definition first.'); return }
      let count = 1; while (project.instances.some(i => i.name === `${d.name} ${count}`)) count++
      const instance = { id: id(), definitionId: d.id, name: `${d.name} ${count}`, ...point, rotation: 0, recessDepth: null, fitClearance: null }, candidate = clone(project)
      candidate.instances.push(instance)
      if (acceptChange(project, candidate)) { commit(p => { p.instances.push(instance) }); select({ kind: 'instance', id: instance.id }) }
      return
    }
    if (isProject && tool === 'trace') {
      if (project.workspace.side !== 'bottom') { notify('Switch to bottom view to route traces.'); return }
      const target = nearestTarget(project, raw, Math.max(9 / camera.zoom, .3))
      if (!routeStart) { if (target) { setRouteStart(target); setDrawing([target.point]) } else notify('Start a trace on a pin or an existing trace.'); return }
      if (target) {
        if (distance(routeStart.point, target.point) < .001) { notify('Choose a different connection to finish this trace.'); return }
        const candidate = clone(project)
        try {
          const from = connectTarget(candidate, routeStart), to = connectTarget(candidate, target)
          if (anchorKey(from) === anchorKey(to)) return
          const vertices = drawing.slice(1).filter((v, index, arr) => !equal(v, index ? arr[index - 1] : routeStart.point) && !equal(v, target.point))
          const trace = { id: id(), width: traceWidth, from, to, vertices }; candidate.traces.push(trace)
          if (!acceptChange(project, candidate)) return
          commit(p => { p.traces = candidate.traces; p.junctions = candidate.junctions }); select({ kind: 'trace', id: trace.id }); setDrawing([]); setRouteStart(null)
        } catch (err) { notify((err as Error).message) }
      } else {
        const next = quantize(snapAngle(drawing[drawing.length - 1], point, angle))
        if (!equal(next, drawing[drawing.length - 1])) setDrawing([...drawing, next])
      }
      return
    }
    if (isProject && tool === 'edge') {
      if (project.board.outline.length) { notify('A completed boundary already exists. Edit it with Select or delete it before drawing another.'); return }
      if (edgeMode === 'rectangle' && drawing.length) { const a = drawing[0]; if (Math.abs(a.x - point.x) < .01 || Math.abs(a.y - point.y) < .01) return; finishOutline(rect(Math.min(a.x, point.x), Math.min(a.y, point.y), Math.abs(a.x - point.x), Math.abs(a.y - point.y))); return }
      if (drawing.length >= 3 && distance(raw, drawing[0]) < 12 / camera.zoom) { finishOutline(drawing); return }
      if (!drawing.length || !equal(point, drawing[drawing.length - 1])) setDrawing([...drawing, point])
      return
    }
    if (!isProject && tool === 'pin') {
      const pin = { id: id(), ...point, name: `Pin ${(definition?.pins.length ?? 0) + 1}`, color: '#a3e635', diameter: 1, shape: pinShape }
      commit(p => { p.workspace.drafts[tab].pins.push(pin) }); select({ kind: 'pin', id: pin.id }); return
    }
    if (!isProject && tool === 'zone') {
      if (zoneShape === 'polygon') {
        if (drawing.length >= 3 && distance(raw, drawing[0]) < 12 / camera.zoom) { finishZonePolygon(drawing); return }
        if (!drawing.length || !equal(point, drawing[drawing.length - 1])) setDrawing([...drawing, point])
        return
      }
      if (!drawing.length) { setDrawing([point]); return }
      if (zoneShape === 'circle') {
        const radius = distance(drawing[0], point)
        if (radius < .01) return
        saveZone({ id: id(), name: 'Clearance zone', shape: 'circle', ...drawing[0], radius, width: radius * 2, height: radius * 2, mode: 'clearance', depth: 1 }); return
      }
      const a = drawing[0], width = Math.abs(point.x - a.x), height = Math.abs(point.y - a.y)
      if (width < .01 || height < .01) return
      saveZone({ id: id(), name: 'Clearance zone', shape: 'rectangle', x: Math.min(a.x, point.x), y: Math.min(a.y, point.y), width, height, mode: 'clearance', depth: 1 })
    }
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const raw = world(e.clientX, e.clientY), point = quantize(raw)
    setCursor(point)
    if (pan.current) { const a = pan.current; setCamera({ ...a.camera, x: a.camera.x - mirror * (e.clientX - a.x) / a.camera.zoom, y: a.camera.y + (e.clientY - a.y) / a.camera.zoom }); return }
    if (drag.current) {
      const d = drag.current, next = clone(d.base), s = d.selection, dx = point.x - d.origin.x, dy = point.y - d.origin.y
      if (!dx && !dy) return
      d.moved = true
      if (s.kind === 'instance') { const i = next.instances.find(i => i.id === s.id)!; i.x += dx; i.y += dy }
      if (s.kind === 'outline' && s.vertex !== undefined) { next.board.outline[s.vertex].x += dx; next.board.outline[s.vertex].y += dy }
      if (s.kind === 'trace' && s.vertex !== undefined) { const t = next.traces.find(t => t.id === s.id)!; t.vertices[s.vertex].x += dx; t.vertices[s.vertex].y += dy }
      if (s.kind === 'zone' && s.vertex !== undefined) { const zone = next.workspace.drafts[tab].zones.find(z => z.id === s.id)!; zone.vertices![s.vertex].x += dx; zone.vertices![s.vertex].y += dy; normalizePolygonZone(zone) }
      else if (s.kind === 'pin' || s.kind === 'zone') { const def = next.workspace.drafts[tab], item = s.kind === 'pin' ? def.pins.find(p => p.id === s.id)! : def.zones.find(z => z.id === s.id)!; item.x += dx; item.y += dy }
      setPreview(next); return
    }
    if (tool === 'trace' && isProject) setHoverTarget(nearestTarget(project, raw, Math.max(9 / camera.zoom, .3)))
  }
  function up() {
    if (pan.current) { workspace(w => { w.viewports[tab] = cameraRef.current }); pan.current = null }
    if (drag.current && preview && drag.current.moved) {
      if (!isProject || acceptChange(drag.current.base, preview)) {
        const candidate = preview
        commit(p => { if (isProject) { p.instances = candidate.instances; p.traces = candidate.traces; p.board.outline = candidate.board.outline } else p.workspace.drafts[tab] = candidate.workspace.drafts[tab] })
      }
    }
    setPreview(null); drag.current = null
  }
  const zoom = camera.zoom, stroke = 1 / zoom, font = 11 / zoom
  const grid = project.board.settings.grid * Math.pow(10, Math.max(0, Math.ceil(Math.log10(9 / (project.board.settings.grid * zoom)))))
  const originX = size.width / 2 - mirror * camera.x * zoom, originY = size.height / 2 + camera.y * zoom
  const showLabel = (p: Point, text: string, className = '', color?: string) => <g transform={`translate(${p.x} ${p.y}) scale(${mirror} -1)`}><text textAnchor="middle" className={className} fill={color} fontSize={font}>{text}</text></g>
  const drawPin = (p: Point, pin: Definition['pins'][number], selected = false, hit = false, rotation = 0) => <g key={pin.id} {...(hit ? { 'data-kind': 'pin', 'data-id': pin.id } : {})} className="pin-target">{pin.shape === 'square' ? <rect x={p.x - pin.diameter / 2} y={p.y - pin.diameter / 2} width={pin.diameter} height={pin.diameter} transform={`rotate(${rotation} ${p.x} ${p.y})`} fill="#12171d" stroke={selected ? '#ffffff' : pin.color} strokeWidth={stroke * (selected ? 2 : 1.5)} /> : <circle cx={p.x} cy={p.y} r={pin.diameter / 2} fill="#12171d" stroke={selected ? '#ffffff' : pin.color} strokeWidth={stroke * (selected ? 2 : 1.5)} />}{(!isProject || zoom > 8) && showLabel({ x: p.x, y: p.y + pin.diameter / 2 + 1 + font / 2 }, pin.name, 'pin-label', pin.color)}</g>
  const drawZone = (z: Zone, selected = false) => {
    const style = { className: `zone zone-${z.mode} ${selected ? 'selected' : ''}`, strokeWidth: stroke * (selected ? 2 : 1), strokeDasharray: `${4 / zoom} ${3 / zoom}` }
    return z.shape === 'circle' ? <circle cx={z.x} cy={z.y} r={z.radius} {...style} /> : <polygon points={pointsString(zonePolygon(z))} {...style} />
  }
  const previewPath = drawing.length ? [...drawing, tool === 'trace' && hoverTarget ? hoverTarget.point : tool === 'trace' ? quantize(snapAngle(drawing[drawing.length - 1], cursor, angle)) : cursor] : []
  const selectedTrace = selection?.kind === 'trace' ? shown.traces.find(t => t.id === selection.id) : null
  const componentLayer = <g data-layer="componentLayer">{shown.instances.map(i => {
            const d = shown.definitions.find(d => d.id === i.definitionId)!, selected = sameSelection(selection, 'instance', i.id)
            const poly = bodyPolygon(d, i), center = transform({ x: d.width / 2, y: d.height / 2 }, i)
            return <g key={i.id} data-kind="instance" data-id={i.id} className={`placed-component ${selected ? 'selected' : ''} ${bottom ? 'ghost-component' : ''}`}>
              {d.zones.map(z => <g key={z.id} transform={`translate(${i.x} ${i.y}) rotate(${i.rotation})`}>{drawZone(z)}</g>)}
              <polygon points={pointsString(poly)} className="component-body" strokeWidth={stroke * (selected ? 2 : 1)} />
              {showLabel({ x: center.x, y: center.y + font / 2 }, i.name, 'instance-name')}
              {zoom > 3 && showLabel({ x: center.x, y: center.y - font }, `${d.width} × ${d.height} mm`, 'dimension-label')}
            </g>
          })}</g>
  const traceLayer = <g data-layer="traceLayer">{shown.traces.map(t => <g key={t.id} data-kind="trace" data-id={t.id} opacity={bottom ? 1 : .38} className="trace-target"><polyline points={pointsString(tracePoints(shown, t))} fill="none" stroke="transparent" strokeWidth={Math.max(t.width, 10 / zoom)} strokeLinejoin="round" strokeLinecap="round" /><polyline points={pointsString(tracePoints(shown, t))} fill="none" stroke={sameSelection(selection, 'trace', t.id) ? '#e2ff9b' : '#b6cf83'} strokeOpacity=".7" strokeWidth={t.width} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" /><polyline points={pointsString(tracePoints(shown, t))} fill="none" stroke="#e3f0c9" strokeOpacity=".7" strokeWidth={stroke * .7} strokeDasharray={`${4 / zoom} ${4 / zoom}`} pointerEvents="none" /></g>)}</g>
  return <div className={`viewport tool-${tool} ${space || pan.current ? 'panning' : ''}`} ref={container}>
    <div className="view-heading"><span className="view-dot" /><strong>{isProject ? 'PROJECT WORKSPACE' : 'COMPONENT WORKSPACE'}</strong><span>/</span><span>{isProject ? project.workspace.side === 'top' ? 'Top · component face' : 'Bottom · conductive face' : 'Local coordinates'}</span></div>
    <svg ref={svg} width="100%" height="100%" tabIndex={0} aria-label={isProject ? 'Project design canvas' : 'Component design canvas'} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { cancel() }} onContextMenu={e => e.preventDefault()}>
      <defs><pattern id="grid" width={grid} height={grid} patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r={.8 / zoom} fill="#47505a" /></pattern><pattern id="major-grid" width={grid * 5} height={grid * 5} patternUnits="userSpaceOnUse"><path d={`M ${grid * 5} 0 H 0 V ${grid * 5}`} fill="none" stroke="#242c34" strokeWidth={stroke * .6} /></pattern></defs>
      <g transform={`translate(${originX} ${originY}) scale(${mirror * zoom} ${-zoom})`}>
        <rect x={camera.x - size.width / zoom} y={camera.y - size.height / zoom} width={size.width * 2 / zoom} height={size.height * 2 / zoom} fill="url(#major-grid)" pointerEvents="none" />
        <rect x={camera.x - size.width / zoom} y={camera.y - size.height / zoom} width={size.width * 2 / zoom} height={size.height * 2 / zoom} fill="url(#grid)" pointerEvents="none" />
        {isProject && <>
          {shown.board.outline.length > 0 && <polygon data-kind="outline" data-id="outline" points={pointsString(shown.board.outline)} className={`board-outline ${selection?.kind === 'outline' ? 'selected' : ''}`} strokeWidth={stroke * 1.5} />}
          {bottom ? <>{componentLayer}{traceLayer}</> : <>{traceLayer}{componentLayer}</>}
          {pins(shown).map(p => <g key={`${p.instance.id}:${p.pin.id}`} data-kind="instance" data-id={p.instance.id}>{drawPin(p, p.pin, false, false, p.instance.rotation)}</g>)}
          {shown.junctions.map(j => <circle key={j.id} cx={j.x} cy={j.y} r={Math.max(.7, 3 / zoom)} fill="#e4ffb6" stroke="#11180c" strokeWidth={stroke} />)}
          {selection?.kind === 'outline' && shown.board.outline.map((p, i) => <rect key={i} data-kind="outline" data-id="outline" data-vertex={i} x={p.x - 4 / zoom} y={p.y - 4 / zoom} width={8 / zoom} height={8 / zoom} className="vertex" strokeWidth={stroke} />)}
          {selectedTrace?.vertices.map((p, i) => <circle key={i} data-kind="trace" data-id={selectedTrace.id} data-vertex={i} cx={p.x} cy={p.y} r={4 / zoom} className="vertex" strokeWidth={stroke} />)}
          {tool === 'component' && definitionId && (() => { const d = project.definitions.find(d => d.id === definitionId); return d ? <g pointerEvents="none" opacity=".5"><rect x={cursor.x} y={cursor.y} width={d.width} height={d.height} fill="#a3e63520" stroke="#b8ed88" strokeWidth={stroke} strokeDasharray={`${4 / zoom} ${3 / zoom}`} /></g> : null })()}
        </>}
        {!isProject && definition && <>
          <path d={`M ${-14 / zoom} 0 H ${28 / zoom} M 0 ${-14 / zoom} V ${28 / zoom}`} stroke="#87929c" strokeWidth={stroke} pointerEvents="none" />
          <rect data-kind="body" data-id={definition.id} x="0" y="0" width={definition.width} height={definition.height} className={`definition-body ${selection?.kind === 'body' ? 'selected' : ''}`} strokeWidth={stroke * 1.5} />
          {definition.zones.map(z => { const b = bounds(zonePolygon(z)), selected = sameSelection(selection, 'zone', z.id); return <g key={z.id} data-kind="zone" data-id={z.id}>{drawZone(z, selected)}{showLabel({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, z.name, 'zone-label')}{selected && z.shape === 'polygon' && z.vertices?.map((v, index) => <rect key={index} data-kind="zone" data-id={z.id} data-vertex={index} x={z.x + v.x - 4 / zoom} y={z.y + v.y - 4 / zoom} width={8 / zoom} height={8 / zoom} className="vertex" strokeWidth={stroke} />)}</g> })}
          {definition.pins.map(p => drawPin(p, p, sameSelection(selection, 'pin', p.id), true))}
          {showLabel({ x: definition.width / 2, y: -font * 2 }, `${definition.width} × ${definition.height} mm`, 'dimension-label')}
          {showLabel({ x: -font * 2, y: -font * 1.5 }, '0,0', 'dimension-label')}
          {tool === 'pin' && (pinShape === 'square' ? <rect x={cursor.x - .5} y={cursor.y - .5} width="1" height="1" fill="#a3e63540" stroke="#a3e635" strokeWidth={stroke} pointerEvents="none" /> : <circle cx={cursor.x} cy={cursor.y} r=".5" fill="#a3e63540" stroke="#a3e635" strokeWidth={stroke} pointerEvents="none" />)}
        </>}
        {drawing.length > 0 && (tool === 'zone' && zoneShape === 'rectangle' || tool === 'edge' && edgeMode === 'rectangle') ? <rect x={Math.min(drawing[0].x, cursor.x)} y={Math.min(drawing[0].y, cursor.y)} width={Math.abs(cursor.x - drawing[0].x)} height={Math.abs(cursor.y - drawing[0].y)} fill="#a3e63510" stroke="#c0eb8e" strokeWidth={stroke * 1.5} strokeDasharray={`${5 / zoom} ${4 / zoom}`} pointerEvents="none" /> : drawing.length > 0 && tool === 'zone' && zoneShape === 'circle' ? <circle cx={drawing[0].x} cy={drawing[0].y} r={distance(drawing[0], cursor)} fill="#a3e63510" stroke="#c0eb8e" strokeWidth={stroke * 1.5} pointerEvents="none" /> : drawing.length > 0 && <polyline points={pointsString(previewPath)} fill={tool === 'edge' || tool === 'zone' ? '#a3e6350b' : 'none'} stroke="#ddf4b4" strokeWidth={tool === 'trace' ? traceWidth : stroke * 1.5} strokeOpacity=".7" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
        {(tool === 'edge' || tool === 'zone' && zoneShape === 'polygon') && drawing.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 / zoom} fill="#d7f5ad" pointerEvents="none" />)}
        {tool === 'trace' && hoverTarget && <circle cx={hoverTarget.point.x} cy={hoverTarget.point.y} r={8 / zoom} fill="none" stroke="#e6ffc0" strokeWidth={stroke * 1.5} pointerEvents="none" />}
      </g>
    </svg>
    <div className="canvas-bottom"><div className="axis-indicator"><span>Y ↑</span><span>X →</span></div><div className="canvas-hint">{space ? 'Drag to pan' : tool === 'trace' ? routeStart ? 'Click to bend · click a pin or trace to connect · Esc to cancel' : 'Click a pin or trace to start routing' : tool === 'edge' ? project.board.outline.length ? 'Boundary complete - use Select to edit' : drawing.length ? 'Click vertices · click first point or Enter to finish' : `Click to start a ${edgeMode}` : tool === 'zone' ? zoneShape === 'circle' ? drawing.length ? 'Click to set radius' : 'Click to set center' : zoneShape === 'polygon' ? 'Click vertices - close at the first point or press Enter' : 'Click two opposite corners' : tool === 'pin' ? 'Click to place a pin' : tool === 'component' ? 'Click to place · Esc to cancel' : 'Pinch or scroll to zoom · Space + drag to pan'}</div><div className="zoom-controls"><Button variant="ghost" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => storeCamera({ ...camera, zoom: Math.max(.01, zoom / 1.25) })}><Minus size={15} /></Button><span>{Math.round(zoom * 10)}%</span><Button variant="ghost" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => storeCamera({ ...camera, zoom: Math.min(10000, zoom * 1.25) })}><Plus size={15} /></Button><i /><Button variant="ghost" size="icon" title="Fit design (F)" aria-label="Fit design" onClick={fit}><Maximize size={15} /></Button></div></div>
    <div className="coordinate-readout"><span>X <b>{cursor.x.toFixed(2)}</b></span><span>Y <b>{cursor.y.toFixed(2)}</b></span><span>mm</span></div>
    {preview && <div className="moving-badge"><RotateCcw size={12} /> Release to apply</div>}
    {isProject && project.board.outline.length > 0 && <span className="board-size-label">{(projectBounds.maxX - projectBounds.minX).toFixed(1)} × {(projectBounds.maxY - projectBounds.minY).toFixed(1)} mm</span>}
  </div>
}
