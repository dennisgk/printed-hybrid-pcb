import { describe, expect, it } from 'vitest'
import { clone, createDefinition, createProject, ensureVertexIds, parseProject, serializeProject } from '../src/lib/model'
import { exampleProject } from '../src/lib/example'

describe('portable documents', () => {
  it('defaults square-pin bottom faces to square and preserves the circular fabrication option', () => {
    const p = createProject('Pad option'), legacy = JSON.parse(JSON.stringify(p))
    delete legacy.board.settings.squarePinBottomFace
    expect(parseProject(JSON.stringify(legacy)).board.settings.squarePinBottomFace).toBe('square')
    p.board.settings.squarePinBottomFace = 'circular'
    expect(parseProject(serializeProject(p)).board.settings.squarePinBottomFace).toBe('circular')
  })
  it('defaults older files to solid traces and round trips lined trace settings', () => {
    const p = createProject('Wire channels'), legacy = JSON.parse(JSON.stringify(p))
    delete legacy.board.settings.traceCut; delete legacy.board.settings.traceCutWidth
    const loaded = parseProject(JSON.stringify(legacy))
    expect(loaded.board.settings.traceCut).toBe('none'); expect(loaded.board.settings.traceCutWidth).toBe(1)
    p.board.settings.traceCut = 'lined'; p.board.settings.traceCutWidth = .8
    expect(parseProject(serializeProject(p)).board.settings).toEqual(p.board.settings)
    p.board.settings.traceCutWidth = 0
    expect(() => parseProject(JSON.stringify(p))).toThrow('traceCutWidth')
  })
  it('loads older projects with open holes and round trips plug fabrication options', () => {
    const p = createProject('Hole plugs')
    const legacy = JSON.parse(JSON.stringify(p))
    for (const key of ['plugHoles', 'plugGap', 'plugTabWidth', 'plugTabThickness']) delete legacy.board.settings[key]
    const loaded = parseProject(JSON.stringify(legacy)).board.settings
    expect(loaded.plugHoles).toBe('none'); expect(loaded.plugGap).toBe(.15)
    expect(loaded.plugTabWidth).toBe(.35); expect(loaded.plugTabThickness).toBe(.2)
    for (const mode of ['none', 'fill', 'slightly-connected'] as const) {
      Object.assign(p.board.settings, { plugHoles: mode, plugGap: .25, plugTabWidth: .3, plugTabThickness: .15 })
      expect(parseProject(serializeProject(p)).board.settings).toEqual(p.board.settings)
    }
    p.board.settings.plugGap = 0
    expect(() => parseProject(JSON.stringify(p))).toThrow('plugGap')
  })
  it('defaults missing landing margins and preserves explicit zero or custom margins', () => {
    const p = createProject('Landing margin')
    const legacy = JSON.parse(JSON.stringify(p)); delete legacy.board.settings.landingMargin
    expect(parseProject(JSON.stringify(legacy)).board.settings.landingMargin).toBe(1)
    for (const margin of [0, .25]) {
      p.board.settings.landingMargin = margin
      expect(parseProject(serializeProject(p)).board.settings.landingMargin).toBe(margin)
    }
    p.board.settings.landingMargin = -1
    expect(() => parseProject(JSON.stringify(p))).toThrow('landingMargin')
  })
  it('preserves square pins and accepts older circular pins without a shape field', () => {
    const p = exampleProject(); p.definitions[0].pins[0].shape = 'square'
    const loaded = parseProject(serializeProject(p))
    expect(loaded.definitions[0].pins[0].shape).toBe('square')
    expect(loaded.definitions[0].pins[1].shape).toBeUndefined()
    expect(loaded.definitions[0].pins[0].diameter).toBe(1.2)
  })
  it('round trips geometry, metadata, viewports, tabs and unapplied drafts', () => {
    const p = exampleProject(), d = clone(p.definitions[0]); d.width = 24
    p.workspace.tabs.push(d.id); p.workspace.activeTab = d.id; p.workspace.drafts[d.id] = d
    p.workspace.viewports[d.id] = { x: 12, y: 8, zoom: 16 }; p.workspace.side = 'bottom'
    const loaded = parseProject(serializeProject(p))
    expect(loaded.instances).toEqual(p.instances); expect(loaded.traces).toEqual(p.traces)
    expect(loaded.workspace).toEqual(p.workspace); expect(loaded.definitions[0].width).toBe(22)
    expect(loaded.workspace.drafts[d.id].width).toBe(24)
  })
  it('permits new, unsaved component tabs with no committed definition', () => {
    const p = createProject('Draft'), d = createDefinition(); p.workspace.drafts[d.id] = d; p.workspace.tabs.push(d.id)
    expect(parseProject(serializeProject(p)).workspace.drafts[d.id]).toEqual(d)
  })
  it('rejects malformed JSON and unsupported versions', () => {
    expect(() => parseProject('{')).toThrow('not valid JSON')
    const p = createProject('Bad') as unknown as { metadata: { schemaVersion: number } }; p.metadata.schemaVersion = 99
    expect(() => parseProject(JSON.stringify(p))).toThrow('Unsupported schema version')
  })
  it('rejects duplicate IDs, missing pins, missing definitions, and broken tabs', () => {
    const original = exampleProject()
    const p = clone(original); p.instances.push(p.instances[0]); expect(() => parseProject(JSON.stringify(p))).toThrow('Duplicate instance')
    const q = clone(original); q.definitions[0].pins = []; expect(() => parseProject(JSON.stringify(q))).toThrow('missing pin')
    const r = clone(original); r.definitions = []; expect(() => parseProject(JSON.stringify(r))).toThrow('Missing definition')
    const s = clone(original); s.workspace.activeTab = 'missing'; expect(() => parseProject(JSON.stringify(s))).toThrow('Invalid saved tab')
  })
  it('rejects non-finite and negative fabrication data', () => {
    const p = createProject('Bad'); p.board.settings.thickness = -3
    expect(() => parseProject(JSON.stringify(p))).toThrow('thickness')
    p.board.settings.thickness = Infinity; expect(() => serializeProject(p)).toThrow()
  })
  it('round trips unbounded projects and new clearance shapes while retaining legacy rectangles', () => {
    const p = exampleProject(); p.board.outline = []
    const base = p.definitions[0].zones[0]
    p.definitions[0].zones.push({ ...clone(base), id: 'circle', shape: 'circle', radius: 5 }, { ...clone(base), id: 'polygon', shape: 'polygon', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] })
    p.instances[0].x = -1_000_000
    ensureVertexIds(p.definitions[0])
    const loaded = parseProject(serializeProject(p))
    expect(loaded.board.outline).toEqual([]); expect(loaded.instances[0].x).toBe(-1_000_000)
    expect(loaded.definitions[0].zones).toEqual(p.definitions[0].zones)
  })
})
