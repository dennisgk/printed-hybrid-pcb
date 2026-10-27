import { z } from 'zod'
import { solveDefinition } from './constraints'

export const APP_VERSION = '1.0.0'
export const id = () => crypto.randomUUID()
const finite = z.number().finite()
const positive = finite.positive()
const nonnegative = finite.nonnegative()
export const pointSchema = z.object({ x: finite, y: finite })
const vertexSchema = pointSchema.extend({ id: z.string().optional() })
const pinSchema = pointSchema.extend({ id: z.string(), name: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/i), diameter: positive, shape: z.enum(['circle', 'square']).optional() })
const zoneSchema = pointSchema.extend({ id: z.string(), name: z.string(), width: positive, height: positive, shape: z.enum(['rectangle', 'circle', 'polygon']).optional(), radius: positive.optional(), vertices: z.array(vertexSchema).optional(), mode: z.enum(['clearance', 'recess', 'cut']), depth: nonnegative }).superRefine((zone, ctx) => {
  if (zone.shape === 'circle' && zone.radius === undefined) ctx.addIssue({ code: 'custom', message: 'A circular zone needs a radius.', path: ['radius'] })
  if (zone.shape === 'polygon' && (!zone.vertices || zone.vertices.length < 3)) ctx.addIssue({ code: 'custom', message: 'A polygon zone needs at least three vertices.', path: ['vertices'] })
})
export const featureSchema = z.object({ owner: z.enum(['body', 'pin', 'zone']), id: z.string(), feature: z.enum(['left', 'right', 'bottom', 'top', 'midX', 'midY', 'edge', 'circle']), vertices: z.tuple([z.string(), z.string()]).optional(), circleMode: z.enum(['near', 'center', 'far']).optional() })
export const centerRefSchema = z.object({ owner: z.enum(['body', 'pin', 'zone']), id: z.string() })
export const annotationSchema = z.object({ labelOffset: pointSchema.optional(), lineOffset: finite.optional(), radius: positive.optional() })
const constraintBase = { id: z.string(), expression: z.string(), value: finite, annotation: annotationSchema.optional() }
export const constraintSchema = z.discriminatedUnion('kind', [
  z.object({ ...constraintBase, kind: z.literal('parallel'), reference: featureSchema, target: featureSchema, normal: pointSchema, side: z.union([z.literal(1), z.literal(-1)]), circleSign: z.union([z.literal(1), z.literal(-1)]).optional() }),
  z.object({ ...constraintBase, kind: z.literal('angular'), zoneId: z.string(), vertices: z.tuple([z.string(), z.string(), z.string()]), origin: pointSchema, direction: pointSchema, orientation: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ ...constraintBase, kind: z.literal('central'), reference: centerRefSchema, target: centerRefSchema }),
])
export const definitionSchema = z.object({ id: z.string(), name: z.string().min(1), width: positive, height: positive, recessDepth: nonnegative, fitClearance: nonnegative.nullable(), pins: z.array(pinSchema), zones: z.array(zoneSchema), constraints: z.array(constraintSchema).optional() })
const instanceSchema = pointSchema.extend({ id: z.string(), definitionId: z.string(), name: z.string().min(1), rotation: finite, recessDepth: nonnegative.nullable(), fitClearance: nonnegative.nullable() })
export const anchorSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('pin'), instanceId: z.string(), pinId: z.string() }), z.object({ kind: z.literal('junction'), id: z.string() })])
const traceSchema = z.object({ id: z.string(), width: positive, from: anchorSchema, to: anchorSchema, vertices: z.array(pointSchema) })
const viewportSchema = z.object({ x: finite, y: finite, zoom: positive })
export const settingsSchema = z.object({ thickness: positive, fitClearance: nonnegative, holeAllowance: nonnegative, traceWidth: positive, ridgeHeight: positive, separation: nonnegative, edgeClearance: nonnegative, minFloor: positive, landingDiameter: positive, landingMargin: nonnegative.default(1), grid: positive, plugHoles: z.enum(['none', 'fill', 'slightly-connected']).default('none'), plugGap: positive.default(.15), plugTabWidth: positive.default(.35), plugTabThickness: positive.default(.2), traceCut: z.enum(['none', 'lined']).default('none'), traceCutWidth: positive.default(1), squarePinBottomFace: z.enum(['square', 'circular']).default('square') })
export const projectSchema = z.object({
  metadata: z.object({ format: z.literal('printed-hybrid-pcb'), schemaVersion: z.literal(2), appVersion: z.string(), id: z.string(), name: z.string().min(1), projectVersion: z.string(), createdAt: z.string(), updatedAt: z.string() }),
  board: z.object({ outline: z.array(pointSchema).refine(v => v.length === 0 || v.length >= 3, 'An outline must be empty or a completed polygon.'), settings: settingsSchema }),
  definitions: z.array(definitionSchema), instances: z.array(instanceSchema), traces: z.array(traceSchema), junctions: z.array(pointSchema.extend({ id: z.string() })),
  workspace: z.object({ tabs: z.array(z.string()), activeTab: z.string(), side: z.enum(['top', 'bottom']), viewports: z.record(z.string(), viewportSchema), drafts: z.record(z.string(), definitionSchema), panelWidth: finite.min(240).max(480), elementsHeight: finite.min(160).max(600) }),
})
export type Point = z.infer<typeof pointSchema>
export type Vertex = z.infer<typeof vertexSchema>
export type Feature = z.infer<typeof featureSchema>
export type Constraint = z.infer<typeof constraintSchema>
export type ParallelConstraint = Extract<Constraint, { kind: 'parallel' }>
export type AngularConstraint = Extract<Constraint, { kind: 'angular' }>
export type CentralConstraint = Extract<Constraint, { kind: 'central' }>
export type CenterRef = z.infer<typeof centerRefSchema>
export type Annotation = z.infer<typeof annotationSchema>
export type Pin = z.infer<typeof pinSchema>
export type PinShape = NonNullable<Pin['shape']>
export type Zone = z.infer<typeof zoneSchema>
export type ZoneShape = NonNullable<Zone['shape']>
export type Definition = z.infer<typeof definitionSchema>
export type Instance = z.infer<typeof instanceSchema>
export type Anchor = z.infer<typeof anchorSchema>
export type Trace = z.infer<typeof traceSchema>
export type Project = z.infer<typeof projectSchema>
export type Settings = z.infer<typeof settingsSchema>
export type PlugHoles = Settings['plugHoles']
export type TraceCut = Settings['traceCut']
export type SquarePinBottomFace = Settings['squarePinBottomFace']
export type Viewport = z.infer<typeof viewportSchema>
export type Selection = { kind: 'instance' | 'trace' | 'outline' | 'pin' | 'zone' | 'body' | 'constraint'; id: string; vertex?: number } | null
export type Tool = 'select' | 'component' | 'trace' | 'edge' | 'pin' | 'zone' | 'parallel' | 'angular' | 'central'

export function createProject(name: string): Project {
  const now = new Date().toISOString()
  return { metadata: { format: 'printed-hybrid-pcb', schemaVersion: 2, appVersion: APP_VERSION, id: id(), name, projectVersion: '1.0', createdAt: now, updatedAt: now }, board: { outline: [], settings: { thickness: 3, fitClearance: .2, holeAllowance: .2, traceWidth: 3, ridgeHeight: .6, separation: 1, edgeClearance: 1, minFloor: 1, landingDiameter: 3, landingMargin: 1, grid: 1, plugHoles: 'none', plugGap: .15, plugTabWidth: .35, plugTabThickness: .2, traceCut: 'none', traceCutWidth: 1, squarePinBottomFace: 'square' } }, definitions: [], instances: [], traces: [], junctions: [], workspace: { tabs: ['project'], activeTab: 'project', side: 'top', viewports: {}, drafts: {}, panelWidth: 294, elementsHeight: 300 } }
}
export function createDefinition(): Definition {
  return { id: id(), name: 'Untitled component', width: 20, height: 30, recessDepth: 1, fitClearance: null, pins: [], zones: [], constraints: [] }
}
export function ensureVertexIds(d: Definition) { for (const z of d.zones) if (z.shape === 'polygon') for (const v of z.vertices ?? []) v.id ??= id() }
export function assertReferences(p: Project) {
  const checkIds = (items: { id: string }[], label: string) => { if (new Set(items.map(x => x.id)).size !== items.length) throw new Error(`Duplicate ${label} IDs.`) }
  checkIds(p.definitions, 'definition'); checkIds(p.instances, 'instance'); checkIds(p.traces, 'trace'); checkIds(p.junctions, 'junction')
  const defs = new Map(p.definitions.map(d => [d.id, d]))
  for (const d of [...p.definitions, ...Object.values(p.workspace.drafts)]) { checkIds(d.pins, 'pin'); checkIds(d.zones, 'zone'); checkIds(d.constraints ?? [], 'constraint'); for (const zone of d.zones) if (zone.shape === 'polygon') { const ids = zone.vertices?.map(v => v.id); if (ids?.some(v => !v) || new Set(ids).size !== ids?.length) throw new Error('Polygon vertex IDs must be present and unique.') } }
  for (const i of p.instances) if (!defs.has(i.definitionId)) throw new Error(`Missing definition for ${i.name}.`)
  for (const t of p.traces) for (const a of [t.from, t.to]) {
    if (a.kind === 'junction') { if (!p.junctions.some(j => j.id === a.id)) throw new Error('A trace references a missing junction.') }
    else { const i = p.instances.find(i => i.id === a.instanceId); if (!i || !defs.get(i.definitionId)?.pins.some(pin => pin.id === a.pinId)) throw new Error('A trace references a missing pin.') }
  }
  if (new Set(p.instances.map(i => i.name)).size !== p.instances.length) throw new Error('Component instance names must be unique.')
  if (new Set(p.workspace.tabs).size !== p.workspace.tabs.length || !p.workspace.tabs.includes('project') || !p.workspace.tabs.includes(p.workspace.activeTab)) throw new Error('Invalid saved tab configuration.')
  for (const tab of p.workspace.tabs) if (tab !== 'project' && !defs.has(tab) && !p.workspace.drafts[tab]) throw new Error('An open tab references a missing component.')
  for (const [key, d] of Object.entries(p.workspace.drafts)) if (key !== d.id) throw new Error('Invalid component draft ID.')
}
export function parseProject(raw: string): Project {
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('This file is not valid JSON.') }
  const v = data as { metadata?: { schemaVersion?: number }; definitions?: Definition[]; workspace?: { drafts?: Record<string, Definition> } }
  if (v?.metadata?.schemaVersion !== 1 && v?.metadata?.schemaVersion !== 2) throw new Error(`Unsupported schema version: ${v?.metadata?.schemaVersion ?? 'missing'}. This app supports versions 1 and 2.`)
  if (v.metadata.schemaVersion === 1) { v.metadata.schemaVersion = 2; for (const d of [...(v.definitions ?? []), ...Object.values(v.workspace?.drafts ?? {})]) { d.constraints = []; ensureVertexIds(d) } }
  const result = projectSchema.safeParse(data)
  if (!result.success) throw new Error(result.error.issues.slice(0, 3).map(e => `${e.path.join('.')}: ${e.message}`).join('\n'))
  assertReferences(result.data)
  for (const d of [...result.data.definitions, ...Object.values(result.data.workspace.drafts)]) solveDefinition(d)
  for (const tab of result.data.workspace.tabs) if (tab !== 'project' && !result.data.workspace.drafts[tab]) result.data.workspace.drafts[tab] = structuredClone(result.data.definitions.find(d => d.id === tab)!)
  return result.data
}
export function serializeProject(p: Project): string {
  const next = structuredClone(p)
  for (const d of [...next.definitions, ...Object.values(next.workspace.drafts)]) { ensureVertexIds(d); solveDefinition(d) }
  return JSON.stringify(projectSchema.parse({ ...next, metadata: { ...next.metadata, appVersion: APP_VERSION, updatedAt: new Date().toISOString() } }), null, 2)
}
export function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const fileName = (name: string) => name.replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').toLowerCase() || 'project'
export const clone = <T,>(value: T): T => structuredClone(value)
