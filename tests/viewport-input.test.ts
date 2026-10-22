import { describe, expect, it } from 'vitest'
import { installZoomGestures, wheelZoomFactor, zoomCameraAt } from '../src/lib/viewport-input'

describe('trackpad zoom', () => {
  it('keeps the world point under the cursor fixed and supports zooming in and out', () => {
    const size = { width: 1000, height: 800 }, point = { x: 300, y: 250 }, camera = { x: -120, y: 50, zoom: 5 }
    const world = (c: typeof camera) => ({ x: c.x + (point.x - size.width / 2) / c.zoom, y: c.y - (point.y - size.height / 2) / c.zoom })
    const next = zoomCameraAt(camera, point, size, wheelZoomFactor(-15, 0, true, size.height))
    expect(next.zoom).toBeGreaterThan(camera.zoom); expect(world(next)).toEqual(world(camera))
    const back = zoomCameraAt(next, point, size, wheelZoomFactor(15, 0, true, size.height))
    expect(back.zoom).toBeCloseTo(camera.zoom); expect(back.x).toBeCloseTo(camera.x)
    expect(wheelZoomFactor(1, 1, false, 800)).toBe(wheelZoomFactor(16, 0, false, 800))
  })
  it('cancels browser zoom, handles Safari scale gestures, and removes listeners', () => {
    class FakeCanvas extends EventTarget { getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 800 } } }
    const canvas = new FakeCanvas(), initial = { x: 0, y: 0, zoom: 5 }; let camera = initial
    const cleanup = installZoomGestures(canvas as unknown as SVGSVGElement, () => camera, next => { camera = next })
    const emit = (type: string, data: object) => { const event = new Event(type, { cancelable: true }); Object.assign(event, data); canvas.dispatchEvent(event); return event }
    const e = emit('wheel', { ctrlKey: true, deltaY: -10, deltaMode: 0, clientX: 500, clientY: 400 })
    expect(e.defaultPrevented).toBe(true); expect(camera.zoom).toBeGreaterThan(5)
    const beforeGesture = camera.zoom
    emit('gesturestart', { scale: 1 }); emit('gesturechange', { scale: 2, clientX: 500, clientY: 400 })
    expect(camera.zoom).toBeCloseTo(beforeGesture * 2)
    emit('wheel', { ctrlKey: true, deltaY: -10, deltaMode: 0, clientX: 500, clientY: 400 })
    expect(camera.zoom).toBeCloseTo(beforeGesture * 2) // no duplicate wheel zoom during Safari gestures
    emit('gestureend', {}); cleanup(); const afterCleanup = camera.zoom
    emit('wheel', { ctrlKey: true, deltaY: -10, deltaMode: 0, clientX: 500, clientY: 400 })
    expect(camera.zoom).toBe(afterCleanup)
  })
})
