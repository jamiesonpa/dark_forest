import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '@/state/gameStore'

export function DebugSettingsWindow() {
  const debugPivotEnabled = useGameStore((s) => s.debugPivotEnabled)
  const setDebugPivotEnabled = useGameStore((s) => s.setDebugPivotEnabled)
  const orientDebugEnabled = useGameStore((s) => s.orientDebugEnabled)
  const setOrientDebugEnabled = useGameStore((s) => s.setOrientDebugEnabled)
  const showIRSTCone = useGameStore((s) => s.showIRSTCone)
  const setShowIRSTCone = useGameStore((s) => s.setShowIRSTCone)
  const showBScopeRadarCone = useGameStore((s) => s.showBScopeRadarCone)
  const setShowBScopeRadarCone = useGameStore((s) => s.setShowBScopeRadarCone)
  const showColliderDebug = useGameStore((s) => s.showColliderDebug)
  const setShowColliderDebug = useGameStore((s) => s.setShowColliderDebug)
  const unlimitAaOrbitZoomOut = useGameStore((s) => s.unlimitAaOrbitZoomOut)
  const setUnlimitAaOrbitZoomOut = useGameStore((s) => s.setUnlimitAaOrbitZoomOut)
  const showCelestialGridCenterMarker = useGameStore((s) => s.showCelestialGridCenterMarker)
  const setShowCelestialGridCenterMarker = useGameStore((s) => s.setShowCelestialGridCenterMarker)
  const setShipState = useGameStore((s) => s.setShipState)
  const starSystem = useGameStore((s) => s.starSystem)
  const capacitorMax = useGameStore((s) => s.ship.capacitorMax)
  const shield = useGameStore((s) => s.ship.shield)
  const shieldMax = useGameStore((s) => s.ship.shieldMax)
  const pivotPosition = useGameStore((s) => s.debugPivotPosition)
  const npcSpawnPosition = useGameStore((s) => s.npcSpawnPosition)
  const setNpcSpawnPosition = useGameStore((s) => s.setNpcSpawnPosition)
  const spawnNpcShip = useGameStore((s) => s.spawnNpcShip)
  const clearNpcShips = useGameStore((s) => s.clearNpcShips)
  const debugAsteroids = useGameStore((s) => s.debugAsteroids)
  const debugAsteroidSpawnOffset = useGameStore((s) => s.debugAsteroidSpawnOffset)
  const setDebugAsteroidSpawnOffset = useGameStore((s) => s.setDebugAsteroidSpawnOffset)
  const debugAsteroidDefaultScale = useGameStore((s) => s.debugAsteroidDefaultScale)
  const setDebugAsteroidDefaultScale = useGameStore((s) => s.setDebugAsteroidDefaultScale)
  const debugAsteroidRandomizeScale = useGameStore((s) => s.debugAsteroidRandomizeScale)
  const setDebugAsteroidRandomizeScale = useGameStore((s) => s.setDebugAsteroidRandomizeScale)
  const spawnDebugAsteroid = useGameStore((s) => s.spawnDebugAsteroid)
  const clearDebugAsteroids = useGameStore((s) => s.clearDebugAsteroids)
  const removeDebugAsteroid = useGameStore((s) => s.removeDebugAsteroid)
  const removeNpcShip = useGameStore((s) => s.removeNpcShip)
  const setNpcShipConfig = useGameStore((s) => s.setNpcShipConfig)
  const npcShips = useGameStore((s) => s.npcShips)
  const randomizePlanetTextures = useGameStore((s) => s.randomizePlanetTextures)
  const revealEwCelestial = useGameStore((s) => s.revealEwCelestial)
  const cancelEwGravAnalysis = useGameStore((s) => s.cancelEwGravAnalysis)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const shipsById = useGameStore((s) => s.shipsById)

  const [perf, setPerf] = useState({ fps: 0, avgFps: 0, frameMs: 0 })
  const [debugAstModel, setDebugAstModel] = useState('')
  const [remoteActivityMs, setRemoteActivityMs] = useState<Record<string, number>>({})
  const [remoteNowMs, setRemoteNowMs] = useState(() => Date.now())
  const rafRef = useRef<number | null>(null)
  const prevRemotePositionsRef = useRef<Record<string, [number, number, number]>>({})
  const playerIds = useMemo(() => Object.keys(shipsById), [shipsById])
  const remotePlayerIds = useMemo(
    () => playerIds.filter((id) => id !== localPlayerId),
    [playerIds, localPlayerId]
  )

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

  useEffect(() => {
    const nextPrev = { ...prevRemotePositionsRef.current }
    const nextActivity = { ...remoteActivityMs }
    let activityChanged = false

    remotePlayerIds.forEach((id) => {
      const ship = shipsById[id]
      if (!ship) return
      const prev = prevRemotePositionsRef.current[id]
      const curr = ship.position
      if (!prev) {
        nextActivity[id] = Date.now()
        activityChanged = true
      } else {
        const moved = Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2])
        if (moved > 0.01) {
          nextActivity[id] = Date.now()
          activityChanged = true
        }
      }
      nextPrev[id] = [curr[0], curr[1], curr[2]]
    })

    Object.keys(nextPrev).forEach((id) => {
      if (!remotePlayerIds.includes(id)) delete nextPrev[id]
    })
    Object.keys(nextActivity).forEach((id) => {
      if (!remotePlayerIds.includes(id)) {
        delete nextActivity[id]
        activityChanged = true
      }
    })

    prevRemotePositionsRef.current = nextPrev
    if (activityChanged) {
      setRemoteActivityMs(nextActivity)
    }
  }, [remotePlayerIds, shipsById, remoteActivityMs])

  useEffect(() => {
    const timer = window.setInterval(() => setRemoteNowMs(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const npcIds = useMemo(() => Object.keys(npcShips), [npcShips])

  const updateNpcSpawnAxis = (axisIndex: 0 | 1 | 2, value: string) => {
    const parsed = Number(value)
    const next = [...npcSpawnPosition] as [number, number, number]
    next[axisIndex] = Number.isFinite(parsed) ? parsed : 0
    setNpcSpawnPosition(next)
  }

  const updateDebugAsteroidOffsetAxis = (axisIndex: 0 | 1 | 2, value: string) => {
    const parsed = Number(value)
    const next = [...debugAsteroidSpawnOffset] as [number, number, number]
    next[axisIndex] = Number.isFinite(parsed) ? parsed : 0
    setDebugAsteroidSpawnOffset(next)
  }

  return (
    <div className="hud-debug-values">
      <button
        type="button"
        className={`hud-debug-toggle ${debugPivotEnabled ? 'active' : ''}`}
        onClick={() => setDebugPivotEnabled(!debugPivotEnabled)}
      >
        PIVOT DEBUG
      </button>
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
      <div className="hud-debug-row">
        <span className="hud-debug-axis">PLAYERS</span>
        <span className="hud-debug-value">{playerIds.length}</span>
      </div>
      <div className="hud-debug-row">
        <span className="hud-debug-axis">REMOTE</span>
        <span className="hud-debug-value">{remotePlayerIds.length}</span>
      </div>
      <div className="hud-debug-row">
        <span className="hud-debug-axis">LOCAL ID</span>
        <span className="hud-debug-value">{localPlayerId.slice(0, 8) || '-'}</span>
      </div>
      <div className="hud-debug-row">
        <span className="hud-debug-axis">ROOM IDS</span>
        <span className="hud-debug-value">
          {playerIds.length > 0 ? playerIds.map((id) => id.slice(0, 8)).join(', ') : '-'}
        </span>
      </div>
      {remotePlayerIds.map((id) => {
        const ship = shipsById[id]
        const activityMs = remoteActivityMs[id]
        const ageSec = activityMs ? (remoteNowMs - activityMs) / 1000 : -1
        return (
          <div key={id} className="hud-debug-row">
            <span className="hud-debug-axis">{`R ${id.slice(0, 4)}`}</span>
            <span className="hud-debug-value">
              {ship
                ? `x:${ship.position[0].toFixed(1)} z:${ship.position[2].toFixed(1)} lastMove:${ageSec < 0 ? '-' : `${ageSec.toFixed(1)}s`}`
                : 'missing'}
            </span>
          </div>
        )
      })}
      <button
        type="button"
        className={`hud-debug-toggle ${orientDebugEnabled ? 'active' : ''}`}
        onClick={() => setOrientDebugEnabled(!orientDebugEnabled)}
      >
        ORIENT DEBUG
      </button>
      <button
        type="button"
        className={`hud-debug-toggle ${showIRSTCone ? 'active' : ''}`}
        onClick={() => setShowIRSTCone(!showIRSTCone)}
      >
        SHOW IRST CONE
      </button>
      <button
        type="button"
        className={`hud-debug-toggle ${showBScopeRadarCone ? 'active' : ''}`}
        onClick={() => setShowBScopeRadarCone(!showBScopeRadarCone)}
      >
        SHOW B-SCOPE CONE
      </button>
      <button
        type="button"
        className={`hud-debug-toggle ${showColliderDebug ? 'active' : ''}`}
        onClick={() => setShowColliderDebug(!showColliderDebug)}
      >
        SHOW COLLIDERS
      </button>
      <button
        type="button"
        className={`hud-debug-toggle ${unlimitAaOrbitZoomOut ? 'active' : ''}`}
        onClick={() => setUnlimitAaOrbitZoomOut(!unlimitAaOrbitZoomOut)}
      >
        UNLIMIT AA ORBIT ZOOM
      </button>
      <button
        type="button"
        className={`hud-debug-toggle ${showCelestialGridCenterMarker ? 'active' : ''}`}
        onClick={() => setShowCelestialGridCenterMarker(!showCelestialGridCenterMarker)}
      >
        SHOW GRID CENTER
      </button>
      <div className="hud-debug-row">
        <span className="hud-debug-axis">NPC SHIPS</span>
        <span className="hud-debug-value">{npcIds.length}</span>
      </div>
      <div className="hud-debug-target-pos">
        <label className="hud-debug-target-axis">
          X
          <input
            className="hud-debug-target-input"
            type="number"
            value={npcSpawnPosition[0]}
            onChange={(event) => updateNpcSpawnAxis(0, event.target.value)}
          />
        </label>
        <label className="hud-debug-target-axis">
          Y
          <input
            className="hud-debug-target-input"
            type="number"
            value={npcSpawnPosition[1]}
            onChange={(event) => updateNpcSpawnAxis(1, event.target.value)}
          />
        </label>
        <label className="hud-debug-target-axis">
          Z
          <input
            className="hud-debug-target-input"
            type="number"
            value={npcSpawnPosition[2]}
            onChange={(event) => updateNpcSpawnAxis(2, event.target.value)}
          />
        </label>
      </div>
      <div className="hud-debug-row">
        <span className="hud-debug-axis">DBG ROIDS</span>
        <span className="hud-debug-value">{debugAsteroids.length}</span>
      </div>
      <div className="hud-debug-target-pos">
        <span className="hud-debug-axis" style={{ gridColumn: '1 / -1', fontSize: '0.65rem', opacity: 0.85 }}>
          spawn: X = 2× scaled mesh radius · Y/Z from ship (world)
        </span>
        <label className="hud-debug-target-axis" title="X is set automatically when spawning (2 × scale × model radius)">
          X
          <span
            className="hud-debug-target-input"
            style={{ opacity: 0.75, cursor: 'default', display: 'flex', alignItems: 'center' }}
          >
            auto
          </span>
        </label>
        <label className="hud-debug-target-axis">
          Y
          <input
            className="hud-debug-target-input"
            type="number"
            value={debugAsteroidSpawnOffset[1]}
            onChange={(event) => updateDebugAsteroidOffsetAxis(1, event.target.value)}
          />
        </label>
        <label className="hud-debug-target-axis">
          Z
          <input
            className="hud-debug-target-input"
            type="number"
            value={debugAsteroidSpawnOffset[2]}
            onChange={(event) => updateDebugAsteroidOffsetAxis(2, event.target.value)}
          />
        </label>
      </div>
      <div className="hud-debug-slider-group">
        <label className="hud-debug-slider-label">
          AST SIZE
          <span className="hud-debug-slider-value">{Math.round(debugAsteroidDefaultScale)}</span>
        </label>
        <input
          className="hud-debug-slider"
          type="range"
          min={4}
          max={500}
          step={1}
          value={debugAsteroidDefaultScale}
          disabled={debugAsteroidRandomizeScale}
          onChange={(e) => setDebugAsteroidDefaultScale(Number(e.target.value))}
        />
      </div>
      <div className="hud-debug-target-pos">
        <label className="hud-debug-target-axis">
          SIZE
          <input
            className="hud-debug-target-input"
            type="number"
            min={4}
            max={500}
            disabled={debugAsteroidRandomizeScale}
            value={debugAsteroidDefaultScale}
            onChange={(e) => setDebugAsteroidDefaultScale(Number(e.target.value) || 4)}
          />
        </label>
        <label className="hud-debug-target-axis" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={debugAsteroidRandomizeScale}
            onChange={(e) => setDebugAsteroidRandomizeScale(e.target.checked)}
          />
          RND
        </label>
      </div>
      <div className="hud-debug-target-pos">
        <label className="hud-debug-target-axis">
          MDL 0–4
          <input
            className="hud-debug-target-input"
            type="number"
            min={0}
            max={4}
            placeholder="rnd"
            value={debugAstModel}
            onChange={(e) => setDebugAstModel(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="hud-debug-spawn-roids"
        onClick={() => {
          const m = debugAstModel.trim() === '' ? undefined : Number(debugAstModel)
          spawnDebugAsteroid({
            modelIndex: m !== undefined && Number.isFinite(m) ? m : undefined,
          })
        }}
      >
        SPAWN DEBUG ASTEROID
      </button>
      <button type="button" className="hud-debug-spawn-roids" onClick={clearDebugAsteroids}>
        CLEAR DEBUG ASTEROIDS
      </button>
      {debugAsteroids.map((a) => (
        <div key={a.id} className="hud-debug-row">
          <span className="hud-debug-axis">{a.id.slice(0, 10)}</span>
          <span className="hud-debug-value" style={{ flex: 1, fontSize: '0.65rem' }}>
            m{a.modelIndex} s{a.scale.toFixed(0)}
          </span>
          <button
            type="button"
            className="hud-debug-reset"
            style={{ marginLeft: 4, fontSize: '0.65rem', padding: '1px 4px' }}
            onClick={() => removeDebugAsteroid(a.id)}
          >
            X
          </button>
        </div>
      ))}
      <button
        type="button"
        className="hud-debug-spawn-roids"
        onClick={() => spawnNpcShip()}
      >
        SPAWN NPC SHIP
      </button>
      <button
        type="button"
        className="hud-debug-spawn-roids"
        onClick={clearNpcShips}
      >
        CLEAR NPC SHIPS
      </button>
      {npcIds.map((npcId) => {
        const cfg = npcShips[npcId]
        if (!cfg) return null
        const ship = shipsById[npcId]
        return (
          <div key={npcId} className="hud-debug-npc-block">
            <div className="hud-debug-row">
              <span className="hud-debug-axis">{npcId.slice(0, 12)}</span>
              <button
                type="button"
                className="hud-debug-reset"
                style={{ marginLeft: 4, fontSize: '0.7em', padding: '1px 4px' }}
                onClick={() => removeNpcShip(npcId)}
              >
                X
              </button>
            </div>
            {ship && (
              <div className="hud-debug-row">
                <span className="hud-debug-axis">POS</span>
                <span className="hud-debug-value">
                  {ship.position[0].toFixed(0)}, {ship.position[1].toFixed(0)}, {ship.position[2].toFixed(0)}
                </span>
              </div>
            )}
            {ship && (
              <div className="hud-debug-row">
                <span className="hud-debug-axis">HP</span>
                <span className="hud-debug-value">
                  S:{ship.shield.toFixed(0)} A:{ship.armor.toFixed(0)} H:{ship.hull.toFixed(0)}
                </span>
              </div>
            )}
            <div className="hud-debug-target-pos">
              <label className="hud-debug-target-axis">
                MODE
                <select
                  className="hud-debug-target-input"
                  value={cfg.behaviorMode}
                  onChange={(e) => setNpcShipConfig(npcId, { behaviorMode: e.target.value as 'manual' | 'stationary' | 'straight' | 'orbit' })}
                >
                  <option value="manual">manual</option>
                  <option value="stationary">stationary</option>
                  <option value="straight">straight</option>
                  <option value="orbit">orbit</option>
                </select>
              </label>
            </div>
            <div className="hud-debug-target-pos">
              <label className="hud-debug-target-axis">
                HDG
                <input
                  className="hud-debug-target-input"
                  type="number"
                  value={cfg.commandedHeading}
                  onChange={(e) => setNpcShipConfig(npcId, { commandedHeading: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="hud-debug-target-axis">
                INC
                <input
                  className="hud-debug-target-input"
                  type="number"
                  min={-90}
                  max={90}
                  value={cfg.commandedInclination}
                  onChange={(e) => setNpcShipConfig(npcId, { commandedInclination: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="hud-debug-target-axis">
                SPD
                <input
                  className="hud-debug-target-input"
                  type="number"
                  min={0}
                  value={cfg.commandedSpeed}
                  onChange={(e) => setNpcShipConfig(npcId, { commandedSpeed: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
            <div className="hud-debug-target-pos">
              <label className="hud-debug-target-axis">
                SHIELDS
                <select
                  className="hud-debug-target-input"
                  value={cfg.shieldsUp ? 'on' : 'off'}
                  onChange={(e) => setNpcShipConfig(npcId, { shieldsUp: e.target.value === 'on' })}
                >
                  <option value="on">ON</option>
                  <option value="off">OFF</option>
                </select>
              </label>
              <label className="hud-debug-target-axis">
                MWD
                <select
                  className="hud-debug-target-input"
                  value={cfg.mwdActive ? 'on' : 'off'}
                  onChange={(e) => setNpcShipConfig(npcId, { mwdActive: e.target.value === 'on' })}
                >
                  <option value="off">OFF</option>
                  <option value="on">ON</option>
                </select>
              </label>
              <label className="hud-debug-target-axis">
                RADAR
                <select
                  className="hud-debug-target-input"
                  value={cfg.radarMode}
                  onChange={(e) => setNpcShipConfig(npcId, { radarMode: e.target.value as 'off' | 'scan' | 'stt' })}
                >
                  <option value="off">OFF</option>
                  <option value="scan">SCAN</option>
                  <option value="stt">STT</option>
                </select>
              </label>
            </div>
          </div>
        )
      })}
      <button
        type="button"
        className="hud-debug-spawn-roids"
        onClick={randomizePlanetTextures}
      >
        RANDOMIZE PLANET TEXTURES
      </button>
      <button
        type="button"
        className="hud-debug-spawn-roids"
        onClick={() => {
          cancelEwGravAnalysis()
          starSystem.celestials.forEach((celestial) => {
            if (celestial.type !== 'star') {
              revealEwCelestial(celestial.id)
            }
          })
        }}
      >
        REVEAL ALL CELESTIALS
      </button>
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
            dacPitch: 0,
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
      <button
        type="button"
        className="hud-debug-reset"
        onClick={() =>
          setShipState({ shield: Math.max(0, shield - shieldMax * 0.1) })
        }
      >
        DAMAGE SHIELDS
      </button>
      <button
        type="button"
        className="hud-debug-reset"
        onClick={() =>
          setShipState({ shield: Math.min(shieldMax, shield + shieldMax * 0.1) })
        }
      >
        GRANT SHIELDS
      </button>
    </div>
  )
}
