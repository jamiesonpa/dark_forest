import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { ShipState } from '@/state/types'
import { getHullColliderOffsetForDebug, getShipHullDebugTemplate } from '@/systems/collision/collisionRegistry'

const HULL_EDGE_THRESHOLD = 18

const hullLineMaterial = new THREE.LineBasicMaterial({
  color: 0x44ffcc,
  transparent: true,
  opacity: 0.92,
  depthTest: true,
})

type ColliderDebugVisualizerProps = {
  shipEntries: [string, ShipState][]
}

export function ColliderDebugVisualizer({ shipEntries }: ColliderDebugVisualizerProps) {
  const show = useGameStore((s) => s.showColliderDebug)

  const shipsRootRef = useRef<THREE.Group>(null)
  const hullEdgesRef = useRef<THREE.EdgesGeometry | null>(null)
  const [hullTemplateSeen, setHullTemplateSeen] = useState(() => getShipHullDebugTemplate() !== null)

  const sortedShipPairs = useMemo(() => {
    return [...shipEntries]
      .filter(([, ship]) => ship.hull > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  }, [shipEntries])

  const shipIdsKey = useMemo(() => sortedShipPairs.map(([id]) => id).join('|'), [sortedShipPairs])

  useFrame(() => {
    if (!hullTemplateSeen && getShipHullDebugTemplate()) {
      setHullTemplateSeen(true)
    }
  })

  useLayoutEffect(() => {
    if (!show || !shipsRootRef.current) return
    const root = shipsRootRef.current
    const template = getShipHullDebugTemplate()
    while (root.children.length > 0) {
      root.remove(root.children[0]!)
    }
    hullEdgesRef.current?.dispose()
    hullEdgesRef.current = null
    if (!template || sortedShipPairs.length === 0) return

    hullEdgesRef.current = new THREE.EdgesGeometry(template, HULL_EDGE_THRESHOLD)
    const edges = hullEdgesRef.current
    const offset = getHullColliderOffsetForDebug()
    for (let si = 0; si < sortedShipPairs.length; si += 1) {
      const g = new THREE.Group()
      const inner = new THREE.Group()
      inner.position.set(offset[0], offset[1], offset[2])
      const hullLines = new THREE.LineSegments(edges, hullLineMaterial)
      hullLines.frustumCulled = false
      inner.add(hullLines)
      g.add(inner)
      root.add(g)
    }
  }, [show, shipIdsKey, hullTemplateSeen])

  useFrame(() => {
    if (!show || !shipsRootRef.current) return
    const root = shipsRootRef.current
    const n = Math.min(sortedShipPairs.length, root.children.length)
    for (let i = 0; i < n; i += 1) {
      const [, ship] = sortedShipPairs[i]!
      const g = root.children[i] as THREE.Group
      g.position.set(ship.position[0], ship.position[1], ship.position[2])
      g.rotation.set(
        THREE.MathUtils.degToRad(-ship.actualInclination),
        THREE.MathUtils.degToRad(-ship.actualHeading),
        THREE.MathUtils.degToRad(ship.rollAngle),
        'YXZ'
      )
    }
  })

  useEffect(() => {
    return () => {
      hullEdgesRef.current?.dispose()
      hullEdgesRef.current = null
    }
  }, [])

  if (!show) return null

  return (
    <group>
      <group ref={shipsRootRef} />
    </group>
  )
}
