import { mkdir, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { projectSchema } from '../src/lib/model'
const schema = z.toJSONSchema(projectSchema, { target: 'draft-2020-12' })
// Vertex IDs are optional in the internal type to accept v1 migration inputs;
// assertReferences requires them in saved v2 files.
function requireVertexIds(value: unknown) {
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  const properties = node.properties as Record<string, unknown> | undefined
  if (properties?.id && properties.x && properties.y && Object.keys(properties).length === 3) node.required = ['x', 'y', 'id']
  for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(requireVertexIds); else requireVertexIds(child)
}
requireVertexIds(schema)
await mkdir('public', { recursive: true })
await writeFile('public/project.schema.json', JSON.stringify({ ...schema, $id: 'https://traceform.local/project.schema.json', title: 'Traceform Project v2', description: 'All coordinates and fabrication dimensions are in millimeters. Constraints are component-local. See README for reference integrity constraints.' }, null, 2) + '\n')
