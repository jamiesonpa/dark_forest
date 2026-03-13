import { Canvas, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { StarSystem } from './StarSystem'

function MainCameraSetup() {
  const { camera } = useThree()
  camera.layers.set(0)
  camera.layers.enable(2)
  return null
}

export function GameCanvas() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        gl={{ antialias: true, alpha: false, logarithmicDepthBuffer: true }}
        camera={{ position: [0, 0, 500], fov: 60, near: 50, far: 20000000 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.58
        }}
      >
        <MainCameraSetup />
        <StarSystem />
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={2.6}
            luminanceThreshold={0.03}
            luminanceSmoothing={0.25}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
