import type { Point, Viewport } from './model'

export function zoomCameraAt(camera: Viewport, point: Point, size: { width: number; height: number }, factor: number): Viewport {
  const zoom = Math.max(.01, Math.min(10000, camera.zoom * factor))
  const offsetX = point.x - size.width / 2, offsetY = point.y - size.height / 2
  return { zoom, x: camera.x + offsetX / camera.zoom - offsetX / zoom, y: camera.y - offsetY / camera.zoom + offsetY / zoom }
}
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean, height: number) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1)
  return Math.exp(Math.max(-10, Math.min(10, -pixels * (pinch ? .01 : .0015))))
}

// Native non-passive listeners are necessary to prevent page zoom during a trackpad pinch.
export function installZoomGestures(element: SVGSVGElement, getCamera: () => Viewport, change: (camera: Viewport) => void) {
  let gestureScale: number | null = null
  const apply = (clientX: number, clientY: number, factor: number) => {
    const r = element.getBoundingClientRect()
    change(zoomCameraAt(getCamera(), { x: clientX - r.left, y: clientY - r.top }, r, factor))
  }
  const wheel = (e: WheelEvent) => {
    e.preventDefault()
    if (gestureScale !== null) return
    apply(e.clientX, e.clientY, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, element.getBoundingClientRect().height))
  }
  type Gesture = Event & { scale: number; clientX: number; clientY: number }
  const start = (event: Event) => { event.preventDefault(); gestureScale = (event as Gesture).scale || 1 }
  const changeGesture = (event: Event) => {
    event.preventDefault()
    const e = event as Gesture
    if (gestureScale === null || !Number.isFinite(e.scale) || e.scale <= 0) return
    const r = element.getBoundingClientRect()
    apply(Number.isFinite(e.clientX) ? e.clientX : r.left + r.width / 2, Number.isFinite(e.clientY) ? e.clientY : r.top + r.height / 2, e.scale / gestureScale)
    gestureScale = e.scale
  }
  const end = (event: Event) => { event.preventDefault(); gestureScale = null }
  element.addEventListener('wheel', wheel, { passive: false })
  element.addEventListener('gesturestart', start, { passive: false })
  element.addEventListener('gesturechange', changeGesture, { passive: false })
  element.addEventListener('gestureend', end, { passive: false })
  return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('gesturestart', start); element.removeEventListener('gesturechange', changeGesture); element.removeEventListener('gestureend', end) }
}
