import type { AngularConstraint, CentralConstraint, CenterRef, Constraint, Definition, Feature, ParallelConstraint, Point, Zone } from './model'
import { cross, distance, inside, normalizePolygonZone, outlineError, pointSegmentDistance, rect, zonePolygon } from './geometry'
import { evaluateExpression } from './expression'

const TOL = 1e-7
const uid = () => crypto.randomUUID()
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const unit = (a: Point): Point => { const length = Math.hypot(a.x, a.y); if (length < TOL) throw new Error('A constraint cannot use a zero-length side.'); return scale(a, 1 / length) }
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 + Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b))
export const featureKey = (f: Feature) => `${f.owner}:${f.id}:${f.feature}:${f.vertices?.join(':') ?? ''}`
export const constraintLabel = (c: Constraint) => c.kind === 'parallel' ? 'Parallel distance' : c.kind === 'central' ? 'Central constraint' : 'Angular constraint'
const key = (owner: string, id: string, field: string) => JSON.stringify([owner, id, field])
const vertexKey = (zoneId: string, vertexId: string, axis: string) => JSON.stringify(['vertex', zoneId, vertexId, axis])
const vertex = (z: Zone, vertexId: string) => { const v = z.vertices?.find(v => v.id === vertexId); if (!v) throw new Error('A constraint references a missing polygon vertex. Remove its constraint before deleting the vertex.'); return v }
function findZone(d: Definition, zoneId: string): Zone { const z = d.zones.find(z => z.id === zoneId); if (!z) throw new Error('A constraint references a missing clearance zone. Remove its constraint first.'); return z }

function featureObject(d: Definition, f: Feature) {
  if (f.owner === 'body') { if (f.id !== d.id) throw new Error('Missing component-body reference.'); return { x: 0, y: 0, width: d.width, height: d.height, circular: false, polygon: false } }
  if (f.owner === 'pin') { const p = d.pins.find(p => p.id === f.id); if (!p) throw new Error('A pin is referenced by a constraint. Remove its constraint before deleting it.'); return { x: p.x - p.diameter / 2, y: p.y - p.diameter / 2, width: p.diameter, height: p.diameter, circular: p.shape !== 'square', polygon: false } }
  const z = findZone(d, f.id)
  return { x: z.x, y: z.y, width: z.width, height: z.height, circular: z.shape === 'circle', polygon: z.shape === 'polygon' }
}
export function featureLine(d: Definition, f: Feature, normal?: Point, circleSign = 1): [Point, Point] {
  const object = featureObject(d, f)
  if (object.circular) {
    if (f.feature !== 'circle' || !normal) throw new Error('Circular objects are only valid as the second parallel-constraint selection.')
    const p = f.owner === 'pin' ? d.pins.find(p => p.id === f.id)! : findZone(d, f.id)
    const radius = f.owner === 'pin' ? object.width / 2 : (p as Zone).radius!
    const offset = f.circleMode === 'center' ? 0 : circleSign * radius
    const center = add(p, scale(normal, offset)), tangent = { x: -normal.y, y: normal.x }
    return [add(center, scale(tangent, -radius)), add(center, scale(tangent, radius))]
  }
  if (object.polygon) {
    if (f.feature !== 'edge' || !f.vertices) throw new Error('This polygon side reference is no longer valid.')
    const z = findZone(d, f.id), a = vertex(z, f.vertices[0]), b = vertex(z, f.vertices[1]), vs = z.vertices!
    const ia = vs.indexOf(a), ib = vs.indexOf(b)
    if ((ia + 1) % vs.length !== ib && (ib + 1) % vs.length !== ia) throw new Error('A referenced polygon side was split. Remove its constraint before changing that side.')
    return [add(z, a), add(z, b)]
  }
  const { x, y, width: w, height: h } = object
  switch (f.feature) {
    case 'left': return [{ x, y }, { x, y: y + h }]
    case 'right': return [{ x: x + w, y }, { x: x + w, y: y + h }]
    case 'bottom': return [{ x, y }, { x: x + w, y }]
    case 'top': return [{ x, y: y + h }, { x: x + w, y: y + h }]
    case 'midX': return [{ x: x + w / 2, y }, { x: x + w / 2, y: y + h }]
    case 'midY': return [{ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }]
    default: throw new Error('The shape of a constrained feature has changed. Remove its constraint first.')
  }
}
export function features(d: Definition, polygonsOnly = false): Feature[] {
  const result: Feature[] = []
  const rectangle = (owner: Feature['owner'], id: string) => { for (const feature of ['left', 'right', 'bottom', 'top', 'midX', 'midY'] as const) result.push({ owner, id, feature }) }
  if (!polygonsOnly) { rectangle('body', d.id); for (const p of d.pins) { if (p.shape === 'square') rectangle('pin', p.id); else result.push({ owner: 'pin', id: p.id, feature: 'circle', circleMode: 'near' }) } }
  for (const z of d.zones) {
    if (z.shape === 'polygon') { for (let n = 0; n < (z.vertices?.length ?? 0); n++) { const a = z.vertices![n], b = z.vertices![(n + 1) % z.vertices!.length]; if (a.id && b.id) result.push({ owner: 'zone', id: z.id, feature: 'edge', vertices: [a.id, b.id] }) } }
    else if (!polygonsOnly) { if (z.shape === 'circle') result.push({ owner: 'zone', id: z.id, feature: 'circle', circleMode: 'near' }); else rectangle('zone', z.id) }
  }
  return result
}
export function normalFor(d: Definition, reference: Feature, previous?: Point) {
  const [a, b] = featureLine(d, reference), u = unit(sub(b, a)); let normal = { x: -u.y, y: u.x }
  if (previous && dot(previous, normal) < 0) normal = scale(normal, -1)
  return normal
}
export function parallelLines(d: Definition, c: ParallelConstraint) {
  const normal = normalFor(d, c.reference, c.normal)
  const reference = featureLine(d, c.reference), target = featureLine(d, c.target, normal, c.circleSign)
  const direction = unit(sub(target[1], target[0]))
  if (Math.abs(dot(direction, normal)) > 1e-6) throw new Error('The selected sides are not parallel. This edit is blocked by their parallel constraint.')
  return { reference, target, normal, signedDistance: dot(sub(target[0], reference[0]), normal) }
}
export function nearestFeature(d: Definition, point: Point, radius: number, options: { first?: Feature | null; angular?: boolean; circleMode?: 'near' | 'center' | 'far' } = {}): Feature | null {
  let best: Feature | null = null, bestDistance = radius
  for (let feature of features(d, options.angular)) {
    if (options.first && featureKey(feature) === featureKey(options.first)) continue
    if (options.angular && options.first && (feature.id !== options.first.id || !feature.vertices?.some(v => options.first!.vertices?.includes(v)))) continue
    let dist: number
    if (feature.feature === 'circle') {
      if (!options.first) continue
      feature = { ...feature, circleMode: options.circleMode ?? 'near' }
      const object = feature.owner === 'pin' ? d.pins.find(p => p.id === feature.id)! : findZone(d, feature.id)
      const r = feature.owner === 'pin' ? (object as { diameter: number }).diameter / 2 : (object as Zone).radius!
      dist = Math.min(distance(point, object), Math.abs(distance(point, object) - r))
    } else {
      const [a, b] = featureLine(d, feature)
      if (options.first && !options.angular) { const normal = normalFor(d, options.first); if (Math.abs(dot(unit(sub(b, a)), normal)) > 1e-6) continue }
      dist = pointSegmentDistance(point, a, b)
    }
    if (dist < bestDistance) { bestDistance = dist; best = feature }
  }
  return best
}
function shapeKeys(d: Definition, f: Feature, normal: Point, reference: boolean): string[] {
  const object = featureObject(d, f)
  if (object.polygon) { const z = findZone(d, f.id); const ids = f.vertices!; const axes = (['x', 'y'] as const).filter(axis => reference || Math.abs(normal[axis]) > TOL); return ids.flatMap(v => axes.map(axis => vertexKey(z.id, v, axis))) }
  if (object.circular) return [...(['x', 'y'] as const).filter(axis => Math.abs(normal[axis]) > TOL), ...(f.circleMode === 'center' ? [] : [f.owner === 'pin' ? 'diameter' : 'radius'])].map(field => key(f.owner, f.id, field))
  const vertical = ['left', 'right', 'midX'].includes(f.feature), axis = vertical ? 'x' : 'y', dimension = f.owner === 'pin' ? 'diameter' : vertical ? 'width' : 'height'
  const usesSize = f.owner === 'pin' ? f.feature !== 'midX' && f.feature !== 'midY' : !['left', 'bottom'].includes(f.feature)
  return [...(f.owner === 'body' ? [] : [axis]), ...(usesSize ? [dimension] : [])].map(field => key(f.owner, f.id, field))
}
export function controlledKeys(d: Definition, c: Constraint): string[] {
  if (c.kind === 'central') {
    objectCenter(d, c.reference); objectCenter(d, c.target)
    if (c.reference.owner === c.target.owner && c.reference.id === c.target.id) throw new Error('Select two different objects to align their centers.')
    if (c.target.owner === 'body') throw new Error('The component body cannot be constraint-controlled. Use it as the ground object instead.')
    return ['x', 'y'].map(axis => key(c.target.owner, c.target.id, axis))
  }
  if (c.kind === 'angular') { angularVertices(d, c); return ['x', 'y'].map(axis => vertexKey(c.zoneId, c.vertices[1], axis)) }
  if (c.target.owner === 'body') throw new Error('The component body cannot be constraint-controlled. Select its sides or midaxes as references only.')
  const same = c.reference.owner === c.target.owner && c.reference.id === c.target.id
  const object = featureObject(d, c.target), normal = normalFor(d, c.reference, c.normal)
  // Resolve both references before assigning ownership, catching deleted or converted features.
  featureLine(d, c.target, normal, c.circleSign)
  const axes = (['x', 'y'] as const).filter(axis => Math.abs(normal[axis]) > TOL)
  if (same && !object.polygon) return [key(c.target.owner, c.target.id, c.target.owner === 'pin' ? 'diameter' : Math.abs(normal.x) > .5 ? 'width' : 'height')]
  if (object.polygon) {
    const z = findZone(d, c.target.id), ids = same ? c.target.vertices! : z.vertices!.map(v => v.id!)
    if (same && ids.some(v => c.reference.vertices?.includes(v))) throw new Error('Parallel constraints on the same polygon require two disjoint sides.')
    return ids.flatMap(v => axes.map(axis => vertexKey(z.id, v, axis)))
  }
  return axes.map(axis => key(c.target.owner, c.target.id, axis))
}
function reads(d: Definition, c: Constraint): string[] {
  if (c.kind === 'central') {
    const inputs = centerKeys(d, c.reference)
    if (c.target.owner === 'zone') { const z = findZone(d, c.target.id); if (z.shape !== 'circle') inputs.push(...['width', 'height'].map(field => key('zone', z.id, field))) }
    return inputs
  }
  const output = new Set(controlledKeys(d, c))
  // Internal rectangle/square distances depend on size alone; translation cancels out.
  if (c.kind === 'parallel' && c.reference.owner === c.target.owner && c.reference.id === c.target.id && !featureObject(d, c.target).polygon) return []
  const inputs = c.kind === 'parallel' ? [...shapeKeys(d, c.reference, normalFor(d, c.reference, c.normal), true), ...shapeKeys(d, c.target, normalFor(d, c.reference, c.normal), false)] : c.vertices.filter((_, n) => n !== 1).flatMap(v => ['x', 'y'].map(axis => vertexKey(c.zoneId, v, axis)))
  return inputs.filter(k => !output.has(k))
}
function propertyValue(d: Definition, property: string): number {
  const [owner, id, field, axis] = JSON.parse(property) as string[]
  if (owner === 'vertex') { const z = findZone(d, id), v = vertex(z, field); return axis === 'x' ? z.x + v.x : z.y + v.y }
  const object = owner === 'body' ? d : owner === 'pin' ? d.pins.find(p => p.id === id) : d.zones.find(z => z.id === id)
  if (!object || typeof (object as unknown as Record<string, unknown>)[field] !== 'number') throw new Error('A constraint-controlled property was removed. Remove its constraint first.')
  return (object as unknown as Record<string, number>)[field]
}
export function orderedConstraints(d: Definition): Constraint[] {
  const constraints = d.constraints ?? [], owners = new Map<string, Constraint>(), ids = new Set<string>()
  for (const c of constraints) {
    if (ids.has(c.id)) throw new Error('Duplicate constraint ID.'); ids.add(c.id)
    for (const property of controlledKeys(d, c)) {
      if (owners.has(property)) throw new Error(`Overconstrained: ${constraintLabel(c)} would drive a property already controlled by another constraint.`)
      owners.set(property, c)
    }
  }
  const order: Constraint[] = [], visiting = new Set<string>(), visited = new Set<string>()
  const visit = (c: Constraint) => {
    if (visiting.has(c.id)) throw new Error('Overconstrained: circular constraint dependencies are not allowed.')
    if (visited.has(c.id)) return
    visiting.add(c.id)
    for (const property of reads(d, c)) { const parent = owners.get(property); if (parent && parent !== c) visit(parent) }
    visiting.delete(c.id); visited.add(c.id); order.push(c)
  }
  for (const c of constraints) visit(c)
  return order
}
function applyParallel(d: Definition, c: ParallelConstraint) {
  let { normal, signedDistance } = parallelLines(d, c)
  const difference = c.side * c.value - signedDistance
  if (Math.abs(difference) < 1e-9) return
  const same = c.reference.owner === c.target.owner && c.reference.id === c.target.id
  const object = featureObject(d, c.target)
  if (same && !object.polygon) {
    const target = c.target.owner === 'pin' ? d.pins.find(p => p.id === c.target.id)! : findZone(d, c.target.id)
    const field = c.target.owner === 'pin' ? 'diameter' : Math.abs(normal.x) > .5 ? 'width' : 'height'
    const record = target as unknown as Record<string, number>, original = record[field]
    record[field] = original + 1
    const coefficient = parallelLines(d, c).signedDistance - signedDistance
    record[field] = original
    if (Math.abs(coefficient) < TOL) throw new Error('Those features do not define an independent size constraint.')
    const next = original + difference / coefficient
    if (!Number.isFinite(next) || next <= TOL) throw new Error('This distance would give the shape a zero or negative size.')
    record[field] = next
    return
  }
  const delta = scale(normal, difference)
  if (object.polygon && same) {
    const z = findZone(d, c.target.id)
    for (const id of c.target.vertices!) { const v = vertex(z, id); v.x += delta.x; v.y += delta.y }
    normalizePolygonZone(z)
  } else {
    const target = c.target.owner === 'pin' ? d.pins.find(p => p.id === c.target.id)! : findZone(d, c.target.id)
    target.x += delta.x; target.y += delta.y
  }
}
export function angularVertices(d: Definition, c: AngularConstraint): [Point, Point, Point] {
  const z = findZone(d, c.zoneId)
  if (z.shape !== 'polygon') throw new Error('An angular constraint requires a polygon. Remove its constraints before converting the shape.')
  const vs = z.vertices!, indices = c.vertices.map(id => vs.indexOf(vertex(z, id))), n = vs.length
  if (new Set(indices).size !== 3 || !((indices[0] + 1) % n === indices[1] && (indices[1] + 1) % n === indices[2] || (indices[2] + 1) % n === indices[1] && (indices[1] + 1) % n === indices[0])) throw new Error('Angular constraints require two adjacent, unchanged polygon sides.')
  return c.vertices.map(id => add(z, vertex(z, id))) as [Point, Point, Point]
}
export function angleAt(a: Point, b: Point, c: Point) { return Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, b)), unit(sub(c, b)))))) * 180 / Math.PI }
function applyAngular(d: Definition, constraint: AngularConstraint) {
  const [a, oldB, c] = angularVertices(d, constraint), chord = sub(c, a), length = distance(a, c)
  if (length < TOL) throw new Error('The angular constraint has coincident fixed vertices.')
  const axis = unit(constraint.direction), onLine = Math.abs(cross(constraint.origin, add(constraint.origin, axis), oldB)) < TOL
  // Annotation-only edits must not perturb already-satisfied geometry numerically.
  if (onLine && Math.sign(cross(a, oldB, c)) === constraint.orientation && Math.abs(angleAt(a, oldB, c) - constraint.value) < 1e-8) return
  const radians = constraint.value * Math.PI / 180, midpoint = scale(add(a, c), .5), perpendicular = unit({ x: -chord.y, y: chord.x }), radius = length / (2 * Math.sin(radians))
  const offset = length / (2 * Math.tan(radians)), direction = unit(constraint.direction), solutions: Point[] = []
  for (const sign of [-1, 1]) {
    const center = add(midpoint, scale(perpendicular, sign * offset)), fromCenter = sub(constraint.origin, center)
    const projection = dot(fromCenter, direction), discriminant = projection ** 2 - (dot(fromCenter, fromCenter) - radius ** 2)
    if (discriminant < -1e-8) continue
    for (const t of [-projection - Math.sqrt(Math.max(0, discriminant)), -projection + Math.sqrt(Math.max(0, discriminant))]) {
      const b = add(constraint.origin, scale(direction, t))
      if (distance(a, b) < TOL || distance(c, b) < TOL || Math.sign(cross(a, b, c)) !== constraint.orientation) continue
      if (Math.abs(angleAt(a, b, c) - constraint.value) < 1e-5) solutions.push(b)
    }
  }
  solutions.sort((a, b) => distance(a, oldB) - distance(b, oldB))
  if (!solutions.length) throw new Error('This angle has no valid solution on the fixed bisector line.')
  const z = findZone(d, constraint.zoneId), v = vertex(z, constraint.vertices[1]); v.x = solutions[0].x - z.x; v.y = solutions[0].y - z.y; normalizePolygonZone(z)
}
const area = (points: Point[]) => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - p.y * q.x }, 0)
/** Solve on a copy; no mutation escapes if a dependency or geometric check fails. */
export function solveDefinition(definition: Definition): void {
  const d = structuredClone(definition), order = orderedConstraints(d)
  const orientations = new Map(d.zones.filter(z => z.shape === 'polygon').map(z => [z.id, Math.sign(area(zonePolygon(z)))]))
  for (const constraint of order) {
    const value = evaluateExpression(constraint.expression)
    if (!close(value, constraint.value)) throw new Error('A constraint expression does not match its saved resolved value.')
    if (constraint.kind === 'central') {
      if (value !== 0 || constraint.expression !== '0') throw new Error('A central constraint aligns centers without an offset.')
      const reference = objectCenter(d, constraint.reference), target = objectCenter(d, constraint.target)
      const object = constraint.target.owner === 'pin' ? d.pins.find(p => p.id === constraint.target.id)! : findZone(d, constraint.target.id)
      object.x += reference.x - target.x; object.y += reference.y - target.y
    }
    else if (constraint.kind === 'parallel') { if (value < 0) throw new Error('Distance must be zero or positive.'); applyParallel(d, constraint) }
    else { if (value <= 0 || value >= 180) throw new Error('Angle must be greater than 0° and less than 180°.'); applyAngular(d, constraint) }
  }
  for (const c of order) {
    if (c.kind === 'central') { if (distance(objectCenter(d, c.reference), objectCenter(d, c.target)) > TOL) throw new Error('Constraints conflict: the centers cannot be aligned.') }
    else if (c.kind === 'parallel') { if (!close(parallelLines(d, c).signedDistance, c.side * c.value)) throw new Error('Constraints conflict: the parallel distance cannot be satisfied.') }
    else { const points = angularVertices(d, c); if (!close(angleAt(...points), c.value)) throw new Error('Constraints conflict: the requested angle cannot be satisfied.') }
  }
  if (order.length) for (const z of d.zones) if (z.shape === 'polygon') {
    const points = zonePolygon(z), error = outlineError(points)
    if (error || Math.sign(area(points)) !== orientations.get(z.id)) throw new Error(`Constraint would create an invalid polygon: ${error ?? 'polygon orientation would reverse.'}`)
  }
  Object.assign(definition, d)
}
export function solveDefinitionEdit(before: Definition, candidate: Definition): Definition {
  const d = structuredClone(candidate)
  for (const c of d.constraints ?? []) if (before.constraints?.some(old => old.id === c.id)) {
    const old = before.constraints.find(old => old.id === c.id)!
    for (const property of controlledKeys(before, old)) if (!close(propertyValue(before, property), propertyValue(d, property))) throw new Error(`Constraint-controlled property: edit or remove its ${constraintLabel(old).toLowerCase()} instead.`)
  }
  solveDefinition(d); return d
}
export function controllerFor(d: Definition, owner: 'pin' | 'zone', id: string, field: string, vertexId?: string): Constraint | undefined {
  const z = owner === 'zone' ? d.zones.find(z => z.id === id) : undefined
  const properties = vertexId ? [vertexKey(id, vertexId, field)] : z?.shape === 'polygon' && ['x', 'y', 'width', 'height'].includes(field) ? z.vertices!.map(v => vertexKey(id, v.id!, field === 'width' ? 'x' : field === 'height' ? 'y' : field)) : [key(owner, id, field)]
  return d.constraints?.find(c => { try { const output = controlledKeys(d, c); return properties.some(p => output.includes(p)) } catch { return false } })
}
export function makeParallel(d: Definition, reference: Feature, target: Feature): ParallelConstraint {
  if (reference.feature === 'circle') throw new Error('The reference must be a straight side or midaxis.')
  if (featureKey(reference) === featureKey(target)) throw new Error('Select two different features.')
  const normal = normalFor(d, reference), line = featureLine(d, reference)
  let circleSign: 1 | -1 = 1
  if (target.feature === 'circle') {
    const object = target.owner === 'pin' ? d.pins.find(p => p.id === target.id)! : findZone(d, target.id)
    const centerSign = dot(sub(object, line[0]), normal) >= 0 ? 1 : -1
    circleSign = (target.circleMode === 'far' ? centerSign : -centerSign) as 1 | -1
  }
  const c: ParallelConstraint = { id: uid(), kind: 'parallel', reference: structuredClone(reference), target: structuredClone(target), normal, side: 1, circleSign, expression: '0', value: 0 }
  const signed = parallelLines(d, c).signedDistance; c.side = signed < 0 ? -1 : 1; c.value = Math.abs(signed); c.expression = String(c.value)
  const copy = structuredClone(d); (copy.constraints ??= []).push(c); solveDefinition(copy)
  return c
}
export function makeAngular(d: Definition, first: Feature, second: Feature): AngularConstraint {
  if (first.owner !== 'zone' || first.id !== second.id || first.feature !== 'edge' || second.feature !== 'edge' || !first.vertices || !second.vertices) throw new Error('Select two adjacent sides of the same polygon.')
  const shared = first.vertices.find(id => second.vertices!.includes(id)), a = first.vertices.find(id => id !== shared), c = second.vertices.find(id => id !== shared)
  if (!shared || !a || !c || a === c) throw new Error('Select two different adjacent polygon sides.')
  const z = findZone(d, first.id), pa = add(z, vertex(z, a)), b = add(z, vertex(z, shared)), pc = add(z, vertex(z, c))
  const value = angleAt(pa, b, pc), direction = unit(add(unit(sub(pa, b)), unit(sub(pc, b))))
  const constraint: AngularConstraint = { id: uid(), kind: 'angular', zoneId: z.id, vertices: [a, shared, c], origin: b, direction, orientation: cross(pa, b, pc) >= 0 ? 1 : -1, value, expression: String(value) }
  const copy = structuredClone(d); (copy.constraints ??= []).push(constraint); solveDefinition(copy)
  return constraint
}
export function constraintPosition(d: Definition, c: Constraint): Point {
  if (c.kind === 'central') return objectCenter(d, c.target)
  if (c.kind === 'angular') return angularVertices(d, c)[1]
  const { target, normal, signedDistance } = parallelLines(d, c)
  return sub(scale(add(...target), .5), scale(normal, signedDistance / 2))
}

export function objectCenter(d: Definition, ref: CenterRef): Point {
  if (ref.owner === 'body') { if (ref.id !== d.id) throw new Error('Missing component-body reference.'); return { x: d.width / 2, y: d.height / 2 } }
  if (ref.owner === 'pin') { const p = d.pins.find(p => p.id === ref.id); if (!p) throw new Error('A central constraint references a missing pin. Remove the constraint first.'); return { x: p.x, y: p.y } }
  const z = findZone(d, ref.id)
  if (z.shape === 'polygon') throw new Error('Central constraints support rectangles, squares, and circles; polygons are not eligible.')
  return z.shape === 'circle' ? { x: z.x, y: z.y } : { x: z.x + z.width / 2, y: z.y + z.height / 2 }
}
function centerKeys(d: Definition, ref: CenterRef) {
  objectCenter(d, ref)
  if (ref.owner === 'body') return ['width', 'height'].map(field => key('body', d.id, field))
  if (ref.owner === 'pin') return ['x', 'y'].map(field => key('pin', ref.id, field))
  const z = findZone(d, ref.id)
  return (z.shape === 'circle' ? ['x', 'y'] : ['x', 'y', 'width', 'height']).map(field => key('zone', ref.id, field))
}
export function centerObjects(d: Definition): CenterRef[] {
  return [{ owner: 'body', id: d.id }, ...d.pins.map(p => ({ owner: 'pin' as const, id: p.id })), ...d.zones.filter(z => z.shape !== 'polygon').map(z => ({ owner: 'zone' as const, id: z.id }))]
}
export function nearestCenterObject(d: Definition, p: Point, tolerance: number, first?: CenterRef | null): Feature | null {
  let best: CenterRef | null = null, score = Infinity
  for (const ref of centerObjects(d)) {
    if (first && ref.owner === first.owner && ref.id === first.id) continue
    const center = objectCenter(d, ref)
    let candidate = distance(p, center), hit = candidate < tolerance
    if (ref.owner === 'body') hit ||= inside(p, rect(0, 0, d.width, d.height))
    else if (ref.owner === 'pin') { const pin = d.pins.find(pin => pin.id === ref.id)!; hit ||= pin.shape === 'square' ? inside(p, rect(pin.x - pin.diameter / 2, pin.y - pin.diameter / 2, pin.diameter, pin.diameter)) : candidate <= pin.diameter / 2 }
    else { const z = findZone(d, ref.id); hit ||= z.shape === 'circle' ? candidate <= z.radius! : inside(p, rect(z.x, z.y, z.width, z.height)) }
    if (hit && candidate < score) { score = candidate; best = ref }
  }
  return best ? { ...best, feature: 'midX' } : null
}
export function makeCentral(d: Definition, reference: CenterRef, target: CenterRef): CentralConstraint {
  const c: CentralConstraint = { id: uid(), kind: 'central', reference: { owner: reference.owner, id: reference.id }, target: { owner: target.owner, id: target.id }, expression: '0', value: 0 }
  const copy = structuredClone(d); (copy.constraints ??= []).push(c); solveDefinition(copy); return c
}
/** Try the user's order first; reversed order never relaxes ownership or solver rules. */
export function withSelectionFallback<T>(first: () => T, reversed: () => T): { result: T; reversed: boolean } {
  try { return { result: first(), reversed: false } }
  catch (original) {
    try { return { result: reversed(), reversed: true } }
    catch (reverseError) { const a = (original as Error).message, b = (reverseError as Error).message; throw new Error(a === b ? a : `${a} Reversed selections also failed: ${b}`) }
  }
}
export function makeConstraintWithFallback(d: Definition, kind: 'parallel' | 'angular' | 'central', first: Feature, second: Feature) {
  const make = (a: Feature, b: Feature) => kind === 'parallel' ? makeParallel(d, a, b) : kind === 'angular' ? makeAngular(d, a, b) : makeCentral(d, a, b)
  return withSelectionFallback(() => make(first, second), () => make(second, first))
}
export function reverseConstraint(d: Definition, c: Constraint): Constraint {
  let reversed: Constraint
  if (c.kind === 'parallel') reversed = makeParallel(d, c.target, c.reference)
  else if (c.kind === 'central') reversed = makeCentral(d, c.target, c.reference)
  else {
    const [a, b, end] = c.vertices
    reversed = makeAngular(d, { owner: 'zone', id: c.zoneId, feature: 'edge', vertices: [end, b] }, { owner: 'zone', id: c.zoneId, feature: 'edge', vertices: [b, a] })
    reversed.origin = c.origin; reversed.direction = c.direction
  }
  return { ...reversed, id: c.id, expression: c.expression, value: c.value, annotation: c.annotation }
}
/** Return an unsolved edit for the document transaction, after validating on copies. */
export function prepareConstraintEdit(before: Definition, constraint: Constraint) {
  const apply = (c: Constraint) => {
    const candidate = structuredClone(before), index = candidate.constraints?.findIndex(item => item.id === c.id) ?? -1
    if (index >= 0) candidate.constraints![index] = c; else (candidate.constraints ??= []).push(c)
    solveDefinitionEdit(before, candidate)
    return candidate
  }
  return withSelectionFallback(() => apply(constraint), () => {
    const base = structuredClone(before); base.constraints = base.constraints?.filter(c => c.id !== constraint.id)
    return apply(reverseConstraint(base, constraint))
  })
}
/** The retry applies to constraint creation/edits, never arbitrary geometry edits. */
export function solveDefinitionEditWithFallback(before: Definition, candidate: Definition) {
  try { return { result: solveDefinitionEdit(before, candidate), reversed: false } }
  catch (original) {
    const geometry = (d: Definition) => JSON.stringify({ ...d, constraints: undefined })
    if (geometry(before) !== geometry(candidate)) throw original
    const changed = (candidate.constraints ?? []).filter(c => {
      const old = before.constraints?.find(old => old.id === c.id)
      return JSON.stringify({ ...c, annotation: undefined }) !== JSON.stringify(old ? { ...old, annotation: undefined } : undefined)
    })
    if (changed.length !== 1) throw original
    const prepared = prepareConstraintEdit(before, changed[0])
    return { result: solveDefinitionEdit(before, prepared.result), reversed: prepared.reversed }
  }
}
