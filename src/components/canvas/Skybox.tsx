import { useEffect } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EXRLoader } from 'three-stdlib'
import skyboxTextureUrl from '../../../starmap_2020_8k.exr'

export function Skybox() {
  const { scene } = useThree()
  const texture = useLoader(EXRLoader, skyboxTextureUrl)

  useEffect(() => {
    const previousBackground = scene.background
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.LinearSRGBColorSpace
    scene.background = texture

    return () => {
      scene.background = previousBackground
    }
  }, [scene, texture])

  return null
}
