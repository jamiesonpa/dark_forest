import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Effect, BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'

/**
 * Screen-space distortion radius for the warp anomaly.
 * Expressed in world units; the screen-space radius is derived from camera distance.
 */
const WARP_VISUAL_RADIUS_WORLD = 600

const fragmentShader = /* glsl */ `
uniform vec2 uCenter;
uniform float uRadius;
uniform float uStrength;
uniform float uTime;
uniform float uActive;
uniform float uKind;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uActive < 0.5) {
    outputColor = inputColor;
    return;
  }

  float aspect = resolution.x / resolution.y;
  vec2 delta = uv - uCenter;
  delta.x *= aspect;
  float dist = length(delta);

  if (dist > uRadius * 1.6) {
    outputColor = inputColor;
    return;
  }

  float t = clamp(dist / uRadius, 0.0, 1.0);
  float falloff = 1.0 - t;
  falloff = falloff * falloff * (3.0 - 2.0 * falloff);

  float angle = atan(delta.y, delta.x);

  float ripple1 = sin(dist * 55.0 - uTime * 3.5) * 0.14;
  float ripple2 = sin(dist * 28.0 + uTime * 2.0) * 0.09;
  float ripple3 = sin(angle * 5.0 + uTime * 1.6) * 0.07;
  float ripple = ripple1 + ripple2 + ripple3;

  float pulse = 0.82 + 0.18 * sin(uTime * 2.0);

  float distortMag = uStrength * falloff * pulse * (1.0 + ripple);

  float spiralPhase = dist * 18.0 - uTime * 2.8;
  float tangentialMag = distortMag * 0.35 * sin(spiralPhase);

  float radialSign = uKind < 0.5 ? -1.0 : 1.0;

  vec2 radialDir = normalize(delta + vec2(1e-5));
  vec2 tangentialDir = vec2(-radialDir.y, radialDir.x);

  vec2 totalDistortion = radialDir * distortMag * radialSign
                       + tangentialDir * tangentialMag;
  totalDistortion.x /= aspect;

  float chromatic = distortMag * 0.35 * falloff;
  vec2 chromDir = radialDir;
  chromDir.x /= aspect;

  float r = texture2D(inputBuffer, uv + totalDistortion + chromDir * chromatic).r;
  float g = texture2D(inputBuffer, uv + totalDistortion).g;
  float b = texture2D(inputBuffer, uv + totalDistortion - chromDir * chromatic).b;

  float glowMask = exp(-dist * dist / (uRadius * uRadius * 0.08)) * 0.12 * pulse;
  vec3 glowColor = uKind < 0.5
    ? vec3(1.0, 0.72, 0.22)
    : vec3(0.28, 0.52, 1.0);

  vec3 finalColor = vec3(r, g, b) + glowColor * glowMask;

  outputColor = vec4(finalColor, 1.0);
}
`

class SpacetimeWarpEffectImpl extends Effect {
  constructor() {
    super('SpacetimeWarpEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uRadius', new THREE.Uniform(0.12)],
        ['uStrength', new THREE.Uniform(0.04)],
        ['uTime', new THREE.Uniform(0)],
        ['uActive', new THREE.Uniform(0)],
        ['uKind', new THREE.Uniform(0)],
      ]),
    })
  }
}

const _worldPos = new THREE.Vector3()

export const RdneSpacetimeWarpEffect = forwardRef<Effect>(function RdneSpacetimeWarpEffect(_, ref) {
  const effect = useMemo(() => new SpacetimeWarpEffectImpl(), [])
  const internalRef = useRef<Effect>(effect)

  useFrame(({ camera, clock }) => {
    const uniforms = effect.uniforms
    const rdneField = useGameStore.getState().ewRdneFieldEffect
    const time = clock.elapsedTime

    if (!rdneField) {
      uniforms.get('uActive')!.value = 0
      return
    }

    const ship = useGameStore.getState().shipsById[rdneField.targetId]
    if (!ship) {
      uniforms.get('uActive')!.value = 0
      return
    }

    _worldPos.set(
      ship.position[0] + rdneField.worldOffset[0],
      ship.position[1] + rdneField.worldOffset[1],
      ship.position[2] + rdneField.worldOffset[2],
    )

    const camDist = camera.position.distanceTo(_worldPos)

    _worldPos.project(camera)

    if (_worldPos.z > 1 || _worldPos.z < -1) {
      uniforms.get('uActive')!.value = 0
      return
    }

    const screenX = (_worldPos.x + 1) * 0.5
    const screenY = (_worldPos.y + 1) * 0.5

    const fovRad = ((camera as THREE.PerspectiveCamera).fov ?? 60) * THREE.MathUtils.DEG2RAD
    const screenRadius = WARP_VISUAL_RADIUS_WORLD / (2 * camDist * Math.tan(fovRad * 0.5))
    const clampedRadius = Math.max(0.02, Math.min(screenRadius, 0.35))

    uniforms.get('uActive')!.value = 1
    uniforms.get('uTime')!.value = time
    uniforms.get('uKind')!.value = rdneField.kind === 'source' ? 1 : 0
    ;(uniforms.get('uCenter')!.value as THREE.Vector2).set(screenX, screenY)
    uniforms.get('uRadius')!.value = clampedRadius

    const baseStrength = 0.025 + rdneField.intensity * 0.035
    uniforms.get('uStrength')!.value = baseStrength
  })

  return <primitive ref={ref ?? internalRef} object={effect} dispose={null} />
})
