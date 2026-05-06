import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// ─── Grid constants ────────────────────────────────────────────────────────────
const GRID_SIZE   = 50
const COUNT       = GRID_SIZE * GRID_SIZE
const SPACING     = 1.05
const HALF_GRID   = (GRID_SIZE * SPACING) / 2
const MEDIAN_Y    = 0.35
const RADIUS      = 1.8
const RISE_HEIGHT = 1.5
const LERP_UP     = 0.18
const SPRING_K    = 0.22
const SPRING_D    = 0.55
const EPSILON_V   = 0.001
const EPSILON_D   = 0.001
const RH          = RISE_HEIGHT.toFixed(2)

// ─── Build material ────────────────────────────────────────────────────────────
// We declare vUv ourselves (v_uv) since MeshStandard only declares it
// when map/normalMap etc. are set. We use 'uv' attribute from BoxGeometry.
function makeMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    metalness: 0.9,
    roughness: 0.1,
  })

  mat.onBeforeCompile = (shader) => {
    // ── Vertex shader ──────────────────────────────────────────────────────────
    // Declare our custom attribute + varyings
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float a_dynY;
varying  float v_dynY;
varying  vec2  v_uv;`
      )
      // #include <begin_vertex> sets `transformed = position` — inject right after
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed.y += a_dynY;
v_dynY = a_dynY;
v_uv   = uv;`
      )

    // ── Fragment shader ────────────────────────────────────────────────────────
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float v_dynY;
varying vec2  v_uv;`
      )
      // #include <opaque_fragment> is the modern replacement for output_fragment
      .replace(
        '#include <opaque_fragment>',
        `{
  // Procedural edge glow — circuit trace on cube face edges
  float edge = step(0.86, max(abs(v_uv.x - 0.5), abs(v_uv.y - 0.5)) * 2.0);
  float t    = clamp(v_dynY / ${RH}, 0.0, 1.0);
  float I    = pow(t, 2.0) * edge;
  // #FF6600 = rgb(1.0, 0.4, 0.0)
  outgoingLight += vec3(1.0, 0.4, 0.0) * I * 5.0;
}
#include <opaque_fragment>`
      )
  }

  mat.customProgramCacheKey = () => 'circuit-grid-v4'
  return mat
}

// ─── Invisible plane material — only created once ──────────────────────────────
// transparent:true + opacity:0 keeps the mesh renderable-to-raycast
// without affecting the post-processing framebuffer
const PLANE_MATERIAL = new THREE.MeshBasicMaterial({
  colorWrite:   false,
  depthWrite:   false,
  transparent:  true,
  opacity:      0,
})

// ─── Component ─────────────────────────────────────────────────────────────────
export default function InstancedGrid() {
  const { invalidate } = useThree()
  const meshRef = useRef(null)

  const baseHeights   = useMemo(() => new Float32Array(COUNT), [])
  const dynOffsets    = useMemo(() => new Float32Array(COUNT), [])
  const velocities    = useMemo(() => new Float32Array(COUNT), [])
  const targetOffsets = useMemo(() => new Float32Array(COUNT), [])

  const activeSet  = useRef(new Set())
  const pointerHit = useRef(null)
  const dummy      = useMemo(() => new THREE.Object3D(), [])

  const geometry = useMemo(() => new THREE.BoxGeometry(0.9, 1, 0.9), [])
  const material = useMemo(() => makeMaterial(), [])

  const dynAttr = useMemo(() => {
    const attr = new THREE.InstancedBufferAttribute(dynOffsets, 1)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }, [dynOffsets])

  // ── One-time init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    for (let i = 0; i < COUNT; i++) {
      const col = i % GRID_SIZE
      const row = Math.floor(i / GRID_SIZE)
      const x   = col * SPACING - HALF_GRID
      const z   = row * SPACING - HALF_GRID
      const y   = (Math.random() * 0.8 - 0.4) + Math.random() * 0.0001
      baseHeights[i] = y

      dummy.position.set(x, y, z)
      dummy.scale.setScalar(1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    mesh.geometry.setAttribute('a_dynY', dynAttr)
    mesh.frustumCulled = false
  }, [baseHeights, dummy, dynAttr])

  // ── Pointer ───────────────────────────────────────────────────────────────
  const handlePointerMove = (e) => {
    e.stopPropagation()
    pointerHit.current = { x: e.point.x, z: e.point.z }
    invalidate()
  }

  const handlePointerLeave = () => { pointerHit.current = null }

  // ── Frame loop ────────────────────────────────────────────────────────────
  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const hit = pointerHit.current

    if (hit) {
      const cc    = Math.floor((hit.x + HALF_GRID) / SPACING)
      const cr    = Math.floor((hit.z + HALF_GRID) / SPACING)
      const cellR = Math.ceil(RADIUS / SPACING)

      for (let dr = -cellR; dr <= cellR; dr++) {
        for (let dc = -cellR; dc <= cellR; dc++) {
          const c = cc + dc, r = cr + dr
          if (c < 0 || c >= GRID_SIZE || r < 0 || r >= GRID_SIZE) continue
          const wx = c * SPACING - HALF_GRID
          const wz = r * SPACING - HALF_GRID
          if (Math.sqrt((wx - hit.x) ** 2 + (wz - hit.z) ** 2) <= RADIUS) {
            const idx = r * GRID_SIZE + c
            targetOffsets[idx] = RISE_HEIGHT
            activeSet.current.add(idx)
          }
        }
      }
    } else {
      activeSet.current.forEach((i) => { targetOffsets[i] = 0 })
    }

    const toRemove = []
    let anyDirty   = false

    activeSet.current.forEach((idx) => {
      const target = targetOffsets[idx]
      let cur = dynOffsets[idx], vel = velocities[idx]

      if (target > 0) {
        const prev = cur
        cur = cur + (target - cur) * LERP_UP
        vel = cur - prev
      } else {
        vel = (vel - SPRING_K * cur) * SPRING_D
        cur = cur + vel
        if (cur < 0) { cur = 0; vel = 0 }
      }

      dynOffsets[idx]  = cur
      velocities[idx]  = vel
      anyDirty         = true

      if (target === 0 && Math.abs(vel) < EPSILON_V && Math.abs(cur) < EPSILON_D) {
        dynOffsets[idx] = 0
        velocities[idx] = 0
        toRemove.push(idx)
        anyDirty = anyDirty // already set
      }
    })

    toRemove.forEach((i) => activeSet.current.delete(i))

    if (anyDirty || hit) dynAttr.needsUpdate = true
    if (activeSet.current.size > 0 || hit) invalidate()
  })

  return (
    <group>
      {/* Invisible raycasting plane */}
      <mesh
        position={[0, MEDIAN_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={PLANE_MATERIAL}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        renderOrder={-1}
      >
        <planeGeometry args={[GRID_SIZE * SPACING + 4, GRID_SIZE * SPACING + 4]} />
      </mesh>

      <instancedMesh
        ref={meshRef}
        args={[geometry, material, COUNT]}
        castShadow={false}
        receiveShadow={false}
      />
    </group>
  )
}
