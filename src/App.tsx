import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ArrowUpRight, Box, Check, ChevronDown, CircuitBoard, Circle, Command, Crosshair, FileJson, FolderOpen, Grid2X2, HelpCircle, Layers2, LoaderCircle, Maximize, MousePointer2, Plus, Redo2, RotateCw, Ruler, Route, Save, Scan, Settings2, SquareDashed, Undo2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './components/ui/button'
import { Dialog } from './components/ui/dialog'
import { Elements, PrintSettings, Properties } from './components/Panels'
import { Viewport } from './components/Viewport'
import { Welcome, Logo } from './components/Welcome'
import { useDocument } from './lib/history'
import { clone, createDefinition, createProject, download, ensureVertexIds, fileName, parseProject, serializeProject } from './lib/model'
import type { Definition, Project, Selection, Tool, ZoneShape, PinShape } from './lib/model'
import { cleanJunctions, outlineError, validateProject, zonePolygon } from './lib/geometry'
import { solveDefinition, solveDefinitionEditWithFallback } from './lib/constraints'
import { exampleProject } from './lib/example'

const MeshPreview = lazy(() => import('./components/MeshPreview'))
const PROJECT_TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [{ id: 'select', label: 'Select', key: 'V', icon: MousePointer2 }, { id: 'component', label: 'Place component', key: 'C', icon: CircuitBoard }, { id: 'trace', label: 'Route trace', key: 'T', icon: Route }, { id: 'edge', label: 'Edge cut', key: 'E', icon: Scan }]
const COMPONENT_TOOLS: typeof PROJECT_TOOLS = [{ id: 'select', label: 'Select', key: 'V', icon: MousePointer2 }, { id: 'pin', label: 'Place pin', key: 'P', icon: Circle }, { id: 'zone', label: 'Clearance zone', key: 'Z', icon: SquareDashed }, { id: 'parallel', label: 'Parallel side constraint', key: 'D', icon: Ruler }, { id: 'angular', label: 'Angular constraint', key: 'A', icon: RotateCw }, { id: 'central', label: 'Central constraint', key: 'G', icon: Crosshair }]

export default function App() {
  const doc = useDocument(), { project } = doc
  const [tool, setTool] = useState<Tool>('select'), [selection, select] = useState<Selection>(null)
  const [definitionId, setDefinitionId] = useState(''), [traceWidth, setTraceWidth] = useState(3), [angle, setAngle] = useState<'45' | '90' | 'free'>('45'), [edgeMode, setEdgeMode] = useState<'polygon' | 'rectangle'>('polygon')
  const [snapEnabled, setSnapEnabled] = useState(true), [fitSignal, setFitSignal] = useState(0)
  const [newOpen, setNewOpen] = useState(false), [newName, setNewName] = useState('Untitled project')
  const [zoneShape, setZoneShape] = useState<ZoneShape>('rectangle')
  const [pinShape, setPinShape] = useState<PinShape>('circle')
  const [circleMode, setCircleMode] = useState<'near' | 'center' | 'far'>('near')
  const [settingsOpen, setSettingsOpen] = useState(false), [meshOpen, setMeshOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false)
  const [toast, setToast] = useState(''), [pending, setPending] = useState<{ title: string; run: () => void } | null>(null), [closingTab, setClosingTab] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null), [loading, setLoading] = useState(false)
  const currentTab = project?.workspace.activeTab ?? 'project', isProject = currentTab === 'project'
  const [exportAttempted, setExportAttempted] = useState(false)
  const issues = useMemo(() => project ? validateProject(project) : [], [project])
  const exportIssues = useMemo(() => project && exportAttempted ? validateProject(project, { forExport: true }) : issues, [project, exportAttempted, issues])
  const notify = (message: string) => setToast(message)
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (doc.dirty) e.preventDefault() }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler) }, [doc.dirty])
  function replace(p: Project) { setExportAttempted(false); doc.load(p); select(null); setTool('select'); setDefinitionId(p.definitions[0]?.id ?? ''); setTraceWidth(p.board.settings.traceWidth); setFitSignal(0) }
  function requestReplace(title: string, run: () => void) { if (doc.dirty) setPending({ title, run }); else run() }
  const commit = (change: (p: Project) => void): boolean => {
    const before = doc.current.current
    if (!before) return false
    try {
      const candidate = clone(before); change(candidate)
      const tab = before.workspace.activeTab
      if (tab !== 'project' && candidate.workspace.drafts[tab] && before.workspace.drafts[tab]) {
        ensureVertexIds(candidate.workspace.drafts[tab])
        const solved = solveDefinitionEditWithFallback(before.workspace.drafts[tab], candidate.workspace.drafts[tab])
        candidate.workspace.drafts[tab] = solved.result
        if (solved.reversed) notify('Reversed the selections to use a valid driven object.')
      }
      const settingsChanged = JSON.stringify(candidate.board.settings) !== JSON.stringify(before.board.settings)
      if (tab === 'project' && !settingsChanged) {
        const existing = new Set(validateProject(before).map(i => i.element + ':' + i.message))
        const issue = validateProject(candidate).find(i => !existing.has(i.element + ':' + i.message))
        if (issue) throw new Error(issue.message)
      }
      doc.commit(p => { Object.assign(p, candidate) })
      if (!before.board.outline.length && candidate.board.outline.length) setTool('select')
      return true
    } catch (error) { notify((error as Error).message); return false }
  }
  function newDefinition() {
    const d = createDefinition()
    doc.commit(p => { p.workspace.drafts[d.id] = d; p.workspace.tabs.push(d.id); p.workspace.activeTab = d.id }); select(null); setTool('select')
  }
  function editDefinition(id: string) {
    doc.commit(p => { const d = p.definitions.find(d => d.id === id); if (!d) return; p.workspace.drafts[id] ??= clone(d); ensureVertexIds(p.workspace.drafts[id]); if (!p.workspace.tabs.includes(id)) p.workspace.tabs.push(id); p.workspace.activeTab = id }); select(null); setTool('select')
  }
  function switchTab(tab: string) { doc.workspace(w => { w.activeTab = tab }); setTool('select'); select(null) }
  function dirtyDefinition(tab: string) { return JSON.stringify(project?.workspace.drafts[tab]) !== JSON.stringify(project?.definitions.find(d => d.id === tab)) }
  function applyDefinition(tab = currentTab, close = false): boolean {
    if (!project) return false
    const source = project.workspace.drafts[tab]; if (!source) return false
    const draft = clone(source)
    try { ensureVertexIds(draft); solveDefinition(draft) } catch (error) { notify((error as Error).message); return false }
    for (const zone of draft.zones) { const error = outlineError(zonePolygon(zone)); if (error) { notify(`Invalid clearance zone: ${error}`); return false } }
    for (const i of project.instances.filter(i => i.definitionId === tab)) {
      const used = project.traces.flatMap(t => [t.from, t.to]).filter(a => a.kind === 'pin' && a.instanceId === i.id)
      if (used.some(a => a.kind === 'pin' && !draft.pins.some(pin => pin.id === a.pinId))) { notify('This definition removes a connected pin. Remove its traces in Project first.'); return false }
    }
    doc.commit(p => { const index = p.definitions.findIndex(d => d.id === tab); if (index >= 0) p.definitions[index] = clone(draft); else p.definitions.push(clone(draft)); p.workspace.drafts[tab] = clone(draft); if (close) { p.workspace.tabs = p.workspace.tabs.filter(t => t !== tab); delete p.workspace.drafts[tab]; p.workspace.activeTab = 'project' } })
    setDefinitionId(tab); notify('Component saved. All placed copies now use this definition.'); return true
  }
  function actuallyClose(tab: string) { doc.commit(p => { p.workspace.tabs = p.workspace.tabs.filter(t => t !== tab); delete p.workspace.drafts[tab]; if (p.workspace.activeTab === tab) p.workspace.activeTab = 'project' }); setTool('select'); select(null) }
  function closeTab(tab: string) { if (dirtyDefinition(tab)) setClosingTab(tab); else actuallyClose(tab) }
  function saveJSON() {
    const p = doc.current.current; if (!p) return
    try { download(serializeProject(p), `${fileName(p.metadata.name)}.json`, 'application/json'); doc.setDirty(false); notify('Project JSON downloaded, including open tabs and drafts.') } catch (err) { notify(`Could not save: ${(err as Error).message}`) }
  }
  async function loadFile(file: File) {
    setLoading(true)
    try { if (file.size > 25_000_000) throw new Error('Please choose a project JSON smaller than 25 MB.'); const p = parseProject(await file.text()); requestReplace('Replace the current project?', () => replace(p)) } catch (err) { notify((err as Error).message) } finally { setLoading(false) }
  }
  function remove() {
    if (!selection || !project) return
    const s = selection
    if (isProject) {
      if (s.kind === 'instance') {
        const connected = project.traces.filter(t => [t.from, t.to].some(a => a.kind === 'pin' && a.instanceId === s.id))
        const run = () => { doc.commit(p => { p.instances = p.instances.filter(i => i.id !== s.id); p.traces = p.traces.filter(t => !connected.some(c => c.id === t.id)); cleanJunctions(p) }); select(null) }
        if (connected.length) setPending({ title: `Delete this component and its ${connected.length} attached traces?`, run }); else run()
      } else if (s.kind === 'trace') { commit(p => { const t = p.traces.find(t => t.id === s.id); if (t && s.vertex !== undefined) t.vertices.splice(s.vertex, 1); else p.traces = p.traces.filter(t => t.id !== s.id); cleanJunctions(p) }); select(null) }
      else if (s.kind === 'outline') { if (s.vertex === undefined) clearBoundary(); else if (project.board.outline.length > 3) commit(p => { p.board.outline.splice(s.vertex!, 1) }) }
    } else if (s.kind === 'constraint') { commit(p => { p.workspace.drafts[currentTab].constraints = p.workspace.drafts[currentTab].constraints?.filter(c => c.id !== s.id) }); select(null)
    } else if (s.kind === 'pin' || s.kind === 'zone') {
      if (s.kind === 'pin' && project.traces.some(t => [t.from, t.to].some(a => a.kind === 'pin' && a.pinId === s.id && project.instances.some(i => i.id === a.instanceId && i.definitionId === currentTab)))) { notify('This pin is connected. Remove its traces in Project before deleting it.'); return }
      commit(p => { const d = p.workspace.drafts[currentTab]; if (s.kind === 'pin') d.pins = d.pins.filter(pin => pin.id !== s.id); else d.zones = d.zones.filter(z => z.id !== s.id) }); select(null)
    }
  }
  const tools = isProject ? PROJECT_TOOLS : COMPONENT_TOOLS
  function clearBoundary() { doc.commit(p => { p.board.outline = [] }); select(null) }
  function activateTool(t: Tool) { if (t === 'edge' && project?.board.outline.length) { setTool('select'); select({ kind: 'outline', id: 'outline' }); return } if (t === 'trace') doc.workspace(w => { w.side = 'bottom' }); setTool(t); select(null) }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[role="dialog"]') || pending || newOpen || meshOpen || settingsOpen || helpOpen || closingTab) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveJSON(); return }
      if (!project) return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doc.redo(); return }
      if (mod) return
      if (e.key === 'Delete') { e.preventDefault(); remove() }
      if (e.key.toLowerCase() === 'f') setFitSignal(v => v + 1)
      if (e.key === 'Tab' && isProject) { e.preventDefault(); doc.workspace(w => { w.side = w.side === 'top' ? 'bottom' : 'top' }) }
      if (e.key.toLowerCase() === 'r' && selection?.kind === 'instance') commit(p => { const i = p.instances.find(i => i.id === selection.id); if (i) i.rotation = (i.rotation + 90) % 360 })
      if (e.key === 'Escape') setTool('select')
      const match = tools.find(t => t.key.toLowerCase() === e.key.toLowerCase()); if (match) activateTool(match.id)
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  })
  function resizePanel(e: React.PointerEvent<HTMLDivElement>, axis: 'width' | 'height') {
    e.preventDefault(); const start = { x: e.clientX, y: e.clientY }, width = project!.workspace.panelWidth, height = project!.workspace.elementsHeight
    e.currentTarget.setPointerCapture(e.pointerId)
    const target = e.currentTarget
    const move = (event: PointerEvent) => doc.workspace(w => { if (axis === 'width') w.panelWidth = Math.max(240, Math.min(480, width + start.x - event.clientX)); else w.elementsHeight = Math.max(160, Math.min(600, height + event.clientY - start.y)) })
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
  }
  const activeDefinition: Definition | undefined = project?.workspace.drafts[currentTab]
  return <>
    <input ref={input} type="file" accept=".json,application/json" className="hidden-input" aria-label="Load project JSON" onChange={e => { const file = e.target.files?.[0]; if (file) void loadFile(file); e.target.value = '' }} />
    {!project ? <Welcome create={() => setNewOpen(true)} load={() => input.current?.click()} sample={() => replace(exampleProject())} loading={loading} /> : <div className="app-shell">
      <header className="app-header"><button className="brand brand-button" onClick={() => requestReplace('Close this project?', () => doc.load(null))} title="Back to welcome"><Logo /><strong>Traceform</strong></button><div className="header-divider" /><div className="project-title"><span>{project.metadata.name}</span><small>{doc.dirty ? <><i /> Unsaved changes</> : <><Check size={11} /> JSON file project</>}</small></div><div className="header-actions"><Button variant="ghost" size="icon" title="New Project" aria-label="New Project" onClick={() => requestReplace('Start a new project?', () => setNewOpen(true))}><Plus size={16} /></Button><Button variant="ghost" size="icon" title="Load Project" aria-label="Load Project" onClick={() => input.current?.click()}><FolderOpen size={16} /></Button><span className="header-divider" /><Button variant="outline" size="sm" onClick={saveJSON}><Save size={14} />Save JSON</Button><Button variant="ghost" size="icon" title="Project settings" aria-label="Project settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></Button><Button size="sm" disabled={!project.board.outline.length} title={!project.board.outline.length ? 'Draw a completed edge-cut boundary to export' : undefined} onClick={() => { setExportAttempted(true); const errors = validateProject(project, { forExport: true }); if (errors.length) { notify(errors[0].message); switchTab('project'); return } setMeshOpen(true) }}><Box size={15} /> Preview & export <ArrowUpRight size={13} /></Button></div></header>
      <nav className="tabs-bar" aria-label="Editor tabs"><div className="document-tabs">{project.workspace.tabs.map(tab => { const d = project.workspace.drafts[tab] ?? project.definitions.find(d => d.id === tab); return <div key={tab} className={`document-tab ${currentTab === tab ? 'active' : ''}`}><button role="tab" aria-selected={currentTab === tab} onClick={() => switchTab(tab)}>{tab === 'project' ? <Layers2 size={14} /> : <CircuitBoard size={14} />}<span>{tab === 'project' ? 'Project' : d?.name}</span>{tab !== 'project' && dirtyDefinition(tab) && <i className="draft-dot" />}</button>{tab === 'project' ? <span className="fixed-tab-dot" /> : <button className="tab-close" aria-label={`Close ${d?.name} tab`} onClick={() => closeTab(tab)}><X size={12} /></button>}</div> })}<button className="new-tab" aria-label="New component definition" title="New component definition" onClick={newDefinition}><Plus size={15} /></button></div><div className="tab-context">{isProject ? <><span className="layer-dot" />{project.workspace.side === 'top' ? 'TOP FACE' : 'BOTTOM FACE'}</> : <><span className="draft-label">COMPONENT DEFINITION</span><Button size="sm" variant="outline" onClick={() => applyDefinition()}><Check size={13} />Save Component</Button></>}</div></nav>
      <div className="tool-settings"><div className="active-tool-label">{(() => { const t = tools.find(t => t.id === tool) ?? tools[0]; return <><t.icon size={15} /><strong>{t.label}</strong><ChevronDown size={11} /></> })()}</div><div className="settings-divider" />
        {isProject && tool === 'component' ? <><select aria-label="Component definition" value={definitionId} onChange={e => setDefinitionId(e.target.value)}><option value="">Choose component…</option>{project.definitions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><Button variant="ghost" size="sm" onClick={newDefinition}><Plus size={13} />New definition</Button>{definitionId && <Button variant="ghost" size="sm" onClick={() => editDefinition(definitionId)}>Edit definition <ArrowUpRight size={12} /></Button>}</> : tool === 'trace' ? <><label className="inline-number">Width<input aria-label="New trace width" type="number" value={traceWidth} min=".1" step=".1" onChange={e => { const n = Number(e.target.value); if (n > 0) setTraceWidth(n) }} /><span>mm</span></label><div className="settings-divider" /><select aria-label="Trace angle snap" value={angle} onChange={e => setAngle(e.target.value as typeof angle)}><option value="45">45° angles</option><option value="90">90° angles</option><option value="free">Free angles</option></select><span className="settings-note">Bottom layer · explicit junctions</span></> : tool === 'edge' ? <><select aria-label="Outline drawing mode" value={edgeMode} onChange={e => setEdgeMode(e.target.value as typeof edgeMode)}><option value="polygon">Polygon outline</option><option value="rectangle">Rectangle outline</option></select><span className="settings-note">Draw one closed outer boundary</span></> : tool === 'parallel' ? <><select aria-label="Circular constraint feature" value={circleMode} onChange={e => setCircleMode(e.target.value as typeof circleMode)}><option value="near">Near tangent</option><option value="center">Center axis</option><option value="far">Far tangent</option></select><span className="settings-note">Select a reference side or midaxis, then a parallel target</span></> : tool === 'central' ? <span className="settings-note">Select the ground rectangle or circle, then the object to center on it</span> : tool === 'angular' ? <span className="settings-note">Select two adjacent polygon sides; enter the angle on the canvas</span> : tool === 'pin' ? <><select aria-label="New pin shape" value={pinShape} onChange={e => setPinShape(e.target.value as PinShape)}><option value="circle">Circular</option><option value="square">Square</option></select><span className="settings-note">Place by center X/Y; diameter is the square side length</span></> : tool === 'zone' ? <><select aria-label="Clearance zone shape" value={zoneShape} onChange={e => setZoneShape(e.target.value as ZoneShape)}><option value="rectangle">Rectangular</option><option value="circle">Circular</option><option value="polygon">Polygon</option></select><span className="settings-note">{zoneShape === 'circle' ? 'Click center, then radius' : zoneShape === 'polygon' ? 'Click vertices; close at the first point or press Enter' : 'Click two opposite corners'}</span></> : <span className="settings-note">{isProject ? 'Select an element to inspect and edit' : 'Edit the board body, pins, and clearance zones'}</span>}
        <div className="settings-right"><button className={`snap-toggle ${snapEnabled ? 'enabled' : ''}`} onClick={() => setSnapEnabled(v => !v)} title="Toggle grid snapping"><Grid2X2 size={13} />Snap <span>{project.board.settings.grid} mm</span><i /></button><span className="settings-divider" /><Button size="icon" variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!doc.canUndo} onClick={doc.undo}><Undo2 size={15} /></Button><Button size="icon" variant="ghost" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!doc.canRedo} onClick={doc.redo}><Redo2 size={15} /></Button></div>
      </div>
      <main className="editor-main"><aside className="toolbar" aria-label={isProject ? 'Project tools' : 'Component tools'}>{tools.map(t => <Fragment key={t.id}>{!isProject && t.id === 'parallel' && <div className="toolbar-separator" />}<button className={`tool-button ${tool === t.id ? 'active' : ''}`} aria-label={t.label} aria-pressed={tool === t.id} disabled={t.id === 'edge' && project.board.outline.length > 0} title={`${t.label} (${t.key})`} onClick={() => activateTool(t.id)}><t.icon size={20} strokeWidth={1.6} /><kbd>{t.key}</kbd></button></Fragment>)}{isProject && <><div className="toolbar-separator" /><button className={`tool-button side-tool ${project.workspace.side === 'bottom' ? 'active' : ''}`} title="Switch side (Tab)" aria-label="Switch side" onClick={() => doc.workspace(w => { w.side = w.side === 'top' ? 'bottom' : 'top' })}><ArrowDownUp size={20} strokeWidth={1.6} /><span>{project.workspace.side === 'top' ? 'TOP' : 'BOT'}</span></button></>}<div className="toolbar-bottom"><button className="tool-button" aria-label="Fit design" title="Fit design (F)" onClick={() => setFitSignal(v => v + 1)}><Maximize size={18} strokeWidth={1.6} /></button><button className="tool-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setHelpOpen(true)}><HelpCircle size={18} strokeWidth={1.6} /></button></div></aside>
        <Viewport key={project.metadata.id} project={project} tool={tool} selection={selection} select={select} commit={commit} workspace={doc.workspace} notify={notify} definitionId={definitionId} traceWidth={traceWidth} angle={angle} edgeMode={edgeMode} zoneShape={zoneShape} pinShape={pinShape} circleMode={circleMode} snapEnabled={snapEnabled} fitSignal={fitSignal} />
        <aside className="right-panels" style={{ width: project.workspace.panelWidth }}><div className="panel-width-handle" onPointerDown={e => resizePanel(e, 'width')} /><section className="elements-panel" style={{ height: project.workspace.elementsHeight }}><Elements project={project} selection={selection} select={select} editDefinition={editDefinition} /></section><div className="panel-height-handle" onPointerDown={e => resizePanel(e, 'height')} /><section className="properties-panel"><Properties project={project} selection={selection} select={select} commit={commit} editDefinition={editDefinition} issues={exportIssues} remove={remove} clearBoundary={clearBoundary} /></section></aside>
      </main><footer className="status-bar"><div><span className={issues.length ? 'status-issue' : 'status-ok'}>{issues.length ? <Circle size={8} fill="currentColor" /> : <Check size={12} />}{issues.length ? `${issues.length} design issues` : 'Design checks passed'}</span><i /><span>{project.instances.length} components</span><span>{project.traces.length} traces</span></div><div><FileJson size={12} /><span>JSON document</span><i /><span>{activeDefinition && dirtyDefinition(currentTab) ? 'Component draft · apply to update copies' : 'All changes stay in memory until saved'}</span><span className="status-version">v1.0</span></div></footer>
    </div>}
    <Dialog open={newOpen} onOpenChange={setNewOpen} title="Start a new project" description="An unbounded workspace for your next circuit."><form onSubmit={e => { e.preventDefault(); replace(createProject(newName.trim() || 'Untitled project')); doc.setDirty(true); setNewOpen(false) }}><label className="field"><span>Project name</span><input autoFocus aria-label="New project name" value={newName} onChange={e => setNewName(e.target.value)} required /></label><div className="dialog-callout"><Layers2 size={16} /><p>Place components anywhere. Draw a closed edge-cut boundary when you are ready to define the printed plate.</p></div><div className="dialog-actions"><Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button><Button type="submit"><Plus size={15} /> Create Project</Button></div></form></Dialog>
    <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null) }} title={pending?.title ?? ''} description="This action changes the current session. Download your JSON first if you want to keep a copy."><div className="dialog-actions"><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant="outline" onClick={saveJSON}><Save size={14} />Save JSON</Button><Button variant="destructive" onClick={() => { const run = pending?.run; setPending(null); run?.() }}>Continue</Button></div></Dialog>
    <Dialog open={!!closingTab} onOpenChange={open => { if (!open) setClosingTab(null) }} title="Apply component changes?" description="Apply this draft to every placed copy, or discard its edits before closing the tab."><div className="dialog-actions"><Button variant="ghost" onClick={() => setClosingTab(null)}>Cancel</Button><Button variant="outline" onClick={() => { if (closingTab) actuallyClose(closingTab); setClosingTab(null) }}>Discard draft</Button><Button onClick={() => { if (closingTab && applyDefinition(closingTab, true)) { setClosingTab(null); setTool('select'); select(null) } }}>Apply & close</Button></div></Dialog>
    {project && <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} title="Project & print settings" description="All dimensions are millimeters. Adjust these starting values for your printer." wide><PrintSettings project={project} commit={doc.commit} /><div className="dialog-actions"><Button onClick={() => setSettingsOpen(false)}><Check size={14} /> Done</Button></div></Dialog>}
    {project && <Dialog open={meshOpen} onOpenChange={setMeshOpen} title="Your design, in three dimensions" description="Inspect the component face and conductive face before exporting one solid plate." wide>{meshOpen && <Suspense fallback={<div className="lazy-loading"><LoaderCircle className="spin" />Loading mesh tools…</div>}><MeshPreview project={project} /></Suspense>}</Dialog>}
    <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="A few useful shortcuts" description="Everything you need to move around your workspace."><div className="shortcuts">{[['Select', 'V'], ['Parallel / angular / central constraint', 'D / A / G'], ['Component / pin / clearance zone', 'C / P / Z'], ['Route trace / edge cut', 'T / E'], ['Switch visible side', 'Tab'], ['Rotate selected instance', 'R'], ['Fit design', 'F'], ['Pan', 'Space + drag'], ['Zoom', 'Scroll'], ['Delete selection', 'Delete'], ['Cancel gesture', 'Esc'], ['Finish polygon / remove last point', 'Enter / Backspace'], ['Save project JSON', 'Ctrl / ⌘ + S'], ['Undo / redo', 'Ctrl / ⌘ + Z / Shift + Z']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><div className="dialog-actions"><Button onClick={() => setHelpOpen(false)}><Command size={14} /> Got it</Button></div></Dialog>
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
  </>
}
