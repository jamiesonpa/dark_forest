import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import {
  B_SCOPE_AZ_LIMIT_DEG,
  bScopeRadarDetectionRangeM,
} from '@/systems/ew/bScopeConstants'

const CONE_HALF_RAD = THREE.MathUtils.degToRad(B_SCOPE_AZ_LIMIT_DEG)
const TAN_ALPHA = Math.tan(CONE_HALF_RAD)
const WEDGE_SEGMENTS = 48

const _forward = new THREE.Vector3()
const _negForward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _basis = new THREE.Matrix4()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Build a BufferGeometry for the "vertically sliced" cone.
 *
 * The full cone has its axis along local +Y (tip at +Y, base at -Y).
 * A point on the base at polar angle θ maps to world-space azimuth via:
 *   az = atan(tan(α) · sin(θ))
 * where α is the cone half-angle.
 *
 * The kept surface is where azMin ≤ az(θ) ≤ azMax, which produces
 * two arcs centred at θ=0 (top) and θ=π (bottom), plus flat faces
 * on the two cutting planes.
 */
function buildWedgeGeometry(
  azMinDeg: number,
  azMaxDeg: number,
  coneLengthM: number
): THREE.BufferGeometry {
  const azMinRad = THREE.MathUtils.degToRad(azMinDeg)
  const azMaxRad = THREE.MathUtils.degToRad(azMaxDeg)

  const kMin = Math.max(-1, Math.min(1, Math.tan(azMinRad) / TAN_ALPHA))
  const kMax = Math.max(-1, Math.min(1, Math.tan(azMaxRad) / TAN_ALPHA))

  const thetaRight = Math.asin(kMax)
  const thetaLeft = Math.asin(-kMin)

  const coneRadius = TAN_ALPHA * coneLengthM
  const tipY = coneLengthM / 2
  const baseY = -coneLengthM / 2

  const positions: number[] = []
  const indices: number[] = []

  function addArc(tStart: number, tEnd: number) {
    const span = tEnd - tStart
    if (span <= 1e-6) return
    const segs = Math.max(2, Math.round(WEDGE_SEGMENTS * (span / (2 * Math.PI))))
    const base = positions.length / 3

    positions.push(0, tipY, 0)

    for (let i = 0; i <= segs; i++) {
      const theta = tStart + (i / segs) * span
      positions.push(coneRadius * Math.sin(theta), baseY, coneRadius * Math.cos(theta))
    }

    for (let i = 0; i < segs; i++) {
      indices.push(base, base + 1 + i, base + 2 + i)
    }
  }

  // Arc A – near θ = 0 (top when viewed from behind the ship)
  addArc(2 * Math.PI - thetaLeft, 2 * Math.PI + thetaRight)

  // Arc B – near θ = π (bottom)
  addArc(Math.PI - thetaRight, Math.PI + thetaLeft)

  // Flat face on the right (starboard) cutting plane
  const trA = thetaRight
  const trB = Math.PI - thetaRight
  if (Math.abs(trA - trB) > 1e-6) {
    const b = positions.length / 3
    positions.push(0, tipY, 0)
    positions.push(coneRadius * Math.sin(trA), baseY, coneRadius * Math.cos(trA))
    positions.push(coneRadius * Math.sin(trB), baseY, coneRadius * Math.cos(trB))
    indices.push(b, b + 1, b + 2)
  }

  // Flat face on the left (port) cutting plane
  const tlA = 2 * Math.PI - thetaLeft
  const tlB = Math.PI + thetaLeft
  if (Math.abs(tlA - tlB) > 1e-6) {
    const b = positions.length / 3
    positions.push(0, tipY, 0)
    positions.push(coneRadius * Math.sin(tlA), baseY, coneRadius * Math.cos(tlA))
    positions.push(coneRadius * Math.sin(tlB), baseY, coneRadius * Math.cos(tlB))
    indices.push(b, b + 1, b + 2)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  return geo
}

export function BScopeRadarDebugCone() {
  const groupRef = useRef<THREE.Group>(null)
  const coneLengthRef = useRef(0)
  const showBScopeRadarCone = useGameStore((s) => s.showBScopeRadarCone)
  const azMin = useGameStore((s) => s.bScopeViewMinDeg)
  const azMax = useGameStore((s) => s.bScopeViewMaxDeg)
  const ewRadarPower = useGameStore((s) => s.ewRadarPower)
  const ewRadarPRF = useGameStore((s) => s.ewRadarPRF)

  const coneLengthM = useMemo(
    () => bScopeRadarDetectionRangeM(ewRadarPower, ewRadarPRF),
    [ewRadarPower, ewRadarPRF]
  )
  coneLengthRef.current = coneLengthM

  const geometry = useMemo(
    () => buildWedgeGeometry(azMin, azMax, coneLengthM),
    [azMin, azMax, coneLengthM]
  )

  useEffect(() => {
    return () => { geometry.dispose() }
  }, [geometry])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const ship = useGameStore.getState().ship
    const headingRad = THREE.MathUtils.degToRad(ship.actualHeading)
    const inclinationRad = THREE.MathUtils.degToRad(ship.actualInclination)
    const cosInc = Math.cos(inclinationRad)

    _forward
      .set(-Math.sin(headingRad) * cosInc, Math.sin(inclinationRad), Math.cos(headingRad) * cosInc)
      .normalize()

    _right.crossVectors(WORLD_UP, _forward)
    if (_right.lengthSq() < 1e-8) {
      _right.set(1, 0, 0)
    } else {
      _right.normalize()
    }
    _up.crossVectors(_forward, _right).normalize()

    _negForward.copy(_forward).negate()
    // WORLD_UP × _forward points PORT in this game's heading convention
    // (starboard = -X when heading=0°/facing+Z). Negate both right and up to
    // flip the azimuth X-axis to starboard while keeping the basis right-handed.
    _right.negate()
    _up.negate()
    _basis.makeBasis(_right, _negForward, _up)
    _quat.setFromRotationMatrix(_basis)

    _pos
      .set(ship.position[0], ship.position[1], ship.position[2])
      .addScaledVector(_forward, coneLengthRef.current * 0.5)

    group.position.copy(_pos)
    group.quaternion.copy(_quat)
  })

  if (!showBScopeRadarCone) return null

  return (
    <group ref={groupRef} frustumCulled={false}>
      <mesh renderOrder={997} geometry={geometry} frustumCulled={false}>
        <meshBasicMaterial
          color={0x44ff66}
          transparent
          opacity={0.09}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
