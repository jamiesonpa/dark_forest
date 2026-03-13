import { useEffect, useRef, useState } from 'react'
import { ShipStatusPrototype } from './ShipStatusPrototype'
import { ShipAttitudePanel } from './ShipAttitudePanel'
import { IRSTView } from './IRSTView'
import { EngineeringPanel } from './EngineeringPanel'
import { RWRDisplay } from './RWRDisplay'
import { useGameStore } from '@/state/gameStore'

export function HUD() {
  const debugPivotEnabled = useGameStore((s) => s.debugPivotEnabled)
  const setDebugPivotEnabled = useGameStore((s) => s.setDebugPivotEnabled)
  const showIRSTCone = useGameStore((s) => s.showIRSTCone)
  const setShowIRSTCone = useGameStore((s) => s.setShowIRSTCone)
  const setShipState = useGameStore((s) => s.setShipState)
  const capacitorMax = useGameStore((s) => s.ship.capacitorMax)
  const pivotPosition = useGameStore((s) => s.debugPivotPosition)
  const asteroidBeltThickness = useGameStore((s) => s.asteroidBeltThickness)
  const asteroidBeltJitter = useGameStore((s) => s.asteroidBeltJitter)
  const asteroidBeltDensity = useGameStore((s) => s.asteroidBeltDensity)
  const asteroidBeltArcLength = useGameStore((s) => s.asteroidBeltArcLength)
  const asteroidBeltRadius = useGameStore((s) => s.asteroidBeltRadius)
  const asteroidBeltMinSize = useGameStore((s) => s.asteroidBeltMinSize)
  const asteroidBeltMaxSize = useGameStore((s) => s.asteroidBeltMaxSize)
  const setAsteroidBeltSettings = useGameStore((s) => s.setAsteroidBeltSettings)
  const spawnAsteroidBelt = useGameStore((s) => s.spawnAsteroidBelt)
  const [perf, setPerf] = useState({ fps: 0, avgFps: 0, frameMs: 0 })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    let lastFrameAt = performance.now()
    let publishAt = lastFrameAt
    let sampleFrames = 0
    let sampleElapsedMs = 0

    const measureFps = (now: number) => {
      const deltaMs = Math.max(0.0001, now - lastFrameAt)
      lastFrameAt = now
      sampleFrames += 1
      sampleElapsedMs += deltaMs

      // Publish 10 times/second so we can see changes quickly.
      if (now - publishAt >= 100) {
        const instantFps = 1000 / deltaMs
        const averageFps = (sampleFrames * 1000) / sampleElapsedMs
        setPerf({
          fps: instantFps,
          avgFps: averageFps,
          frameMs: deltaMs,
        })

        publishAt = now
        sampleFrames = 0
        sampleElapsedMs = 0
      }

      rafRef.current = requestAnimationFrame(measureFps)
    }

    rafRef.current = requestAnimationFrame(measureFps)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="hud-container">
      <div className="hud-top-left">
        <IRSTView />
      </div>
      <div className="hud-left-eng">
        <EngineeringPanel />
      </div>
      <div className="hud-bottom">
        <div className="hud-bottom-status-row">
          <ShipStatusPrototype />
        </div>
      </div>
      <div className="hud-nav-solution-bottom-right">
        <ShipAttitudePanel />
      </div>
      <div className="hud-bottom-right">
        <RWRDisplay />
      </div>
      <div className="hud-debug-panel hud-panel">
        <button
          type="button"
          className={`hud-debug-toggle ${debugPivotEnabled ? 'active' : ''}`}
          onClick={() => setDebugPivotEnabled(!debugPivotEnabled)}
        >
          DBG
        </button>
        {debugPivotEnabled && (
          <div className="hud-debug-values">
            <div className="hud-debug-row">
              <span className="hud-debug-axis">X</span>
              <span className="hud-debug-value">{pivotPosition[0].toFixed(2)}</span>
            </div>
            <div className="hud-debug-row">
              <span className="hud-debug-axis">Y</span>
              <span className="hud-debug-value">{pivotPosition[1].toFixed(2)}</span>
            </div>
            <div className="hud-debug-row">
              <span className="hud-debug-axis">Z</span>
              <span className="hud-debug-value">{pivotPosition[2].toFixed(2)}</span>
            </div>
            <div className="hud-debug-row">
              <span className="hud-debug-axis">FPS</span>
              <span className="hud-debug-value">{perf.fps.toFixed(1)}</span>
            </div>
            <div className="hud-debug-row">
              <span className="hud-debug-axis">AVG</span>
              <span className="hud-debug-value">{perf.avgFps.toFixed(1)}</span>
            </div>
            <div className="hud-debug-row">
              <span className="hud-debug-axis">MS</span>
              <span className="hud-debug-value">{perf.frameMs.toFixed(2)}</span>
            </div>
            <button
              type="button"
              className={`hud-debug-toggle ${showIRSTCone ? 'active' : ''}`}
              onClick={() => setShowIRSTCone(!showIRSTCone)}
            >
              SHOW IRST CONE
            </button>
            <button
              type="button"
              className="hud-debug-spawn-roids"
              onClick={spawnAsteroidBelt}
            >
              SPAWN ROIDS
            </button>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                THICK
                <span className="hud-debug-slider-value">{Math.round(asteroidBeltThickness)}</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={50}
                max={2500}
                step={25}
                value={asteroidBeltThickness}
                onChange={(event) =>
                  setAsteroidBeltSettings({ thickness: Number(event.target.value) })
                }
              />
            </div>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                RADIUS
                <span className="hud-debug-slider-value">{Math.round(asteroidBeltRadius)}</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={2000}
                max={80000}
                step={200}
                value={asteroidBeltRadius}
                onChange={(event) =>
                  setAsteroidBeltSettings({ radius: Number(event.target.value) })
                }
              />
            </div>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                JITTER
                <span className="hud-debug-slider-value">{Math.round(asteroidBeltJitter)}</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={0}
                max={3000}
                step={25}
                value={asteroidBeltJitter}
                onChange={(event) =>
                  setAsteroidBeltSettings({ jitter: Number(event.target.value) })
                }
              />
            </div>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                DENS
                <span className="hud-debug-slider-value">{asteroidBeltDensity.toFixed(1)}</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={0.1}
                max={12}
                step={0.1}
                value={asteroidBeltDensity}
                onChange={(event) =>
                  setAsteroidBeltSettings({ density: Number(event.target.value) })
                }
              />
            </div>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                SIZE MIN
                <span className="hud-debug-slider-value">{Math.round(asteroidBeltMinSize)}</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={4}
                max={400}
                step={1}
                value={asteroidBeltMinSize}
                onChange={(event) =>
                  setAsteroidBeltSettings({ sizeMin: Number(event.target.value) })
                }
              />
            </div>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                SIZE MAX
                <span className="hud-debug-slider-value">{Math.round(asteroidBeltMaxSize)}</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={6}
                max={500}
                step={1}
                value={asteroidBeltMaxSize}
                onChange={(event) =>
                  setAsteroidBeltSettings({ sizeMax: Number(event.target.value) })
                }
              />
            </div>
            <div className="hud-debug-slider-group">
              <label className="hud-debug-slider-label">
                ARC
                <span className="hud-debug-slider-value">{Math.round(asteroidBeltArcLength)}°</span>
              </label>
              <input
                className="hud-debug-slider"
                type="range"
                min={20}
                max={360}
                step={5}
                value={asteroidBeltArcLength}
                onChange={(event) =>
                  setAsteroidBeltSettings({ arcLength: Number(event.target.value) })
                }
              />
            </div>
            <button
              type="button"
              className="hud-debug-reset"
              onClick={() =>
                setShipState({
                  position: [0, 0, 0],
                  targetSpeed: 0,
                  actualSpeed: 0,
                  bearing: 0,
                  actualHeading: 0,
                  inclination: 0,
                  actualInclination: 0,
                  rollAngle: 0,
                  mwdActive: false,
                  mwdRemaining: 0,
                  mwdCooldownRemaining: 0,
                })
              }
            >
              RESET
            </button>
            <button
              type="button"
              className="hud-debug-reset"
              onClick={() => setShipState({ capacitor: capacitorMax })}
            >
              CAP FULL
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
