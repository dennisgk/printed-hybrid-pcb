import { id } from './model'
import type { Anchor, Definition, Instance, Pin, Point, Project, Trace, Zone, ZoneShape } from './model'

export const EPS = 1e-5
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export const equal = (a: Point, b: Point) => distance(a, b) < EPS
export const snap = (p: Point, grid: number): Point => ({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid })
export const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
export function bounds(points: Point[]) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) }
}
export function transform(p: Point, i: Instance): Point {
  const r = i.rotation * Math.PI / 180
  return { x: i.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: i.y + p.x * Math.sin(r) + p.y * Math.cos(r) }
}
export function rect(x: number, y: number, width: number, height: number, clearance = 0): Point[] {
  return [{ x: x - clearance, y: y - clearance }, { x: x + width + clearance, y: y - clearance }, { x: x + width + clearance, y: y + height + clearance }, { x: x - clearance, y: y + height + clearance }]
}
export function bodyPolygon(d: Definition, i: Instance, c = 0) { return rect(0, 0, d.width, d.height, c).map(p => transform(p, i)) }
export function zonePolygon(z: Zone): Point[] {
  if (z.shape === 'circle') return Array.from({ length: 96 }, (_, n) => ({ x: z.x + (z.radius ?? z.width / 2) * Math.cos(n * Math.PI / 48), y: z.y + (z.radius ?? z.width / 2) * Math.sin(n * Math.PI / 48) }))
  if (z.shape === 'polygon') return (z.vertices ?? []).map(p => ({ x: z.x + p.x, y: z.y + p.y }))
  return rect(z.x, z.y, z.width, z.height)
}
export function createPolygonZone(points: Point[]): Zone {
  const b = bounds(points)
  return { id: id(), name: 'Clearance zone', shape: 'polygon', x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY, vertices: points.map(p => ({ x: p.x - b.minX, y: p.y - b.minY })), mode: 'clearance', depth: 1 }
}
export function changeZoneShape(z: Zone, shape: ZoneShape) {
  if ((z.shape ?? 'rectangle') === shape) return
  const b = bounds(zonePolygon(z)), w = b.maxX - b.minX, h = b.maxY - b.minY
  z.shape = shape; z.width = w; z.height = h; z.x = b.minX; z.y = b.minY
  delete z.radius; delete z.vertices
  if (shape === 'circle') { z.x += w / 2; z.y += h / 2; z.radius = Math.max(w, h) / 2; z.width = z.height = z.radius * 2 }
  if (shape === 'polygon') z.vertices = rect(0, 0, w, h)
}
export function resizeZone(z: Zone, key: 'width' | 'height', value: number) {
  if (z.shape === 'polygon' && z.vertices) { const axis = key === 'width' ? 'x' : 'y', scale = value / z[key]; z.vertices = z.vertices.map(v => ({ ...v, [axis]: v[axis] * scale })) }
  z[key] = value
}
export function normalizePolygonZone(z: Zone) {
  if (z.shape !== 'polygon' || !z.vertices?.length) return
  const b = bounds(z.vertices)
  z.x += b.minX; z.y += b.minY
  z.width = Math.max(EPS, b.maxX - b.minX); z.height = Math.max(EPS, b.maxY - b.minY)
  z.vertices = z.vertices.map(v => ({ x: v.x - b.minX, y: v.y - b.minY }))
}
export function projectContentPoints(p: Project): Point[] {
  return [...p.board.outline, ...p.instances.flatMap(i => { const d = p.definitions.find(d => d.id === i.definitionId); return d ? [...bodyPolygon(d, i), ...d.zones.flatMap(z => zonePolygon(z).map(v => transform(v, i)))] : [] }), ...p.traces.flatMap(t => tracePoints(p, t))]
}
export const edges = (points: Point[]) => points.map((p, i) => [p, points[(i + 1) % points.length]] as [Point, Point])
export function projectSegment(p: Point, a: Point, b: Point): Point {
  const l = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  const t = l < EPS * EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l))
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}
export const pointSegmentDistance = (p: Point, a: Point, b: Point) => distance(p, projectSegment(p, a, b))
export function intersects(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) && ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))) return true
  return [pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)].some(v => v < EPS)
}
export function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  return intersects(a, b, c, d) ? 0 : Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}
export function inside(p: Point, poly: Point[]) {
  if (edges(poly).some(([a, b]) => pointSegmentDistance(p, a, b) < EPS)) return true
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c
  }
  return c
}
export function polygonsOverlap(a: Point[], b: Point[]) { return a.some(p => inside(p, b)) || b.some(p => inside(p, a)) || edges(a).some(([p, q]) => edges(b).some(([r, s]) => intersects(p, q, r, s))) }
export function polygonsDistance(a: Point[], b: Point[]) { return polygonsOverlap(a, b) ? 0 : Math.min(...edges(a).flatMap(([p, q]) => edges(b).map(([r, s]) => segmentDistance(p, q, r, s)))) }
export type PinHole = { center: Point; radius: number; polygon: Point[] | null }
export function pinHole(pin: Pin, instance: Instance, allowance: number): PinHole {
  const side = pin.diameter + allowance
  return { center: transform(pin, instance), radius: side / 2, polygon: pin.shape === 'square' ? rect(pin.x - side / 2, pin.y - side / 2, side, side).map(p => transform(p, instance)) : null }
}
export const pinOuterDiameter = (pin: Pin, allowance: number) => (pin.diameter + allowance) * (pin.shape === 'square' ? Math.SQRT2 : 1)
export function pointPolygonDistance(point: Point, polygon: Point[]) { return inside(point, polygon) ? 0 : Math.min(...edges(polygon).map(([a, b]) => pointSegmentDistance(point, a, b))) }
export function pointHoleDistance(point: Point, hole: PinHole) { return hole.polygon ? pointPolygonDistance(point, hole.polygon) : Math.max(0, distance(point, hole.center) - hole.radius) }
export function segmentHoleDistance(a: Point, b: Point, hole: PinHole) {
  if (!hole.polygon) return Math.max(0, pointSegmentDistance(hole.center, a, b) - hole.radius)
  return inside(a, hole.polygon) || inside(b, hole.polygon) ? 0 : Math.min(...edges(hole.polygon).map(([c, d]) => segmentDistance(a, b, c, d)))
}
export function holePolygonDistance(hole: PinHole, polygon: Point[]) { return hole.polygon ? polygonsDistance(hole.polygon, polygon) : Math.max(0, pointPolygonDistance(hole.center, polygon) - hole.radius) }
export function holesDistance(a: PinHole, b: PinHole) {
  if (a.polygon && b.polygon) return polygonsDistance(a.polygon, b.polygon)
  if (a.polygon) return Math.max(0, pointPolygonDistance(b.center, a.polygon) - b.radius)
  if (b.polygon) return Math.max(0, pointPolygonDistance(a.center, b.polygon) - a.radius)
  return Math.max(0, distance(a.center, b.center) - a.radius - b.radius)
}
export function outlineError(poly: Point[]): string | null {
  if (poly.length < 3) return 'The board outline needs at least three vertices.'
  const area = Math.abs(edges(poly).reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0) / 2)
  if (area < EPS) return 'The board outline has no area.'
  const es = edges(poly)
  for (let i = 0; i < es.length; i++) {
    if (distance(...es[i]) < EPS) return 'The outline contains a zero-length edge.'
    for (let j = i + 1; j < es.length; j++) if (j !== i + 1 && !(i === 0 && j === es.length - 1) && intersects(...es[i], ...es[j])) return 'The board outline intersects itself.'
  }
  // Adjacent edges must not double back along the same line.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length]
    if (Math.abs(cross(a, b, c)) < EPS && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 0) return 'The outline doubles back on itself.'
  }
  return null
}
export function anchorKey(a: Anchor) { return a.kind === 'pin' ? `pin:${a.instanceId}:${a.pinId}` : `junction:${a.id}` }
export function anchorPoint(p: Project, a: Anchor): Point {
  if (a.kind === 'junction') return p.junctions.find(j => j.id === a.id) ?? { x: NaN, y: NaN }
  const i = p.instances.find(i => i.id === a.instanceId)
  const pin = p.definitions.find(d => d.id === i?.definitionId)?.pins.find(pin => pin.id === a.pinId)
  return i && pin ? transform(pin, i) : { x: NaN, y: NaN }
}
export function tracePoints(p: Project, t: Trace) { return [anchorPoint(p, t.from), ...t.vertices, anchorPoint(p, t.to)] }
export function pins(p: Project) {
  return p.instances.flatMap(i => (p.definitions.find(d => d.id === i.definitionId)?.pins ?? []).map(pin => ({ ...transform(pin, i), pin, instance: i, anchor: { kind: 'pin', instanceId: i.id, pinId: pin.id } as Anchor })))
}
export function snapAngle(start: Point, end: Point, mode: '45' | '90' | 'free'): Point {
  if (mode === 'free') return end
  const angle = Math.atan2(end.y - start.y, end.x - start.x), step = mode === '45' ? Math.PI / 4 : Math.PI / 2
  const rounded = Math.round(angle / step) * step
  const length = (end.x - start.x) * Math.cos(rounded) + (end.y - start.y) * Math.sin(rounded)
  return { x: start.x + length * Math.cos(rounded), y: start.y + length * Math.sin(rounded) }
}
export type Target = { kind: 'anchor'; anchor: Anchor; point: Point } | { kind: 'segment'; traceId: string; segment: number; point: Point }
export function nearestTarget(p: Project, point: Point, radius: number): Target | null {
  const candidates = [...pins(p).map(pin => ({ point: pin, anchor: pin.anchor })), ...p.junctions.map(j => ({ point: j, anchor: { kind: 'junction', id: j.id } as Anchor }))]
  candidates.sort((a, b) => distance(a.point, point) - distance(b.point, point))
  if (candidates[0] && distance(candidates[0].point, point) < radius) return { kind: 'anchor', ...candidates[0] }
  let best: Target | null = null, bestD = radius
  for (const t of p.traces) { const pts = tracePoints(p, t); for (let s = 0; s < pts.length - 1; s++) { const projected = projectSegment(point, pts[s], pts[s + 1]), d = distance(projected, point); if (d < bestD) { bestD = d; best = { kind: 'segment', traceId: t.id, segment: s, point: projected } } } }
  return best
}
export function connectTarget(p: Project, target: Target): Anchor {
  if (target.kind === 'anchor') return target.anchor
  // Resolve against current geometry: a second target may reference a path already split by the first.
  for (const t of p.traces.slice()) {
    const pts = tracePoints(p, t)
    for (let s = 0; s < pts.length - 1; s++) if (pointSegmentDistance(target.point, pts[s], pts[s + 1]) < EPS) {
      if (equal(target.point, pts[0])) return t.from
      if (equal(target.point, pts[pts.length - 1])) return t.to
      const junction = { id: id(), ...target.point }; p.junctions.push(junction)
      const anchor: Anchor = { kind: 'junction', id: junction.id }
      const index = p.traces.findIndex(x => x.id === t.id)
      const left = pts.slice(1, s + 1).filter(v => !equal(v, target.point)), right = pts.slice(s + 1, -1).filter(v => !equal(v, target.point))
      p.traces.splice(index, 1, { ...t, to: anchor, vertices: left }, { ...t, id: id(), from: anchor, vertices: right })
      return anchor
    }
  }
  throw new Error('The selected connection is no longer available.')
}
export type Issue = { element: string; message: string }
export function validateProject(p: Project, options: { forExport?: boolean } = {}): Issue[] {
  const issues: Issue[] = [], s = p.board.settings, outline = p.board.outline
  const add = (element: string, message: string) => { if (!issues.some(i => i.element === element && i.message === message)) issues.push({ element, message }) }
  const outlineIssue = outlineError(outline)
  const hasBoundary = !!options.forExport && outline.length >= 3 && !outlineIssue
  if (!outline.length && options.forExport) add('outline', 'Define a completed edge-cut boundary before exporting.')
  else if (outline.length && outlineIssue) { add('outline', outlineIssue); return issues }
  if (s.minFloor > s.thickness) add('board', 'Minimum remaining floor exceeds plate thickness.')
  const border = edges(outline)
  const containsSegment = (a: Point, b: Point, margin = 0) => !hasBoundary || (inside(a, outline) && inside(b, outline) && inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, outline) && border.every(([c, d]) => segmentDistance(a, b, c, d) >= margin - EPS))
  const bodies: { instance: Instance; poly: Point[] }[] = [], cuts: { poly: Point[]; instance: string; clearance: number }[] = [], keepouts: { poly: Point[]; instance: string; clearance: number }[] = []
  for (const i of p.instances) {
    const d = p.definitions.find(d => d.id === i.definitionId)
    if (!d) { add(i.id, `${i.name}: missing component definition.`); continue }
    const c = i.fitClearance ?? d.fitClearance ?? s.fitClearance, depth = i.recessDepth ?? d.recessDepth
    const poly = bodyPolygon(d, i, c); bodies.push({ instance: i, poly })
    if (edges(poly).some(([a, b]) => !containsSegment(a, b, s.edgeClearance))) add(i.id, `${i.name}: component recess must fit inside the board edge clearance.`)
    if (depth > s.thickness - s.minFloor + EPS) add(i.id, `${i.name}: recess leaves less than the minimum floor thickness.`)
    for (const z of d.zones) {
      const localPolygon = zonePolygon(z), error = outlineError(localPolygon)
      if (error) { add(i.id, `${i.name}: invalid clearance zone (${error})`); continue }
      const polygon = localPolygon.map(q => transform(q, i))
      keepouts.push({ poly: polygon, instance: i.id, clearance: c })
      if (z.mode === 'cut') cuts.push({ poly: polygon, instance: i.id, clearance: c })
      if (z.mode === 'recess' && z.depth > s.thickness - s.minFloor + EPS) add(i.id, `${i.name}: a clearance-zone pocket leaves too little floor material.`)
    }
  }
  for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) if (polygonsOverlap(bodies[a].poly, bodies[b].poly)) add(bodies[b].instance.id, `${bodies[b].instance.name}: component recesses overlap.`)
  for (const z of keepouts) for (const b of bodies) if (b.instance.id !== z.instance && (polygonsOverlap(z.poly, b.poly) || polygonsDistance(z.poly, b.poly) < z.clearance - EPS)) add(b.instance.id, `${b.instance.name}: intersects another component's clearance zone.`)
  const allPins = pins(p).map(pin => ({ ...pin, hole: pinHole(pin.pin, pin.instance, s.holeAllowance) }))
  for (const pin of allPins) {
    const hole = pin.hole
    if (hasBoundary && (hole.polygon ? edges(hole.polygon).some(([a, b]) => !containsSegment(a, b, s.edgeClearance)) : !inside(pin, outline) || border.some(([a, b]) => pointSegmentDistance(pin, a, b) < hole.radius + s.edgeClearance - EPS))) add(pin.instance.id, `${pin.instance.name}: a pin hole is outside the usable plate.`)
    if (cuts.some(c => holePolygonDistance(hole, c.poly) < c.clearance + EPS)) add(pin.instance.id, `${pin.instance.name}: a pin hole intersects a through-cut.`)
  }
  for (let a = 0; a < allPins.length; a++) for (let b = a + 1; b < allPins.length; b++) if (holesDistance(allPins[a].hole, allPins[b].hole) < EPS) add(allPins[b].instance.id, 'Printed pin holes overlap or touch.')
  type Segment = { a: Point; b: Point; trace: Trace; index: number; start?: string; end?: string }
  const segs: Segment[] = []
  const padRadius = (a: Anchor) => {
    const pin = a.kind === 'pin' ? allPins.find(p => anchorKey(p.anchor) === anchorKey(a)) : null
    const connectedWidth = Math.max(s.traceWidth, ...p.traces.filter(t => anchorKey(t.from) === anchorKey(a) || anchorKey(t.to) === anchorKey(a)).map(t => t.width))
    return pin ? Math.max(s.landingDiameter, connectedWidth, pinOuterDiameter(pin.pin, s.holeAllowance) + 1) / 2 : connectedWidth / 2
  }
  for (const t of p.traces) {
    const pts = tracePoints(p, t)
    if (pts.some(v => !Number.isFinite(v.x + v.y))) { add(t.id, 'Trace has a missing endpoint.'); continue }
    if (anchorKey(t.from) === anchorKey(t.to)) add(t.id, 'A trace cannot connect an anchor to itself.')
    for (let n = 0; n < pts.length - 1; n++) {
      const a = pts[n], b = pts[n + 1]
      if (distance(a, b) < EPS) add(t.id, 'Trace contains a zero-length segment.')
      if (!containsSegment(a, b, t.width / 2 + s.edgeClearance)) add(t.id, 'Trace violates board edge clearance.')
      if (cuts.some(c => inside(a, c.poly) || inside(b, c.poly) || edges(c.poly).some(([q, r]) => segmentDistance(a, b, q, r) < t.width / 2 + s.separation + c.clearance - EPS))) add(t.id, 'Trace intersects a through-cut or its clearance.')
      for (const pin of allPins) if (anchorKey(pin.anchor) !== anchorKey(t.from) && anchorKey(pin.anchor) !== anchorKey(t.to) && segmentHoleDistance(a, b, pin.hole) < t.width / 2 + s.separation - EPS) add(t.id, 'Trace passes too close to an unrelated pin hole.')
      segs.push({ a, b, trace: t, index: n, start: n === 0 ? anchorKey(t.from) : undefined, end: n === pts.length - 2 ? anchorKey(t.to) : undefined })
    }
    for (const a of [t.from, t.to]) if (a.kind === 'pin') {
      const center = anchorPoint(p, a), r = padRadius(a)
      if (hasBoundary && (!inside(center, outline) || border.some(([a, b]) => pointSegmentDistance(center, a, b) < r + s.edgeClearance - EPS))) add(t.id, 'Pin landing pad violates board edge clearance.')
      if (cuts.some(c => inside(center, c.poly) || edges(c.poly).some(([a, b]) => pointSegmentDistance(center, a, b) < r + s.separation + c.clearance - EPS))) add(t.id, 'Pin landing pad intersects a through-cut.')
    }
  }
  for (let x = 0; x < segs.length; x++) for (let y = x + 1; y < segs.length; y++) {
    const a = segs[x], b = segs[y], same = a.trace.id === b.trace.id
    const shared = [a.start, a.end].find(k => k && (k === b.start || k === b.end))
    const adjacent = same && Math.abs(a.index - b.index) === 1
    if (shared || adjacent) {
      const joint = equal(a.a, b.a) || equal(a.a, b.b) ? a.a : a.b
      const u = equal(a.a, joint) ? a.b : a.a, v = equal(b.a, joint) ? b.b : b.a
      if (Math.abs(cross(joint, u, v)) < EPS && (u.x - joint.x) * (v.x - joint.x) + (u.y - joint.y) * (v.y - joint.y) > 0) add(b.trace.id, 'Trace segments overlap beyond their shared connection.')
      continue
    }
    if (segmentDistance(a.a, a.b, b.a, b.b) < (a.trace.width + b.trace.width) / 2 + s.separation - EPS) add(b.trace.id, 'Traces cross, overlap, or violate separation. Connect at an explicit junction.')
  }
  // Pads belong to anchors, not networks. Only an explicit shared anchor permits contact.
  const connected = new Map<string, Anchor>()
  for (const t of p.traces) for (const a of [t.from, t.to]) if (a.kind === 'pin') connected.set(anchorKey(a), a)
  for (const [key, anchor] of connected) {
    const center = anchorPoint(p, anchor), radius = padRadius(anchor)
    for (const seg of segs) if (seg.start !== key && seg.end !== key && pointSegmentDistance(center, seg.a, seg.b) < radius + seg.trace.width / 2 + s.separation - EPS) add(seg.trace.id, 'Trace intersects an unrelated pin landing pad.')
    for (const pin of allPins) if (anchorKey(pin.anchor) !== key && pointHoleDistance(center, pin.hole) < radius + s.separation - EPS) add(pin.instance.id, 'A landing pad is too close to another pin hole.')
  }
  const padEntries = [...connected.entries()]
  for (let a = 0; a < padEntries.length; a++) for (let b = a + 1; b < padEntries.length; b++) if (distance(anchorPoint(p, padEntries[a][1]), anchorPoint(p, padEntries[b][1])) < padRadius(padEntries[a][1]) + padRadius(padEntries[b][1]) + s.separation - EPS) add('routing', 'Separate pin landing pads overlap or violate separation.')
  return issues
}
export function cleanJunctions(p: Project) { p.junctions = p.junctions.filter(j => p.traces.some(t => [t.from, t.to].some(a => a.kind === 'junction' && a.id === j.id))) }
