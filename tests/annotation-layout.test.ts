import { describe, expect, it } from 'vitest'
import { createDefinition, clone } from '../src/lib/model'
import { annotationText, layoutAnnotations } from '../src/lib/annotation-layout'
import { constraintPosition, makeAngular, makeCentral, makeParallel, solveDefinition, solveDefinitionEdit } from '../src/lib/constraints'
import { createPolygonZone } from '../src/lib/geometry'

function fixture() {
  const d = createDefinition(); d.id = 'body'
  d.zones = ['a', 'b', 'c'].map(id => ({ id, name: id, x: 35, y: 10, width: 5, height: 5, mode: 'clearance', depth: 1 }))
  for (const z of d.zones) d.constraints!.push(makeParallel(d, { owner: 'body', id: 'body', feature: 'right' }, { owner: 'zone', id: z.id, feature: 'left' }))
  return d
}
describe('dimension annotation layout', () => {
  it('separates dimensions sharing identical anchors with deterministic placement', () => {
    const d = fixture(), before = clone(d), layout = layoutAnnotations(d, d.constraints!, 10)
    expect(layout.size).toBe(3); expect(layoutAnnotations(d, d.constraints!, 10)).toEqual(layout)
    const labels = [...layout.values()].map(l => l.label)
    for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
      expect(Math.abs(labels[a].x - labels[b].x) > 6 || Math.abs(labels[a].y - labels[b].y) > 2.6).toBe(true)
    }
    expect(d).toEqual(before)
  })
  it('respects manually placed labels and lines at different zoom levels', () => {
    const d = fixture(), c = d.constraints![0]; c.annotation = { labelOffset: { x: 20, y: 30 }, lineOffset: 12 }
    const origin = constraintPosition(d, c)
    for (const zoom of [1, 5, 20]) {
      const placement = layoutAnnotations(d, d.constraints!, zoom).get(c.id)!
      expect(placement.label).toEqual({ x: origin.x + 20, y: origin.y + 30 }); expect(placement.lineOffset).toBe(12)
    }
  })
  it('changes annotation metadata without moving or resizing constrained geometry', () => {
    const d = fixture(), candidate = clone(d)
    candidate.constraints![0].annotation = { labelOffset: { x: 7, y: 8 }, lineOffset: -4 }
    const next = solveDefinitionEdit(d, candidate)
    expect(next.zones).toEqual(d.zones); expect(next.pins).toEqual(d.pins)
    expect(next.constraints![0].annotation).toEqual(candidate.constraints![0].annotation)
    delete next.constraints![0].annotation
    expect(layoutAnnotations(next, next.constraints!, 10).get(next.constraints![0].id)).toBeDefined()
  })
  it('places central labels around the aligned point and keeps fixed positions', () => {
    const d = createDefinition(); d.pins = [{ id: 'pin', name: 'P', x: 5, y: 5, diameter: 1, color: '#a3e635' }]
    const c = makeCentral(d, { owner: 'body', id: d.id }, { owner: 'pin', id: 'pin' }); d.constraints!.push(c); solveDefinition(d)
    expect(annotationText(c)).toBe('Centers')
    const placement = layoutAnnotations(d, d.constraints!, 10).get(c.id)!
    expect(placement.label).not.toEqual(placement.anchor)
    d.constraints![0].annotation = { labelOffset: { x: 1, y: -2 } }
    expect(layoutAnnotations(d, d.constraints!, 10).get(c.id)!.label).toEqual({ x: 11, y: 13 })
  })
  it('respects an angular arc radius without perturbing polygon vertices', () => {
    const d = createDefinition(), z = createPolygonZone([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 10, y: -10 }, { x: 0, y: -10 }]); d.zones = [z]
    const c = makeAngular(d, { owner: 'zone', id: z.id, feature: 'edge', vertices: [z.vertices![0].id!, z.vertices![1].id!] }, { owner: 'zone', id: z.id, feature: 'edge', vertices: [z.vertices![1].id!, z.vertices![2].id!] })
    d.constraints!.push(c)
    const candidate = clone(d); candidate.constraints![0].annotation = { radius: 4, labelOffset: { x: 3, y: 8 } }
    const solved = solveDefinitionEdit(d, candidate), placement = layoutAnnotations(solved, solved.constraints!, 10).get(c.id)!
    expect(placement.radius).toBe(4); expect(placement.label).toEqual({ x: 8, y: 13 })
    expect(solved.zones).toEqual(d.zones)
  })
})
