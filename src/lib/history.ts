import { useRef, useState } from 'react'
import { clone } from './model'
import type { Project } from './model'

export function useDocument() {
  const [project, setProject] = useState<Project | null>(null)
  const current = useRef<Project | null>(null)
  const past = useRef<Project[]>([]), future = useRef<Project[]>([])
  const [dirty, setDirty] = useState(false)
  const install = (p: Project | null) => { current.current = p; setProject(p) }
  const load = (p: Project | null, changed = false) => { past.current = []; future.current = []; install(p); setDirty(changed) }
  const commit = (change: (p: Project) => void) => {
    if (!current.current) return
    const before = current.current, next = clone(before)
    change(next)
    if (JSON.stringify(next) === JSON.stringify(before)) return
    past.current = [...past.current.slice(-99), before]; future.current = []
    install(next); setDirty(true)
  }
  const workspace = (change: (p: Project['workspace']) => void) => {
    if (!current.current) return
    const next = { ...current.current, workspace: clone(current.current.workspace) }; change(next.workspace)
    install(next); setDirty(true)
  }
  const travel = (from: React.RefObject<Project[]>, to: React.RefObject<Project[]>) => {
    const previous = from.current.pop()
    if (!previous || !current.current) return
    to.current.push(current.current)
    // Current camera and panel layout should not jump during geometry undo.
    const live = current.current.workspace
    previous.workspace = { ...previous.workspace, viewports: live.viewports, side: live.side, panelWidth: live.panelWidth, elementsHeight: live.elementsHeight }
    install(previous); setDirty(true)
  }
  return { project, current, dirty, setDirty, load, commit, workspace, undo: () => travel(past, future), redo: () => travel(future, past), canUndo: past.current.length > 0, canRedo: future.current.length > 0 }
}
