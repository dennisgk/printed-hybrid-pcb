import { mkdir, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { projectSchema } from '../src/lib/model'
const schema = z.toJSONSchema(projectSchema, { target: 'draft-2020-12' })
await mkdir('public', { recursive: true })
await writeFile('public/project.schema.json', JSON.stringify({ ...schema, $id: 'https://traceform.local/project.schema.json', title: 'Traceform Project v1', description: 'All coordinates and fabrication dimensions are in millimeters. See README for reference integrity constraints.' }, null, 2) + '\n')
