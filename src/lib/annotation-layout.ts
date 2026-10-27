import type { Constraint, Definition, Point } from './model'
import { angularVertices, constraintPosition, parallelLines } from './constraints'
import { bounds, inside, rect, zonePolygon } from './geometry'

export type AnnotationPlacement = { label: Point; anchor: Point; lineOffset: number; radius: number; a?: Point; b?: Point }
type Box = { minX: number; minY: number; maxX: number; maxY: number }
type Obstacle = Box & { weight: number }
const center = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const boxAt = (p: Point, width: number, height: number): Box => ({ minX: p.x - width / 2, maxX: p.x + width / 2, minY: p.y - height / 2, maxY: p.y + height / 2 })
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
const inBox = (p: Point, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
export const annotationText = (c: Constraint) => c.kind === 'central' ? 'Centers' : `${Number(c.value.toFixed(3))}${c.kind === 'angular' ? '°' : ' mm'}`

/** Deterministic screen-aware greedy layout; user placements always take precedence. */
export function layoutAnnotations(d: Definition, constraints: Constraint[], zoom: number, viewport?: Box): Map<string, AnnotationPlacement> {
  const obstacles: Obstacle[] = [{ ...bounds(rect(0, 0, d.width, d.height)), weight: .8 }]
  const nameBox = (p: Point, name: string) => ({ ...boxAt(p, (name.length * 6.5 + 8) / zoom, 15 / zoom), weight: 12 })
  for (const z of d.zones) {
    const b = bounds(zonePolygon(z)); obstacles.push({ ...b, weight: 2.5 })
    obstacles.push(nameBox({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, z.name))
  }
  for (const p of d.pins) {
    obstacles.push({ ...boxAt(p, p.diameter + 6 / zoom, p.diameter + 6 / zoom), weight: 9 })
    obstacles.push(nameBox({ x: p.x, y: p.y + p.diameter / 2 + 1 + 5 / zoom }, p.name))
  }
  const content = bounds([...rect(0, 0, d.width, d.height), ...d.zones.flatMap(zonePolygon), ...d.pins])
  const occupied: Box[] = [], dimensionLines: [Point, Point][] = [], result = new Map<string, AnnotationPlacement>()
  const linePenalty = (a: Point, b: Point) => {
    let score = 0
    for (let n = 1; n < 20; n++) { const p = { x: a.x + (b.x - a.x) * n / 20, y: a.y + (b.y - a.y) * n / 20 }; for (const obstacle of obstacles) if (inBox(p, obstacle)) score += obstacle.weight * .8; for (const label of occupied) if (inBox(p, label)) score += 45 }
    return score
  }
  // Fixed annotations reserve their positions before automatic ones are considered.
  const order = constraints.map((constraint, index) => ({ constraint, index })).sort((a, b) => Number(!a.constraint.annotation?.labelOffset) - Number(!b.constraint.annotation?.labelOffset) || a.index - b.index)
  for (const { constraint: c } of order) {
    try {
      const origin = constraintPosition(d, c), metadata = c.annotation, text = annotationText(c), width = (text.length * 6.8 + 22) / zoom, height = 26 / zoom
      const fixed = metadata?.labelOffset ? { x: origin.x + metadata.labelOffset.x, y: origin.y + metadata.labelOffset.y } : null
      const options: AnnotationPlacement[] = []
      if (c.kind === 'parallel') {
        const { target, normal, signedDistance } = parallelLines(d, c), middle = center(...target), tangent = { x: -normal.y, y: normal.x }
        const projections = rect(content.minX, content.minY, content.maxX - content.minX, content.maxY - content.minY).map(p => p.x * tangent.x + p.y * tangent.y), current = middle.x * tangent.x + middle.y * tangent.y
        const offsets = metadata?.lineOffset !== undefined ? [metadata.lineOffset] : [0, 24 / zoom, -24 / zoom, 48 / zoom, -48 / zoom, Math.min(...projections) - current - 24 / zoom, Math.max(...projections) - current + 24 / zoom]
        for (const lineOffset of offsets) {
          const b = { x: middle.x + tangent.x * lineOffset, y: middle.y + tangent.y * lineOffset }, a = { x: b.x - normal.x * signedDistance, y: b.y - normal.y * signedDistance }, anchor = center(a, b)
          for (const offset of fixed ? [0] : [17, -17, 32, -32]) {
            const label = fixed ?? { x: anchor.x + tangent.x * offset / zoom, y: anchor.y + tangent.y * offset / zoom }
            options.push({ label, anchor, lineOffset, radius: 0, a, b })
          }
        }
      } else {
        const origin = c.kind === 'angular' ? angularVertices(d, c)[1] : constraintPosition(d, c), radius = metadata?.radius ?? 24 / zoom
        const radii = c.kind === 'angular' && metadata?.radius === undefined ? [radius, 38 / zoom, 54 / zoom] : [radius]
        for (const r of radii) for (const ring of fixed ? [0] : [r + 20 / zoom, r + 43 / zoom]) for (let n = 0; n < (fixed ? 1 : 12); n++) {
          const angle = n * Math.PI / 6
          options.push({ anchor: origin, label: fixed ?? { x: origin.x + Math.cos(angle) * ring, y: origin.y + Math.sin(angle) * ring }, lineOffset: 0, radius: r })
        }
        if (!fixed) for (const p of [{ x: content.minX - width / 2 - 12 / zoom, y: origin.y }, { x: content.maxX + width / 2 + 12 / zoom, y: origin.y }, { x: origin.x, y: content.minY - 20 / zoom }, { x: origin.x, y: content.maxY + 20 / zoom }]) options.push({ anchor: origin, label: p, lineOffset: 0, radius })
      }
      let best = options[0], bestScore = Infinity
      for (const option of options) {
        const box = boxAt(option.label, width, height)
        let score = Math.hypot(option.label.x - origin.x, option.label.y - origin.y) * zoom * .065
        for (const obstacle of obstacles) score += overlap(box, obstacle) * zoom ** 2 * obstacle.weight * .035
        for (const other of occupied) score += overlap(box, other) * zoom ** 2 * 25
        if (viewport && inBox(origin, viewport) && (!inBox({ x: box.minX, y: box.minY }, viewport) || !inBox({ x: box.maxX, y: box.maxY }, viewport))) score += 2000
        if (option.a && option.b) { score += linePenalty(option.a, option.b); score += Math.abs(option.lineOffset) * zoom * .025 }
        for (const [a, b] of dimensionLines) {
          // Penalize labels covering already-placed dimension lines as well as text.
          const poly = rect(box.minX, box.minY, width, height)
          for (let n = 0; n <= 6; n++) if (inside({ x: a.x + (b.x - a.x) * n / 6, y: a.y + (b.y - a.y) * n / 6 }, poly)) score += 12
        }
        if (score < bestScore) { best = option; bestScore = score }
      }
      if (!best) continue
      occupied.push(boxAt(best.label, width, height)); if (best.a && best.b) dimensionLines.push([best.a, best.b]); result.set(c.id, best)
    } catch { /* Broken draft references are reported by the constraint engine. */ }
  }
  return result
}
