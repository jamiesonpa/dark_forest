import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import * as THREE from 'three'
import targetShipFbxUrl from '../../../target_ship.fbx?url'

interface TargetShipProps {
  position: [number, number, number]
}

export function TargetShip({ position }: TargetShipProps) {
  const sourceModel = useLoader(FBXLoader, targetShipFbxUrl) as THREE.Group

  const model = useMemo(() => {
    const clone = sourceModel.clone(true)
    const bounds = new THREE.Box3().setFromObject(clone)
    const center = new THREE.Vector3()
    bounds.getCenter(center)
    clone.position.sub(center)

    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = true
      child.receiveShadow = true
      if (Array.isArray(child.material)) {
        child.material = child.material.map((mat) => mat.clone())
      } else if (child.material) {
        child.material = child.material.clone()
      }
    })

    return clone
  }, [sourceModel])

  return (
    <group position={position}>
      <primitive object={model} />
    </group>
  )
}
