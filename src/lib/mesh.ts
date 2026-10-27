import type { Manifold, ManifoldToplevel, CrossSection, Vec2 } from 'manifold-3d'
import type { Project, Point } from './model'
import { landingPads, pinHole, pins, rect, tracePoints, transform, validateProject, zonePolygon } from './geometry'
import { solveDefinition } from './constraints'

export type MeshResult = { positions: Float32Array; indices: Uint32Array; volume: number; triangles: number; bounds: { min: number[]; max: number[] } }

export function generateMesh(api: ManifoldToplevel, source: Project): MeshResult {
  const project = structuredClone(source)
  for (const definition of project.definitions) solveDefinition(definition)
  const issues = validateProject(project, { forExport: true })
  if (issues.length) throw new Error(issues[0].message)
  const allocated: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T): T => { allocated.push(value); return value }
  const { Manifold: M, CrossSection: C } = api
  const s = project.board.settings, epsilon = .01
  const polygon = (pts: Point[]) => {
    const area = pts.reduce((sum, p, n) => { const q = pts[(n + 1) % pts.length]; return sum + p.x * q.y - q.x * p.y }, 0)
    return own(new C([(area < 0 ? pts.toReversed() : pts).map(p => [p.x, p.y] as Vec2)]))
  }
  const extrude = (shape: CrossSection, height: number, z: number) => own(own(shape.extrude(height)).translate([0, 0, z]))
  const circle = (p: Point, radius: number) => own(own(C.circle(radius, 64)).translate([p.x, p.y]))
  const traceSection = (pts: Point[], width: number) => {
    const sections: CrossSection[] = [], r = width / 2
    for (let n = 0; n < pts.length - 1; n++) {
      const a = pts[n], b = pts[n + 1], angle = Math.atan2(b.y - a.y, b.x - a.x)
      const offset = { x: -Math.sin(angle) * r, y: Math.cos(angle) * r }
      sections.push(polygon([{ x: a.x + offset.x, y: a.y + offset.y }, { x: a.x - offset.x, y: a.y - offset.y }, { x: b.x - offset.x, y: b.y - offset.y }, { x: b.x + offset.x, y: b.y + offset.y }]))
    }
    for (const point of pts) sections.push(circle(point, r))
    return own(C.union(sections))
  }
  const union = (parts: Manifold[]) => own(M.union(parts))
  try {
    const outline = polygon(project.board.outline)
    const solids: Manifold[] = [extrude(outline, s.thickness, s.ridgeHeight)]
    const subtract: Manifold[] = []
    for (const i of project.instances) {
      const d = project.definitions.find(d => d.id === i.definitionId)!
      const c = i.fitClearance ?? d.fitClearance ?? s.fitClearance, depth = i.recessDepth ?? d.recessDepth
      const top = s.ridgeHeight + s.thickness
      // Recess cutters may overhang the outline. Subtracting from the plate
      // naturally clips them at its edges and ignores portions outside it.
      if (depth > 0) subtract.push(extrude(polygon(rect(0, 0, d.width, d.height, c).map(p => transform(p, i))), depth + epsilon, top - depth))
      for (const z of d.zones) if (z.mode !== 'clearance' && (z.mode === 'cut' || z.depth > 0)) {
        let shape = z.shape === 'circle' ? circle(z, (z.radius ?? z.width / 2) + c) : polygon(z.shape === 'polygon' ? zonePolygon(z) : rect(z.x, z.y, z.width, z.height, c))
        if (z.shape === 'polygon' && c) shape = own(shape.offset(c, 'Round', 2, 64))
        shape = own(own(shape.rotate(i.rotation)).translate([i.x, i.y]))
        subtract.push(extrude(shape, z.mode === 'cut' ? top + 2 * epsilon : z.depth + epsilon, z.mode === 'cut' ? -epsilon : top - z.depth))
      }
    }
    for (const t of project.traces) {
      const pts = tracePoints(project, t)
      solids.push(extrude(traceSection(pts, t.width), s.ridgeHeight + epsilon, 0))
      // Stop exactly at the base surface: channels remove only the raised
      // underside ridges, never plate thickness or the topside recess floor.
      if (s.traceCut === 'lined') subtract.push(extrude(traceSection(pts, s.traceCutWidth), s.ridgeHeight + epsilon, -epsilon))
    }
    const allPins = pins(project)
    for (const { pin, instance, pad } of landingPads(project)) {
      solids.push(extrude(pad.polygon ? polygon(pad.polygon) : circle(pad.center, pad.radius), s.ridgeHeight + epsilon, 0))
      if (s.traceCut === 'lined' && pad.polygon) {
        const cut = pinHole({ ...pin, diameter: s.traceCutWidth }, instance, 0)
        subtract.push(extrude(polygon(cut.polygon!), s.ridgeHeight + epsilon, -epsilon))
      }
    }
    for (const pin of allPins) {
      if (s.plugHoles === 'fill') continue
      const hole = pinHole(pin.pin, pin.instance, s.holeAllowance)
      const section = hole.polygon ? polygon(hole.polygon) : circle(hole.center, hole.radius)
      const height = s.thickness + s.ridgeHeight + 2 * epsilon
      if (s.plugHoles === 'slightly-connected') {
        // Carve a relief around the core, retaining four tabs only near the
        // plate underside. Subtractive construction preserves every recess/cut
        // and clips the plugs to the actual material at each pin.
        const radius = hole.radius - s.plugGap
        const core = hole.polygon
          ? polygon(rect(pin.pin.x - radius, pin.pin.y - radius, radius * 2, radius * 2).map(p => transform(p, pin.instance)))
          : circle(hole.center, radius)
        const relief = extrude(own(section.subtract(core)), height, -epsilon)
        const makeTab = (angle: number) => {
          const local = polygon(rect(-hole.radius - epsilon, -s.plugTabWidth / 2, 2 * (hole.radius + epsilon), s.plugTabWidth))
          const placed = own(own(local.rotate(pin.instance.rotation + angle)).translate([hole.center.x, hole.center.y]))
          return extrude(placed, s.plugTabThickness, s.ridgeHeight)
        }
        subtract.push(own(relief.subtract(union([makeTab(0), makeTab(90)]))))
      } else subtract.push(extrude(section, height, -epsilon))
    }
    let solid = union(solids)
    if (subtract.length) solid = own(solid.subtract(union(subtract)))
    if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) throw new Error('Geometry could not produce a valid solid. Check the plate settings.')
    const pieces = solid.decompose().map(own)
    if (pieces.length !== 1) throw new Error(`The result contains ${pieces.length} disconnected solids. Adjust cuts to keep the plate connected.`)
    const mesh = solid.getMesh(), box = solid.boundingBox()
    const positions = new Float32Array(mesh.numVert * 3)
    for (let v = 0; v < mesh.numVert; v++) for (let n = 0; n < 3; n++) positions[v * 3 + n] = mesh.vertProperties[v * mesh.numProp + n]
    return { positions, indices: new Uint32Array(mesh.triVerts), volume: solid.volume(), triangles: mesh.numTri, bounds: box }
  } finally { for (let i = allocated.length - 1; i >= 0; i--) allocated[i].delete() }
}

export function binarySTL(mesh: MeshResult): ArrayBuffer {
  const data = new ArrayBuffer(84 + mesh.indices.length / 3 * 50), view = new DataView(data)
  new Uint8Array(data, 0, 80).set(new TextEncoder().encode('Printed Hybrid PCB | millimeters | single plate'))
  view.setUint32(80, mesh.indices.length / 3, true)
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const offset = 84 + t * 50, vs = [0, 1, 2].map(n => Array.from(mesh.positions.slice(mesh.indices[t * 3 + n] * 3, mesh.indices[t * 3 + n] * 3 + 3)))
    const a = vs[1].map((n, i) => n - vs[0][i]), b = vs[2].map((n, i) => n - vs[0][i]), normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], length = Math.hypot(...normal) || 1
    normal.forEach((n, i) => view.setFloat32(offset + i * 4, n / length, true))
    vs.flat().forEach((n, i) => view.setFloat32(offset + 12 + i * 4, n, true))
  }
  return data
}
