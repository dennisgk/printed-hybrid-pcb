import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ArrowDown, ArrowUp, Box, Download, LoaderCircle, Rotate3D } from 'lucide-react'
import type { Project } from '../lib/model'
import { download, fileName } from '../lib/model'
import type { MeshResult } from '../lib/mesh'
import { binarySTL } from '../lib/mesh'
import { Button } from './ui/button'

export default function MeshPreview({ project }: { project: Project }) {
  const host = useRef<HTMLDivElement>(null), sceneAPI = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; radius: number } | null>(null)
  const [result, setResult] = useState<MeshResult | null>(null), [error, setError] = useState(''), [viewError, setViewError] = useState('')
  useEffect(() => {
    const worker = new Worker(new URL('../lib/mesh.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = e => { if (e.data.error) setError(e.data.error); else setResult(e.data.result) }
    worker.onerror = e => setError(e.message || 'The mesh worker could not start.')
    worker.postMessage(project)
    return () => worker.terminate()
  }, [project])
  useEffect(() => {
    if (!result || !host.current) return
    const el = host.current, scene = new THREE.Scene(); scene.background = new THREE.Color('#11161c')
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch { setViewError('3D preview requires WebGL. Your validated mesh is still available to export.'); return }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); el.appendChild(renderer.domElement)
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(result.indices, 1)); geometry.computeVertexNormals(); geometry.computeBoundingBox()
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3()); geometry.translate(-center.x, -center.y, -center.z)
    const material = new THREE.MeshStandardMaterial({ color: '#b0c49b', roughness: .65, metalness: .1, flatShading: true })
    const object = new THREE.Mesh(geometry, material); scene.add(object)
    const edgesGeometry = new THREE.EdgesGeometry(geometry, 40), edgeMaterial = new THREE.LineBasicMaterial({ color: '#4d6351', transparent: true, opacity: .3 }); scene.add(new THREE.LineSegments(edgesGeometry, edgeMaterial))
    const radius = geometry.boundingBox!.getSize(new THREE.Vector3()).length() * .9
    const camera = new THREE.PerspectiveCamera(40, 1, .01, radius * 30); camera.up.set(0, 0, 1); camera.position.set(radius * .75, -radius, radius * .9)
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = radius * .1; controls.maxDistance = radius * 10; controls.update()
    scene.add(new THREE.HemisphereLight('#f0ffe7', '#283b52', 2.4))
    const light = new THREE.DirectionalLight('#ffffff', 3); light.position.set(radius, -radius, radius * 2); scene.add(light)
    const bottomLight = new THREE.DirectionalLight('#b4cdf0', 2); bottomLight.position.set(-radius, radius, -radius); scene.add(bottomLight)
    sceneAPI.current = { camera, controls, radius }
    const resize = new ResizeObserver(() => { const { width, height } = el.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix() }); resize.observe(el)
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
    return () => { sceneAPI.current = null; resize.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); geometry.dispose(); material.dispose(); edgesGeometry.dispose(); edgeMaterial.dispose(); renderer.dispose(); renderer.domElement.remove() }
  }, [result])
  function view(side: 'top' | 'bottom' | 'iso') {
    const api = sceneAPI.current; if (!api) return
    const r = api.radius; api.camera.position.set(side === 'iso' ? r * .75 : 0, side === 'iso' ? -r : -.001, side === 'bottom' ? -r * 1.5 : side === 'top' ? r * 1.5 : r * .9); api.controls.target.set(0, 0, 0); api.controls.update()
  }
  return <div className="mesh-preview"><div className="mesh-viewport" ref={host}>{!result && !error && <div className="mesh-message"><LoaderCircle className="spin" size={24} /><strong>Building your plate</strong><span>Recesses, tape paths, and pin holes.</span></div>}{error && <div className="mesh-message mesh-error"><Box size={26} /><strong>Mesh needs attention</strong><p>{error}</p></div>}{viewError && <div className="mesh-message"><p>{viewError}</p></div>}{result && !viewError && <div className="mesh-views"><Button variant="outline" size="sm" onClick={() => view('top')}><ArrowUp size={13} />Top</Button><Button variant="outline" size="sm" onClick={() => view('bottom')}><ArrowDown size={13} />Bottom</Button><Button variant="outline" size="sm" onClick={() => view('iso')}><Rotate3D size={13} />Orbit</Button></div>}</div><div className="mesh-footer"><div><strong>{result ? `${result.triangles.toLocaleString()} triangles · ${(result.volume / 1000).toFixed(2)} cm³` : 'One plate · two faces'}</strong><span>STL coordinates are in millimeters. Slice with mm units.</span></div><Button disabled={!result} onClick={() => result && download(binarySTL(result), `${fileName(project.metadata.name)}.stl`, 'model/stl')}><Download size={15} /> Export STL</Button></div></div>
}
