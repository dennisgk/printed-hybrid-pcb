import { createProject, id } from './model'
import type { Definition } from './model'
export function exampleProject() {
  const p = createProject('Sensor carrier')
  p.board.outline = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }]
  const controller: Definition = { id: id(), name: 'Controller', width: 22, height: 30, recessDepth: 1, fitClearance: null, pins: [{ id: id(), name: '5V', x: 19, y: 5, diameter: 1.2, color: '#eda787' }, { id: id(), name: 'GND', x: 19, y: 25, diameter: 1.2, color: '#a3c9ef' }], zones: [{ id: id(), name: 'USB clearance', x: -5, y: 10, width: 5, height: 10, mode: 'recess', depth: 1 }] }
  const sensor: Definition = { id: id(), name: 'Sensor', width: 16, height: 28, recessDepth: 1, fitClearance: null, pins: [{ id: id(), name: 'VCC', x: 2, y: 4, diameter: 1.2, color: '#eda787' }, { id: id(), name: 'GND', x: 2, y: 24, diameter: 1.2, color: '#a3c9ef' }], zones: [] }
  p.definitions = [controller, sensor]
  p.instances = [{ id: id(), name: 'Controller 1', definitionId: controller.id, x: 18, y: 24, rotation: 0, recessDepth: null, fitClearance: null }, { id: id(), name: 'Sensor 1', definitionId: sensor.id, x: 68, y: 34, rotation: 0, recessDepth: null, fitClearance: null }]
  p.traces = [0, 1].map(n => ({ id: id(), width: 3, from: { kind: 'pin', instanceId: p.instances[0].id, pinId: controller.pins[n].id }, to: { kind: 'pin', instanceId: p.instances[1].id, pinId: sensor.pins[n].id }, vertices: [{ x: 50, y: 29 + n * 20 }, { x: 59, y: 38 + n * 20 }] }))
  return p
}
