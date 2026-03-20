import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import { registerShipHullFromObject } from '@/systems/collision/collisionRegistry'
import { ensureRapierLoaded } from '@/systems/collision/ensureRapier'

const RAVEN_OBJ = '/models/caldari_battleship_Raven.obj'

/**
 * Loads the player hull once and registers Rapier trimesh data for mesh collisions (matches PlayerShip centering).
 */
export function CollisionHullBootstrap() {
  const obj = useLoader(OBJLoader, RAVEN_OBJ)
  const { centeredClone, visualOriginCorrection } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(obj)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const shipCenterOffset: [number, number, number] = [-center.x, -center.y, -center.z]
    const clone = obj.clone(true)
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      if (!child.geometry) return
      child.geometry = child.geometry.clone()
      child.geometry.translate(shipCenterOffset[0], shipCenterOffset[1], shipCenterOffset[2])
    })
    clone.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(clone)
    const c2 = new THREE.Vector3()
    b2.getCenter(c2)
    const visualOriginCorrection: [number, number, number] = [-c2.x, -c2.y, -c2.z]
    return { centeredClone: clone, visualOriginCorrection }
  }, [obj])

  useEffect(() => {
    void ensureRapierLoaded().then(() => {
      registerShipHullFromObject(centeredClone, visualOriginCorrection)
    })
  }, [centeredClone, visualOriginCorrection])

  return null
}
