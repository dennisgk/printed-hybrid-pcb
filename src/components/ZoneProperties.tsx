import { Plus, Trash2 } from 'lucide-react'
import type { Definition, Zone, ZoneShape } from '../lib/model'
import { changeZoneShape, normalizePolygonZone, rect, resizeZone } from '../lib/geometry'
import { constraintLabel, controllerFor } from '../lib/constraints'
import { Button } from './ui/button'
import { FieldGroup, NumberField, TextField } from './ui/fields'

export function ZoneProperties({ zone, update, definition, selectConstraint }: { zone: Zone; definition: Definition; selectConstraint: (id: string) => void; update: (fn: (z: Zone) => void) => void }) {
  const lock = (field: string, vertexId?: string) => { const c = controllerFor(definition, 'zone', zone.id, field, vertexId); return c ? { label: constraintLabel(c), select: () => selectConstraint(c.id) } : undefined }
  const shape = zone.shape ?? 'rectangle'
  return <FieldGroup title="CLEARANCE ZONE">
    <TextField label="Zone name" value={zone.name} onChange={n => update(z => { z.name = n })} />
    <label className="field"><span>Shape</span><select aria-label="Zone shape" value={shape} onChange={e => update(z => changeZoneShape(z, e.target.value as ZoneShape))}><option value="rectangle">Rectangular</option><option value="circle">Circular</option><option value="polygon">Polygon</option></select></label>
    <div className="field-pair"><NumberField label={shape === 'circle' ? 'Center X' : 'X position'} control={lock('x')} value={zone.x} min={-Infinity} onChange={n => update(z => { z.x = n })} /><NumberField label={shape === 'circle' ? 'Center Y' : 'Y position'} control={lock('y')} value={zone.y} min={-Infinity} onChange={n => update(z => { z.y = n })} /></div>
    {shape === 'circle' ? <NumberField label="Radius" control={lock('radius')} value={zone.radius ?? zone.width / 2} min={.01} onChange={n => update(z => { z.radius = n; z.width = z.height = n * 2 })} /> : <div className="field-pair"><NumberField label="Width" control={lock('width')} value={zone.width} min={.01} onChange={n => update(z => resizeZone(z, 'width', n))} /><NumberField label="Height" control={lock('height')} value={zone.height} min={.01} onChange={n => update(z => resizeZone(z, 'height', n))} /></div>}
    {shape === 'polygon' && <>
      <p className="property-note">Drag the square handles to reshape the polygon, or edit component-local vertex positions.</p>
      {(zone.vertices ?? []).map((v, index) => <div className="vertex-fields" key={index}><span>{index + 1}</span><div className="field-pair"><NumberField label={`Vertex ${index + 1} X`} control={lock('x', v.id)} value={zone.x + v.x} min={-Infinity} onChange={n => update(z => { z.vertices![index].x = n - z.x; normalizePolygonZone(z) })} /><NumberField label={`Vertex ${index + 1} Y`} control={lock('y', v.id)} value={zone.y + v.y} min={-Infinity} onChange={n => update(z => { z.vertices![index].y = n - z.y; normalizePolygonZone(z) })} /></div><button className="close-button" aria-label={`Remove zone vertex ${index + 1}`} disabled={(zone.vertices?.length ?? 0) <= 3} onClick={() => update(z => { z.vertices!.splice(index, 1); normalizePolygonZone(z) })}><Trash2 size={12} /></button></div>)}
      <Button variant="outline" size="sm" onClick={() => update(z => { const v = z.vertices ?? rect(0, 0, z.width, z.height), a = v.at(-1)!, b = v[0]; v.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); z.vertices = v })}><Plus size={13} /> Add vertex</Button>
    </>}
    <label className="field"><span>Plate behavior</span><select aria-label="Plate behavior" value={zone.mode} onChange={e => update(z => { z.mode = e.target.value as Zone['mode'] })}><option value="clearance">Keep clear only</option><option value="recess">Recessed pocket</option><option value="cut">Through-cut</option></select></label>
    {zone.mode === 'recess' && <NumberField label="Pocket depth" value={zone.depth} onChange={n => update(z => { z.depth = n })} />}
    <p className="property-note">Zones may extend beyond the board body for overhanging connectors.</p>
  </FieldGroup>
}
