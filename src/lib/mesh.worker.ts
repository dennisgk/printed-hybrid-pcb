import Module from 'manifold-3d'
import wasmURL from 'manifold-3d/manifold.wasm?url'
import { generateMesh } from './mesh'
import type { Project } from './model'

const ready = Module({ locateFile: () => wasmURL }).then(api => { api.setup(); return api })
self.onmessage = async (e: MessageEvent<Project>) => {
  try { const result = generateMesh(await ready, e.data); self.postMessage({ result }, { transfer: [result.positions.buffer, result.indices.buffer] }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
