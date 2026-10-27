import { beforeAll, describe, expect, it } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { Ray, Vector3 } from 'three'
import { createProject, id } from '../src/lib/model'
import { exampleProject } from '../src/lib/example'
import { binarySTL, generateMesh } from '../src/lib/mesh'
import { anchorPoint, connectTarget, rect, transform, validateProject } from '../src/lib/geometry'
import type { MeshResult } from '../src/lib/mesh'
import { makeParallel } from '../src/lib/constraints'

let api: ManifoldToplevel
beforeAll(async () => { api = await Module(); api.setup() })

// Ray parity checks actual exported triangles, including gaps and tab heights.
function containsMaterial(mesh: MeshResult, point: { x: number; y: number }, z: number) {
  const ray = new Ray(new Vector3(point.x, point.y, z), new Vector3(0, 0, 1)), hits = new Set<string>()
  const vertex = (index: number) => new Vector3().fromArray(mesh.positions, index * 3)
  for (let n = 0; n < mesh.indices.length; n += 3) {
    const hit = ray.intersectTriangle(vertex(mesh.indices[n]), vertex(mesh.indices[n + 1]), vertex(mesh.indices[n + 2]), false, new Vector3())
    if (hit) hits.add(hit.z.toFixed(5))
  }
  return hits.size % 2 === 1
}

describe('manufacturing meshes', () => {
  it.each(['rectangle', 'circle', 'polygon'] as const)('clips overhanging bodies and %s recess zones to the plate', shape => {
    const p = createProject('Overhang'); p.board.outline = rect(0, 0, 100, 80)
    const d = { id: id(), name: 'Overhanging board', width: 10, height: 10, recessDepth: 1, fitClearance: 0, pins: [], zones: [{ id: id(), name: 'Overhanging recess', shape, x: shape === 'circle' ? 5 : 0, y: shape === 'circle' ? 25 : 20, width: 10, height: 10, radius: 5, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], mode: 'recess' as const, depth: .5 }] }
    const instance = { id: id(), definitionId: d.id, name: 'Board 1', x: -5, y: 20, rotation: 0, recessDepth: null, fitClearance: null }
    p.definitions.push(d); p.instances.push(instance)
    expect(validateProject(p, { forExport: true })).toEqual([])
    const mesh = generateMesh(api, p)
    const clippedZoneVolume = shape === 'rectangle' ? 25 : shape === 'circle' ? Math.PI * 6.25 : 18.75
    expect(Math.abs(mesh.volume - (24000 - 50 - clippedZoneVolume))).toBeLessThan(.05)
    expect(mesh.bounds.min[0]).toBe(0); expect(mesh.bounds.max[0]).toBe(100)
    expect(mesh.bounds.min[1]).toBe(0); expect(mesh.bounds.max[1]).toBe(80)
    d.zones[0].x = -100 // A recess entirely off the plate removes nothing.
    expect(generateMesh(api, p).volume).toBeCloseTo(23950, 3)
    instance.x = -100
    expect(generateMesh(api, p).volume).toBeCloseTo(24000, 3)
  })
  it.each(['none', 'lined'] as const)('matches landing pad and center opening shapes to rotated pins with %s trace cuts', traceCut => {
    const p = createProject('Pad shapes'); p.board.outline = rect(0, 0, 100, 80)
    Object.assign(p.board.settings, { landingDiameter: 4, traceWidth: 1.5, traceCut, traceCutWidth: .8 })
    const pin = { id: id(), name: 'A', x: 5, y: 5, diameter: .2, shape: 'square' as 'square' | 'circle', color: '#a3e635' }
    const d = { id: id(), name: 'Pins', width: 10, height: 10, recessDepth: 1, fitClearance: 0, pins: [pin], zones: [] }
    const instance = { id: id(), name: 'Pins 1', definitionId: d.id, x: 30, y: 20, rotation: 31, recessDepth: null, fitClearance: null }
    p.definitions.push(d); p.instances.push(instance)
    const center = transform(pin, instance), end = { id: id(), x: center.x + 20, y: center.y }
    p.junctions.push(end); p.traces.push({ id: id(), width: 1.5, from: { kind: 'pin', instanceId: instance.id, pinId: pin.id }, to: { kind: 'junction', id: end.id }, vertices: [] })
    const local = (x: number, y: number) => transform({ x: pin.x + x, y: pin.y + y }, instance)
    const square = generateMesh(api, p)
    expect(containsMaterial(square, local(1.7, 1.7), .2)).toBe(true)
    expect(containsMaterial(square, local(2.1, .3), .2)).toBe(false)
    expect(containsMaterial(square, local(.35, .35), .2)).toBe(traceCut === 'none')
    p.board.settings.squarePinBottomFace = 'circular'
    const circularBottom = generateMesh(api, p)
    expect(containsMaterial(circularBottom, local(1.7, 1.7), .2)).toBe(false)
    expect(containsMaterial(circularBottom, local(.35, .35), .2)).toBe(true)
    expect(containsMaterial(circularBottom, local(.17, .17), .8)).toBe(false) // The hole remains square.
    expect(pin.shape).toBe('square')
    pin.shape = 'circle'
    const circular = generateMesh(api, p)
    expect(containsMaterial(circular, local(1.7, 1.7), .2)).toBe(false)
    expect(containsMaterial(circular, local(.35, .35), .2)).toBe(true)
    expect(containsMaterial(circular, local(.17, .17), .8)).toBe(true)
  })
  it('cuts flush channels through straights, round bends, end caps, and explicit branches while retaining borders', () => {
    const p = createProject('Wire channels'); p.board.outline = rect(0, 0, 100, 80)
    const start = { id: id(), x: 20, y: 20 }, end = { id: id(), x: 80, y: 60 }, branch = { id: id(), x: 80, y: 40 }
    p.junctions.push(start, end, branch)
    const trace = { id: id(), width: 3, from: { kind: 'junction' as const, id: start.id }, to: { kind: 'junction' as const, id: end.id }, vertices: [{ x: 60, y: 20 }, { x: 60, y: 60 }] }
    p.traces.push(trace)
    const joint = connectTarget(p, { kind: 'segment', traceId: trace.id, segment: 1, point: { x: 60, y: 40 } })
    p.traces.push({ id: id(), width: 3, from: joint, to: { kind: 'junction', id: branch.id }, vertices: [] })
    const solid = generateMesh(api, p), source = structuredClone(p)
    p.board.settings.traceCut = 'lined'; p.board.settings.traceCutWidth = 1.2
    const lined = generateMesh(api, p)
    expect(lined.volume).toBeLessThan(solid.volume)
    for (const point of [{ x: 40, y: 20.03 }, { x: 60.03, y: 20.04 }, { x: 19.6, y: 20.1 }, { x: 60.03, y: 40.04 }]) {
      expect(containsMaterial(solid, point, .2)).toBe(true)
      expect(containsMaterial(lined, point, .2)).toBe(false)
      expect(containsMaterial(lined, point, .8)).toBe(true)
    }
    for (const point of [{ x: 40, y: 21.1 }, { x: 60.9, y: 19.1 }]) expect(containsMaterial(lined, point, .2)).toBe(true)
    // The channel floor is exactly the base plane, without eating into the plate.
    expect(containsMaterial(lined, { x: 40, y: 20.03 }, .599)).toBe(false)
    expect(containsMaterial(lined, { x: 40, y: 20.03 }, .601)).toBe(true)
    p.board.settings.traceCut = 'none'; p.board.settings.traceCutWidth = 1
    expect(p).toEqual(source)
  })
  it.each(['none', 'fill', 'slightly-connected'] as const)('keeps landing pad rims and lined channels compatible with %s hole plugs', plugHoles => {
    const p = exampleProject(); p.board.settings.plugHoles = plugHoles
    p.definitions.forEach(d => d.pins.forEach(pin => { pin.diameter = .4 }))
    p.board.settings.plugGap = .05; p.board.settings.plugTabWidth = .1
    const solid = generateMesh(api, p)
    p.board.settings.traceCut = 'lined'; p.board.settings.traceCutWidth = 1.2
    const lined = generateMesh(api, p), pin = anchorPoint(p, p.traces[0].from)
    const cap = { x: pin.x - .45, y: pin.y + .04 }, rim = { x: pin.x - 1.1, y: pin.y + .04 }
    expect(containsMaterial(solid, cap, .2)).toBe(true)
    expect(containsMaterial(lined, cap, .2)).toBe(false)
    expect(containsMaterial(lined, cap, .8)).toBe(true)
    expect(containsMaterial(lined, rim, .2)).toBe(true)
    expect(lined.volume).toBeLessThan(solid.volume)
  })
  it('rejects cut widths that erase borders and retains existing single-layer crossing checks', () => {
    const p = exampleProject(); p.board.settings.traceCut = 'lined'
    for (const width of [3, 4]) {
      p.board.settings.traceCutWidth = width
      expect(() => generateMesh(api, p)).toThrow('Trace Cut Width must be smaller')
    }
    p.board.settings.traceCutWidth = 1
    p.traces[1].vertices = [{ x: 50, y: 29 }]
    expect(validateProject(p).some(i => i.message.includes('cross'))).toBe(true)
    expect(() => generateMesh(api, p)).toThrow()
  })
  it.each(['circle', 'square'] as const)('builds removable %s plugs with thin tabs, open reliefs, and intact recesses', shape => {
    const p = createProject('Breakaway plug'); p.board.outline = rect(0, 0, 100, 80)
    const definitionId = id(), pin = { id: id(), name: 'A', x: 5, y: 5, shape, diameter: 3, color: '#a3e635' }
    const instance = { id: id(), definitionId, name: 'Pins 1', x: 30, y: 20, rotation: 31, recessDepth: null, fitClearance: null }
    p.definitions.push({ id: definitionId, name: 'Pins', width: 10, height: 10, recessDepth: 1, fitClearance: 0, pins: [pin], zones: [] })
    p.instances.push(instance)
    p.board.settings.plugGap = .2
    const open = generateMesh(api, p)
    p.board.settings.plugHoles = 'fill'
    const filled = generateMesh(api, p)
    expect(filled.volume).toBeCloseTo(23900, 3) // Filling must not erase the body recess.
    p.board.settings.plugHoles = 'slightly-connected'
    const plugged = generateMesh(api, p)
    expect(plugged.volume).toBeGreaterThan(open.volume); expect(plugged.volume).toBeLessThan(filled.volume)
    const local = (x: number, y: number) => transform({ x: pin.x + x, y: pin.y + y }, instance)
    const axis = local(1.5, .03), gap = shape === 'square' ? local(1.5, .5) : local(1.5 / Math.SQRT2, 1.5 / Math.SQRT2)
    expect(containsMaterial(plugged, local(0, 0), .9)).toBe(true)
    expect(containsMaterial(plugged, gap, .7)).toBe(false)
    expect(containsMaterial(plugged, axis, .7)).toBe(true) // Four tabs exist only in the thin underside band.
    expect(containsMaterial(plugged, axis, .9)).toBe(false)
    expect(containsMaterial(plugged, local(0, 0), 3)).toBe(false) // Recess remains open above the plug.
    expect(containsMaterial(filled, gap, .9)).toBe(true)
    expect(containsMaterial(open, local(0, 0), .9)).toBe(false)
    p.board.settings.plugTabThickness = .1
    expect(generateMesh(api, p).volume).toBeLessThan(plugged.volume)
    p.board.settings.plugGap = 2
    expect(() => generateMesh(api, p)).toThrow('plug gap leaves no plug')
    p.board.settings.plugGap = .2; p.board.settings.plugTabWidth = 3
    expect(() => generateMesh(api, p)).toThrow('plug tabs are too wide')
  })
  it('keeps plugged landing pads connected and does not change source geometry or routing rules', () => {
    const p = exampleProject(), source = structuredClone(p)
    p.board.settings.plugHoles = 'slightly-connected'
    const plugged = generateMesh(api, p)
    const center = anchorPoint(p, p.traces[0].from)
    expect(containsMaterial(plugged, center, .1)).toBe(true)
    p.board.settings.plugHoles = 'fill'
    expect(generateMesh(api, p).volume).toBeGreaterThan(plugged.volume)
    p.board.settings.plugHoles = 'none'
    expect(p).toEqual(source)
    expect(containsMaterial(generateMesh(api, p), center, .1)).toBe(false)
    p.board.settings.plugHoles = 'fill'; p.traces[0].width = 55
    expect(() => generateMesh(api, p)).toThrow()
  })
  it('uses the configurable landing margin for solids and clearance validation', () => {
    const p = exampleProject()
    p.board.settings.landingDiameter = .01; p.board.settings.traceWidth = .5
    p.traces.forEach(t => { t.width = .5 })
    p.board.settings.landingMargin = 0
    const small = generateMesh(api, p)
    p.board.settings.landingMargin = 2
    expect(generateMesh(api, p).volume).toBeGreaterThan(small.volume)
    p.board.settings.landingMargin = 100
    expect(() => generateMesh(api, p)).toThrow('landing pad')
  })
  it('uses solved constraint geometry and leaves the source document untouched', () => {
    const p = createProject('Constrained cut'); p.board.outline = rect(0, 0, 100, 80)
    const definitionId = id(), zoneId = id()
    p.definitions.push({ id: definitionId, name: 'Cut', width: 10, height: 10, recessDepth: 0, fitClearance: 0, pins: [], zones: [{ id: zoneId, name: 'Cut', x: 20, y: 20, width: 5, height: 5, mode: 'cut', depth: 0 }] })
    p.instances.push({ id: id(), name: 'Cut 1', definitionId, x: 20, y: 20, rotation: 0, recessDepth: null, fitClearance: null })
    const d = p.definitions[0], c = makeParallel(d, { owner: 'zone', id: zoneId, feature: 'left' }, { owner: 'zone', id: zoneId, feature: 'right' })
    c.expression = '3*2'; c.value = 6; d.constraints = [c]
    expect(generateMesh(api, p).volume).toBeCloseTo(24000 - 6 * 5 * 3, 3)
    expect(d.zones[0].width).toBe(5)
  })
  it('subtracts square holes using side = diameter + allowance at arbitrary component rotation', () => {
    const p = createProject('Square hole'); p.board.outline = rect(0, 0, 100, 80)
    const definitionId = id()
    p.definitions.push({ id: definitionId, name: 'Square pin', width: 10, height: 10, recessDepth: 0, fitClearance: 0, pins: [{ id: id(), name: 'A', x: 5, y: 5, shape: 'square', diameter: 2, color: '#a3e635' }], zones: [] })
    p.instances.push({ id: id(), definitionId, name: 'Square pin 1', x: 30, y: 20, rotation: 33, recessDepth: null, fitClearance: null })
    const mesh = generateMesh(api, p)
    expect(mesh.volume).toBeCloseTo(24000 - 2.2 ** 2 * 3, 3)
    p.board.settings.holeAllowance = .6
    expect(generateMesh(api, p).volume).toBeCloseTo(24000 - 2.6 ** 2 * 3, 3)
    expect(p.definitions[0].pins[0].diameter).toBe(2)
  })
  it('exports an exact plain plate with positive volume and millimeter bounds', () => {
    const p = createProject('Plate'); p.board.outline = rect(0, 0, 100, 80)
    const mesh = generateMesh(api, p)
    expect(mesh.volume).toBeCloseTo(24000, 3)
    expect(mesh.bounds.min[0]).toBe(0); expect(mesh.bounds.max[0]).toBe(100)
    expect(mesh.bounds.max[2] - mesh.bounds.min[2]).toBeCloseTo(3)
    const stl = binarySTL(mesh); expect(new DataView(stl).getUint32(80, true)).toBe(mesh.triangles); expect(stl.byteLength).toBe(84 + mesh.triangles * 50)
  })
  it('produces a closed sample mesh with recesses, rounded ridges and pin holes', () => {
    const mesh = generateMesh(api, exampleProject()), edges = new Map<string, number>()
    expect(mesh.volume).toBeGreaterThan(20000); expect(mesh.volume).toBeLessThan(24000); expect(mesh.triangles).toBeGreaterThan(500)
    expect(mesh.bounds.min[2]).toBeCloseTo(0); expect(mesh.bounds.max[2]).toBeCloseTo(3.6)
    for (let t = 0; t < mesh.indices.length; t += 3) for (let e = 0; e < 3; e++) { const a = mesh.indices[t + e], b = mesh.indices[t + (e + 1) % 3], key = [a, b].sort((x, y) => x - y).join(':'); edges.set(key, (edges.get(key) ?? 0) + 1) }
    expect([...edges.values()].every(count => count === 2)).toBe(true)
  })
  it('blocks invalid geometry before boolean operations', () => {
    const p = exampleProject(); p.instances[0].x = -30
    expect(() => generateMesh(api, p)).toThrow('pin hole is outside')
  })
  it('blocks through-cuts that divide the plate into disconnected solids', () => {
    const p = createProject('Disconnected'), definitionId = id()
    p.board.outline = rect(0, 0, 100, 80)
    p.definitions.push({ id: definitionId, name: 'Divider', width: 10, height: 10, recessDepth: 0, fitClearance: 0, pins: [], zones: [{ id: id(), name: 'Divider cut', x: -25, y: 15, width: 110, height: 3, mode: 'cut', depth: 0 }] })
    p.instances.push({ id: id(), definitionId, name: 'Divider 1', x: 20, y: 20, rotation: 0, recessDepth: null, fitClearance: null })
    expect(() => generateMesh(api, p)).toThrow('disconnected')
  })
  it('is deterministic across repeat generation without accumulating tolerance', () => {
    const p = exampleProject(), first = generateMesh(api, p), second = generateMesh(api, p)
    expect(first.volume).toBe(second.volume); expect(first.positions).toEqual(second.positions)
    expect(p.definitions[0].pins[0].diameter).toBe(1.2)
  })
  it('refuses to export without a boundary', () => {
    expect(() => generateMesh(api, createProject('No outline'))).toThrow('edge-cut boundary')
  })
  it('cuts circular and polygon zones, including clockwise vertices', () => {
    const p = createProject('Shaped zones'); p.board.outline = rect(0, 0, 100, 80).reverse()
    const definitionId = id()
    p.definitions.push({ id: definitionId, name: 'Shapes', width: 10, height: 10, recessDepth: 0, fitClearance: 0, pins: [], zones: [
      { id: id(), name: 'Circle', shape: 'circle', x: 20, y: 20, radius: 3, width: 6, height: 6, mode: 'cut', depth: 0 },
      { id: id(), name: 'Triangle', shape: 'polygon', x: 40, y: 20, width: 10, height: 10, vertices: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }], mode: 'cut', depth: 0 },
    ] })
    p.instances.push({ id: id(), name: 'Shapes 1', definitionId, x: 20, y: 20, rotation: 0, recessDepth: null, fitClearance: null })
    const mesh = generateMesh(api, p)
    expect(Math.abs(mesh.volume - (24000 - Math.PI * 9 * 3 - 50 * 3))).toBeLessThan(.2)
  })
})
