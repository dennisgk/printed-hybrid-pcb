import { describe, expect, it } from 'vitest'
import type { Definition, Feature } from '../src/lib/model'
import { clone, createDefinition, createProject, parseProject, serializeProject } from '../src/lib/model'
import { controllerFor, makeCentral, makeConstraintWithFallback, makeParallel, nearestCenterObject, objectCenter, prepareConstraintEdit, solveDefinition, solveDefinitionEdit, solveDefinitionEditWithFallback } from '../src/lib/constraints'
import { createPolygonZone } from '../src/lib/geometry'

const feature = (id: string, part: Feature['feature'], owner: Feature['owner'] = 'zone'): Feature => ({ owner, id, feature: part })
function fixture(): Definition {
  const d = createDefinition(); d.id = 'body'
  d.zones = [{ id: 'a', name: 'A', x: 30, y: 5, width: 10, height: 6, mode: 'clearance', depth: 1 }, { id: 'b', name: 'B', x: 60, y: 20, width: 8, height: 8, mode: 'clearance', depth: 1 }]
  return d
}
describe('central constraints', () => {
  it('centers rectangles, controls X/Y, and keeps sizes editable', () => {
    const d = fixture(), c = makeCentral(d, { owner: 'body', id: d.id }, { owner: 'zone', id: 'a' }); d.constraints!.push(c); solveDefinition(d)
    expect(objectCenter(d, c.target)).toEqual(objectCenter(d, c.reference))
    expect(d.zones[0].x).toBe(5); expect(d.zones[0].y).toBe(12)
    expect(controllerFor(d, 'zone', 'a', 'x')?.id).toBe(c.id); expect(controllerFor(d, 'zone', 'a', 'y')?.id).toBe(c.id)
    expect(controllerFor(d, 'zone', 'a', 'width')).toBeUndefined()
    const candidate = clone(d); candidate.zones[0].width = 14; candidate.height = 40
    const next = solveDefinitionEdit(d, candidate)
    expect(next.zones[0].width).toBe(14); expect(next.zones[0].x).toBe(3); expect(next.zones[0].y).toBe(17)
    const manual = clone(next); manual.zones[0].x++
    expect(() => solveDefinitionEdit(next, manual)).toThrow('Constraint-controlled')
  })
  it('uses pin and circular-zone centers and propagates dependency chains', () => {
    const d = fixture(); d.zones[1] = { ...d.zones[1], shape: 'circle', radius: 4 }
    d.pins = [{ id: 'pin', name: 'P', x: 2, y: 3, diameter: 1, color: '#a3e635' }]
    const a = makeCentral(d, { owner: 'zone', id: 'a' }, { owner: 'zone', id: 'b' }); d.constraints!.push(a)
    const b = makeCentral(d, { owner: 'zone', id: 'b' }, { owner: 'pin', id: 'pin' }); d.constraints!.push(b)
    solveDefinition(d)
    expect(d.pins[0].x).toBe(35); expect(d.pins[0].y).toBe(8)
    const next = clone(d); next.zones[0].x = 45; next.zones[1].radius = 7
    const solved = solveDefinitionEdit(d, next)
    expect(solved.pins[0].x).toBe(50); expect(solved.zones[1].radius).toBe(7)
    expect(() => makeCentral(d, { owner: 'pin', id: 'pin' }, { owner: 'zone', id: 'a' })).toThrow('circular')
  })
  it('rejects unsupported polygons and duplicate drivers, protects the body, and releases deleted constraints', () => {
    const d = fixture(), c = makeCentral(d, { owner: 'body', id: 'body' }, { owner: 'zone', id: 'a' }); d.constraints!.push(c); solveDefinition(d)
    expect(() => makeParallel(d, feature('body', 'right', 'body'), feature('a', 'left'))).toThrow('Overconstrained')
    expect(() => makeCentral(d, { owner: 'zone', id: 'b' }, { owner: 'body', id: 'body' })).toThrow('body cannot')
    const z = createPolygonZone([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }]); d.zones.push(z)
    expect(() => makeCentral(d, { owner: 'zone', id: z.id }, { owner: 'zone', id: 'b' })).toThrow('polygons')
    const free = clone(d); free.constraints = []; free.zones[0].x = 40
    expect(solveDefinitionEdit(d, free).zones[0].x).toBe(40)
  })
  it('composes a size constraint with center alignment without creating a false cycle', () => {
    const d = fixture(), size = makeParallel(d, feature('a', 'left'), feature('a', 'right')); d.constraints!.push(size)
    d.constraints!.push(makeCentral(d, { owner: 'body', id: 'body' }, { owner: 'zone', id: 'a' })); solveDefinition(d)
    const candidate = clone(d); candidate.constraints![0].expression = '6*2'; candidate.constraints![0].value = 12
    const solved = solveDefinitionEdit(d, candidate)
    expect(solved.zones[0].width).toBe(12); expect(solved.zones[0].x).toBe(4)
  })
  it('round-trips central constraints and manual annotation offsets in JSON', () => {
    const d = fixture(), c = makeCentral(d, { owner: 'body', id: 'body' }, { owner: 'zone', id: 'a' })
    c.annotation = { labelOffset: { x: 8, y: -5 }, lineOffset: 3, radius: 2 }; d.constraints!.push(c); solveDefinition(d)
    const p = createProject('Annotations'); p.definitions = [d]; p.workspace.drafts[d.id] = clone(d); p.workspace.tabs.push(d.id)
    const loaded = parseProject(serializeProject(p))
    expect(loaded.definitions[0].constraints).toEqual(d.constraints)
    expect(loaded.workspace.drafts[d.id].constraints![0].annotation).toEqual(c.annotation)
    expect(nearestCenterObject(d, { x: 60, y: 20 }, 1)?.id).toBe('b')
  })
})
describe('selection-order retry', () => {
  it('keeps a valid original order and tries the reverse only after failure', () => {
    const d = fixture(), direct = makeConstraintWithFallback(d, 'parallel', feature('body', 'right', 'body'), feature('a', 'left'))
    expect(direct.reversed).toBe(false)
    const reversed = makeConstraintWithFallback(d, 'parallel', feature('a', 'left'), feature('body', 'right', 'body'))
    expect(reversed.reversed).toBe(true); expect(reversed.result.kind).toBe('parallel')
    if (reversed.result.kind === 'parallel') expect(reversed.result.reference.owner).toBe('body')
    expect(d.constraints).toEqual([])
  })
  it('retries central selection without allowing the body to move', () => {
    const d = fixture(), created = makeConstraintWithFallback(d, 'central', feature('a', 'midX'), feature('body', 'midX', 'body'))
    expect(created.reversed).toBe(true)
    if (created.result.kind !== 'central') throw new Error('Expected a central constraint')
    expect(created.result.reference.owner).toBe('body'); expect(created.result.target.id).toBe('a')
  })
  it('retries a pending distance with the requested value, preserving its ID and expression', () => {
    const d = fixture(), desired = makeParallel(d, feature('a', 'right'), feature('b', 'left'))
    desired.expression = '3+4'; desired.value = 7
    d.constraints!.push(makeParallel(d, feature('body', 'right', 'body'), feature('b', 'left')))
    const prepared = prepareConstraintEdit(d, desired)
    expect(prepared.reversed).toBe(true)
    const next = solveDefinitionEdit(d, prepared.result), last = next.constraints!.at(-1)!
    expect(last.id).toBe(desired.id); expect(last.expression).toBe('3+4')
    expect(next.zones[0].x).toBeCloseTo(43)
  })
  it('fails atomically if both orders conflict instead of bypassing restrictions', () => {
    const d = fixture()
    d.constraints!.push(makeParallel(d, feature('body', 'right', 'body'), feature('a', 'left')))
    d.constraints!.push(makeParallel(d, feature('body', 'right', 'body'), feature('b', 'left')))
    const before = clone(d)
    expect(() => makeConstraintWithFallback(d, 'parallel', feature('a', 'right'), feature('b', 'left'))).toThrow('Overconstrained')
    expect(d).toEqual(before)
  })
  it('retries edits through the document transaction while preserving geometry-edit protection', () => {
    const d = fixture(), pending = makeParallel(d, feature('a', 'right'), feature('b', 'left'))
    d.constraints!.push(makeParallel(d, feature('body', 'right', 'body'), feature('b', 'left')))
    const candidate = clone(d); candidate.constraints!.push(pending)
    const retried = solveDefinitionEditWithFallback(d, candidate)
    expect(retried.reversed).toBe(true)
    const forbidden = clone(d); forbidden.zones[1].x += 5
    expect(() => solveDefinitionEditWithFallback(d, forbidden)).toThrow('Constraint-controlled')
    expect(d.zones[1].x).toBe(60)
  })
})
