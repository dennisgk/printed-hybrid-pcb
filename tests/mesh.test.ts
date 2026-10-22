import { beforeAll, describe, expect, it } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { createProject, id } from '../src/lib/model'
import { exampleProject } from '../src/lib/example'
import { binarySTL, generateMesh } from '../src/lib/mesh'
import { rect } from '../src/lib/geometry'

let api: ManifoldToplevel
beforeAll(async () => { api = await Module(); api.setup() })
describe('manufacturing meshes', () => {
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
    const p = exampleProject(); p.instances[0].x = -10
    expect(() => generateMesh(api, p)).toThrow('clearance')
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
