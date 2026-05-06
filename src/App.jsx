import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom, ChromaticAberration, Noise, SMAA } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { Vector2 } from 'three'
import InstancedGrid from './components/InstancedGrid'

export default function App() {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [0, 15, 10], fov: 55, near: 0.1, far: 200 }}
      style={{ background: '#000000' }}
    >
      <color attach="background" args={['#000000']} />
      <InstancedGrid />

      <EffectComposer>
        <Bloom
          intensity={2.0}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.025}
          radius={0.5}
        />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new Vector2(0.0005, 0.0005)}
        />
        <Noise
          blendFunction={BlendFunction.SOFT_LIGHT}
          opacity={0.08}
        />
        <SMAA />
      </EffectComposer>
    </Canvas>
  )
}
