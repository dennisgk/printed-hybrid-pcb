import { describe, expect, it } from 'vitest'
import type { Definition, Feature, Zone } from '../src/lib/model'
import { clone, createDefinition, createProject, ensureVertexIds, parseProject, serializeProject } from '../src/lib/model'
import { angleAt, angularVertices, controlledKeys, controllerFor, makeAngular, makeParallel, parallelLines, solveDefinition, solveDefinitionEdit } from '../src/lib/constraints'
import { createPolygonZone, zonePolygon } from '../src/lib/geometry'

function fixture() {
  const d = createDefinition(); d.id = 'body'; d.zones = [zone('a', 30), zone('b', 60)]; return d
}
function zone(id: string, x: number): Zone { return { id, name: id, x, y: 5, width: 10, height: 10, mode: 'clearance', depth: 1 } }
const feature = (id: string, part: Feature['feature'], owner: Feature['owner'] = 'zone'): Feature => ({ owner, id, feature: part })
function addParallel(d: Definition, a: Feature, b: Feature) { const c = makeParallel(d, a, b); (d.constraints ??= []).push(c); return c }
function setValue(d: Definition, constraintId: string, expression: string, value: number) { const next = clone(d), c = next.constraints!.find(c => c.id === constraintId)!; c.expression = expression; c.value = value; return solveDefinitionEdit(d, next) }
function polygonFixture() {
  const d = createDefinition(), z = createPolygonZone([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 10, y: -10 }, { x: 0, y: -10 }]); d.zones = [z]
  const edge = (i: number): Feature => ({ owner: 'zone', id: z.id, feature: 'edge', vertices: [z.vertices![i].id!, z.vertices![(i + 1) % z.vertices!.length].id!] })
  return { d, z, edge }
}
describe('directed component constraints', () => {
  it('moves a target, keeps body reference dimensions free, and blocks manual output writes', () => {
    const d = fixture(), c = addParallel(d, feature(d.id, 'right', 'body'), feature('a', 'left'))
    const next = setValue(d, c.id, '10+5', 15)
    expect(next.zones[0].x).toBeCloseTo(35); expect(next.width).toBe(20)
    expect(controllerFor(next, 'zone', 'a', 'x')?.id).toBe(c.id); expect(controllerFor(next, 'zone', 'a', 'y')).toBeUndefined()
    const manual = clone(next); manual.zones[0].x++
    expect(() => solveDefinitionEdit(next, manual)).toThrow('Constraint-controlled')
    const referenceEdit = clone(next); referenceEdit.width = 25
    expect(solveDefinitionEdit(next, referenceEdit).zones[0].x).toBeCloseTo(40)
    expect(() => makeParallel(d, feature('a', 'left'), feature(d.id, 'right', 'body'))).toThrow('body cannot')
  })
  it('uses same-object sides and midaxes to size rectangles and square pins', () => {
    const d = fixture(), c = addParallel(d, feature('a', 'left'), feature('a', 'midX'))
    const next = setValue(d, c.id, '3*3', 9)
    expect(next.zones[0].width).toBeCloseTo(18); expect(next.zones[0].x).toBe(30)
    expect(() => setValue(d, c.id, '0', 0)).toThrow('zero or negative')
    const square = createDefinition(); square.pins = [{ id: 'pin', name: 'Pin', x: 4, y: 7, diameter: 2, shape: 'square', color: '#a3e635' }]
    const pc = addParallel(square, feature('pin', 'bottom', 'pin'), feature('pin', 'top', 'pin'))
    const resized = setValue(square, pc.id, '4', 4)
    expect(resized.pins[0].diameter).toBeCloseTo(4); expect(resized.pins[0].x).toBe(4); expect(resized.pins[0].y).toBe(7)
    expect(controllerFor(resized, 'pin', 'pin', 'diameter')?.id).toBe(pc.id)
  })
  it.each(['near', 'center', 'far'] as const)('moves a circular target using its %s feature while keeping size editable', mode => {
    const d = fixture(); d.zones = [{ ...zone('circle', 30), shape: 'circle', radius: 3, y: 10, width: 6, height: 6 }]
    const c = addParallel(d, feature('body', 'right', 'body'), { ...feature('circle', 'circle'), circleMode: mode })
    const next = setValue(d, c.id, '8', 8)
    expect(Math.abs(parallelLines(next, next.constraints![0] as typeof c).signedDistance)).toBeCloseTo(8)
    expect(next.zones[0].radius).toBe(3)
    const radiusChange = clone(next); radiusChange.zones[0].radius = 4
    const resized = solveDefinitionEdit(next, radiusChange)
    expect(Math.abs(parallelLines(resized, resized.constraints![0] as typeof c).signedDistance)).toBeCloseTo(8)
    expect(controllerFor(resized, 'zone', 'circle', 'radius')).toBeUndefined()
  })
  it('propagates chains and rejects cycles and duplicate drivers', () => {
    const d = fixture(), c = addParallel(d, feature('body', 'right', 'body'), feature('a', 'left'))
    addParallel(d, feature('a', 'right'), feature('b', 'left'))
    const next = setValue(d, c.id, '20', 20)
    expect(next.zones[0].x).toBeCloseTo(40); expect(next.zones[1].x).toBeCloseTo(70)
    expect(() => makeParallel(d, feature('body', 'left', 'body'), feature('a', 'right'))).toThrow('Overconstrained')
    const cycle = fixture(); addParallel(cycle, feature('a', 'right'), feature('b', 'left'))
    expect(() => makeParallel(cycle, feature('b', 'right'), feature('a', 'left'))).toThrow('circular')
  })
  it('allows independent horizontal and vertical drivers on the same object', () => {
    const d = fixture()
    const x = addParallel(d, feature('body', 'right', 'body'), feature('a', 'left'))
    const y = addParallel(d, feature('body', 'top', 'body'), feature('a', 'top'))
    let next = setValue(d, x.id, '12', 12)
    next = setValue(next, y.id, '9', 9)
    expect(next.zones[0].x).toBeCloseTo(32); expect(next.zones[0].y).toBeCloseTo(11)
    expect(controllerFor(next, 'zone', 'a', 'x')?.id).toBe(x.id)
    expect(controllerFor(next, 'zone', 'a', 'y')?.id).toBe(y.id)
  })
  it('combines a same-object width with a position driven from its far side', () => {
    const d = fixture(), width = addParallel(d, feature('a', 'left'), feature('a', 'right'))
    addParallel(d, feature('body', 'right', 'body'), feature('a', 'right'))
    const next = setValue(d, width.id, '15', 15)
    expect(next.zones[0].width).toBeCloseTo(15)
    expect(next.zones[0].x + next.zones[0].width).toBeCloseTo(40)
  })
  it('rejects deleted references and shape conversions, and releases a deleted driver', () => {
    const d = fixture(), c = addParallel(d, feature('body', 'right', 'body'), feature('a', 'left'))
    const deleted = clone(d); deleted.zones = []
    expect(() => solveDefinitionEdit(d, deleted)).toThrow()
    const changed = clone(d); changed.zones[0].shape = 'circle'; changed.zones[0].radius = 5
    expect(() => solveDefinitionEdit(d, changed)).toThrow()
    const free = clone(d); free.constraints = []; free.zones[0].x = 50
    expect(solveDefinitionEdit(d, free).zones[0].x).toBe(50)
    expect(c.reference.owner).toBe('body')
  })
  it('moves only the second edge for same-polygon distances, with stable vertex IDs', () => {
    const d = createDefinition(), z = createPolygonZone([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]); d.zones = [z]
    const edge = (a: number, b: number): Feature => ({ owner: 'zone', id: z.id, feature: 'edge', vertices: [z.vertices![a].id!, z.vertices![b].id!] })
    const ids = z.vertices!.map(v => v.id), c = addParallel(d, edge(0, 1), edge(2, 3)), next = setValue(d, c.id, '15', 15)
    expect(zonePolygon(next.zones[0])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 15 }, { x: 0, y: 15 }])
    expect(next.zones[0].vertices!.map(v => v.id)).toEqual(ids)
    expect(controlledKeys(next, next.constraints![0])).toHaveLength(2)
    expect(controllerFor(next, 'zone', z.id, 'height')?.id).toBe(c.id)
  })
  it('moves an entire polygon across objects and blocks a nonparallel reference edit', () => {
    const d = fixture(), z = createPolygonZone([{ x: 40, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 10 }, { x: 40, y: 10 }]); d.zones.push(z)
    const edge: Feature = { owner: 'zone', id: z.id, feature: 'edge', vertices: [z.vertices![3].id!, z.vertices![0].id!] }
    const c = addParallel(d, feature('body', 'right', 'body'), edge), original = zonePolygon(z), next = setValue(d, c.id, '25', 25)
    expect(zonePolygon(next.zones[2])).toEqual(original.map(p => ({ x: p.x + 5, y: p.y })))
    const reference = createDefinition(); reference.zones = [clone(z), zone('rect', 60)]
    addParallel(reference, edge, feature('rect', 'left'))
    const edit = clone(reference); edit.zones[0].vertices![0].x += 1
    expect(() => solveDefinitionEdit(reference, edit)).toThrow('not parallel')
  })
  it('moves the shared angular vertex on its original bisector, preserving outer vertices', () => {
    const { d, edge } = polygonFixture(), c = makeAngular(d, edge(0), edge(1)); d.constraints!.push(c)
    const original = angularVertices(d, c), next = setValue(d, c.id, '30*2', 60), points = angularVertices(next, c)
    expect(points[0]).toEqual(original[0]); expect(points[2]).toEqual(original[2])
    expect(points[1].x).toBeCloseTo(5); expect(points[1].y).toBeCloseTo(5 * Math.sqrt(3))
    expect(angleAt(...points)).toBeCloseTo(60)
    expect(() => setValue(d, c.id, '180', 180)).toThrow('less than 180')
    expect(() => makeAngular(d, edge(0), edge(3))).toThrow('adjacent')
  })
  it('rejects an angular solution when the fixed bisector no longer reaches a valid locus', () => {
    const { d, edge } = polygonFixture(), c = makeAngular(d, edge(0), edge(1)); d.constraints!.push(c)
    const next = clone(d); next.zones[0].vertices![0].x += 100; next.zones[0].vertices![2].x += 100
    expect(() => solveDefinitionEdit(d, next)).toThrow('no valid solution')
  })
  it('rolls back failed solves and rejects mismatched expression results', () => {
    const d = fixture(), c = addParallel(d, feature('a', 'left'), feature('a', 'right')), before = clone(d)
    d.constraints![0].expression = '-1'; d.constraints![0].value = -1
    const invalid = clone(d); expect(() => solveDefinition(d)).toThrow('positive'); expect(d).toEqual(invalid)
    expect(() => setValue(before, c.id, '2+2', 5)).toThrow('does not match')
  })
  it('migrates v1 vertices and round-trips v2 constraints and drafts', () => {
    const { d } = polygonFixture(), p = createProject('Migration'); p.definitions = [d]
    const legacy = JSON.parse(JSON.stringify(p)); legacy.metadata.schemaVersion = 1; delete legacy.definitions[0].constraints
    for (const v of legacy.definitions[0].zones[0].vertices) delete v.id
    const migrated = parseProject(JSON.stringify(legacy)); expect(migrated.metadata.schemaVersion).toBe(2)
    expect(migrated.definitions[0].zones[0].vertices!.every(v => v.id)).toBe(true)
    const next = fixture(); addParallel(next, feature('body', 'right', 'body'), feature('a', 'left')); ensureVertexIds(next)
    p.definitions.push(next); p.workspace.tabs.push(next.id); p.workspace.drafts[next.id] = clone(next)
    const loaded = parseProject(serializeProject(p))
    expect(loaded.definitions[1].constraints).toEqual(next.constraints)
    expect(loaded.workspace.drafts[next.id]).toEqual(next)
    const broken = clone(p); broken.definitions[1].constraints![0].value++
    expect(() => parseProject(JSON.stringify(broken))).toThrow('does not match')
  })
})
