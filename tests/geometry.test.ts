import { describe, expect, it } from 'vitest'
import { createProject, id } from '../src/lib/model'
import { exampleProject } from '../src/lib/example'
import { anchorPoint, bounds, connectTarget, inside, landingPads, outlineError, pinHole, pointHoleDistance, rect, segmentHoleDistance, snap, snapAngle, tracePoints, transform, validateProject, zonePolygon, createPolygonZone, changeZoneShape } from '../src/lib/geometry'

function padProject() {
  const p = createProject('Pad clearance'); p.board.outline = rect(0, 0, 100, 80)
  Object.assign(p.board.settings, { traceWidth: .2, landingDiameter: 4, separation: .1, edgeClearance: 0, holeAllowance: 0 })
  const d = { id: id(), name: 'Pins', width: 20, height: 20, recessDepth: 0, fitClearance: 0, zones: [], pins: [{ id: id(), name: 'A', x: 10, y: 10, diameter: .4, color: '#a3e635', shape: 'square' as 'square' | 'circle' }] }
  const instance = { id: id(), name: 'Pins 1', definitionId: d.id, x: 20, y: 20, rotation: 0, recessDepth: null, fitClearance: null }
  const end = { id: id(), x: 60, y: 30 }
  p.definitions.push(d); p.instances.push(instance); p.junctions.push(end)
  p.traces.push({ id: id(), width: .2, from: { kind: 'pin', instanceId: instance.id, pinId: d.pins[0].id }, to: { kind: 'junction', id: end.id }, vertices: [] })
  return p
}

describe('geometry and connectivity', () => {
  it('allows component recesses to overhang while enforcing pin, pad, and trace edge clearance at export', () => {
    const p = exampleProject(), instance = p.instances[0]
    instance.x = -10 // Body and USB recess overhang; pins and landing pads remain inside.
    expect(validateProject(p, { forExport: true })).toEqual([])
    instance.x = -18.5
    const outside = validateProject(p, { forExport: true })
    expect(outside.some(i => i.message.includes('pin hole is outside'))).toBe(true)
    expect(outside.some(i => i.message === 'Pin landing pad violates board edge clearance.')).toBe(true)
    instance.x = -10
    p.traces[0].vertices[0] = { x: 44, y: .5 }
    expect(validateProject(p, { forExport: true }).some(i => i.message === 'Trace violates board edge clearance.')).toBe(true)
    expect(validateProject(p)).toEqual([]) // Boundary errors are still deferred until export.
  })
  it('sizes square pad sides using the hole side plus margin and rotates their corners with the component', () => {
    const p = padProject(), pin = p.definitions[0].pins[0], instance = p.instances[0]
    Object.assign(p.board.settings, { landingDiameter: .1, holeAllowance: .2, landingMargin: .4 })
    pin.diameter = 2
    const pad = landingPads(p)[0].pad
    expect(bounds(pad.polygon!).maxX - bounds(pad.polygon!).minX).toBeCloseTo(2.6)
    instance.rotation = 31
    expect(landingPads(p)[0].pad.polygon).toEqual(rect(8.7, 8.7, 2.6, 2.6).map(q => transform(q, instance)))
    p.board.settings.squarePinBottomFace = 'circular'
    expect(landingPads(p)[0].pad.polygon).toBeNull()
    expect(landingPads(p)[0].pad.radius).toBeCloseTo((2.2 * Math.SQRT2 + .4) / 2)
    expect(pinHole(pin, instance, .2).polygon).not.toBeNull()
    pin.shape = 'circle'
    expect(landingPads(p)[0].pad.polygon).toBeNull(); expect(landingPads(p)[0].pad.radius).toBeCloseTo(1.3)
  })
  it('detects square-pad corner collisions with other holes and unrelated traces', () => {
    const p = padProject(), d = p.definitions[0]
    d.pins.push({ id: id(), name: 'B', x: 11.8, y: 11.8, diameter: .2, color: '#a3e635', shape: 'circle' })
    expect(validateProject(p).some(i => i.message.includes('too close to another pin hole'))).toBe(true)
    const a = { id: id(), x: 31.8, y: 31.6 }, b = { id: id(), x: 31.8, y: 31.9 }
    p.junctions.push(a, b); p.traces.push({ id: id(), width: .1, from: { kind: 'junction', id: a.id }, to: { kind: 'junction', id: b.id }, vertices: [] })
    expect(validateProject(p).some(i => i.message === 'Trace intersects an unrelated pin landing pad.')).toBe(true)
    p.board.settings.squarePinBottomFace = 'circular'
    expect(validateProject(p).some(i => i.message.includes('landing pad'))).toBe(false)
    expect(d.pins[0].shape).toBe('square')
    d.pins[0].shape = 'circle'
    expect(validateProject(p).some(i => i.message.includes('landing pad'))).toBe(false)
  })
  it('uses exact square corners for pad-to-pad separation and rotated board edge checks', () => {
    const p = padProject(), d = p.definitions[0], instance = p.instances[0]
    const pin = { ...d.pins[0], id: id(), name: 'B', x: 13.8, y: 13.8 }, end = { id: id(), x: 60, y: 33.8 }
    d.pins.push(pin); p.junctions.push(end)
    p.traces.push({ id: id(), width: .2, from: { kind: 'pin', instanceId: instance.id, pinId: pin.id }, to: { kind: 'junction', id: end.id }, vertices: [] })
    expect(validateProject(p).some(i => i.message.includes('Separate pin landing pads'))).toBe(true)
    d.pins.forEach(pin => { pin.shape = 'circle' })
    expect(validateProject(p).some(i => i.message.includes('Separate pin landing pads'))).toBe(false)
    p.traces.pop(); d.pins.pop(); d.pins[0].shape = 'square'; instance.rotation = 45
    p.board.outline = rect(17.4, 0, 82.6, 80)
    expect(validateProject(p, { forExport: true }).some(i => i.message === 'Pin landing pad violates board edge clearance.')).toBe(true)
    d.pins[0].shape = 'circle'
    expect(validateProject(p, { forExport: true }).some(i => i.message === 'Pin landing pad violates board edge clearance.')).toBe(false)
  })
  it('centers square holes, adds allowance to their side length, and rotates with the instance', () => {
    const p = exampleProject(), pin = p.definitions[0].pins[0], instance = p.instances[0]
    pin.shape = 'square'; pin.diameter = 2
    instance.rotation = 0
    const hole = pinHole(pin, instance, .2), b = bounds(hole.polygon!)
    expect(b.maxX - b.minX).toBeCloseTo(2.2); expect(b.maxY - b.minY).toBeCloseTo(2.2)
    expect((b.minX + b.maxX) / 2).toBe(hole.center.x)
    expect((b.minY + b.maxY) / 2).toBe(hole.center.y)
    const corner = { x: hole.center.x + 1.05, y: hole.center.y + 1.05 }
    expect(pointHoleDistance(corner, hole)).toBe(0)
    expect(segmentHoleDistance(corner, { x: corner.x + 2, y: corner.y }, hole)).toBe(0)
    instance.rotation = 45
    const rotated = pinHole(pin, instance, .2), rb = bounds(rotated.polygon!)
    expect(rb.maxX - rb.minX).toBeCloseTo(2.2 * Math.SQRT2)
    expect(rotated.center).toEqual(transform(pin, instance))
  })
  it('detects square-hole corner collisions that circular hole checks would miss', () => {
    const p = createProject('Corner contact'), d = { id: id(), name: 'Pins', width: 20, height: 20, recessDepth: 0, fitClearance: 0, zones: [], pins: [{ id: id(), name: 'A', x: 5, y: 5, diameter: 2, color: '#a3e635', shape: 'square' as const }, { id: id(), name: 'B', x: 6.9, y: 6.9, diameter: 2, color: '#a3e635', shape: 'square' as const }] }
    p.board.settings.holeAllowance = 0; p.definitions.push(d)
    p.instances.push({ id: id(), name: 'Pins 1', definitionId: d.id, x: 0, y: 0, rotation: 0, recessDepth: null, fitClearance: null })
    expect(validateProject(p).some(i => i.message.includes('holes overlap'))).toBe(true)
  })
  it('validates the complete sample', () => expect(validateProject(exampleProject())).toEqual([]))
  it('transforms local pins through rotation without changing their identity', () => {
    const p = exampleProject(), instance = p.instances[0]
    const before = anchorPoint(p, p.traces[0].from); instance.x += 4; instance.rotation = 90
    const after = anchorPoint(p, p.traces[0].from)
    expect(after).toEqual(transform(p.definitions[0].pins[0], instance)); expect(after).not.toEqual(before)
    expect(tracePoints(p, p.traces[0])[1]).toEqual(p.traces[0].vertices[0])
  })
  it('rejects self-intersections and doubled-back board edges', () => {
    expect(outlineError([{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }])).toBeTruthy()
    expect(outlineError([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }])).toBeTruthy()
    expect(outlineError(rect(0, 0, 100, 80))).toBeNull()
  })
  it('splits an existing trace at an explicit junction, preserving endpoint references', () => {
    const p = exampleProject(), old = p.traces[0]
    const anchor = connectTarget(p, { kind: 'segment', traceId: old.id, segment: 0, point: { x: 44, y: 29 } })
    expect(p.junctions).toHaveLength(1); expect(p.traces).toHaveLength(3)
    expect(p.traces[0].from).toEqual(old.from); expect(p.traces[0].to).toEqual(anchor); expect(p.traces[1].to).toEqual(old.to)
    expect(validateProject(p)).toEqual([])
  })
  it('permits an explicit branch but rejects an incidental crossing', () => {
    const p = exampleProject()
    const j = connectTarget(p, { kind: 'segment', traceId: p.traces[0].id, segment: 0, point: { x: 44, y: 29 } })
    const end = { id: id(), x: 44, y: 12 }; p.junctions.push(end)
    p.traces.push({ id: id(), width: 3, from: j, to: { kind: 'junction', id: end.id }, vertices: [] })
    expect(validateProject(p)).toEqual([])
    end.y = 65 // intersects the other trace without a junction
    expect(validateProject(p).some(i => i.message.includes('cross'))).toBe(true)
  })
  it('checks pin-hole overlap, recess floor, trace width, and cutout collisions', () => {
    const p = exampleProject(); p.definitions[0].recessDepth = 2.5
    expect(validateProject(p).some(i => i.message.includes('floor'))).toBe(true)
    p.definitions[0].recessDepth = 1; p.traces[0].width = 55
    expect(validateProject(p).length).toBeGreaterThan(0)
    p.traces[0].width = 3; p.definitions[0].zones.push({ id: id(), name: 'Cut', x: 20, y: 3, width: 15, height: 4, mode: 'cut', depth: 0 })
    expect(validateProject(p).some(i => i.message.includes('through-cut'))).toBe(true)
  })
  it('handles concave outlines and quantizes in world units', () => {
    expect(snap({ x: 2.23, y: -1.6 }, .5)).toEqual({ x: 2, y: -1.5 })
    const end = snapAngle({ x: 0, y: 0 }, { x: 8, y: 6 }, '90'); expect(Math.abs(end.y)).toBeLessThan(1e-9)
    expect(inside({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 7, y: 3 }, { x: 0, y: 10 }])).toBe(true)
  })
  it('starts with no boundary and permits layout anywhere until export', () => {
    const blank = createProject('Unbounded')
    expect(blank.board.outline).toEqual([]); expect(validateProject(blank)).toEqual([])
    expect(validateProject(blank, { forExport: true })[0].message).toContain('edge-cut')
    const p = exampleProject()
    for (const i of p.instances) i.x -= 1_000_000
    for (const t of p.traces) for (const v of t.vertices) v.x -= 1_000_000
    expect(validateProject(p)).toEqual([])
    expect(validateProject(p, { forExport: true }).some(e => e.message.includes('board edge'))).toBe(true)
    p.board.outline = []
    expect(validateProject(p)).toEqual([])
    expect(validateProject(p, { forExport: true }).some(e => e.element === 'outline')).toBe(true)
  })
  it('continues enforcing trace errors without a boundary', () => {
    const p = exampleProject(); p.board.outline = []
    p.traces[1].vertices = [{ x: 50, y: 29 }]
    expect(validateProject(p).some(e => e.message.includes('cross'))).toBe(true)
  })
  it('creates circular and polygon zones in component coordinates', () => {
    const circle = { id: id(), name: 'Circular', shape: 'circle' as const, x: 20, y: 10, width: 10, height: 10, radius: 5, mode: 'cut' as const, depth: 1 }
    expect(inside({ x: 20, y: 10 }, zonePolygon(circle))).toBe(true)
    expect(inside({ x: 24.9, y: 14.9 }, zonePolygon(circle))).toBe(false)
    const polygon = createPolygonZone([{ x: -5, y: -10 }, { x: 15, y: -10 }, { x: 0, y: 5 }])
    expect(zonePolygon(polygon)).toEqual([{ x: -5, y: -10 }, { x: 15, y: -10 }, { x: 0, y: 5 }])
    changeZoneShape(polygon, 'circle'); expect(polygon.radius).toBe(10)
    changeZoneShape(polygon, 'rectangle'); expect(polygon.width).toBe(20)
  })
  it('checks round and polygon cutouts against traces', () => {
    for (const shape of ['circle', 'polygon'] as const) {
      const p = exampleProject()
      p.definitions[0].zones.push({ id: id(), name: 'Cut', x: 30, y: 5, width: 6, height: 6, shape, radius: 3, vertices: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 0, y: 3 }], mode: 'cut', depth: 0 })
      expect(validateProject(p).some(e => e.message.includes('through-cut'))).toBe(true)
    }
  })
})
