import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from "react";
import { useGameStore } from "@/state/gameStore";
import { getCelestialById } from "@/utils/systemData";
import { EWSystemMap } from "@/components/stations/EWSystemMap";
import { useEwTvStore, EW_ORBIT_FEED_W, EW_ORBIT_FEED_H } from "@/state/ewTvStore";
import { multiplayerClient } from "@/network/colyseusClient";
import {
  WORLD_UNITS_PER_AU,
  bearingInclinationFromVector,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from "@/systems/warp/navigationMath";
import {
  clamp,
  computeActiveDetectRangeM,
  deriveGravAnalysisDurationMs,
  gravHighPassAttenuation,
  gravMassForCelestialType,
  gravNoiseFloorScale,
  gravRelativeIntensityBoost,
} from "@/systems/ew/consoleMath";
import {
  AMBER,
  AMBER_DIM,
  AMBER_GLOW,
  BG_DARK,
  BG_PANEL,
  BG_SCREEN,
  GRAV_ANALYSIS_MAX_MS,
  GRAV_ANOMALY_BASE_MAX_RANGE_AU,
  GRAV_CONTROL_COLUMN_WIDTH,
  GRAV_CONTROL_RACK_WIDTH,
  GRAV_RESULT_BANNER_MS,
  GREEN_DIM,
  GRID_COLOR,
  GRID_COLOR_BRIGHT,
  RED_ALERT,
} from "@/systems/ew/consoleTheme";

function buildContactsFromGame() {
  const gameState = useGameStore.getState();
  const playerPos = gameState.ship.position;
  const localId = gameState.localPlayerId;
  const npcShips = gameState.npcShips;
  const contacts = [];

  for (const [id, ship] of Object.entries(gameState.shipsById)) {
    if (id === localId) continue;
    if (ship.currentCelestialId !== gameState.currentCelestialId) continue;

    const npcConfig = npcShips[id];
    const radarMode = npcConfig?.radarMode ?? "off";
    const mwdActive = npcConfig?.mwdActive ?? ship.mwdActive ?? false;

    const dx = ship.position[0] - playerPos[0];
    const dy = ship.position[1] - playerPos[1];
    const dz = ship.position[2] - playerPos[2];
    const range = Math.sqrt(dx * dx + dz * dz);
    const { bearing, inclination } = bearingInclinationFromVector([dx, dy, dz]);

    const usingThrusters = ship.actualSpeed > 0.1;
    // IR model:
    // - idle + shields down => near invisible
    // - shields up => noticeably hotter
    // - active thrust => hottest, scaled by speed
    let thermal = 0.002;
    if (ship.shieldsUp) {
      thermal += 52;
    }
    if (usingThrusters) {
      // Enemy MWD must not make IR brighter: cap thrust heating at subwarp envelope.
      const speedNorm = Math.max(0, Math.min(1, Math.min(ship.actualSpeed, 215) / 215));
      thermal += 11 + speedNorm * 22;
    }
    const type = radarMode === "off" ? "unknown" : "battleship";

    let emStrength, freq, sigWidth, sigType;
    if (radarMode === "stt") {
      emStrength = 0.85;
      freq = 0.48;
      sigWidth = 0.015;
      sigType = "stt";
    } else if (radarMode === "scan") {
      emStrength = 0.5;
      freq = 0.42;
      sigWidth = 0.035;
      sigType = "scan";
    } else {
      emStrength = 0.0;
      freq = 0.42;
      sigWidth = 0.08;
      sigType = "none";
    }

    contacts.push({
      id,
      bearing,
      range,
      freq,
      sigWidth,
      sigType,
      emStrength,
      thermal,
      type,
      driftBearing: 0,
      driftRange: 0,
      active: radarMode !== "off",
      jamming: false,
      rcs: type === "battleship" ? 22 : 2,
      heading: ship.actualHeading,
      speed: ship.actualSpeed,
      relDx: dx,
      relDy: dy,
      relDz: dz,
      inclination,
      mwdActive,
    });
  }

  return contacts;
}

function buildGravAnomaliesFromEnvironment(starSystem, currentCelestialId, gain = 1) {
  if (!starSystem?.celestials?.length) return [];
  const currentCelestial = getCelestialById(currentCelestialId, starSystem);
  if (!currentCelestial) return [];
  const currentCelestialWorld = worldPositionForCelestial(currentCelestial);
  const effectiveGain = Math.max(0.5, gain);
  const maxRangeAu = GRAV_ANOMALY_BASE_MAX_RANGE_AU * effectiveGain;
  const maxRangeWorld = maxRangeAu * WORLD_UNITS_PER_AU;
  return starSystem.celestials
    .filter((c) => c.type !== "star" && c.id !== currentCelestialId)
    .map((c) => {
      const targetWorld = worldPositionForCelestial(c);
      // Match the warp-pip/navigation frame: current celestial center -> destination.
      const toTarget = vectorBetweenWorldPoints(currentCelestialWorld, targetWorld);
      const rangeWorld = vectorMagnitude(toTarget);
      if (rangeWorld <= 0 || rangeWorld > maxRangeWorld) return null;
      const { bearing } = bearingInclinationFromVector(toTarget);
      return {
        id: `G-${c.id}`,
        celestialId: c.id,
        celestialName: c.name,
        bearing,
        range: rangeWorld,
        speed: 0,
        type: c.type,
        gravProfile: "celestial",
        gravMass: gravMassForCelestialType(c.type),
        active: true,
        emStrength: 0,
        thermal: 0,
      };
    })
    .filter((entry) => entry !== null);
}

function buildIrSourcesFromEnvironment(starSystem, currentCelestialId) {
  if (!starSystem?.celestials?.length) return [];
  const currentCelestial = getCelestialById(currentCelestialId, starSystem);
  if (!currentCelestial) return [];
  const star =
    getCelestialById("star", starSystem)
    || starSystem.celestials.find((c) => c.type === "star")
    || null;
  if (!star) return [];

  const currentCelestialWorld = worldPositionForCelestial(currentCelestial);
  const starWorld = worldPositionForCelestial(star);
  const toStar = vectorBetweenWorldPoints(currentCelestialWorld, starWorld);
  const rangeWorld = Math.max(1, vectorMagnitude(toStar));
  const { bearing, inclination } = bearingInclinationFromVector(toStar);

  return [{
    id: `IR-${star.id}`,
    bearing,
    inclination,
    range: rangeWorld,
    irProfile: "solar",
    thermal: 4,
    type: "star",
    active: true,
  }];
}

const IR_SHIP_REFERENCE_RANGE_KM = 12;
const MWD_GRAV_WELL_PER_KM_CUBED = 0.00015;
const MWD_GRAV_WELL_MIN = 0.05;
const MWD_GRAV_WELL_MAX = 10;
function inverseCubeAttenuation(distance, referenceDistance, minDistanceFraction = 0.5) {
  const minDistance = Math.max(0.0001, referenceDistance * minDistanceFraction);
  const safeDistance = Math.max(minDistance, distance);
  return Math.pow(referenceDistance / safeDistance, 3);
}

// Noise generator
const noise = (x, t) => {
  const s = Math.sin(x * 12.9898 + t * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Panel frame component
const Panel = ({
  title,
  children,
  style,
  className = "",
  headerRight = null,
  headerCenter = null,
  dimmed = false,
}) => (
  <div style={{
    background: BG_PANEL,
    border: `1px solid ${AMBER_DIM}`,
    borderRadius: 2,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    ...style,
  }} className={className}>
    <div style={{
      background: "rgba(255,176,0,0.06)",
      borderBottom: `1px solid ${AMBER_DIM}`,
      boxSizing: "border-box",
      height: 28,
      minHeight: 28,
      maxHeight: 28,
      overflow: "hidden",
      padding: "0 10px",
      fontSize: 10,
      fontFamily: "'Consolas', 'Monaco', monospace",
      color: AMBER,
      letterSpacing: 3,
      textTransform: "uppercase",
      display: "grid",
      gridTemplateColumns: "auto minmax(0, 1fr) auto",
      alignItems: "center",
      columnGap: 8,
    }}>
      <span style={{ flexShrink: 0 }}>{title}</span>
      {/* Middle column reserves space so centered controls never sit under the right column (fixes range slider hit-testing). */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minWidth: 0,
        minHeight: 0,
        maxHeight: 28,
        overflow: "hidden",
        gap: 6,
        letterSpacing: 0,
        textTransform: "none",
      }}>
        {headerCenter}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexShrink: 0 }}>
        {headerRight ?? <span style={{ color: AMBER_DIM, fontSize: 8 }}>■ ACTIVE</span>}
      </div>
    </div>
    <div style={{
      flex: 1,
      position: "relative",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      opacity: dimmed ? 0.55 : 1,
      filter: dimmed ? "grayscale(1)" : "none",
    }}>
      {children}
    </div>
  </div>
);

/** Power / arm header controls — matches WS officer console weapons styling */
const EwSysPowerArmHeader = ({
  font,
  isPowered,
  isArmed,
  onTogglePower,
  onToggleArmed,
}) => {
  const pwrGreen = "#00ff64";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button
        type="button"
        onClick={onTogglePower}
        style={{
          minWidth: 42,
          height: 20,
          border: `1px solid ${isPowered ? pwrGreen : AMBER_DIM}`,
          background: isPowered ? "rgba(0,255,100,0.14)" : "rgba(80,60,20,0.2)",
          color: isPowered ? "#9dffc4" : AMBER_DIM,
          fontFamily: font,
          fontSize: 9,
          borderRadius: 2,
          cursor: "pointer",
          letterSpacing: 1,
        }}
      >
        {isPowered ? "PWR ON" : "PWR OFF"}
      </button>
      <button
        type="button"
        onClick={onToggleArmed}
        disabled={!isPowered}
        style={{
          minWidth: 44,
          height: 20,
          border: `1px solid ${isArmed ? AMBER : AMBER_GLOW}`,
          background: isArmed ? "rgba(255,176,0,0.15)" : "rgba(255,176,0,0.18)",
          color: isArmed ? AMBER_GLOW : "#f2d38a",
          fontFamily: font,
          fontSize: 9,
          borderRadius: 2,
          cursor: isPowered ? "pointer" : "not-allowed",
          letterSpacing: 1,
          boxShadow: isArmed ? "none" : "0 0 4px rgba(255,176,0,0.45)",
          opacity: isPowered ? 1 : 0.45,
        }}
      >
        {isArmed ? "ARMED" : "ARM"}
      </button>
    </div>
  );
};

// Waterfall Display
const WaterfallDisplay = ({ contacts, time, shipHeading }) => {
  const canvasRef = useRef(null);
  const bufferRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    if (!bufferRef.current) {
      bufferRef.current = ctx.createImageData(W, H);
      for (let i = 3; i < bufferRef.current.data.length; i += 4) {
        bufferRef.current.data[i] = 255;
      }
    }
    const imgData = bufferRef.current;

    // Scroll down by 1 row
    for (let y = H - 1; y > 0; y--) {
      for (let x = 0; x < W; x++) {
        const dst = (y * W + x) * 4;
        const src = ((y - 1) * W + x) * 4;
        imgData.data[dst] = imgData.data[src];
        imgData.data[dst + 1] = imgData.data[src + 1];
        imgData.data[dst + 2] = imgData.data[src + 2];
      }
    }

    // New top row — heading-relative: center = own heading, left = -180, right = +180
    const hdg = shipHeading || 0;
    for (let x = 0; x < W; x++) {
      const relAngle = ((x / W) - 0.5) * 360;
      const bearing = ((hdg + relAngle) % 360 + 360) % 360;
      let intensity = noise(x * 0.1, time * 0.5) * 8;

      contacts.forEach(c => {
        if (!c.active && c.emStrength === 0) return;
        const sig = c.emStrength + c.thermal * 0.3;
        const dist = Math.abs(bearing - c.bearing);
        const angDist = Math.min(dist, 360 - dist);
        const spread = 2 + sig * 4;
        if (angDist < spread) {
          const falloff = 1 - (angDist / spread);
          intensity += falloff * sig * 180 * (0.7 + noise(x, time * 2) * 0.6);
        }
      });

      intensity = Math.min(255, Math.max(0, intensity));
      const idx = x * 4;
      imgData.data[idx] = intensity;
      imgData.data[idx + 1] = intensity * 0.69;
      imgData.data[idx + 2] = 0;
    }

    ctx.putImageData(imgData, 0, 0);

    // Bearing labels — heading-relative
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, 22);
    ctx.font = "16px Consolas, Monaco, monospace";
    ctx.fillStyle = AMBER_DIM;
    const labelSteps = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
    labelSteps.forEach(offset => {
      const bx = ((offset + 180) / 360) * W;
      const absBrg = ((hdg + offset) % 360 + 360) % 360;
      const label = offset === 0 ? `${String(Math.round(absBrg)).padStart(3, "0")}°` : `${offset > 0 ? "R" : "L"}${Math.abs(offset)}`;
      ctx.fillText(label, bx + 3, 18);
      ctx.strokeStyle = offset === 0 ? GRID_COLOR_BRIGHT : GRID_COLOR;
      ctx.lineWidth = offset === 0 ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(bx, 22);
      ctx.lineTo(bx, H);
      ctx.stroke();
    });
  }, [time, contacts]);

  return <canvas ref={canvasRef} width={1040} height={300} style={{ width: "100%", height: "100%", imageRendering: "auto" }} />;
};

// Gate helper for analyzers with bearing cursor + scroll zoom + analyze
function useGate() {
  const MAX_ZOOM = 10;
  const MIN_GATE_WIDTH = 1 / MAX_ZOOM;
  const [gateL, setGateL] = useState(0);
  const [gateR, setGateR] = useState(1);
  const [cursor, setCursor] = useState(0.5);
  const [bearingOffsetDeg, setBearingOffsetDeg] = useState(0);
  const [ctxMenu, setCtxMenu] = useState(null);
  const dragging = useRef(null);
  const lastDragX = useRef(0);

  const onMouseDown = useCallback((e) => {
    setCtxMenu(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    lastDragX.current = mx;
    if (e.button === 2) {
      // Right-click drag pans the bearing tape.
      dragging.current = "PAN";
      return;
    }
    if (e.button !== 0) {
      dragging.current = null;
      return;
    }
    const distL = Math.abs(mx - gateL);
    const distR = Math.abs(mx - gateR);
    const distC = Math.abs(mx - cursor);
    const minDist = Math.min(distL, distR, distC);
    if (minDist > 0.05) {
      // Left-click places and drags the bearing selector line.
      dragging.current = "C";
      setCursor(mx);
    } else if (distC <= minDist) dragging.current = "C";
    else if (distL <= minDist) dragging.current = "L";
    else dragging.current = "R";
  }, [gateL, gateR, cursor]);

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (dragging.current === "L") setGateL(Math.min(mx, gateR - MIN_GATE_WIDTH));
    else if (dragging.current === "R") setGateR(Math.max(mx, gateL + MIN_GATE_WIDTH));
    else if (dragging.current === "C") setCursor(mx);
    else if (dragging.current === "PAN") {
      const delta = mx - lastDragX.current;
      const width = gateR - gateL;
      if (width >= 0.999) {
        setBearingOffsetDeg((prev) => prev - delta * 360);
      } else {
        let newL = gateL + delta;
        let newR = gateR + delta;
        if (newL < 0) {
          newR -= newL;
          newL = 0;
        }
        if (newR > 1) {
          newL -= (newR - 1);
          newR = 1;
        }
        const clampedL = Math.max(0, newL);
        const clampedR = Math.min(1, newR);
        setGateL(clampedL);
        setGateR(clampedR);
        setCursor((prev) => Math.max(clampedL, Math.min(clampedR, prev + delta)));
      }
      lastDragX.current = mx;
    }
  }, [gateL, gateR, MIN_GATE_WIDTH]);

  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.85 : 1.18;
    const width = gateR - gateL;
    const newWidth = Math.max(MIN_GATE_WIDTH, Math.min(1, width * zoomFactor));
    // Always zoom around the bearing selector cursor.
    const center = gateL + cursor * width;
    let newL = center - cursor * newWidth;
    let newR = newL + newWidth;
    if (newL < 0) {
      newR -= newL;
      newL = 0;
    }
    if (newR > 1) {
      newL -= (newR - 1);
      newR = 1;
    }
    setGateL(Math.max(0, newL));
    setGateR(Math.min(1, newR));
  }, [gateL, gateR, cursor, MIN_GATE_WIDTH]);

  const onContextMenu = useCallback((e) => {
    // Disable graph context menu interactions.
    e.preventDefault();
  }, []);

  const gateAroundCursor = useCallback(() => {
    const margin = 0.05;
    setGateL(Math.max(0, cursor - margin));
    setGateR(Math.min(1, cursor + margin));
    setCtxMenu(null);
  }, [cursor]);

  const reset = useCallback(() => { setGateL(0); setGateR(1); setCursor(0.5); }, []);

  const gateWidth = gateR - gateL;
  const isGated = gateWidth < 0.5;

  return { gateL, gateR, cursor, bearingOffsetDeg, ctxMenu, isGated, gateWidth, onMouseDown, onMouseMove, onMouseUp, onWheel, onContextMenu, gateAroundCursor, reset, setCtxMenu };
}

function drawGates(ctx, W, H, cursorPos, gateWidth, color, dimColor) {
  if (gateWidth >= 0.999) return;
  const cx = cursorPos * W;
  const halfWidthPx = (gateWidth * W) / 2;
  const lx = Math.max(0, cx - halfWidthPx);
  const rx = Math.min(W, cx + halfWidthPx);

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, lx, H);
  ctx.fillRect(rx, 0, W - rx, H);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, H); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx + 6, 0); ctx.lineTo(lx, 8); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx - 6, 0); ctx.lineTo(rx, 8); ctx.closePath(); ctx.fill();

  const zoom = (1 / gateWidth).toFixed(1);
  ctx.font = "18px Consolas, Monaco, monospace";
  ctx.fillStyle = dimColor;
  ctx.fillText(`${zoom}x`, (lx + rx) / 2 - 16, 18);
}

function drawCursor(ctx, W, H, cursorPos, color, brightColor, label) {
  const cx = cursorPos * W;
  const boxY = 8;
  const boxPaddingX = 6;
  const boxHeight = 18;

  ctx.strokeStyle = brightColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, H);
  ctx.stroke();

  ctx.font = "14px Consolas, Monaco, monospace";
  const textWidth = Math.ceil(ctx.measureText(label).width);
  const boxWidth = textWidth + boxPaddingX * 2;
  const boxX = cx - boxWidth / 2;

  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = brightColor;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  ctx.fillStyle = brightColor;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, boxY + 13);
  ctx.textAlign = "start";

  ctx.fillStyle = brightColor;
  ctx.beginPath();
  // Pointer at the bottom of the selector line, aimed at the X-axis
  ctx.moveTo(cx, H - 1);
  ctx.lineTo(cx - 5, H - 7);
  ctx.lineTo(cx + 5, H - 7);
  ctx.closePath();
  ctx.fill();
}

function drawShipForwardReference(ctx, W, H, viewL, viewR, bearingOffsetDeg, color, label = "FWD") {
  const viewW = Math.max(0.0001, viewR - viewL);
  const forwardNormRaw = 0.5 - (bearingOffsetDeg / 360);
  const forwardNorm = ((forwardNormRaw % 1) + 1) % 1;
  if (forwardNorm < viewL || forwardNorm > viewR) return;

  const x = ((forwardNorm - viewL) / viewW) * W;
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.62;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "11px Consolas, Monaco, monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x, 12);
  ctx.textAlign = "start";
  ctx.restore();
}

function spectrumLockState(contacts, selectedBearing, gateL, gateR) {
  const candidates = contacts
    .filter(c => c.active && c.emStrength > 0.05)
    .map(c => {
      const bearingDist = Math.abs(selectedBearing - c.bearing);
      const bDist = Math.min(bearingDist, 360 - bearingDist);
      const bearingFactor = Math.max(0, 1 - bDist / 30);
      return { ...c, score: c.emStrength * bearingFactor };
    })
    .filter(c => c.score > 0.08)
    .sort((a, b) => b.score - a.score);

  const target = candidates[0];
  if (!target) return { state: "none", canAnalyze: false };

  const width = gateR - gateL;
  const center = (gateL + gateR) / 2;
  const centerErr = Math.abs(target.freq - center);
  const inGate = target.freq >= gateL && target.freq <= gateR;
  if (!inGate) return { state: "none", canAnalyze: false };

  const closeLock = width <= 0.25 && centerErr <= Math.max(0.02, width * 0.25);
  const hardLock = width <= 0.14 && centerErr <= 0.018;
  if (hardLock) return { state: "locked", canAnalyze: true };
  if (closeLock) return { state: "close", canAnalyze: false };
  return { state: "none", canAnalyze: false };
}

function gravLockState(contacts, gateL, gateR, bearingOffsetDeg = 0, gain = 1, highPassPct = 100) {
  const shipHdg = useGameStore.getState().ship.actualHeading;
  const effectiveGain = Math.max(0.5, gain);
  const maxRangeAu = GRAV_ANOMALY_BASE_MAX_RANGE_AU * effectiveGain;
  const candidates = contacts
    .map(c => {
      const relBrg = ((c.bearing - shipHdg + 540) % 360) - 180;
      const wellNormRaw = 0.5 + (relBrg - bearingOffsetDeg) / 360;
      const wellNorm = ((wellNormRaw % 1) + 1) % 1;
      const isCelestial = c.gravProfile === "celestial";
      let score = 0;
      if (isCelestial) {
        const rangeAu = c.range / WORLD_UNITS_PER_AU;
        if (rangeAu <= maxRangeAu) {
          const rangeFactor = Math.pow(Math.max(0, 1 - rangeAu / maxRangeAu), 1.35);
          const filterAttenuation = gravHighPassAttenuation(c.type, highPassPct);
          const relativeBoost = gravRelativeIntensityBoost(c.type, highPassPct);
          score = (c.gravMass || 0.7) * rangeFactor * 1.6 * filterAttenuation * relativeBoost;
        }
      }
      return {
        ...c,
        wellNorm,
        score,
        rangeAu: c.range / WORLD_UNITS_PER_AU,
      };
    })
    .filter(c => c.gravProfile === "celestial" && c.score > 0.05)
    .sort((a, b) => b.score - a.score);

  const target = candidates[0];
  if (!target) {
    return {
      state: "none",
      canAnalyze: false,
      target: null,
      celestialId: null,
      clarity: 0,
      durationMs: GRAV_ANALYSIS_MAX_MS,
      centerError: 1,
    };
  }

  const width = gateR - gateL;
  const center = (gateL + gateR) / 2;
  const centerErr = Math.abs(target.wellNorm - center);
  const inGate = target.wellNorm >= gateL && target.wellNorm <= gateR;
  const signalFactor = clamp(target.score / 1.2, 0, 1);
  const zoomFactor = clamp((0.22 - width) / 0.16, 0, 1);
  const centeringFactor = clamp(1 - centerErr / Math.max(0.025, width * 0.5), 0, 1);
  const clarity = clamp(signalFactor * 0.45 + zoomFactor * 0.25 + centeringFactor * 0.3, 0, 1);
  const durationMs = deriveGravAnalysisDurationMs(clarity);
  const closeLock = width <= 0.25 && centerErr <= Math.max(0.02, width * 0.25);
  const hardLock = width <= 0.14 && centerErr <= 0.018;
  const state = !inGate ? "none" : hardLock ? "locked" : closeLock ? "close" : "none";
  return {
    state,
    canAnalyze: inGate && hardLock,
    target,
    celestialId: target.celestialId ?? null,
    clarity,
    durationMs,
    centerError: centerErr,
  };
}

// Spectrum Analyzer — full band, no zoom, with jammer cursors
const SpectrumAnalyzer = ({ contacts, time, selectedBearing, onLockQualityChange, jammers, jammerColors, selectedJammer, onJammerFreqChange }) => {
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((e) => {
    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const freq = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (onJammerFreqChange) onJammerFreqChange(selectedJammer, freq);
  }, [selectedJammer, onJammerFreqChange]);

  const handlePointerMove = useCallback((e) => {
    if (!draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const freq = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (onJammerFreqChange) onJammerFreqChange(selectedJammer, freq);
  }, [selectedJammer, onJammerFreqChange]);

  const handlePointerUp = useCallback(() => { draggingRef.current = false; }, []);

  // Compute lock quality based on whether any signal is on our bearing
  const lockQuality = (() => {
    const candidates = contacts
      .filter(c => c.active && c.emStrength > 0.05)
      .map(c => {
        const bDist = Math.min(Math.abs(selectedBearing - c.bearing), 360 - Math.abs(selectedBearing - c.bearing));
        const bearingFactor = Math.max(0, 1 - bDist / 30);
        return { ...c, score: c.emStrength * bearingFactor };
      })
      .filter(c => c.score > 0.08)
      .sort((a, b) => b.score - a.score);
    const target = candidates[0];
    if (!target) return { state: "none", canAnalyze: false };
    if (target.score > 0.3) return { state: "locked", canAnalyze: true };
    if (target.score > 0.15) return { state: "close", canAnalyze: false };
    return { state: "none", canAnalyze: false };
  })();
  const hasSignalUI = lockQuality.canAnalyze;
  const nearSignalUI = lockQuality.state === "close";

  useEffect(() => {
    if (onLockQualityChange) onLockQualityChange(lockQuality.state);
  }, [lockQuality.state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 10; i++) {
      const x = (i / 10) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const y = (i / 8) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = GRID_COLOR_BRIGHT;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    const traceColor = hasSignalUI ? "#44ff66" : nearSignalUI ? "#ffd24a" : AMBER;
    const traceGlow = hasSignalUI ? "#88ffaa" : nearSignalUI ? "#ffe38a" : AMBER_GLOW;

    // Spectrum trace — full band 0–1
    ctx.beginPath();
    ctx.strokeStyle = traceColor;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = traceGlow;
    ctx.shadowBlur = 6;

    // Precompute active jammer effects for this frame
    const activeJammers = (jammers || []).filter(j => j.active && j.mode);

    const maxAmp = H * 0.82;
    for (let x = 0; x < W; x++) {
      const freq = x / W;
      let amplitude = (noise(freq * 50, time) * 0.08 + noise(freq * 120, time * 1.3) * 0.04) * H;

      contacts.forEach(c => {
        if (!c.active) return;
        const bearingDist = Math.abs(selectedBearing - c.bearing);
        const bDist = Math.min(bearingDist, 360 - bearingDist);
        if (bDist > 30) return;
        const bearingFactor = 1 - bDist / 30;
        const width = c.sigWidth || 0.04;
        const freqDist = Math.abs(freq - c.freq);

        if (freqDist < width) {
          const spike = (1 - freqDist / width) * c.emStrength * bearingFactor;
          let modulation = 0.8 + Math.sin(time * 3 + c.freq * 20) * 0.2;
          if (c.sigType === "stt") modulation = 0.9 + Math.sin(time * 8 + c.freq * 40) * 0.1;
          else if (c.sigType === "scan") modulation = (0.5 + Math.sin(time * 1.5) * 0.5) * (0.7 + Math.sin(time * 4 + c.freq * 15) * 0.3);
          else if (c.sigType === "deception") modulation = 0.6 + noise(freq * 200, time * 3) * 0.8;
          else if (c.sigType === "missile") modulation = 0.85 + Math.sin(time * 12 + c.freq * 60) * 0.15;

          let sigAmp = spike * H * 0.55 * modulation;

          // Jammer interaction with this signal
          activeJammers.forEach(j => {
            const jDist = Math.abs(c.freq - j.freq);
            if (jDist > 0.08) return;
            const overlap = Math.max(0, 1 - jDist / 0.05);

            if (j.mode === "NJ") {
              // Noise jam: suppresses signal, adds chaotic noise
              sigAmp *= (1 - overlap * 0.6);
              sigAmp += overlap * noise(freq * 150, time * 4) * H * 0.15;
            } else if (j.mode === "SJ") {
              // Spot jam: crushes the signal peak, distorts shape
              sigAmp *= (1 - overlap * 0.75);
              const jitter = noise(freq * 200 + time * 5, time * 3) * overlap * H * 0.08;
              sigAmp += jitter;
            } else if (j.mode === "DRFM") {
              // DRFM: signal breaks up, stutters, ghost copies appear
              const stutter = Math.sin(time * 3) > 0.2 ? 1 : 0.15;
              sigAmp *= (1 - overlap * 0.4 * stutter);
              // Ghost offset copies
              const ghost1Dist = Math.abs(freq - (c.freq + 0.04));
              const ghost2Dist = Math.abs(freq - (c.freq - 0.03));
              if (ghost1Dist < width * 0.6) {
                sigAmp += (1 - ghost1Dist / (width * 0.6)) * c.emStrength * bearingFactor * H * 0.2 * overlap * stutter;
              }
              if (ghost2Dist < width * 0.5) {
                sigAmp += (1 - ghost2Dist / (width * 0.5)) * c.emStrength * bearingFactor * H * 0.15 * overlap * stutter;
              }
            } else if (j.mode === "RGPO") {
              // RGPO: signal wobbles and smears, peak drifts
              const drift = Math.sin(time * 0.4) * 0.03;
              const smear = Math.abs(freq - (c.freq + drift));
              if (smear < width * 1.5) {
                const smearFactor = overlap * 0.5 * (1 - smear / (width * 1.5));
                sigAmp *= (1 - overlap * 0.3);
                sigAmp += smearFactor * c.emStrength * bearingFactor * H * 0.25 * (0.8 + Math.sin(time * 5 + freq * 60) * 0.2);
              }
            }
          });

          amplitude += sigAmp;
        }
        const harm = Math.abs(freq - c.freq * 2);
        if (harm < width * 0.5 && c.freq * 2 < 1) {
          amplitude += (1 - harm / (width * 0.5)) * c.emStrength * bearingFactor * H * 0.12;
        }
      });

      // Noise jam raises the noise floor around the jammer frequency
      activeJammers.forEach(j => {
        if (j.mode !== "NJ") return;
        const jDist = Math.abs(freq - j.freq);
        if (jDist < 0.08) {
          const env = 1 - jDist / 0.08;
          amplitude += env * 0.3 * noise(freq * 60 + time * 3, time * 2) * H * 0.1;
        }
      });

      amplitude = Math.min(amplitude, maxAmp);
      const y = H - 20 - amplitude;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Frequency labels along bottom
    ctx.font = "20px Consolas, Monaco, monospace";
    ctx.fillStyle = AMBER_DIM;
    ctx.fillText(`2.0–20.0 GHz  |  dBm  |  BRG: ${selectedBearing}°`, 6, H - 8);

    // Bearing — top left
    ctx.font = "20px Consolas, Monaco, monospace";
    ctx.fillStyle = hasSignalUI ? "#44ff66" : nearSignalUI ? "#ffd24a" : AMBER;
    ctx.fillText(`BRG ${String(Math.round(selectedBearing)).padStart(3, "0")}`, 8, 22);

    // Lock indicator top right
    if (hasSignalUI || nearSignalUI) {
      ctx.font = "20px Consolas, Monaco, monospace";
      ctx.fillStyle = hasSignalUI ? "#44ff66" : "#ffd24a";
      ctx.textAlign = "right";
      ctx.fillText(hasSignalUI ? "■ SIGNAL LOCKED" : "■ SIGNAL CLOSE", W - 10, 22);
      ctx.textAlign = "start";
    }

    // Signal labels
    contacts.forEach(c => {
      if (!c.active) return;
      const bDist = Math.min(Math.abs(selectedBearing - c.bearing), 360 - Math.abs(selectedBearing - c.bearing));
      if (bDist > 30) return;
      const px = c.freq * W;
      const label = c.sigType === "stt" ? "STT" : c.sigType === "scan" ? "SCAN" : c.sigType === "missile" ? "MSL" : c.sigType === "deception" ? "ECM" : "UNK";
      ctx.font = "14px Consolas, Monaco, monospace";
      ctx.fillStyle = hasSignalUI ? "#44ff66" : AMBER;
      ctx.textAlign = "center";
      ctx.fillText(label, px, 38);
      ctx.fillText(`${(c.freq * 18 + 2).toFixed(1)}`, px, 52);
      ctx.textAlign = "start";
    });

    // Active jammer counter-signals — drawn from the top down
    if (jammers && jammerColors) {
      jammers.forEach((j, i) => {
        if (!j.active || !j.mode) return;
        const color = jammerColors[i];
        const jFreq = j.freq;
        const jamMaxAmp = H * 0.6;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;

        for (let x = 0; x < W; x++) {
          const freq = x / W;
          let amp = 0;

          if (j.mode === "NJ") {
            const width = 0.06;
            const freqDist = Math.abs(freq - jFreq);
            if (freqDist < width) {
              const env = 1 - freqDist / width;
              amp = env * 0.7 * (0.4 + noise(freq * 80, time * 2) * 0.6);
            }
          } else if (j.mode === "SJ") {
            const width = 0.02;
            const freqDist = Math.abs(freq - jFreq);
            if (freqDist < width) {
              const env = 1 - freqDist / width;
              amp = env * env * 0.9 * (0.85 + Math.sin(time * 6 + freq * 50) * 0.15);
            }
          } else if (j.mode === "DRFM") {
            const width = 0.025;
            const freqDist = Math.abs(freq - jFreq);
            if (freqDist < width) {
              const env = 1 - freqDist / width;
              const replay = Math.sin(time * 10 + freq * 100) * 0.3 + 0.7;
              const stutter = Math.sin(time * 2.5) > 0 ? 1 : 0.3;
              amp = env * 0.85 * replay * stutter;
            }
          } else if (j.mode === "RGPO") {
            const drift = Math.sin(time * 0.4) * 0.03;
            const width = 0.018;
            const freqDist = Math.abs(freq - (jFreq + drift));
            if (freqDist < width) {
              const env = 1 - freqDist / width;
              amp = env * 0.8 * (0.9 + Math.sin(time * 7 + freq * 40) * 0.1);
            }
          }

          if (amp > 0) {
            amp = Math.min(amp * jamMaxAmp, jamMaxAmp);
            const y = 20 + amp;
            if (x === 0 || freq - 1/W < jFreq - 0.08) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Fill under the counter-signal for visibility
        ctx.fillStyle = color + "15";
        ctx.beginPath();
        for (let x = 0; x < W; x++) {
          const freq = x / W;
          let amp = 0;
          const width = j.mode === "NJ" ? 0.06 : j.mode === "SJ" ? 0.02 : j.mode === "DRFM" ? 0.025 : 0.018;
          const center = j.mode === "RGPO" ? jFreq + Math.sin(time * 0.4) * 0.03 : jFreq;
          const freqDist = Math.abs(freq - center);
          if (freqDist < width) {
            const env = 1 - freqDist / width;
            amp = env * 0.5 * jamMaxAmp;
          }
          const y = amp > 0 ? 20 + amp : 20;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(W, 0);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
      });
    }

    // Jammer cursors
    if (jammers && jammerColors) {
      jammers.forEach((j, i) => {
        const cx = j.freq * W;
        const color = jammerColors[i];
        const isSel = i === selectedJammer;
        const isAct = j.active;

        ctx.strokeStyle = isAct ? color : isSel ? color : color + "66";
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.setLineDash(isAct ? [] : [4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();
        ctx.setLineDash([]);

        // Jammer number label
        ctx.font = "bold 16px Consolas, Monaco, monospace";
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.fillText(`J${i + 1}`, cx, H - 28);
        if (j.mode) {
          ctx.font = "10px Consolas, Monaco, monospace";
          ctx.fillText(j.mode, cx, H - 40);
        }
        ctx.textAlign = "start";
      });
    }

  }, [time, contacts, selectedBearing, hasSignalUI, nearSignalUI, jammers, jammerColors, selectedJammer]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <canvas
        ref={canvasRef}
        width={800}
        height={320}
        style={{ width: "100%", flex: 1, minHeight: 0, background: BG_SCREEN, cursor: "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
};

// Gravitational Analyzer — mass distortion waveform
const GRAV_CYAN = "#00ccaa";
const GRAV_CYAN_DIM = "#005544";
const GRAV_CYAN_GLOW = "#44ffcc";
const IR_ORANGE = "#ff9a3c";
const IR_ORANGE_DIM = "#6e3f12";
const IR_ORANGE_GLOW = "#ffb86f";

const GravAnalyzer = ({
  contacts,
  time,
  selectedBearing,
  onBearingChange,
  resetToken = 0,
  scannerOn = true,
}) => {
  const canvasRef = useRef(null);
  const gate = useGate();
  const prevCursor = useRef(gate.cursor);
  const [gain, setGain] = useState(1.0);
  const [highPassPct, setHighPassPct] = useState(100);
  const starSystem = useGameStore((s) => s.starSystem);
  const currentCelestialId = useGameStore((s) => s.currentCelestialId);
  const revealedCelestialIds = useGameStore((s) => s.ewRevealedCelestialIds);
  const warpState = useGameStore((s) => s.warpState);
  const activeGravAnalysis = useGameStore((s) => s.ewActiveGravAnalysis);
  const lastGravAnalysisResult = useGameStore((s) => s.ewLastGravAnalysisResult);
  const startEwGravAnalysis = useGameStore((s) => s.startEwGravAnalysis);
  const completeEwGravAnalysis = useGameStore((s) => s.completeEwGravAnalysis);
  const cancelEwGravAnalysis = useGameStore((s) => s.cancelEwGravAnalysis);
  const warpInterference = warpState === "warping" || warpState === "landing";
  const scannerUsable = scannerOn && !warpInterference;
  const gravAnomalies = useMemo(
    () => buildGravAnomaliesFromEnvironment(starSystem, currentCelestialId, gain),
    [starSystem, currentCelestialId, gain]
  );
  const gravContacts = useMemo(
    () => [...contacts, ...gravAnomalies],
    [contacts, gravAnomalies]
  );
  const gravQuality = gravLockState(gravContacts, gate.gateL, gate.gateR, gate.bearingOffsetDeg, gain, highPassPct);
  const targetAlreadyRevealed = !!(
    gravQuality.state !== "none"
    && gravQuality.celestialId
    && revealedCelestialIds.includes(gravQuality.celestialId)
  );
  const hasWellInGateUI = gravQuality.canAnalyze;
  const nearWellUI = gravQuality.state === "close";
  const nowMs = Date.now();
  const activeAnalysisRemaining = activeGravAnalysis
    ? Math.max(0, activeGravAnalysis.startedAt + activeGravAnalysis.durationMs - nowMs)
    : 0;
  const activeAnalysisProgress = activeGravAnalysis
    ? clamp(1 - activeAnalysisRemaining / activeGravAnalysis.durationMs, 0, 1)
    : 0;
  const recentAnalysisResult = lastGravAnalysisResult
    && nowMs - lastGravAnalysisResult.completedAt <= GRAV_RESULT_BANNER_MS
    ? lastGravAnalysisResult
    : null;
  const canStartAnalysis = scannerUsable && hasWellInGateUI && !targetAlreadyRevealed && !activeGravAnalysis;
  const displayedResultCelestial = recentAnalysisResult
    ? getCelestialById(recentAnalysisResult.celestialId, starSystem)
    : null;
  const displayedResultLabel = displayedResultCelestial?.name ?? recentAnalysisResult?.celestialId ?? null;
  const activeAnalysisCelestial = activeGravAnalysis
    ? getCelestialById(activeGravAnalysis.celestialId, starSystem)
    : null;

  useEffect(() => {
    if (!scannerUsable) return;
    if (gate.cursor !== prevCursor.current && onBearingChange) {
      const viewL = gate.gateL;
      const viewW = gate.gateR - gate.gateL;
      const cursorT = viewL + gate.cursor * viewW;
      const shipHdg = useGameStore.getState().ship.actualHeading;
      const newBearing = Math.round(shipHdg - 180 + cursorT * 360 + gate.bearingOffsetDeg);
      onBearingChange(((newBearing % 360) + 360) % 360);
    }
    prevCursor.current = gate.cursor;
  }, [gate.cursor, onBearingChange, gate.gateL, gate.gateR, gate.bearingOffsetDeg, scannerUsable]);

  useEffect(() => {
    if (!activeGravAnalysis) return;
    if (Date.now() >= activeGravAnalysis.startedAt + activeGravAnalysis.durationMs) {
      completeEwGravAnalysis();
    }
  }, [activeGravAnalysis, time, completeEwGravAnalysis]);

  useEffect(() => {
    if (!scannerUsable && activeGravAnalysis) {
      cancelEwGravAnalysis();
    }
  }, [scannerUsable, activeGravAnalysis, cancelEwGravAnalysis]);

  useEffect(() => {
    gate.reset();
  }, [resetToken]);

  function computeDisplacement(t, contacts, selectedBearing, H, time) {
    const noiseFloorScale = gravNoiseFloorScale(highPassPct);
    const noiseGainMultiplier = gain <= 1
      ? gain * gain
      : 1 + (gain - 1) * 1.35;
    // Heavy baseline noise — makes the signal hard to pick out
    let displacement =
      (Math.sin(t * 6 + time * 0.6) * 7 +
        Math.sin(t * 14 + time * 1.1) * 4 +
        Math.sin(t * 23 + time * 0.4) * 3 +
        noise(t * 30, time * 0.7) * 12 - 6 +
        noise(t * 80, time * 0.3) * 5) * noiseGainMultiplier * noiseFloorScale;

    const shipHdg = useGameStore.getState().ship.actualHeading;
    contacts.forEach(c => {
      let relBrg = ((c.bearing - shipHdg + 540) % 360) - 180;

      const isCelestial = c.gravProfile === "celestial";
      let totalMass = 0;
      if (isCelestial) {
        const rangeAu = c.range / WORLD_UNITS_PER_AU;
        const effectiveRangeAu = rangeAu / Math.max(0.35, gain);
        if (effectiveRangeAu > GRAV_ANOMALY_BASE_MAX_RANGE_AU) return;
        const rangeFactor = Math.pow(
          Math.max(0, 1 - effectiveRangeAu / GRAV_ANOMALY_BASE_MAX_RANGE_AU),
          1.4
        );
        const filterAttenuation = gravHighPassAttenuation(c.type, highPassPct);
        const relativeBoost = gravRelativeIntensityBoost(c.type, highPassPct);
        totalMass = (c.gravMass || 0.7) * rangeFactor * 1.7 * filterAttenuation * relativeBoost;
      } else {
        const rangeKm = c.range / 1000;
        const effectiveRangeKm = rangeKm / Math.max(0.5, gain);
        const baseMass = (c.type === "battleship" ? 0.5 : c.type === "destroyer" ? 0.3 : 0.15);
        let gravStrength = baseMass;
        const speed = c.speed || 0;
        if (speed > 300) {
          gravStrength += (speed / 1200) * 1.2;
        } else if (speed > 1) {
          gravStrength += (speed / 215) * 0.08;
        }
        let rangeFactor;
        if (effectiveRangeKm <= 3) {
          rangeFactor = 1.0;
        } else if (effectiveRangeKm <= 8) {
          rangeFactor = 0.3 + 0.7 * (1 - (effectiveRangeKm - 3) / 5);
        } else if (effectiveRangeKm <= 15) {
          rangeFactor = 0.05 + 0.25 * (1 - (effectiveRangeKm - 8) / 7);
        } else {
          rangeFactor = 0.05 * Math.exp(-(effectiveRangeKm - 15) / 20);
        }
        if ((c.speed || 0) <= 1 && effectiveRangeKm > 8) {
          rangeFactor *= 0.1;
        }
        totalMass = gravStrength * rangeFactor;
        if (c.mwdActive) {
          // Keep the MWD effect as a stronger grav well (not a peak), scaled by distance^3.
          const mwdWellMass = clamp(
            Math.pow(Math.max(0, rangeKm), 3) * MWD_GRAV_WELL_PER_KM_CUBED,
            MWD_GRAV_WELL_MIN,
            MWD_GRAV_WELL_MAX
          );
          totalMass += mwdWellMass;
        }
      }

      const wellCenterRaw = 0.5 + ((relBrg - gate.bearingOffsetDeg) / 360);
      const wellCenter = ((wellCenterRaw % 1) + 1) % 1;
      const directDist = Math.abs(t - wellCenter);
      const wellDist = Math.min(directDist, 1 - directDist);
      if (isCelestial) {
        // Type-specific celestial signatures:
        // - planet: broad parabolic hump
        // - asteroid belt: weak jagged cluster of micro-bumps
        const signedWellDeltaRaw = t - wellCenter;
        const signedWellDelta = signedWellDeltaRaw > 0.5
          ? signedWellDeltaRaw - 1
          : signedWellDeltaRaw < -0.5
            ? signedWellDeltaRaw + 1
            : signedWellDeltaRaw;

        if (c.type === "planet") {
          const wellWidth = 0.062;
          if (wellDist < wellWidth) {
            const u = wellDist / wellWidth;
            const parabola = 1 - u * u;
            // Smooth edge envelope to remove hard "pop-in/pop-out" at bump boundaries.
            const edge = 1 - u;
            const easedEdge = edge * edge * (3 - 2 * edge);
            const shaped = parabola * easedEdge;
            const amp = 0.36;
            const massScale = 1.0;
            displacement += shaped * totalMass * massScale * H * amp;
          }
        } else if (c.type === "asteroid_belt") {
          const beltSpan = 0.085;
          if (wellDist < beltSpan) {
            let beltContribution = 0;
            const baseSeed = c.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
            const microCount = 6;
            for (let i = 0; i < microCount; i++) {
              const n0 = noise(baseSeed * 0.23 + i * 7.1, 0.31);
              const n1 = noise(baseSeed * 0.19 + i * 11.7, 0.77);
              const offset = (n0 - 0.5) * beltSpan * 1.5;
              const microWidth = beltSpan * (0.09 + n1 * 0.12);
              const d = Math.abs(signedWellDelta - offset);
              if (d < microWidth) {
                const edge = 1 - d / microWidth;
                const jitter = 0.55 + noise(t * 220 + i * 13.0, time * 1.9 + baseSeed * 0.01) * 0.65;
                beltContribution += edge * edge * jitter * (0.18 + n0 * 0.22);
              }
            }
            displacement += beltContribution * totalMass * H * 0.26;
          }
        } else {
          const fallbackWidth = 0.045;
          if (wellDist < fallbackWidth) {
            const wellDepth = (1 - wellDist / fallbackWidth) * totalMass;
            displacement += wellDepth * H * 0.3;
          }
        }
      } else {
        const wellWidth = 0.06;
        if (wellDist < wellWidth) {
          const wellDepth = (1 - wellDist / wellWidth) * totalMass;
          displacement -= wellDepth * wellDepth * H * 0.25;
        }
      }
      if (!isCelestial && wellDist < 0.03) {
        const dragFreq = 40 + c.range * 0.002;
        displacement += Math.sin(t * dragFreq + time * 2) * totalMass * 5;
      }
    });
    return displacement;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const midY = H / 2;
    const viewL = gate.gateL;
    const viewR = gate.gateR;
    const viewW = viewR - viewL;
    const gateZoom = 1 / Math.max(0.02, viewW);
    const zoomGain = 1 + Math.max(0, gateZoom - 1) * 0.5;

    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, W, H);

    if (warpInterference) {
      ctx.strokeStyle = "rgba(0,204,170,0.07)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const y = (i / 6) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0,204,170,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
      drawShipForwardReference(ctx, W, H, viewL, viewR, gate.bearingOffsetDeg, "rgba(136,255,170,0.9)");

      ctx.beginPath();
      ctx.strokeStyle = GRAV_CYAN;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(68,255,204,0.55)";
      ctx.shadowBlur = 8;
      for (let x = 0; x < W; x++) {
        const t = x / Math.max(1, W - 1);
        const displacement =
          Math.sin(t * 70 + time * 8.5) * 30 +
          Math.sin(t * 155 - time * 12.5) * 18 +
          Math.sin(t * 290 + time * 21) * 10 +
          (noise(t * 180, time * 7) - 0.5) * 70 +
          (noise(t * 420 + 9.3, time * 13) - 0.5) * 32;
        const y = midY + displacement;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.fillRect(W * 0.5 - 170, midY - 26, 340, 52);
      ctx.strokeStyle = "rgba(0,204,170,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(W * 0.5 - 170, midY - 26, 340, 52);
      ctx.font = "24px Consolas, Monaco, monospace";
      ctx.fillStyle = "rgba(255,176,0,0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WARP INTERFERENCE", W * 0.5, midY);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      return;
    }

    if (!scannerOn) {
      ctx.strokeStyle = "rgba(130,130,130,0.08)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const y = (i / 6) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(150,150,150,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
      drawShipForwardReference(ctx, W, H, viewL, viewR, gate.bearingOffsetDeg, "rgba(190,190,190,0.75)");
      ctx.font = "20px Consolas, Monaco, monospace";
      ctx.fillStyle = "rgba(170,170,170,0.75)";
      ctx.fillText("SCANNER OFFLINE", 8, 22);
      return;
    }

    ctx.strokeStyle = "rgba(0,204,170,0.07)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const y = (i / 6) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    ctx.strokeStyle = "rgba(0,204,170,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    drawShipForwardReference(ctx, W, H, viewL, viewR, gate.bearingOffsetDeg, "rgba(136,255,170,0.95)");

    // Check if gravitational well is enclosed by gates
    let hasWellInGate = false;
    const shipHdgCheck = useGameStore.getState().ship.actualHeading;
    gravContacts.forEach(c => {
      if (c.gravProfile === "celestial" && gravHighPassAttenuation(c.type, highPassPct) <= 0.02) return;
      let relBrg = ((c.bearing - shipHdgCheck + 540) % 360) - 180;
      const wellNormRaw = 0.5 + ((relBrg - gate.bearingOffsetDeg) / 360);
      const wellNorm = ((wellNormRaw % 1) + 1) % 1;
      if (wellNorm >= viewL && wellNorm <= viewR && gate.isGated) {
        hasWellInGate = true;
      }
    });
    const traceColor = hasWellInGateUI ? "#44ff66" : nearWellUI ? "#ffd24a" : GRAV_CYAN;
    const traceGlow = hasWellInGateUI ? "#88ffaa" : nearWellUI ? "#ffe38a" : GRAV_CYAN_GLOW;

    // Precompute displacement and auto-scale Y so the trace stays in-bounds.
    const displacementRaw = new Array(W);
    let maxDispAbs = 0;
    for (let x = 0; x < W; x++) {
      const t = viewL + (x / W) * viewW;
      let dRaw = computeDisplacement(t, gravContacts, selectedBearing, H, time) * zoomGain;
      if (!Number.isFinite(dRaw)) dRaw = 0;
      displacementRaw[x] = dRaw;
      const abs = Math.abs(dRaw);
      if (abs > maxDispAbs) maxDispAbs = abs;
    }
    const mainTargetSpan = H * 0.42;
    const mainScaleRaw = maxDispAbs > 0.0001 ? mainTargetSpan / maxDispAbs : 1;
    // Keep zoomed-out view calm: do not over-amplify at wide gates.
    const zoomNorm = Math.max(0, Math.min(1, (gateZoom - 1) / 9));
    const maxMainScale = 1 + zoomNorm * 3;
    const mainScale = Math.max(0.12, Math.min(maxMainScale, mainScaleRaw));
    const displacementScaled = displacementRaw.map((v) => v * mainScale);

    // Main trace
    ctx.beginPath();
    ctx.strokeStyle = traceColor;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = traceGlow;
    ctx.shadowBlur = 5;
    for (let x = 0; x < W; x++) {
      const y = midY - displacementScaled[x];
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Strain trace
    const strainRaw = new Array(W);
    let maxStrainAbs = 0;
    let prevScaled = displacementScaled[0] || 0;
    for (let x = 0; x < W; x++) {
      const d = displacementScaled[x];
      const s = (d - prevScaled) * 3;
      prevScaled = d;
      strainRaw[x] = s;
      const abs = Math.abs(s);
      if (abs > maxStrainAbs) maxStrainAbs = abs;
    }
    const strainBaseY = midY + H * 0.3;
    const strainMaxSwing = Math.max(8, Math.min(strainBaseY, H - strainBaseY) - 4);
    const strainScaleRaw = maxStrainAbs > 0.0001 ? strainMaxSwing / (maxStrainAbs * 2) : 1;
    const maxStrainScale = 1 + zoomNorm * 2.5;
    const strainScale = Math.max(0.2, Math.min(maxStrainScale, strainScaleRaw));

    ctx.beginPath();
    ctx.strokeStyle = hasWellInGate ? "rgba(68,255,102,0.3)" : "rgba(0,204,170,0.3)";
    ctx.lineWidth = 0.8;
    ctx.shadowBlur = 0;
    for (let x = 0; x < W; x++) {
      const strain = strainRaw[x] * strainScale;
      const y = strainBaseY - strain * 2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Gate overlay
    const gateColor = hasWellInGateUI ? "#44ff66" : nearWellUI ? "#ffd24a" : GRAV_CYAN;
    const gateDim = hasWellInGateUI ? "#227733" : nearWellUI ? "#8a6f1a" : GRAV_CYAN_DIM;
    drawGates(ctx, W, H, gate.cursor, gate.gateWidth, gateColor, gateDim);

    // Zoom readout
    ctx.font = "14px Consolas, Monaco, monospace";
    ctx.fillStyle = GRAV_CYAN_DIM;
    ctx.fillText(`ZOOM ${(1 / Math.max(0.001, viewW)).toFixed(1)}x`, 8, 18);
      ctx.textAlign = "right";
      ctx.fillText(`HPF ${Math.round(highPassPct)}%`, W - 8, 18);
      ctx.textAlign = "start";

    // Cursor
    const cursorT = viewL + gate.cursor * viewW;
    const shipHdg2 = useGameStore.getState().ship.actualHeading;
    const cursorAbsBrg = (((shipHdg2 + (cursorT - 0.5) * 360 + gate.bearingOffsetDeg) % 360 + 360) % 360).toFixed(0);
    drawCursor(ctx, W, H, gate.cursor, GRAV_CYAN, GRAV_CYAN_GLOW, `BRG ${String(cursorAbsBrg).padStart(3, "0")}`);

    // Lock indicator
    if (hasWellInGateUI || nearWellUI) {
      ctx.font = "20px Consolas, Monaco, monospace";
      ctx.fillStyle = hasWellInGateUI ? "#44ff66" : "#ffd24a";
      ctx.textAlign = "right";
      ctx.fillText(hasWellInGateUI ? "■ MASS LOCKED" : "■ MASS CLOSE", W - 10, 22);
      ctx.textAlign = "start";
    }

    if (activeGravAnalysis) {
      const boxW = Math.min(W - 40, 600);
      const boxH = 120;
      const boxX = (W - boxW) / 2;
      const boxY = (H - boxH) / 2;
      ctx.fillStyle = "rgba(0,0,0,0.92)";
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = GRAV_CYAN_GLOW;
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      const tx = boxX + 16;
      ctx.font = "18px Consolas, Monaco, monospace";
      ctx.fillStyle = GRAV_CYAN_GLOW;
      ctx.fillText(`ANALYZING: ${activeAnalysisCelestial?.name ?? activeGravAnalysis.celestialId}`, tx, boxY + 26);
      ctx.fillStyle = GRAV_CYAN;
      ctx.fillText(`CLARITY: ${Math.round(activeGravAnalysis.clarity * 100)}%`, tx, boxY + 52);
      ctx.fillText(`TIME: ${(activeAnalysisRemaining / 1000).toFixed(1)} s`, tx + boxW / 2, boxY + 52);
      ctx.fillRect(tx, boxY + 72, (boxW - 32) * activeAnalysisProgress, 16);
      ctx.strokeStyle = GRAV_CYAN_DIM;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, boxY + 72, boxW - 32, 16);
      ctx.font = "14px Consolas, Monaco, monospace";
      ctx.fillStyle = GRAV_CYAN_DIM;
      ctx.fillText(`TRACK SOLUTION ${(activeAnalysisProgress * 100).toFixed(0)}%`, tx, boxY + 104);
    } else if (recentAnalysisResult && displayedResultLabel) {
      const boxW = Math.min(W - 40, 560);
      const boxH = 88;
      const boxX = (W - boxW) / 2;
      const boxY = (H - boxH) / 2;
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = "#44ff66";
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.font = "18px Consolas, Monaco, monospace";
      ctx.fillStyle = "#88ffaa";
      ctx.fillText(`TRACK REVEALED: ${displayedResultLabel.toUpperCase()}`, boxX + 16, boxY + 30);
      ctx.font = "16px Consolas, Monaco, monospace";
      ctx.fillStyle = "#44ff66";
      ctx.fillText(
        `ANALYSIS ${(recentAnalysisResult.durationMs / 1000).toFixed(1)}s  |  CLARITY ${Math.round(recentAnalysisResult.clarity * 100)}%`,
        boxX + 16,
        boxY + 58
      );
    }
  }, [time, gravContacts, selectedBearing, gate.gateL, gate.gateR, gate.cursor, gate.isGated, gate.bearingOffsetDeg, hasWellInGateUI, nearWellUI, scannerOn, warpInterference, gain, highPassPct, activeGravAnalysis, activeAnalysisCelestial, activeAnalysisProgress, activeAnalysisRemaining, recentAnalysisResult, displayedResultLabel]);

  const font = "'Consolas', 'Monaco', monospace";
  const shipHeading = useGameStore((s) => s.ship.actualHeading);
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (!scannerUsable) return;
      const gainStep = e.deltaY < 0 ? 0.05 : -0.05;
        setGain((prev) => Math.max(0.5, Math.min(2, Number((prev + gainStep).toFixed(2)))));
      return;
    }
    if (e.altKey) {
      e.preventDefault();
      if (!scannerUsable) return;
      const hpfStep = e.deltaY < 0 ? 2 : -2;
      setHighPassPct((prev) => Math.max(0, Math.min(100, prev + hpfStep)));
      return;
    }
    if (!scannerUsable) return;
    gate.onWheel(e);
  }, [scannerUsable, gate]);
  const viewSpanDeg = Math.max(1, (gate.gateR - gate.gateL) * 360);
  const viewCenterT = (gate.gateL + gate.gateR) / 2;
  const centerBearing = (((shipHeading + (viewCenterT - 0.5) * 360 + gate.bearingOffsetDeg) % 360) + 360) % 360;
  const nearestThirty = Math.round(centerBearing / 30) * 30;
  const bearingTapeTicks = Array.from({ length: 41 }, (_, i) => {
    const rawDeg = nearestThirty + (i - 20) * 30;
    const deltaDeg = rawDeg - centerBearing;
    const leftPct = 50 + (deltaDeg / viewSpanDeg) * 100;
    const wrapped = ((rawDeg % 360) + 360) % 360;
    const labelVal = wrapped === 360 ? 0 : wrapped;
    return {
      key: `${rawDeg}`,
      leftPct,
      label: `${labelVal}`,
    };
  }).filter(t => t.leftPct >= -5 && t.leftPct <= 105);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={280}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              background: BG_SCREEN,
              cursor: scannerUsable ? "crosshair" : "not-allowed",
              pointerEvents: scannerUsable ? "auto" : "none",
            }}
            onMouseDown={scannerUsable ? gate.onMouseDown : undefined}
            onMouseMove={scannerUsable ? gate.onMouseMove : undefined}
            onMouseUp={scannerUsable ? gate.onMouseUp : undefined}
            onMouseLeave={scannerUsable ? gate.onMouseUp : undefined}
            onWheel={scannerUsable ? handleWheel : undefined}
            onContextMenu={scannerUsable ? gate.onContextMenu : undefined}
          />
        </div>
        <div style={{
          width: GRAV_CONTROL_RACK_WIDTH,
          borderLeft: `1px solid ${GRAV_CYAN_DIM}55`,
          background: "rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "row",
          flexShrink: 0,
        }}>
          <div style={{
            width: GRAV_CONTROL_COLUMN_WIDTH,
            borderRight: `1px solid ${GRAV_CYAN_DIM}33`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 2px",
          }}>
            <span style={{ fontSize: 8, letterSpacing: 1, color: scannerUsable || warpInterference ? GRAV_CYAN_DIM : "rgba(150,150,150,0.8)" }}>GAIN</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={gain}
              disabled={!scannerUsable}
              onChange={(e) => setGain(Number(e.target.value))}
              style={{
                width: 150,
                transform: "rotate(-90deg)",
                accentColor: scannerUsable || warpInterference ? GRAV_CYAN : "rgba(130,130,130,0.6)",
                cursor: scannerUsable ? "pointer" : "not-allowed",
              }}
              aria-label="Gravimetric gain"
            />
            <span style={{
              fontSize: 8,
              letterSpacing: 1,
              color: scannerUsable || warpInterference ? GRAV_CYAN : "rgba(150,150,150,0.8)",
              minWidth: 34,
              textAlign: "center",
            }}>
              {gain.toFixed(2)}x
            </span>
          </div>
          <div style={{
            width: GRAV_CONTROL_COLUMN_WIDTH,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 2px",
          }}>
            <span style={{ fontSize: 8, letterSpacing: 1, color: scannerUsable || warpInterference ? GRAV_CYAN_DIM : "rgba(150,150,150,0.8)" }}>HPF</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={highPassPct}
              disabled={!scannerUsable}
              onChange={(e) => setHighPassPct(Number(e.target.value))}
              style={{
                width: 150,
                transform: "rotate(-90deg)",
                accentColor: scannerUsable || warpInterference ? GRAV_CYAN : "rgba(130,130,130,0.6)",
                cursor: scannerUsable ? "pointer" : "not-allowed",
              }}
              aria-label="Gravimetric high pass filter"
            />
            <span style={{
              fontSize: 8,
              letterSpacing: 1,
              color: scannerUsable || warpInterference ? GRAV_CYAN : "rgba(150,150,150,0.8)",
              minWidth: 34,
              textAlign: "center",
            }}>
              {Math.round(highPassPct)}%
            </span>
          </div>
        </div>
      </div>
      <div style={{
        display: "flex",
        borderTop: `1px solid ${GRAV_CYAN_DIM}55`,
        background: "rgba(0,0,0,0.35)",
        flexShrink: 0,
        minHeight: 32,
      }}>
        <div style={{ flex: 1, minWidth: 0, padding: "3px 8px 5px" }}>
          <div style={{
            position: "relative",
            height: 20,
            overflow: "hidden",
            fontFamily: font,
          }}>
            {bearingTapeTicks.map((tick) => (
              <span
                key={tick.key}
                style={{
                  position: "absolute",
                  left: `${tick.leftPct}%`,
                  transform: "translateX(-50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                  textShadow: scannerUsable ? "0 0 4px rgba(68,255,204,0.35)" : "none",
                  color: scannerUsable || warpInterference ? GRAV_CYAN_GLOW : "rgba(170,170,170,0.9)",
                  fontSize: 10,
                  fontWeight: "bold",
                  letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: 1,
                    height: 7,
                    background: scannerUsable || warpInterference ? GRAV_CYAN : "rgba(150,150,150,0.8)",
                  }}
                />
                <span>{tick.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div
          style={{
            width: GRAV_CONTROL_RACK_WIDTH,
            borderLeft: `1px solid ${GRAV_CYAN_DIM}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 4px 6px",
          }}
        >
          <button
            onClick={() => {
              if (canStartAnalysis && gravQuality.target && gravQuality.celestialId) {
                startEwGravAnalysis({
                  celestialId: gravQuality.celestialId,
                  anomalyId: gravQuality.target.id,
                  startedAt: Date.now(),
                  durationMs: gravQuality.durationMs,
                  clarity: gravQuality.clarity,
                });
              }
            }}
            disabled={!canStartAnalysis}
            style={{
              width: "100%",
              padding: "4px 4px",
              fontSize: 10,
              letterSpacing: 1,
              background: !scannerUsable
                ? (warpInterference ? "rgba(0,204,170,0.08)" : "rgba(100,100,100,0.08)")
                : activeGravAnalysis
                  ? "rgba(0,204,170,0.08)"
                  : targetAlreadyRevealed
                    ? "rgba(68,255,102,0.08)"
                    : hasWellInGateUI
                      ? "rgba(68,255,102,0.15)"
                      : nearWellUI
                        ? "rgba(255,210,74,0.15)"
                        : "rgba(0,204,170,0.1)",
              border: `1px solid ${!scannerUsable ? (warpInterference ? "rgba(0,204,170,0.35)" : "rgba(130,130,130,0.35)") : activeGravAnalysis ? GRAV_CYAN : targetAlreadyRevealed ? "#44ff66" : hasWellInGateUI ? "#44ff66" : nearWellUI ? "#ffd24a" : GRAV_CYAN}`,
              color: !scannerUsable ? (warpInterference ? GRAV_CYAN : "rgba(160,160,160,0.65)") : activeGravAnalysis ? GRAV_CYAN_GLOW : targetAlreadyRevealed ? "#88ffaa" : hasWellInGateUI ? "#44ff66" : nearWellUI ? "#ffd24a" : GRAV_CYAN,
              fontFamily: font,
              cursor: canStartAnalysis ? "pointer" : "not-allowed",
              borderRadius: 1,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {activeGravAnalysis && (
              <span style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${activeAnalysisProgress * 100}%`,
                background: "rgba(0,204,170,0.15)",
                transition: "width 0.5s linear",
              }} />
            )}
            <span style={{ position: "relative" }}>
              {warpInterference
                ? "WARP"
                : activeGravAnalysis
                  ? "ANALYZING"
                  : targetAlreadyRevealed
                    ? "KNOWN"
                    : "ANALYZE"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

const IrAnalyzer = ({
  contacts,
  time,
  selectedBearing,
  onBearingChange,
  resetToken = 0,
  scannerOn = true,
}) => {
  const canvasRef = useRef(null);
  const gate = useGate();
  const prevCursor = useRef(gate.cursor);
  const [gain, setGain] = useState(1.0);
  const [hasQualifiedThermalInGate, setHasQualifiedThermalInGate] = useState(false);
  const starSystem = useGameStore((s) => s.starSystem);
  const currentCelestialId = useGameStore((s) => s.currentCelestialId);
  const shipHeadingDeg = useGameStore((s) => s.ship.actualHeading);
  const setShipState = useGameStore((s) => s.setShipState);
  const warpState = useGameStore((s) => s.warpState);
  const warpInterference = warpState === "warping" || warpState === "landing";
  const scannerUsable = scannerOn && !warpInterference;

  const irSources = useMemo(() => {
    const shipSources = contacts.map((c) => ({
      ...c,
      irProfile: "ship",
      thermal: Math.max(0.05, c.thermal ?? 0.08),
      inclination: c.inclination ?? 0,
    }));
    return [...shipSources, ...buildIrSourcesFromEnvironment(starSystem, currentCelestialId)];
  }, [contacts, starSystem, currentCelestialId]);

  const inGateThermalTarget = useMemo(() => {
    if (!gate.isGated) return null;
    let bestTarget = null;
    let bestSignal = -Infinity;
    for (const c of irSources) {
      if (c.irProfile !== "ship") continue;
      const relBrg = ((c.bearing - shipHeadingDeg + 540) % 360) - 180;
      const wellNormRaw = 0.5 + ((relBrg - gate.bearingOffsetDeg) / 360);
      const wellNorm = ((wellNormRaw % 1) + 1) % 1;
      if (wellNorm < gate.gateL || wellNorm > gate.gateR) continue;
      const thermalStrength = Math.max(0.04, c.thermal ?? 0.08);
      const rangeKm = c.range / 1000;
      const rangeAttenuation = inverseCubeAttenuation(rangeKm, IR_SHIP_REFERENCE_RANGE_KM);
      const signalScore = thermalStrength * rangeAttenuation;
      if (signalScore > bestSignal) {
        bestSignal = signalScore;
        bestTarget = c;
      }
    }
    return bestTarget;
  }, [irSources, gate.isGated, gate.gateL, gate.gateR, gate.bearingOffsetDeg, shipHeadingDeg]);

  useEffect(() => {
    if (!scannerUsable) return;
    if (gate.cursor !== prevCursor.current && onBearingChange) {
      const viewL = gate.gateL;
      const viewW = gate.gateR - gate.gateL;
      const cursorT = viewL + gate.cursor * viewW;
      const shipHdg = useGameStore.getState().ship.actualHeading;
      const newBearing = Math.round(shipHdg - 180 + cursorT * 360 + gate.bearingOffsetDeg);
      onBearingChange(((newBearing % 360) + 360) % 360);
    }
    prevCursor.current = gate.cursor;
  }, [gate.cursor, onBearingChange, gate.gateL, gate.gateR, gate.bearingOffsetDeg, scannerUsable]);

  useEffect(() => {
    gate.reset();
  }, [resetToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const midY = H / 2;
    const viewL = gate.gateL;
    const viewR = gate.gateR;
    const viewW = viewR - viewL;
    const gateZoom = 1 / Math.max(0.02, viewW);
    const zoomGain = 1 + Math.max(0, gateZoom - 1) * 0.45;

    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, W, H);

    if (warpInterference) {
      setHasQualifiedThermalInGate(false);
      ctx.strokeStyle = "rgba(255,154,60,0.07)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const y = (i / 6) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,154,60,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
      drawShipForwardReference(ctx, W, H, viewL, viewR, gate.bearingOffsetDeg, "rgba(255,226,138,0.9)");

      ctx.beginPath();
      ctx.strokeStyle = IR_ORANGE;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(255,184,111,0.6)";
      ctx.shadowBlur = 8;
      for (let x = 0; x < W; x++) {
        const t = x / Math.max(1, W - 1);
        const displacement =
          Math.sin(t * 85 + time * 6.1) * 28
          + Math.sin(t * 170 - time * 8.5) * 14
          + (noise(t * 280, time * 5.2) - 0.5) * 54;
        const y = midY + displacement;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.fillRect(W * 0.5 - 170, midY - 26, 340, 52);
      ctx.strokeStyle = "rgba(255,154,60,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(W * 0.5 - 170, midY - 26, 340, 52);
      ctx.font = "22px Consolas, Monaco, monospace";
      ctx.fillStyle = "rgba(255,176,0,0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WARP INTERFERENCE", W * 0.5, midY);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      return;
    }

    if (!scannerOn) {
      setHasQualifiedThermalInGate(false);
      ctx.strokeStyle = "rgba(130,130,130,0.08)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const y = (i / 6) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(150,150,150,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
      drawShipForwardReference(ctx, W, H, viewL, viewR, gate.bearingOffsetDeg, "rgba(190,190,190,0.75)");
      ctx.font = "20px Consolas, Monaco, monospace";
      ctx.fillStyle = "rgba(170,170,170,0.75)";
      ctx.fillText("SCANNER OFFLINE", 8, 22);
      return;
    }

    ctx.strokeStyle = "rgba(255,154,60,0.07)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const y = (i / 6) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,154,60,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    drawShipForwardReference(ctx, W, H, viewL, viewR, gate.bearingOffsetDeg, "rgba(255,226,138,0.95)");

    let hasThermalContactInGate = false;
    let hasSolarInGate = false;
    let maxThermalPeakRaw = 0;
    const shipHdgCheck = useGameStore.getState().ship.actualHeading;
    irSources.forEach((c) => {
      const relBrg = ((c.bearing - shipHdgCheck + 540) % 360) - 180;
      const wellNormRaw = 0.5 + ((relBrg - gate.bearingOffsetDeg) / 360);
      const wellNorm = ((wellNormRaw % 1) + 1) % 1;
      if (wellNorm >= viewL && wellNorm <= viewR && gate.isGated) {
        if (c.irProfile === "solar") {
          hasSolarInGate = true;
        } else {
          hasThermalContactInGate = true;
          const thermalStrength = Math.max(0.04, c.thermal ?? 0.08);
          const rangeKm = c.range / 1000;
          const rangeAttenuation = inverseCubeAttenuation(rangeKm, IR_SHIP_REFERENCE_RANGE_KM);
          const strength = thermalStrength * 0.475 * rangeAttenuation * (0.8 + gain * 0.5);
          const peakRaw = strength * H * 0.42;
          if (peakRaw > maxThermalPeakRaw) {
            maxThermalPeakRaw = peakRaw;
          }
        }
      }
    });

    const traceColor = hasSolarInGate ? "#ffd24a" : hasThermalContactInGate ? "#ffb86f" : IR_ORANGE;
    const traceGlow = hasSolarInGate ? "#ffe28a" : hasThermalContactInGate ? "#ffd0a0" : IR_ORANGE_GLOW;
    const displacementRaw = new Array(W);
    let maxDispAbs = 0;
    let noiseAbsSum = 0;
    const gainNoiseBoost = 0.85 + Math.max(0, gain - 1) * 2.6;

    for (let x = 0; x < W; x++) {
      const t = viewL + (x / W) * viewW;
      const baselineNoise =
        (Math.sin(t * 7 + time * 0.7) * 5
          + Math.sin(t * 17 + time * 1.2) * 3
          + (noise(t * 45, time * 0.9) - 0.5) * 9
          + (noise(t * 140, time * 1.7) - 0.5) * 7 - 3) * gainNoiseBoost * 4;
      noiseAbsSum += Math.abs(baselineNoise);
      let displacement = baselineNoise;

      irSources.forEach((c) => {
        const relBrg = ((c.bearing - shipHdgCheck + 540) % 360) - 180;

        const wellCenterRaw = 0.5 + ((relBrg - gate.bearingOffsetDeg) / 360);
        const wellCenter = ((wellCenterRaw % 1) + 1) % 1;
        const directDist = Math.abs(t - wellCenter);
        const wellDist = Math.min(directDist, 1 - directDist);

        let width = 0.024;
        let strength = 0;
        if (c.irProfile === "solar") {
          // Solar source is a special case: keep it always visible.
          const rangeAttenuation = 1;
          // Broad lobe: roughly 2x the previous angular footprint.
          width = 0.104;
          strength = 8.5 * rangeAttenuation * Math.max(0.9, gain * 1.1);
        } else {
          const thermalStrength = Math.max(0.04, c.thermal ?? 0.08);
          const rangeKm = c.range / 1000;
          const rangeAttenuation = inverseCubeAttenuation(rangeKm, IR_SHIP_REFERENCE_RANGE_KM);
          width = 0.01 + Math.min(0.015, thermalStrength * 0.02);
          strength = thermalStrength * 4.75 * rangeAttenuation * (0.8 + gain * 0.5);
        }

        if (wellDist < width) {
          let shaped;
          if (c.irProfile === "solar") {
            // Smooth bell curve for solar IR instead of a sharp punctate peak.
            const sigma = width * 0.42;
            const u = wellDist / Math.max(0.0001, sigma);
            const raw = Math.exp(-0.5 * u * u);
            const edgeU = width / Math.max(0.0001, sigma);
            const edgeRaw = Math.exp(-0.5 * edgeU * edgeU);
            // Normalize the bell so it reaches exactly zero at the cutoff edge.
            shaped = Math.max(0, (raw - edgeRaw) / Math.max(0.0001, 1 - edgeRaw));
          } else {
            const spike = 1 - (wellDist / width);
            shaped = spike * spike;
          }
          displacement += shaped * strength * H * 0.42;
        }
      });

      const dRaw = displacement * zoomGain;
      displacementRaw[x] = dRaw;
      const abs = Math.abs(dRaw);
      if (abs > maxDispAbs) maxDispAbs = abs;
    }
    const avgNoiseLevelRaw = noiseAbsSum / Math.max(1, W);
    const hasThermalInGate = hasThermalContactInGate && maxThermalPeakRaw >= avgNoiseLevelRaw * 2;
    setHasQualifiedThermalInGate(hasThermalInGate);

    const targetSpan = H * 0.42;
    const scaleRaw = maxDispAbs > 0.0001 ? targetSpan / maxDispAbs : 1;
    const zoomNorm = Math.max(0, Math.min(1, (gateZoom - 1) / 9));
    const maxScale = 1 + zoomNorm * 3;
    const scale = Math.max(0.12, Math.min(maxScale, scaleRaw));

    ctx.beginPath();
    ctx.strokeStyle = traceColor;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = traceGlow;
    ctx.shadowBlur = 5;
    for (let x = 0; x < W; x++) {
      const y = midY - displacementRaw[x] * scale;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const gateColor = hasSolarInGate ? "#ffd24a" : hasThermalContactInGate ? "#ffb86f" : IR_ORANGE;
    const gateDim = hasSolarInGate ? "#8a6f1a" : hasThermalContactInGate ? "#6e3f12" : IR_ORANGE_DIM;
    drawGates(ctx, W, H, gate.cursor, gate.gateWidth, gateColor, gateDim);

    ctx.font = "14px Consolas, Monaco, monospace";
    ctx.fillStyle = IR_ORANGE_DIM;
    ctx.fillText(`ZOOM ${(1 / Math.max(0.001, viewW)).toFixed(1)}x`, 8, 18);
    ctx.textAlign = "right";
    ctx.fillText(`GAIN ${gain.toFixed(2)}x`, W - 8, 18);
    ctx.textAlign = "start";

    const cursorT = viewL + gate.cursor * viewW;
    const shipHdg2 = useGameStore.getState().ship.actualHeading;
    const cursorAbsBrg = (((shipHdg2 + (cursorT - 0.5) * 360 + gate.bearingOffsetDeg) % 360 + 360) % 360).toFixed(0);
    drawCursor(ctx, W, H, gate.cursor, IR_ORANGE, IR_ORANGE_GLOW, `BRG ${String(cursorAbsBrg).padStart(3, "0")}`);

    if (hasSolarInGate || hasThermalInGate) {
      ctx.font = "20px Consolas, Monaco, monospace";
      ctx.fillStyle = hasSolarInGate ? "#ffd24a" : "#ffb86f";
      ctx.textAlign = "right";
      ctx.fillText(hasSolarInGate ? "■ SOLAR SPIKE LOCKED" : "■ THERMAL CONTACT IN GATE", W - 10, 22);
      ctx.textAlign = "start";
    }
  }, [time, irSources, selectedBearing, gate.gateL, gate.gateR, gate.cursor, gate.isGated, gate.bearingOffsetDeg, scannerOn, warpInterference, gain]);

  const font = "'Consolas', 'Monaco', monospace";
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (!scannerUsable) return;
      const gainStep = e.deltaY < 0 ? 0.05 : -0.05;
      setGain((prev) => Math.max(0.5, Math.min(2, Number((prev + gainStep).toFixed(2)))));
      return;
    }
    if (!scannerUsable) return;
    gate.onWheel(e);
  }, [scannerUsable, gate]);

  const viewSpanDeg = Math.max(1, (gate.gateR - gate.gateL) * 360);
  const viewCenterT = (gate.gateL + gate.gateR) / 2;
  const centerBearing = (((shipHeadingDeg + (viewCenterT - 0.5) * 360 + gate.bearingOffsetDeg) % 360) + 360) % 360;
  const nearestThirty = Math.round(centerBearing / 30) * 30;
  const bearingTapeTicks = Array.from({ length: 41 }, (_, i) => {
    const rawDeg = nearestThirty + (i - 20) * 30;
    const deltaDeg = rawDeg - centerBearing;
    const leftPct = 50 + (deltaDeg / viewSpanDeg) * 100;
    const wrapped = ((rawDeg % 360) + 360) % 360;
    const labelVal = wrapped === 360 ? 0 : wrapped;
    return {
      key: `${rawDeg}`,
      leftPct,
      label: `${labelVal}`,
    };
  }).filter((t) => t.leftPct >= -5 && t.leftPct <= 105);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={280}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              background: BG_SCREEN,
              cursor: scannerUsable ? "crosshair" : "not-allowed",
              pointerEvents: scannerUsable ? "auto" : "none",
            }}
            onMouseDown={scannerUsable ? gate.onMouseDown : undefined}
            onMouseMove={scannerUsable ? gate.onMouseMove : undefined}
            onMouseUp={scannerUsable ? gate.onMouseUp : undefined}
            onMouseLeave={scannerUsable ? gate.onMouseUp : undefined}
            onWheel={scannerUsable ? handleWheel : undefined}
            onContextMenu={scannerUsable ? gate.onContextMenu : undefined}
          />
        </div>
        <div style={{
          width: GRAV_CONTROL_RACK_WIDTH,
          borderLeft: `1px solid ${IR_ORANGE_DIM}55`,
          background: "rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "row",
          flexShrink: 0,
        }}>
          <div style={{
            width: GRAV_CONTROL_COLUMN_WIDTH,
            borderRight: `1px solid ${IR_ORANGE_DIM}33`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 2px",
          }}>
            <span style={{ fontSize: 8, letterSpacing: 1, color: scannerUsable || warpInterference ? IR_ORANGE_DIM : "rgba(150,150,150,0.8)" }}>GAIN</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={gain}
              disabled={!scannerUsable}
              onChange={(e) => setGain(Number(e.target.value))}
              style={{
                width: 150,
                transform: "rotate(-90deg)",
                accentColor: scannerUsable || warpInterference ? IR_ORANGE : "rgba(130,130,130,0.6)",
                cursor: scannerUsable ? "pointer" : "not-allowed",
              }}
              aria-label="IR gain"
            />
            <span style={{
              fontSize: 8,
              letterSpacing: 1,
              color: scannerUsable || warpInterference ? IR_ORANGE : "rgba(150,150,150,0.8)",
              minWidth: 34,
              textAlign: "center",
            }}>
              {gain.toFixed(2)}x
            </span>
          </div>
          <div style={{ flex: 1 }} />
        </div>
      </div>
      <div style={{
        display: "flex",
        borderTop: `1px solid ${IR_ORANGE_DIM}55`,
        background: "rgba(0,0,0,0.35)",
        flexShrink: 0,
        minHeight: 32,
      }}>
        <div style={{ flex: 1, minWidth: 0, padding: "3px 8px 5px" }}>
          <div style={{
            position: "relative",
            height: 20,
            overflow: "hidden",
            fontFamily: font,
          }}>
            {bearingTapeTicks.map((tick) => (
              <span
                key={tick.key}
                style={{
                  position: "absolute",
                  left: `${tick.leftPct}%`,
                  transform: "translateX(-50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                  textShadow: scannerUsable ? "0 0 4px rgba(255,184,111,0.35)" : "none",
                  color: scannerUsable || warpInterference ? IR_ORANGE_GLOW : "rgba(170,170,170,0.9)",
                  fontSize: 10,
                  fontWeight: "bold",
                  letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: 1,
                    height: 7,
                    background: scannerUsable || warpInterference ? IR_ORANGE : "rgba(150,150,150,0.8)",
                  }}
                />
                <span>{tick.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div
          style={{
            width: GRAV_CONTROL_RACK_WIDTH,
            borderLeft: `1px solid ${IR_ORANGE_DIM}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 4px 6px",
          }}
        >
          <button
            onClick={() => {
              if (!scannerUsable || !inGateThermalTarget || !hasQualifiedThermalInGate) return;
              const nextBearing = ((inGateThermalTarget.bearing % 360) + 360) % 360;
              const nextInclination = Math.max(-90, Math.min(90, inGateThermalTarget.inclination ?? 0));
              setShipState({
                irstBearing: nextBearing,
                irstInclination: nextInclination,
              });
            }}
            disabled={!scannerUsable || !inGateThermalTarget || !hasQualifiedThermalInGate}
            style={{
              width: "100%",
              padding: "4px 4px",
              fontSize: 10,
              letterSpacing: 1,
              background: !scannerUsable
                ? "rgba(100,100,100,0.08)"
                : inGateThermalTarget && hasQualifiedThermalInGate
                  ? "rgba(255,154,60,0.18)"
                  : "rgba(255,154,60,0.08)",
              border: `1px solid ${!scannerUsable ? "rgba(130,130,130,0.35)" : (inGateThermalTarget && hasQualifiedThermalInGate) ? IR_ORANGE : IR_ORANGE_DIM}`,
              color: !scannerUsable
                ? "rgba(160,160,160,0.65)"
                : (inGateThermalTarget && hasQualifiedThermalInGate)
                  ? IR_ORANGE_GLOW
                  : "rgba(190,130,90,0.95)",
              fontFamily: font,
              cursor: scannerUsable && inGateThermalTarget && hasQualifiedThermalInGate ? "pointer" : "not-allowed",
              borderRadius: 1,
            }}
            aria-label="Send gated thermal target to IRST"
          >
            IRST SEND
          </button>
        </div>
      </div>
    </div>
  );
};

// F-16 / F-22 style B-Scope Radar
const RANGE_SCALES = [10, 20, 40, 80, 160];
const AZ_OPTIONS = [30, 60, 90];

const BScope = ({ contacts, time, selectedContact, onSelectContact, lockState, setLockState, iffState, setIffState, radarOn, spectrumQuality }) => {
  const canvasRef = useRef(null);
  const [rangeIdx, setRangeIdx] = useState(2);
  const [azIdx, setAzIdx] = useState(1);
  const [contextMenu, setContextMenu] = useState(null);
  const contactHitBoxes = useRef([]);
  const passiveSnapshotsRef = useRef({});
  const lastStepRef = useRef(-1);
  const maxRange = RANGE_SCALES[rangeIdx] * 1000;
  const azHalf = AZ_OPTIONS[azIdx];
  const scanBarRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const MARGIN_L = 60;
    const MARGIN_R = 20;
    const MARGIN_T = 48;
    const MARGIN_B = 56;
    const scopeW = W - MARGIN_L - MARGIN_R;
    const scopeH = H - MARGIN_T - MARGIN_B;
    const azToScopeX = (azDeg) => MARGIN_L + ((azDeg + azHalf) / (azHalf * 2)) * scopeW;

    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN_L, MARGIN_T, scopeW, scopeH);
    ctx.clip();

    // Horizontal range lines
    const rangeKm = maxRange / 1000;
    const numLines = 4;
    for (let i = 0; i <= numLines; i++) {
      const y = MARGIN_T + (i / numLines) * scopeH;
      ctx.strokeStyle = i === numLines ? GRID_COLOR_BRIGHT : GRID_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN_L, y);
      ctx.lineTo(MARGIN_L + scopeW, y);
      ctx.stroke();
    }

    // Vertical azimuth lines
    const azStep = azHalf <= 30 ? 5 : azHalf <= 60 ? 15 : 15;
    const azLines = [];
    for (let a = -azHalf; a <= azHalf; a += azStep) azLines.push(a);
    azLines.forEach(az => {
      const x = azToScopeX(az);
      ctx.strokeStyle = az === 0 ? GRID_COLOR_BRIGHT : GRID_COLOR;
      ctx.lineWidth = az === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, MARGIN_T);
      ctx.lineTo(x, MARGIN_T + scopeH);
      ctx.stroke();
    });

    // Wing line — shows ship roll/turn to EW officer
    const shipState = useGameStore.getState().ship;
    const shipHeading = shipState.actualHeading;
    const rollDeg = shipState.rollAngle || 0;
    const bearingCmd = shipState.bearing;
    const headingDelta = ((bearingCmd - shipHeading + 540) % 360) - 180;
    {
      const centerX = MARGIN_L + scopeW / 2;
      const centerY = MARGIN_T + scopeH / 2;
      const wingLen = scopeW * 0.42;
      const rollRad = (-rollDeg * Math.PI) / 180;
      const dx = Math.cos(rollRad) * wingLen;
      const dy = Math.sin(rollRad) * wingLen;

      ctx.strokeStyle = "rgba(80, 140, 255, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX - dx, centerY + dy);
      ctx.lineTo(centerX + dx, centerY - dy);
      ctx.stroke();

      // Commanded bearing indicator — small chevron showing where the ship is turning
      if (Math.abs(headingDelta) > 1) {
        const cmdNorm = (-headingDelta + azHalf) / (azHalf * 2);
        const cmdX = MARGIN_L + Math.max(0, Math.min(1, cmdNorm)) * scopeW;
        ctx.strokeStyle = "rgba(80, 140, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cmdX - 5, MARGIN_T + 10);
        ctx.lineTo(cmdX, MARGIN_T + 2);
        ctx.lineTo(cmdX + 5, MARGIN_T + 10);
        ctx.stroke();
      }
    }

    // Bottom-line scan sweep — only when radar is on
    if (!radarOn) { scanBarRef.current = 0; }
    const hardLockedContact = contacts.find(c => lockState[c.id] === "hard");
    let sweepCenterNorm = 0.5;
    let sweepWidthNorm = 1.0;
    let sweepSpeed = 0.006;

    if (hardLockedContact) {
      const lockedRel = ((hardLockedContact.bearing - shipHeading + 540) % 360) - 180;
      sweepCenterNorm = (-lockedRel + azHalf) / (azHalf * 2);
      sweepWidthNorm = 10 / azHalf;
      sweepSpeed = 0.012;
    }

    const bottomY = MARGIN_T + scopeH;
    if (radarOn) {
      scanBarRef.current = (scanBarRef.current + sweepSpeed) % 1;
      const scanPhase = Math.sin(scanBarRef.current * Math.PI * 2);
      const sweepLeft = sweepCenterNorm - sweepWidthNorm / 2;
      const sweepRight = sweepCenterNorm + sweepWidthNorm / 2;
      const scanNorm = sweepLeft + ((scanPhase + 1) / 2) * (sweepRight - sweepLeft);
      const scanX = MARGIN_L + scanNorm * scopeW;
      ctx.strokeStyle = hardLockedContact ? "rgba(255,176,0,0.25)" : "rgba(255,176,0,0.15)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scanX - 40, bottomY);
      ctx.lineTo(scanX + 40, bottomY);
      ctx.stroke();
      ctx.strokeStyle = hardLockedContact ? "rgba(255,176,0,0.1)" : "rgba(255,176,0,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(scanX, bottomY - 12);
      ctx.lineTo(scanX, bottomY);
      ctx.stroke();
    }

    // Update passive snapshots every ~2.5 seconds
    const currentStep = Math.floor(time / 2.5);
    const stepChanged = currentStep !== lastStepRef.current;
    if (stepChanged) lastStepRef.current = currentStep;

    // Plot contacts
    const hits = [];
    contacts.forEach(c => {
      const sig = Math.max(c.emStrength, c.thermal * 0.5);
      const passiveDetect = !!c.passiveDetect;
      const activeDetect = !!c.activeDetect;

      // Notching kills both active AND passive on the B-scope
      if (c.heading !== undefined && c.speed > 1) {
        const bearingToPlayer = (c.bearing + 180) % 360;
        const aspect = Math.abs(((c.heading - bearingToPlayer + 540) % 360) - 180);
        const beamAngle = Math.abs(aspect - 90);
        if (beamAngle <= 10) {
          if (!activeDetect) return;
        }
      }

      if (!passiveDetect && !activeDetect) return;
      if (c.range > maxRange) return;
      const passiveOnly = passiveDetect && !activeDetect;
      const displaySig = activeDetect ? Math.max(sig, 0.3) : sig;

      const relBearing = ((c.bearing - shipHeading + 540) % 360) - 180;
      let displayRelBrg = relBearing;

      // Passive-only contacts: intermittent, frozen snapshots with massive uncertainty
      let displayRange = c.range;
      if (passiveOnly) {
        const specReduce = spectrumQuality === "locked" ? 0.1 : spectrumQuality === "close" ? 0.3 : 1.0;
        const seed = c.id.charCodeAt(0);

        // Only visible ~40% of update cycles (spectrum lock improves to ~70%/~90%)
        const visChance = spectrumQuality === "locked" ? 0.9 : spectrumQuality === "close" ? 0.7 : 0.4;

        if (stepChanged || !passiveSnapshotsRef.current[c.id]) {
          const showRoll = noise(seed * 2.3, currentStep * 0.7);
          const visible = showRoll < visChance;
          const brgFuzz = (noise(seed * 3.7, currentStep * 1.3) - 0.5) * 80 * specReduce;
          const rngFuzz = (noise(seed * 7.1, currentStep * 0.9) - 0.5) * 1.2 * specReduce;
          passiveSnapshotsRef.current[c.id] = {
            relBrg: relBearing + brgFuzz,
            range: c.range * (1 + rngFuzz),
            visible,
          };
        }

        const snap = passiveSnapshotsRef.current[c.id];
        if (!snap.visible) return;
        displayRelBrg = snap.relBrg;
        displayRange = snap.range;
      }

      if (Math.abs(displayRelBrg) > azHalf) return;

      const rangeNorm = Math.min(displayRange / maxRange, 1);
      const px = azToScopeX(displayRelBrg);
      const py = MARGIN_T + (1 - rangeNorm) * scopeH;

      hits.push({ id: c.id, x: px, y: py, w: 40, h: 32 });

      const lock = lockState[c.id];
      const iff = iffState[c.id] || "UNK";
      const isLocked = lock === "hard" || lock === "soft";
      const iffColor = iff === "HOSTILE" ? RED_ALERT : iff === "FRIENDLY" ? "#00ff66" : AMBER;

      const brickW = 12 + displaySig * 16;
      const brickH = 6;
      if (passiveOnly) {
        ctx.strokeStyle = `rgba(255,176,0,${0.3 + displaySig * 0.5})`;
        ctx.lineWidth = 1;
        ctx.shadowColor = AMBER_GLOW;
        ctx.shadowBlur = displaySig * 4;
        ctx.strokeRect(px - brickW / 2, py - brickH / 2, brickW, brickH);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = `rgba(255,176,0,${0.3 + displaySig * 0.7})`;
        ctx.shadowColor = AMBER_GLOW;
        ctx.shadowBlur = displaySig * 8;
        ctx.fillRect(px - brickW / 2, py - brickH / 2, brickW, brickH);
        ctx.shadowBlur = 0;
      }

      // Velocity vector caret — only with active radar return AND target actually moving
      if (activeDetect && c.speed > 1 && c.relDx !== undefined) {
        const targetHRad = c.heading * Math.PI / 180;
        const vxVis = -Math.sin(targetHRad) * c.speed;
        const vzVis = -Math.cos(targetHRad) * c.speed;

        const futDx = c.relDx + vxVis;
        const futDz = c.relDz + vzVis;
        const futBearing = ((Math.atan2(futDx, futDz) * 180 / Math.PI) + 360) % 360;
        const futRange = Math.sqrt(futDx * futDx + futDz * futDz);
        const futRelBrg = ((futBearing - shipHeading + 540) % 360) - 180;
        const futRangeNorm = Math.min(futRange / maxRange, 1);
        const futPx = azToScopeX(futRelBrg);
        const futPy = MARGIN_T + (1 - futRangeNorm) * scopeH;

        const cdx = futPx - px;
        const cdy = futPy - py;
        const dirLen = Math.sqrt(cdx * cdx + cdy * cdy);
        const caretLength = Math.min(80, 8 + c.speed * 0.05);

        if (dirLen > 0.5) {
          const nx = cdx / dirLen;
          const ny = cdy / dirLen;
          ctx.strokeStyle = `rgba(255,176,0,${0.5 + sig * 0.5})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + nx * caretLength, py + ny * caretLength);
          ctx.stroke();
        }
      }

      if (lock === "soft") {
        ctx.strokeStyle = iffColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(px - 20, py - 14, 40, 28);
        ctx.setLineDash([]);
      } else if (lock === "hard") {
        ctx.strokeStyle = iffColor;
        ctx.lineWidth = 3;
        const t2 = time * 6;
        const flash = Math.sin(t2) > 0;
        if (flash) ctx.strokeRect(px - 20, py - 14, 40, 28);
      }

      // Only show labels/symbols for active radar contacts
      if (activeDetect) {
        ctx.font = "16px Consolas, Monaco, monospace";
        ctx.fillStyle = isLocked ? iffColor : (selectedContact === c.id ? AMBER_GLOW : AMBER);
        ctx.fillText(c.id, px + 24, py + 6);

        ctx.fillStyle = AMBER_DIM;
        ctx.font = "14px Consolas, Monaco, monospace";
        ctx.fillText(`${(c.range / 1000).toFixed(1)}`, px + 24, py + 24);

        if (isLocked) {
          ctx.font = "12px Consolas, Monaco, monospace";
          ctx.fillStyle = iffColor;
          ctx.fillText(iff, px + 24, py - 12);
          ctx.fillText(lock === "hard" ? "HRD" : "SFT", px - 20, py - 20);
        }
      }
    });
    contactHitBoxes.current = hits;

    ctx.restore();

    // Azimuth labels along bottom
    ctx.font = "16px Consolas, Monaco, monospace";
    ctx.fillStyle = AMBER_DIM;
    const labelAzStep = azHalf <= 30 ? 10 : 30;
    for (let az = -azHalf; az <= azHalf; az += labelAzStep) {
      const x = azToScopeX(az);
      const label = az === 0 ? "0" : az > 0 ? `R${az}` : `L${Math.abs(az)}`;
      ctx.fillText(label, x - 12, H - MARGIN_B + 24);
    }

    // Range labels along left
    for (let i = 0; i <= numLines; i++) {
      const y = MARGIN_T + (i / numLines) * scopeH;
      const rng = rangeKm * (1 - i / numLines);
      ctx.fillStyle = AMBER_DIM;
      ctx.font = "16px Consolas, Monaco, monospace";
      ctx.fillText(`${rng.toFixed(0)}`, 4, y + 6);
    }

    // Top HUD info
    const ownHeading = useGameStore.getState().ship.actualHeading;
    const hdgStr = String(Math.round(ownHeading)).padStart(3, "0");
    ctx.fillStyle = AMBER;
    ctx.font = "18px Consolas, Monaco, monospace";
    ctx.fillText(`RNG ${rangeKm}km`, MARGIN_L + 8, MARGIN_T - 12);
    ctx.textAlign = "center";
    ctx.fillText(`HDG ${hdgStr}`, MARGIN_L + scopeW / 2, MARGIN_T - 12);
    ctx.textAlign = "start";
    ctx.fillText(`AZ ±${azHalf}°`, MARGIN_L + scopeW - 88, MARGIN_T - 12);

    // Bottom-right lock indicator (bearing/range)
    const hardLockId = Object.keys(lockState).find(id => lockState[id] === "hard");
    const softLockId = Object.keys(lockState).find(id => lockState[id] === "soft");
    const lockId = hardLockId || softLockId;
    const isHardLock = !!hardLockId;
    const lockContact = lockId ? contacts.find(c => c.id === lockId) : null;

    const boxW = 84;
    const boxH = 60;
    const boxX = MARGIN_L + scopeW - boxW - 8;
    const boxY = MARGIN_T + scopeH - boxH - 6;
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = isHardLock ? RED_ALERT : lockContact ? AMBER_GLOW : AMBER_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = AMBER_DIM;
    ctx.beginPath();
    ctx.moveTo(boxX + 8, boxY + 30);
    ctx.lineTo(boxX + boxW - 8, boxY + 30);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = isHardLock ? RED_ALERT : lockContact ? AMBER : AMBER_DIM;
    if (lockContact) {
      const brg = String(Math.round(lockContact.bearing)).padStart(3, "0");
      const rngKm = Math.max(0, Math.round(lockContact.range / 1000));
      ctx.font = "18px Consolas, Monaco, monospace";
      ctx.fillText(brg, boxX + boxW / 2, boxY + 22);
      ctx.fillText(String(rngKm).padStart(2, "0"), boxX + boxW / 2, boxY + 52);
    } else {
      ctx.font = "18px Consolas, Monaco, monospace";
      ctx.fillText("---", boxX + boxW / 2, boxY + 22);
      ctx.fillText("--", boxX + boxW / 2, boxY + 52);
    }
    ctx.textAlign = "start";

  }, [time, contacts, selectedContact, maxRange, azHalf, lockState, iffState, radarOn]);

  const font = "'Consolas', 'Monaco', monospace";
  const arrowBtnStyle = (dir) => ({
    padding: "2px 6px", fontSize: 10,
    background: "rgba(255,176,0,0.06)",
    border: `1px solid ${AMBER_DIM}`,
    color: AMBER,
    fontFamily: font,
    cursor: "pointer", borderRadius: 1,
    lineHeight: 1,
  });

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* Left: range up/down arrows */}
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        padding: "24px 2px 28px 2px", alignItems: "center",
      }}>
        <button
          onClick={() => setRangeIdx(i => Math.min(RANGE_SCALES.length - 1, i + 1))}
          style={arrowBtnStyle("up")}
          title="Increase range"
        >▲</button>
        <span style={{ fontSize: 7, color: AMBER_DIM, writingMode: "vertical-rl", letterSpacing: 2 }}>
          RNG
        </span>
        <button
          onClick={() => setRangeIdx(i => Math.max(0, i - 1))}
          style={arrowBtnStyle("down")}
          title="Decrease range"
        >▼</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={760}
          style={{ width: "100%", flex: 1, background: BG_SCREEN, cursor: "crosshair" }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const scaleX = 800 / rect.width;
            const scaleY = 760 / rect.height;
            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;
            const hit = contactHitBoxes.current.find(
              h => mx >= h.x - h.w / 2 && mx <= h.x + h.w / 2 && my >= h.y - h.h / 2 && my <= h.y + h.h / 2
            );
            if (hit && radarOn) {
              onSelectContact(hit.id);
              setLockState(prev => ({
                ...prev,
                [hit.id]: prev[hit.id] === "soft" ? "hard" : "soft",
              }));
            }
            setContextMenu(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!radarOn) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const scaleX = 800 / rect.width;
            const scaleY = 760 / rect.height;
            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;
            const hit = contactHitBoxes.current.find(
              h => mx >= h.x - h.w / 2 && mx <= h.x + h.w / 2 && my >= h.y - h.h / 2 && my <= h.y + h.h / 2
            );
            if (hit) {
              onSelectContact(hit.id);
              setContextMenu({
                id: hit.id,
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              });
            } else {
              setContextMenu(null);
            }
          }}
        />
        {contextMenu && (
          <div style={{
            position: "absolute",
            left: contextMenu.x,
            top: contextMenu.y,
            background: BG_PANEL,
            border: `1px solid ${AMBER_DIM}`,
            zIndex: 20,
            minWidth: 110,
            fontSize: 9,
            fontFamily: "'Consolas', 'Monaco', monospace",
          }}>
            <div style={{ padding: "3px 8px", borderBottom: `1px solid ${AMBER_DIM}33`, color: AMBER_GLOW, fontSize: 8, letterSpacing: 1 }}>
              {contextMenu.id}
            </div>
            {[
              { label: "SOFT LOCK", action: () => setLockState(p => ({ ...p, [contextMenu.id]: "soft" })) },
              { label: "HARD LOCK", action: () => setLockState(p => ({ ...p, [contextMenu.id]: "hard" })) },
              { label: "UNLOCK", action: () => setLockState(p => { const n = { ...p }; delete n[contextMenu.id]; return n; }) },
              { type: "sep" },
              { label: "ID: HOSTILE", action: () => setIffState(p => ({ ...p, [contextMenu.id]: "HOSTILE" })), color: RED_ALERT },
              { label: "ID: UNKNOWN", action: () => setIffState(p => ({ ...p, [contextMenu.id]: "UNK" })), color: AMBER },
              { label: "ID: FRIENDLY", action: () => setIffState(p => ({ ...p, [contextMenu.id]: "FRIENDLY" })), color: "#00ff66" },
            ].map((item, i) =>
              item.type === "sep" ? (
                <div key={i} style={{ borderTop: `1px solid ${AMBER_DIM}33`, margin: "2px 0" }} />
              ) : (
                <div
                  key={i}
                  onClick={() => { item.action(); setContextMenu(null); }}
                  style={{
                    padding: "4px 8px",
                    cursor: "pointer",
                    color: item.color || AMBER,
                    borderBottom: `1px solid ${AMBER_DIM}11`,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,176,0,0.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  {item.label}
                </div>
              )
            )}
          </div>
        )}
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center", gap: 4, padding: "4px 0",
          borderTop: `1px solid ${AMBER_DIM}33`,
        }}>
          <button
            onClick={() => setAzIdx(i => Math.max(0, i - 1))}
            style={arrowBtnStyle("left")}
            title="Narrow azimuth"
          >◀</button>
          <span style={{ fontSize: 7, color: AMBER_DIM, letterSpacing: 1, fontFamily: font }}>AZ ±{azHalf}°</span>
          <button
            onClick={() => setAzIdx(i => Math.min(AZ_OPTIONS.length - 1, i + 1))}
            style={arrowBtnStyle("right")}
            title="Widen azimuth"
          >▶</button>
          <span style={{ width: 8 }} />
          {RANGE_SCALES.map((r, i) => (
            <button
              key={r}
              onClick={() => setRangeIdx(i)}
              style={{
                padding: "2px 8px", fontSize: 8, letterSpacing: 1,
                background: rangeIdx === i ? "rgba(255,176,0,0.15)" : "rgba(255,176,0,0.03)",
                border: `1px solid ${rangeIdx === i ? AMBER : AMBER_DIM}`,
                color: rangeIdx === i ? AMBER_GLOW : AMBER_DIM,
                fontFamily: font,
                cursor: "pointer", borderRadius: 1,
              }}
            >
              {r}km
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// EMCON status bars
const EmconBar = ({ label, value, warning }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
    <span style={{ width: 36, fontSize: 8, color: AMBER_DIM, fontFamily: "'Consolas', 'Monaco', monospace", textAlign: "right" }}>{label}</span>
    <div style={{ flex: 1, height: 8, background: "#1a1a18", border: `1px solid ${AMBER_DIM}33`, borderRadius: 1, overflow: "hidden" }}>
      <div style={{
        width: `${value * 100}%`,
        height: "100%",
        background: warning ? `linear-gradient(90deg, ${AMBER}, ${RED_ALERT})` : `linear-gradient(90deg, ${AMBER_DIM}, ${AMBER})`,
        transition: "width 0.3s",
        boxShadow: warning ? `0 0 6px ${RED_ALERT}` : "none",
      }} />
    </div>
    <span style={{ width: 28, fontSize: 8, color: warning ? RED_ALERT : AMBER, fontFamily: "'Consolas', 'Monaco', monospace" }}>
      {(value * 100).toFixed(0)}%
    </span>
  </div>
);

// EW-styled RWR display (amber themed)
const EwRwr = () => {
  const rwrContacts = useGameStore((s) => s.rwrContacts);
  const shipHeading = useGameStore((s) => s.ship.actualHeading);
  const canvasRef = useRef(null);
  const [time, setTime] = useState(0);

  useEffect(() => {
    let raf;
    const tick = () => { setTime(t => t + 0.016); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const S = canvas.width;
    const cx = S / 2;
    const cy = S / 2;
    const outerR = S * 0.42;
    const innerR = S * 0.12;

    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, S, S);

    // Rings
    [outerR, (outerR + innerR) / 2, innerR].forEach((r, i) => {
      ctx.strokeStyle = i === 1 ? "rgba(255,176,0,0.08)" : "rgba(255,176,0,0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash(i === 1 ? [3, 3] : []);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Cross hairs
    ctx.strokeStyle = "rgba(255,176,0,0.1)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - outerR - 4); ctx.lineTo(cx, cy + outerR + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - outerR - 4, cy); ctx.lineTo(cx + outerR + 4, cy); ctx.stroke();

    // Center dot
    ctx.fillStyle = AMBER_DIM;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

    // Cardinal labels
    ctx.font = "14px Consolas, Monaco, monospace";
    ctx.fillStyle = AMBER_DIM;
    ctx.textAlign = "center";
    ctx.fillText("12", cx, cy - outerR - 8);
    ctx.fillText("6", cx, cy + outerR + 16);
    ctx.textAlign = "start";
    ctx.fillText("3", cx + outerR + 8, cy + 5);
    ctx.textAlign = "end";
    ctx.fillText("9", cx - outerR - 8, cy + 5);
    ctx.textAlign = "start";

    // Contacts
    rwrContacts.forEach(c => {
      const relBearing = ((c.bearing - shipHeading + 360) % 360);
      const rad = (relBearing - 90) * (Math.PI / 180);
      const str = Math.max(1, Math.min(10, c.signalStrength));
      const dist = outerR - ((str - 1) / 9) * (outerR - innerR);
      const px = cx + Math.cos(rad) * dist;
      const py = cy + Math.sin(rad) * dist;

      const isCrit = c.priority === "critical";
      const isHigh = c.priority === "high";
      const symColor = isCrit ? RED_ALERT : isHigh ? "#ffaa00" : AMBER;

      // Lock box
      if (c.sttLock) {
        ctx.strokeStyle = symColor;
        ctx.lineWidth = 1.5;
        if (c.symbol === "M") {
          const r2 = 14;
          ctx.beginPath();
          ctx.moveTo(px, py - r2); ctx.lineTo(px + r2, py); ctx.lineTo(px, py + r2); ctx.lineTo(px - r2, py);
          ctx.closePath(); ctx.stroke();
        } else {
          const flash = Math.sin(time * 6) > 0;
          if (flash) ctx.strokeRect(px - 12, py - 12, 24, 24);
        }
      }

      // Symbol
      ctx.font = "bold 16px Consolas, Monaco, monospace";
      ctx.fillStyle = symColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.symbol, px, py);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    });

    // Heading label
    ctx.font = "14px Consolas, Monaco, monospace";
    ctx.fillStyle = AMBER;
    ctx.fillText(`HDG ${String(Math.round(shipHeading)).padStart(3, "0")}`, 6, 16);

    // Contact count
    ctx.textAlign = "right";
    ctx.fillStyle = rwrContacts.length > 0 ? AMBER : AMBER_DIM;
    ctx.fillText(`${rwrContacts.length} THR`, S - 6, 16);
    ctx.textAlign = "start";

  }, [time, rwrContacts, shipHeading]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={240}
      style={{ width: "100%", height: "100%", background: BG_SCREEN }}
    />
  );
};

// ─── RWCA (Remote Warp Core Attenuator) ────────────────────────────
const RWCA_HARMONICS = 2;
const RWCA_COEFFS = RWCA_HARMONICS * 2;
const RWCA_MIN_RANGE_KM = 10;
const RWCA_MAX_RANGE_KM = 50;
const RDNE_MIN_RANGE_KM = 10;
const RDNE_MAX_RANGE_KM = 50;
/** Centroid of RDNE lock cue polygon (apex 14,5 — base 6,24 / 22,24); rotation pivots here. */
const RDNE_LOCK_TRI_CX = 14;
const RDNE_LOCK_TRI_CY = (5 + 24 + 24) / 3;
/** Ownship-frame bow vector (0° = same heading as own) is drawn toward RDNE left; was top before −90°. */
const RDNE_LOCK_ROTATION_DISPLAY_OFFSET_DEG = -90;
/** Lock cue dot grid: center-to-center pitch equals inset from inner edges to nearest dots. */
const RDNE_LOCK_GRID_STEP_PX = 15;
const RDNE_USER_MARKER_DIAM_PX = 10;
/** Invisible drag/select target around the visible dot (easier grab on touch / mouse). */
const RDNE_USER_MARKER_HIT_PX = 34;
const RDNE_USER_MARKER_INSET_PX = RDNE_USER_MARKER_DIAM_PX / 2 + 1;
/** Vector strength peaks at this fraction of max field radius (weak near center and at outer edge). */
const RDNE_VEC_STRENGTH_PEAK_FRAC = 0.25;
/** Relative strength at rMin / rMax (inner and outer falloff floor). */
const RDNE_VEC_STRENGTH_EDGE = 0.2;
const RDNE_VEC_MAX_SHAFT_PX = RDNE_LOCK_GRID_STEP_PX * 0.92;
const RDNE_VEC_HEAD_DEPTH_PX = RDNE_LOCK_GRID_STEP_PX * 0.32;
const RDNE_VEC_HEAD_HALF_W_PX = RDNE_LOCK_GRID_STEP_PX * 0.22;
/** Field slider 0: rMax ≈ rMin + 1.15·step; 1: rMax = 5.75·step (matches prior fixed outer ring). */
const RDNE_FIELD_RMIN_STEPS = 0.65;
const RDNE_FIELD_RMAX_EXTRA_MIN_STEPS = 1.15;
const RDNE_FIELD_RMAX_EXTRA_MAX_STEPS = 5.75 - RDNE_FIELD_RMIN_STEPS;

/**
 * Normalized coords in the RDNE **padding box** (same box as the dot grid and vector SVG).
 * Uses clientWidth/Height so a border on the surface does not skew alignment vs CSS backgrounds.
 */
function rdneNormFromClient(clientX, clientY, el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return { nx: 0.5, ny: 0.5 };
  const rect = el.getBoundingClientRect();
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w <= 0 || h <= 0) return { nx: 0.5, ny: 0.5 };
  const style = typeof window !== "undefined" ? window.getComputedStyle(el) : null;
  const bl = style ? parseFloat(style.borderLeftWidth) || 0 : 0;
  const bt = style ? parseFloat(style.borderTopWidth) || 0 : 0;
  const ix = RDNE_USER_MARKER_INSET_PX / w;
  const iy = RDNE_USER_MARKER_INSET_PX / h;
  const x = clientX - rect.left - bl;
  const y = clientY - rect.top - bt;
  return {
    nx: clamp(x / w, ix, 1 - ix),
    ny: clamp(y / h, iy, 1 - iy),
  };
}

/**
 * Centers of dots in the lock-cue grid. `background-position: step/2` places each 15×15 tile’s
 * top-left at (step/2, step/2); the radial dot is centered in the tile → dot centers at (step, step), (2·step, step), …
 */
function rdneEachGridDotCenter(w, h, stepPx, fn) {
  for (let x = stepPx; x < w; x += stepPx) {
    for (let y = stepPx; y < h; y += stepPx) {
      fn(x, y);
    }
  }
}

function rdneSmoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Strength vs distance from sink/source: weak at rMin and rMax, peaks near 0.25·rMax.
 */
function rdneVectorStrengthFromDist(dist, rMin, rMax) {
  const dPeak = Math.max(rMin + 1e-4, RDNE_VEC_STRENGTH_PEAK_FRAC * rMax);
  const e = RDNE_VEC_STRENGTH_EDGE;
  if (dist <= dPeak) {
    const denom = Math.max(1e-6, dPeak - rMin);
    const t = (dist - rMin) / denom;
    return e + (1 - e) * rdneSmoothstep01(t);
  }
  const denom = Math.max(1e-6, rMax - dPeak);
  const t = (rMax - dist) / denom;
  return e + (1 - e) * rdneSmoothstep01(t);
}

/**
 * Short arrows from grid dots: amber (sink) → toward marker; blue (source) → away.
 * Shaft length scales with field strength (distance falloff). Heads are two strokes only (unfilled).
 */
function rdneBuildGridVectorArrows(w, h, nx, ny, kind, stepPx, fieldIntensity = 1) {
  if (w <= 8 || h <= 8) return [];
  const t = clamp(fieldIntensity, 0, 1);
  const mx = nx * w;
  const my = ny * h;
  const rMin = stepPx * RDNE_FIELD_RMIN_STEPS;
  const extraSteps =
    RDNE_FIELD_RMAX_EXTRA_MIN_STEPS +
    (RDNE_FIELD_RMAX_EXTRA_MAX_STEPS - RDNE_FIELD_RMAX_EXTRA_MIN_STEPS) * t;
  const rMax = rMin + stepPx * extraSteps;
  const shaftGain = 0.22 + 0.78 * t;
  const markerR = RDNE_USER_MARKER_DIAM_PX / 2 + 3;
  const out = [];
  rdneEachGridDotCenter(w, h, stepPx, (gx, gy) => {
    const vx = kind === "amber" ? mx - gx : gx - mx;
    const vy = kind === "amber" ? my - gy : gy - my;
    const dist = Math.hypot(vx, vy);
    if (dist < 1e-4 || dist < rMin || dist > rMax) return;
    const strength = rdneVectorStrengthFromDist(dist, rMin, rMax);
    const ux = vx / dist;
    const uy = vy / dist;
    const headScale = 0.28 + 0.72 * strength;
    const headDepth = RDNE_VEC_HEAD_DEPTH_PX * headScale;
    const headHalfW = RDNE_VEC_HEAD_HALF_W_PX * headScale;
    const geomCap = dist - markerR - headDepth * 1.08;
    const shaftLen = Math.min(geomCap, RDNE_VEC_MAX_SHAFT_PX * strength * shaftGain);
    if (shaftLen < 2.5) return;
    const tx = gx + ux * shaftLen;
    const ty = gy + uy * shaftLen;
    const bx = tx - ux * headDepth;
    const by = ty - uy * headDepth;
    const px = -uy * headHalfW;
    const py = ux * headHalfW;
    out.push({
      gx,
      gy,
      bx,
      by,
      tx,
      ty,
      w1x: bx + px,
      w1y: by + py,
      w2x: bx - px,
      w2y: by - py,
    });
  });
  return out;
}

/** Horizontal placement of lock cue in the RDNE surface (matches CSS `left` %). */
function rdneLockCueNormX(t) {
  return 0.04 + clamp(t, 0, 1) * 0.92;
}

const RDNE_RESULTANT_MAX_SHAFT_PX = RDNE_LOCK_GRID_STEP_PX * 5.2;
const RDNE_RESULTANT_HEAD_DEPTH_PX = RDNE_LOCK_GRID_STEP_PX * 0.36;
const RDNE_RESULTANT_HEAD_HALF_W_PX = RDNE_LOCK_GRID_STEP_PX * 0.24;
/** Below this normalized magnitude the resultant arrow is omitted (avoids noise at field edge). */
const RDNE_RESULTANT_MIN_DISPLAY_MAG = 0.06;

/**
 * Red “force on target” arrow at the lock triangle centroid: same radial model as grid field lines
 * (sink → pull toward marker, source → push away), scaled by distance falloff and flux.
 * Returns line segments for the same arrow style as `rdneBuildGridVectorArrows`, or null if off-field / negligible.
 */
function rdneBuildResultantForceArrow(w, h, markerNx, markerNy, kind, stepPx, fieldIntensity, shipRangeT) {
  if (w <= 8 || h <= 8) return null;
  const tFlux = clamp(fieldIntensity, 0, 1);
  const mx = markerNx * w;
  const my = markerNy * h;
  const sx = rdneLockCueNormX(shipRangeT) * w;
  const sy = 0.5 * h;
  const rMin = stepPx * RDNE_FIELD_RMIN_STEPS;
  const extraSteps =
    RDNE_FIELD_RMAX_EXTRA_MIN_STEPS +
    (RDNE_FIELD_RMAX_EXTRA_MAX_STEPS - RDNE_FIELD_RMAX_EXTRA_MIN_STEPS) * tFlux;
  const rMax = rMin + stepPx * extraSteps;
  const shaftGain = 0.22 + 0.78 * tFlux;

  const vx = kind === "amber" ? mx - sx : sx - mx;
  const vy = kind === "amber" ? my - sy : sy - my;
  const dist = Math.hypot(vx, vy);
  if (dist < 1e-4 || dist < rMin || dist > rMax) return null;
  const strength = rdneVectorStrengthFromDist(dist, rMin, rMax);
  const mag = strength * shaftGain;
  if (mag < RDNE_RESULTANT_MIN_DISPLAY_MAG) return null;

  const ux = vx / dist;
  const uy = vy / dist;
  const headScale = 0.35 + 0.65 * strength;
  const headDepth = RDNE_RESULTANT_HEAD_DEPTH_PX * headScale;
  const headHalfW = RDNE_RESULTANT_HEAD_HALF_W_PX * headScale;
  const shaftLen = Math.min(
    RDNE_RESULTANT_MAX_SHAFT_PX * mag,
    Math.max(0, Math.min(w, h) * 0.42 - headDepth * 1.1),
  );
  if (shaftLen < 3) return null;

  const tx = sx + ux * shaftLen;
  const ty = sy + uy * shaftLen;
  const bx = tx - ux * headDepth;
  const by = ty - uy * headDepth;
  const px = -uy * headHalfW;
  const py = ux * headHalfW;
  return {
    sx,
    sy,
    bx,
    by,
    tx,
    ty,
    w1x: bx + px,
    w1y: by + py,
    w2x: bx - px,
    w2y: by - py,
  };
}

const RWCA_MATCH_THRESHOLD = 0.8;
/** Peak-to-peak waveform extent ≤ this fraction of canvas height (centered). */
const RWCA_WAVEFORM_Y_MAX = 0.75;
/** Horizontal scroll speed (rad/s × EWConsole `time`, ~seconds). Pattern moves left → right. */
const RWCA_WAVEFORM_SCROLL_RADS_PER_SEC = 4.4;
const RWCA_LABELS = ["C1", "S1", "C2", "S2"];
const RWCA_FONT = "'Consolas', 'Monaco', monospace";

function rwcaHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h;
}

function rwcaSeeded(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function rwcaGenerateEnemyCoeffs(shipId) {
  const h = rwcaHash(shipId);
  const raw = [];
  for (let i = 0; i < RWCA_COEFFS; i++) {
    raw.push(rwcaSeeded(h * 0.00137 + i * 173.3) * 2 - 1);
  }
  const energy = raw.reduce((s, c) => s + c * c, 0);
  const scale = energy > 0 ? 1.2 / Math.sqrt(energy) : 1;
  return raw.map(c => +(c * scale).toFixed(3));
}

function rwcaEvalWaveform(coeffs, x) {
  let y = 0;
  for (let k = 0; k < RWCA_HARMONICS; k++) {
    y += coeffs[k * 2] * Math.cos((k + 1) * x);
    y += coeffs[k * 2 + 1] * Math.sin((k + 1) * x);
  }
  return y;
}

function rwcaComputeMatch(enemy, player) {
  let err = 0, energy = 0;
  for (let i = 0; i < RWCA_COEFFS; i++) {
    const d = player[i] - enemy[i];
    err += d * d;
    energy += enemy[i] * enemy[i];
  }
  if (energy === 0) return 0;
  return Math.max(0, Math.min(1, 1 - err / energy));
}

const RWCAPanel = ({ contacts, lockState, time, power, rangeKm, rwcaPowered, rwcaArmed }) => {
  const [playerCoeffs, setPlayerCoeffs] = useState(() => new Array(RWCA_COEFFS).fill(0));
  const canvasRef = useRef(null);
  const waveformWrapRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ w: 320, h: 160 });
  const prevTargetRef = useRef(null);
  const lastRwcaNetworkTargetRef = useRef(undefined);

  const lockedId = useMemo(() => {
    const hard = Object.keys(lockState).find(id => lockState[id] === "hard");
    if (hard) return hard;
    return Object.keys(lockState).find(id => lockState[id] === "soft") || null;
  }, [lockState]);

  const targetContact = useMemo(() => {
    if (!lockedId) return null;
    return contacts.find(c => c.id === lockedId) || null;
  }, [contacts, lockedId]);

  const inRange = targetContact ? (targetContact.range / 1000) <= rangeKm : false;

  const enemyCoeffs = useMemo(() => {
    if (!lockedId) return null;
    return rwcaGenerateEnemyCoeffs(lockedId);
  }, [lockedId]);

  useEffect(() => {
    if (lockedId !== prevTargetRef.current) {
      setPlayerCoeffs(new Array(RWCA_COEFFS).fill(0));
      prevTargetRef.current = lockedId;
    }
  }, [lockedId]);

  const match = useMemo(() => {
    if (!enemyCoeffs) return 0;
    return rwcaComputeMatch(enemyCoeffs, playerCoeffs);
  }, [enemyCoeffs, playerCoeffs]);

  const isLocked = match >= RWCA_MATCH_THRESHOLD && inRange;

  useEffect(() => {
    if (!multiplayerClient.isConnected()) {
      lastRwcaNetworkTargetRef.current = undefined;
      return;
    }
    const targetId =
      rwcaPowered && rwcaArmed && isLocked && lockedId ? lockedId : null;
    if (lastRwcaNetworkTargetRef.current === targetId) return;
    lastRwcaNetworkTargetRef.current = targetId;
    multiplayerClient.sendEwRwcaAttenuate({ targetShipId: targetId });
  }, [rwcaPowered, rwcaArmed, isLocked, lockedId]);

  useEffect(() => {
    const targetId =
      rwcaPowered && rwcaArmed && isLocked && lockedId ? lockedId : null;
    const npcTarget =
      typeof targetId === "string" && targetId.startsWith("npc-") ? targetId : null;
    useGameStore.getState().applyLocalNpcRwcaAttenuation(npcTarget);
    return () => {
      useGameStore.getState().applyLocalNpcRwcaAttenuation(null);
    };
  }, [rwcaPowered, rwcaArmed, isLocked, lockedId]);

  useEffect(() => {
    return () => {
      if (multiplayerClient.isConnected()) {
        multiplayerClient.sendEwRwcaAttenuate({ targetShipId: null });
      }
      lastRwcaNetworkTargetRef.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    const el = waveformWrapRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(48, Math.floor(r.width));
      const h = Math.max(48, Math.floor(r.height));
      setCanvasDims((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? Math.min(2.5, window.devicePixelRatio || 1) : 1;
    const W = canvasDims.w;
    const H = canvasDims.h;
    const bufW = Math.max(1, Math.round(W * dpr));
    const bufH = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    const midY = H / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
    }
    ctx.strokeStyle = GRID_COLOR_BRIGHT;
    ctx.beginPath(); ctx.moveTo(0, H * 0.25); ctx.lineTo(W, H * 0.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * 0.75); ctx.lineTo(W, H * 0.75); ctx.stroke();

    if (!rwcaPowered) {
      ctx.fillStyle = AMBER_DIM;
      ctx.font = `600 12px ${RWCA_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("POWER OFF", W / 2, midY);
      return;
    }

    if (!enemyCoeffs) {
      ctx.fillStyle = AMBER_DIM;
      ctx.font = `600 12px ${RWCA_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("NO TARGET LOCKED", W / 2, midY);
      return;
    }

    const steps = Math.max(2, Math.ceil(W));
    const hasInput = playerCoeffs.some(c => c !== 0);
    const scrollPhase = time * RWCA_WAVEFORM_SCROLL_RADS_PER_SEC;
    const phaseAtPx = (px) => (px / W) * Math.PI * 2 - scrollPhase;

    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const px = (i / steps) * W;
      const x = phaseAtPx(px);
      const noiseVal = Math.sin(x * 7.1 + px * 0.08 + time * 4) * 0.015;
      const ye = rwcaEvalWaveform(enemyCoeffs, x) + noiseVal;
      vMin = Math.min(vMin, ye);
      vMax = Math.max(vMax, ye);
      if (hasInput) {
        const yp = rwcaEvalWaveform(playerCoeffs, x);
        vMin = Math.min(vMin, yp);
        vMax = Math.max(vMax, yp);
      }
    }
    const span = Math.max(vMax - vMin, 1e-6);
    const vMean = (vMin + vMax) / 2;
    const scale = (H * RWCA_WAVEFORM_Y_MAX) / span;

    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const px = (i / steps) * W;
      const x = phaseAtPx(px);
      const noiseVal = Math.sin(x * 7.1 + px * 0.08 + time * 4) * 0.015;
      const y = rwcaEvalWaveform(enemyCoeffs, x) + noiseVal;
      const cy = midY - (y - vMean) * scale;
      if (i === 0) ctx.moveTo(px, cy); else ctx.lineTo(px, cy);
    }
    ctx.stroke();

    if (hasInput) {
      ctx.strokeStyle = "#00ff64";
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = (i / steps) * W;
        const x = phaseAtPx(px);
        const y = rwcaEvalWaveform(playerCoeffs, x);
        const cy = midY - (y - vMean) * scale;
        if (i === 0) ctx.moveTo(px, cy); else ctx.lineTo(px, cy);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
    const matchPct = (match * 100).toFixed(0);
    const matchColor = match >= RWCA_MATCH_THRESHOLD ? "#00ff64" : match >= 0.5 ? AMBER : AMBER_DIM;
    ctx.fillStyle = matchColor;
    ctx.font = `bold 11px ${RWCA_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`${matchPct}%`, W - 4, 12);

    if (isLocked) {
      ctx.fillStyle = "#00ff64";
      ctx.font = `bold 10px ${RWCA_FONT}`;
      ctx.textAlign = "left";
      ctx.fillText("\u29BF ATTENUATING", 4, 12);
    } else if (targetContact && !inRange) {
      ctx.fillStyle = RED_ALERT;
      ctx.font = `9px ${RWCA_FONT}`;
      ctx.textAlign = "left";
      ctx.fillText("OUT OF RANGE", 4, 12);
    }

    if (targetContact) {
      ctx.fillStyle = AMBER_DIM;
      ctx.font = `8px ${RWCA_FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(`TGT: ${lockedId}  ${(targetContact.range / 1000).toFixed(1)} km`, 4, H - 4);
    }
  }, [canvasDims, rwcaPowered, enemyCoeffs, playerCoeffs, match, isLocked, inRange, targetContact, time, lockedId]);

  const updateCoeff = useCallback((idx, value) => {
    setPlayerCoeffs(prev => { const n = [...prev]; n[idx] = value; return n; });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, gap: 0 }}>
      {/* Waveform display — left 2/3 */}
      <div style={{ flex: 2, minWidth: 0, display: "flex", flexDirection: "column", padding: "4px 0 4px 4px" }}>
        <div
          ref={waveformWrapRef}
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            position: "relative",
            borderRadius: 1,
            border: `1px solid ${AMBER_DIM}44`,
            overflow: "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
            }}
          />
        </div>
      </div>

      {/* Vertical sliders — right 1/3 */}
      <div style={{
        flex: 1, minWidth: 0, display: "flex", flexDirection: "row",
        alignItems: "stretch", justifyContent: "center",
        gap: 2,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 2,
        paddingRight: 4,
        borderLeft: `1px solid ${AMBER_DIM}33`,
        marginLeft: 4,
        boxSizing: "border-box",
      }}>
        {RWCA_LABELS.map((label, idx) => {
          const isSin = idx % 2 === 1;
          const accent = isSin ? "#4488ff" : AMBER;
          return (
            <div key={label} style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              flex: 1, minWidth: 0, gap: 4,
            }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: RWCA_FONT,
                letterSpacing: 0.04,
                lineHeight: 1,
                color: isSin ? "#66aaff" : AMBER_GLOW,
                paddingTop: 2,
                flexShrink: 0,
              }}>
                {label}
              </span>
              {/* minHeight keeps track from shrinking when outer vertical padding increases */}
              <div style={{
                flex: 1,
                minHeight: 52,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}>
                {/* Track height = 1/1.5 of column; column flex centers this block on Y */}
                <div style={{
                  height: "calc(100% / 1.5)",
                  minHeight: 32,
                  maxHeight: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <input
                    type="range" min={-1} max={1} step={0.02}
                    value={playerCoeffs[idx]}
                    onChange={e => updateCoeff(idx, +e.target.value)}
                    style={{
                      writingMode: "vertical-lr",
                      direction: "rtl",
                      appearance: "slider-vertical",
                      width: 14,
                      height: "100%",
                      minHeight: 0,
                      accentColor: accent,
                      cursor: "pointer",
                      margin: 0,
                      padding: 0,
                    }}
                  />
                </div>
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: RWCA_FONT,
                lineHeight: 1,
                color: AMBER_GLOW,
                whiteSpace: "nowrap",
                paddingBottom: 2,
                flexShrink: 0,
              }}>
                {playerCoeffs[idx] >= 0 ? "+" : ""}{playerCoeffs[idx].toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const EW_MFD_TABS = ["MAP", "RADAR", "TV"];

// Main Component
export default function EWConsole() {
  const rdneResultantFilterId = useId().replace(/:/g, "");
  const [time, setTime] = useState(0);
  const starSystem = useGameStore((s) => s.starSystem);
  const currentCelestialId = useGameStore((s) => s.currentCelestialId);
  const upperScannerOn = useGameStore((s) => s.ewUpperScannerOn);
  const lowerScannerOn = useGameStore((s) => s.ewLowerScannerOn);
  const setUpperScannerOn = useGameStore((s) => s.setEwUpperScannerOn);
  const setLowerScannerOn = useGameStore((s) => s.setEwLowerScannerOn);
  const [contacts, setContacts] = useState(() => buildContactsFromGame());
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedBearing, setSelectedBearing] = useState(0);
  const radarOn = useGameStore((s) => s.ewRadarOn);
  const radarMode = useGameStore((s) => s.ewRadarMode);
  const radarPower = useGameStore((s) => s.ewRadarPower);
  const radarFreq = useGameStore((s) => s.ewRadarFreq);
  const radarPRF = useGameStore((s) => s.ewRadarPRF);
  const setEwRadar = useGameStore((s) => s.setEwRadar);
  const setRadarOn = (v) => setEwRadar({ radarOn: typeof v === "function" ? v(radarOn) : v });
  const setRadarMode = (v) => setEwRadar({ radarMode: v });
  const setRadarPower = (v) => setEwRadar({ radarPower: typeof v === "function" ? v(radarPower) : v });
  const setRadarFreq = (v) => setEwRadar({ radarFreq: typeof v === "function" ? v(radarFreq) : v });
  const setRadarPRF = (v) => setEwRadar({ radarPRF: v });
  const [emconLevel, setEmconLevel] = useState(0.3);
  const lockState = useGameStore((s) => s.ewLockState);
  const iffState = useGameStore((s) => s.ewIffState);
  const setLockStateStore = useGameStore((s) => s.setEwLockState);
  const setIffStateStore = useGameStore((s) => s.setEwIffState);
  const setLockState = (updater) => {
    if (typeof updater === "function") setLockStateStore(updater);
    else setLockStateStore(() => updater);
  };
  const setIffState = (updater) => {
    if (typeof updater === "function") setIffStateStore(updater);
    else setIffStateStore(() => updater);
  };
  const [spectrumLockQuality, setSpectrumLockQuality] = useState("none");
  const JAMMER_COLORS = ["#ff4466", "#44aaff", "#44ff66", "#ffaa22"];
  const jammers = useGameStore((s) => s.ewJammers);
  const setJammers = useGameStore((s) => s.setEwJammers);
  const [selectedJammer, setSelectedJammer] = useState(0);
  const [upperScannerResetToken, setUpperScannerResetToken] = useState(0);
  const [lowerScannerResetToken, setLowerScannerResetToken] = useState(0);
  const [upperScannerType, setUpperScannerType] = useState("grav");
  const [lowerScannerType, setLowerScannerType] = useState("ir");
  const [rwcaPowered, setRwcaPowered] = useState(false);
  const [rwcaArmed, setRwcaArmed] = useState(false);
  const [rwcaPower, setRwcaPower] = useState(0.2);
  const rwcaRangeKm = RWCA_MIN_RANGE_KM + rwcaPower * (RWCA_MAX_RANGE_KM - RWCA_MIN_RANGE_KM);
  const [rdnePowered, setRdnePowered] = useState(false);
  const [rdneArmed, setRdneArmed] = useState(false);
  const [rdnePower, setRdnePower] = useState(0.2);
  const rdneRangeKm = RDNE_MIN_RANGE_KM + rdnePower * (RDNE_MAX_RANGE_KM - RDNE_MIN_RANGE_KM);
  const shipHeadingForRdne = useGameStore((s) => s.ship.actualHeading);
  const rdneLockedTargetMarker = useMemo(() => {
    if (!rdnePowered || !rdneArmed) return null;
    const hardId = Object.keys(lockState).find((id) => lockState[id] === "hard");
    const lockedId =
      hardId || Object.keys(lockState).find((id) => lockState[id] === "soft") || null;
    if (!lockedId) return null;
    const target = contacts.find((c) => c.id === lockedId);
    if (!target) return null;
    const distanceKm = target.range / 1000;
    if (distanceKm > rdneRangeKm || rdneRangeKm <= 0) return null;
    const t = Math.min(1, Math.max(0, distanceKm / rdneRangeKm));
    const targetHdg = target.heading ?? 0;
    const headingInOwnFrameDeg = ((targetHdg - shipHeadingForRdne + 540) % 360) - 180;
    const displayRotationDeg = headingInOwnFrameDeg + RDNE_LOCK_ROTATION_DISPLAY_OFFSET_DEG;
    return { t, displayRotationDeg };
  }, [rdnePowered, rdneArmed, lockState, contacts, rdneRangeKm, shipHeadingForRdne]);
  const rdneSurfaceRef = useRef(null);
  const lastRdneNetSendMsRef = useRef(0);
  const lastRdneNetPayloadRef = useRef(null);
  const [rdneSurfacePx, setRdneSurfacePx] = useState({ w: 0, h: 0 });
  const [rdneUserMarker, setRdneUserMarker] = useState(null);
  /** 0…1: smaller → tighter field + weaker arrow lengths; larger → prior default outer radius + strength. */
  const [rdneFieldIntensity, setRdneFieldIntensity] = useState(1);

  useLayoutEffect(() => {
    const el = rdneSurfaceRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setRdneSurfacePx((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rdneVectorArrows = useMemo(() => {
    if (!rdneUserMarker || rdneSurfacePx.w <= 0 || rdneSurfacePx.h <= 0) return [];
    return rdneBuildGridVectorArrows(
      rdneSurfacePx.w,
      rdneSurfacePx.h,
      rdneUserMarker.nx,
      rdneUserMarker.ny,
      rdneUserMarker.kind,
      RDNE_LOCK_GRID_STEP_PX,
      rdneFieldIntensity,
    );
  }, [rdneUserMarker, rdneSurfacePx.w, rdneSurfacePx.h, rdneFieldIntensity]);

  const rdneResultantForceArrow = useMemo(() => {
    if (
      !rdneLockedTargetMarker ||
      !rdneUserMarker ||
      rdneSurfacePx.w <= 0 ||
      rdneSurfacePx.h <= 0
    ) {
      return null;
    }
    return rdneBuildResultantForceArrow(
      rdneSurfacePx.w,
      rdneSurfacePx.h,
      rdneUserMarker.nx,
      rdneUserMarker.ny,
      rdneUserMarker.kind,
      RDNE_LOCK_GRID_STEP_PX,
      rdneFieldIntensity,
      rdneLockedTargetMarker.t,
    );
  }, [
    rdneLockedTargetMarker,
    rdneUserMarker,
    rdneSurfacePx.w,
    rdneSurfacePx.h,
    rdneFieldIntensity,
  ]);
  const [staleContacts, setStaleContacts] = useState({});
  const [classifierMenu, setClassifierMenu] = useState(null);
  const radarWasOnRef = useRef(false);
  const [logEntries, setLogEntries] = useState([
    { t: "00:00:00", msg: "SYSTEM ONLINE — PASSIVE ELINT MODE", type: "sys" },
  ]);
  const contactUpdateAtRef = useRef(0);
  const timeUpdateAtRef = useRef(0);
  const [ewMfdTab, setEwMfdTab] = useState("MAP");
  const ewTvWrapperRef = useRef(null);
  const ewTvDisplayRef = useRef(null);
  const ewTvFeedCanvas = useEwTvStore((s) => s.canvas);

  useEffect(() => {
    let frame;
    const tick = () => {
      const now = performance.now();
      if (now - timeUpdateAtRef.current >= 33) {
        setTime(t => t + 0.033);
        timeUpdateAtRef.current = now;
      }
      if (now - contactUpdateAtRef.current >= 33) {
        setContacts(buildContactsFromGame());
        contactUpdateAtRef.current = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!rwcaPowered) setRwcaArmed(false);
  }, [rwcaPowered]);

  useEffect(() => {
    if (!rdnePowered) setRdneArmed(false);
  }, [rdnePowered]);

  useEffect(() => {
    const setEffect = useGameStore.getState().setEwRdneFieldEffect;
    if (!rdneUserMarker || !rdneLockedTargetMarker || !rdnePowered || !rdneArmed) {
      setEffect(null);
      return;
    }
    const hardId = Object.keys(lockState).find((id) => lockState[id] === "hard");
    const lockedId =
      hardId || Object.keys(lockState).find((id) => lockState[id] === "soft") || null;
    if (!lockedId) { setEffect(null); return; }
    const target = contacts.find((c) => c.id === lockedId);
    if (!target) { setEffect(null); return; }

    const lockCueNx = rdneLockCueNormX(rdneLockedTargetMarker.t);
    const dxRdne = rdneUserMarker.nx - lockCueNx;
    const dyRdne = -(rdneUserMarker.ny - 0.5);
    const offsetMag = Math.hypot(dxRdne, dyRdne);
    if (offsetMag < 0.001) { setEffect(null); return; }

    const bearingRad = Math.atan2(-target.relDx, target.relDz);
    const rangeX = -Math.sin(bearingRad);
    const rangeZ = Math.cos(bearingRad);
    const crossX = Math.cos(bearingRad);
    const crossZ = Math.sin(bearingRad);

    const scale = rdneRangeKm / 0.92 * 1000;
    const worldOffsetX = (dxRdne * rangeX + dyRdne * crossX) * scale;
    const worldOffsetZ = (dxRdne * rangeZ + dyRdne * crossZ) * scale;

    let forceMag = 0;
    if (rdneSurfacePx.w > 8 && rdneSurfacePx.h > 8) {
      const tFlux = clamp(rdneFieldIntensity, 0, 1);
      const stepPx = RDNE_LOCK_GRID_STEP_PX;
      const rMin = stepPx * RDNE_FIELD_RMIN_STEPS;
      const extraSteps =
        RDNE_FIELD_RMAX_EXTRA_MIN_STEPS +
        (RDNE_FIELD_RMAX_EXTRA_MAX_STEPS - RDNE_FIELD_RMAX_EXTRA_MIN_STEPS) * tFlux;
      const rMax = rMin + stepPx * extraSteps;
      const shaftGain = 0.22 + 0.78 * tFlux;
      const mx = rdneUserMarker.nx * rdneSurfacePx.w;
      const my = rdneUserMarker.ny * rdneSurfacePx.h;
      const sx = lockCueNx * rdneSurfacePx.w;
      const sy = 0.5 * rdneSurfacePx.h;
      const pxDist = Math.hypot(mx - sx, my - sy);
      if (pxDist >= rMin && pxDist <= rMax && pxDist > 1e-4) {
        const strength = rdneVectorStrengthFromDist(pxDist, rMin, rMax);
        forceMag = strength * shaftGain;
      }
    }

    setEffect({
      targetId: lockedId,
      kind: rdneUserMarker.kind === "amber" ? "sink" : "source",
      worldOffset: [worldOffsetX, 0, worldOffsetZ],
      intensity: rdneFieldIntensity,
      forceMagnitude: forceMag,
    });
    return () => { useGameStore.getState().setEwRdneFieldEffect(null); };
  }, [
    rdneUserMarker, rdneLockedTargetMarker, rdnePowered, rdneArmed,
    lockState, contacts, rdneRangeKm, rdneFieldIntensity,
    rdneSurfacePx.w, rdneSurfacePx.h,
  ]);

  useEffect(() => {
    if (!multiplayerClient.isConnected()) {
      lastRdneNetPayloadRef.current = null;
      return;
    }
    const effect = useGameStore.getState().ewRdneFieldEffect;
    const msg = effect
      ? {
          targetShipId: effect.targetId,
          kind: effect.kind,
          worldOffset: effect.worldOffset,
          intensity: effect.intensity,
          forceMagnitude: effect.forceMagnitude,
        }
      : { targetShipId: null };

    const prev = lastRdneNetPayloadRef.current;
    const isNull = msg.targetShipId === null;
    const wasNull = !prev || prev.targetShipId === null;

    if (isNull && wasNull) return;

    const now = performance.now();
    const elapsed = now - lastRdneNetSendMsRef.current;
    if (!isNull && !wasNull && elapsed < 100) return;

    lastRdneNetPayloadRef.current = msg;
    lastRdneNetSendMsRef.current = now;
    multiplayerClient.sendEwRdneField(msg);

    return () => {
      if (multiplayerClient.isConnected()) {
        multiplayerClient.sendEwRdneField({ targetShipId: null });
      }
      lastRdneNetPayloadRef.current = null;
    };
  }, [
    rdneUserMarker, rdneLockedTargetMarker, rdnePowered, rdneArmed,
    lockState, contacts, rdneRangeKm, rdneFieldIntensity,
    rdneSurfacePx.w, rdneSurfacePx.h,
  ]);

  useEffect(() => {
    if (ewMfdTab !== "TV") return;
    useEwTvStore.getState().acquireTv();
    return () => {
      useEwTvStore.getState().releaseTv();
    };
  }, [ewMfdTab]);

  useLayoutEffect(() => {
    if (ewMfdTab !== "TV") return;
    const source = ewTvFeedCanvas;
    if (!source) return;
    const disp = ewTvDisplayRef.current;
    const wrap = ewTvWrapperRef.current;
    if (!disp || !wrap) return;
    const ctx = disp.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      const d = ewTvDisplayRef.current;
      const wEl = ewTvWrapperRef.current;
      const src = useEwTvStore.getState().canvas;
      if (!d || !wEl || !src) return;
      const w = Math.max(1, Math.floor(wEl.clientWidth));
      const h = Math.max(1, Math.floor(wEl.clientHeight));
      if (d.width !== w || d.height !== h) {
        d.width = w;
        d.height = h;
      }
      const c = d.getContext("2d");
      if (!c) return;
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      const scale = Math.min(w / EW_ORBIT_FEED_W, h / EW_ORBIT_FEED_H);
      const dw = Math.floor(EW_ORBIT_FEED_W * scale);
      const dh = Math.floor(EW_ORBIT_FEED_H * scale);
      const ox = Math.floor((w - dw) / 2);
      const oy = Math.floor((h - dh) / 2);
      c.drawImage(src, 0, 0, EW_ORBIT_FEED_W, EW_ORBIT_FEED_H, ox, oy, dw, dh);
    };

    tick();
    const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, [ewMfdTab, ewTvFeedCanvas]);

  const hardLockedId = Object.keys(lockState).find(id => lockState[id] === "hard") || null;
  const effectiveRadarMode = hardLockedId ? "STT" : radarMode;

  const notchSeedRef = useRef(0);
  const contactsWithDetection = useMemo(() => contacts.map(c => {
    const passiveRange = 20000 + c.emStrength * 180000;
    const passiveDetect = c.active && c.emStrength > 0.2 && c.range < passiveRange;
    const activeRange = computeActiveDetectRangeM(c, radarPower, radarFreq, radarPRF, effectiveRadarMode);
    let activeDetect = radarOn && c.range <= activeRange;

    // Notching: target beaming perpendicular (aspect ~90° or ~270° ±10°) drops from radar
    if (activeDetect && c.heading !== undefined && c.speed > 1) {
      const bearingToPlayer = (c.bearing + 180) % 360;
      const aspect = Math.abs(((c.heading - bearingToPlayer + 540) % 360) - 180);
      const beamAngle = Math.abs(aspect - 90);
      const isNotching = beamAngle <= 10;

      if (isNotching && (effectiveRadarMode === "RWS" || effectiveRadarMode === "TWS")) {
        // INTER PRF is best against notching targets
        const prfResist = radarPRF === "INTER" ? 0.4 : radarPRF === "HIGH" ? 0.15 : 0.05;
        const powerResist = Math.max(0, (radarPower - 60) / 40) * 0.2;
        const detectProb = prfResist + powerResist;

        notchSeedRef.current = (notchSeedRef.current + 1) % 60;
        const roll = noise(c.id.charCodeAt(0) * 0.1 + notchSeedRef.current, time * 0.3);
        if (roll > detectProb) {
          activeDetect = false;
        }
      }
    }

    return { ...c, passiveDetect, activeDetect, activeRange };
  }), [contacts, radarPower, radarFreq, radarPRF, effectiveRadarMode, radarOn, time]);

  useEffect(() => {
    if (radarWasOnRef.current && !radarOn) {
      setStaleContacts(prev => {
        const next = { ...prev };
        contactsWithDetection.forEach(c => {
          if (c.activeDetect && !c.passiveDetect) {
            next[c.id] = { ...c, staleAt: Date.now() };
          }
        });
        return next;
      });
    }
    radarWasOnRef.current = radarOn;
  }, [radarOn, contactsWithDetection]);

  useEffect(() => {
    setStaleContacts(prev => {
      const next = { ...prev };
      contactsWithDetection.forEach(c => {
        if (c.passiveDetect || c.activeDetect) {
          delete next[c.id];
        }
      });
      return next;
    });
  }, [contactsWithDetection]);

  const visibleContacts = contactsWithDetection.filter(c => {
    const passiveRange = 20000 + c.emStrength * 180000;
    const passiveDetect = c.active && c.emStrength > 0.2 && c.range < passiveRange;
    const activeDetect = c.activeDetect;
    return passiveDetect || activeDetect;
  });

  const staleContactList = Object.values(staleContacts);
  const selectedData =
    visibleContacts.find(c => c.id === selectedContact) ||
    staleContactList.find(c => c.id === selectedContact);

  const estimatedRangeKm = (computeActiveDetectRangeM(
    { id: "RNG", type: "battleship", rcs: 22 },
    radarPower,
    radarFreq,
    radarPRF,
    effectiveRadarMode
  ) / 1000).toFixed(1);

  useEffect(() => {
    setEmconLevel(radarOn ? 0.3 + radarPower / 100 * 0.6 : 0.1);
  }, [radarOn, radarPower]);

  const font = "'Consolas', 'Monaco', monospace";
  const scannerSlots = [
    {
      id: "A",
      type: upperScannerType,
      setType: setUpperScannerType,
      isOn: upperScannerOn,
      setOn: setUpperScannerOn,
      resetToken: upperScannerResetToken,
      reset: () => setUpperScannerResetToken((v) => v + 1),
    },
    {
      id: "B",
      type: lowerScannerType,
      setType: setLowerScannerType,
      isOn: lowerScannerOn,
      setOn: setLowerScannerOn,
      resetToken: lowerScannerResetToken,
      reset: () => setLowerScannerResetToken((v) => v + 1),
    },
  ];

  /** Matches grav / IR scanner `Panel` height so auxiliary strips align across the console. */
  const scannerPanelHeightPx = 243;

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      maxHeight: "100vh",
      background: BG_DARK,
      color: AMBER,
      fontFamily: font,
      fontSize: 11,
      display: "flex",
      flexDirection: "column",
      padding: 6,
      gap: 6,
      boxSizing: "border-box",
      overflow: "auto",
    }}>

      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 12px",
        borderBottom: `1px solid ${AMBER_DIM}`,
        background: "rgba(255,176,0,0.03)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, letterSpacing: 4, fontWeight: "bold" }}>DARK FOREST</span>
          <span style={{ color: AMBER_DIM, fontSize: 9, letterSpacing: 2 }}>EW OFFICER CONSOLE v2.4.1</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 9 }}>
          <span>VESSEL: <span style={{ color: AMBER_GLOW }}>RAVEN</span></span>
          <span>GRID: <span style={{ color: AMBER_GLOW }}>DF-1 PLANET I</span></span>
          <span style={{
            color: radarOn ? RED_ALERT : AMBER,
          }}>
            EMCON: {radarOn ? "⚠ EMITTING" : "SILENT"}
          </span>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: "flex", gap: 6, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        <div style={{ flex: "0 0 36%", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, minHeight: 0 }}>
          {scannerSlots.map((slot) => {
            const scannerAccent = slot.type === "ir" ? IR_ORANGE : GRAV_CYAN;
            const scannerAccentDim = slot.type === "ir" ? IR_ORANGE_DIM : GRAV_CYAN_DIM;
            const scannerAccentGlow = slot.type === "ir" ? IR_ORANGE_GLOW : GRAV_CYAN_GLOW;
            const scannerLabel = slot.type === "ir" ? "IR Scanner" : "Gravimetric Scanner";
            return (
              <Panel
                key={slot.id}
                title={scannerLabel}
                style={{ height: scannerPanelHeightPx, minHeight: scannerPanelHeightPx, flex: "0 0 auto" }}
                dimmed={!slot.isOn}
                headerRight={(
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => slot.setType("grav")}
                        style={{
                          padding: "1px 6px",
                          fontSize: 8,
                          letterSpacing: 1,
                          borderRadius: 1,
                          border: `1px solid ${slot.type === "grav" ? GRAV_CYAN : "rgba(130,130,130,0.5)"}`,
                          background: slot.type === "grav" ? "rgba(0,204,170,0.14)" : "rgba(90,90,90,0.12)",
                          color: slot.type === "grav" ? GRAV_CYAN_GLOW : "rgba(180,180,180,0.75)",
                          fontFamily: font,
                          cursor: "pointer",
                        }}
                        aria-label={`Switch scanner ${slot.id} to gravimetric`}
                      >
                        GRAV
                      </button>
                      <button
                        onClick={() => slot.setType("ir")}
                        style={{
                          padding: "1px 6px",
                          fontSize: 8,
                          letterSpacing: 1,
                          borderRadius: 1,
                          border: `1px solid ${slot.type === "ir" ? IR_ORANGE : "rgba(130,130,130,0.5)"}`,
                          background: slot.type === "ir" ? "rgba(255,154,60,0.14)" : "rgba(90,90,90,0.12)",
                          color: slot.type === "ir" ? IR_ORANGE_GLOW : "rgba(180,180,180,0.75)",
                          fontFamily: font,
                          cursor: "pointer",
                        }}
                        aria-label={`Switch scanner ${slot.id} to IR`}
                      >
                        IR
                      </button>
                    </div>
                    <button
                      onClick={slot.reset}
                      style={{
                        padding: "1px 6px",
                        fontSize: 8,
                        letterSpacing: 1,
                        borderRadius: 1,
                        border: `1px solid ${slot.isOn ? scannerAccentDim : "rgba(130,130,130,0.35)"}`,
                        background: slot.isOn
                          ? (slot.type === "ir" ? "rgba(255,154,60,0.1)" : "rgba(0,204,170,0.08)")
                          : "rgba(90,90,90,0.12)",
                        color: slot.isOn ? scannerAccent : "rgba(180,180,180,0.65)",
                        fontFamily: font,
                        cursor: slot.isOn ? "pointer" : "not-allowed",
                      }}
                      disabled={!slot.isOn}
                      aria-label={`Reset scanner ${slot.id} gate`}
                    >
                      RESET
                    </button>
                    <button
                      onClick={() => slot.setOn(!slot.isOn)}
                      style={{
                        padding: "1px 6px",
                        fontSize: 8,
                        letterSpacing: 1,
                        borderRadius: 1,
                        border: `1px solid ${slot.isOn ? scannerAccent : "rgba(130,130,130,0.5)"}`,
                        background: slot.isOn
                          ? (slot.type === "ir" ? "rgba(255,154,60,0.16)" : "rgba(0,204,170,0.14)")
                          : "rgba(90,90,90,0.16)",
                        color: slot.isOn ? scannerAccentGlow : "rgba(180,180,180,0.85)",
                        fontFamily: font,
                        cursor: "pointer",
                      }}
                      aria-label={`Toggle scanner ${slot.id} power`}
                    >
                      {slot.isOn ? "ON" : "OFF"}
                    </button>
                  </div>
                )}
              >
                {slot.type === "ir" ? (
                  <IrAnalyzer
                    contacts={contacts}
                    time={time}
                    selectedBearing={selectedBearing}
                    onBearingChange={setSelectedBearing}
                    resetToken={slot.resetToken}
                    scannerOn={slot.isOn}
                  />
                ) : (
                  <GravAnalyzer
                    contacts={contacts}
                    time={time}
                    selectedBearing={selectedBearing}
                    onBearingChange={setSelectedBearing}
                    resetToken={slot.resetToken}
                    scannerOn={slot.isOn}
                  />
                )}
              </Panel>
            );
          })}
          <Panel
            title="Reserved"
            style={{ flex: 1, minHeight: 48, minWidth: 0 }}
            headerRight={<span style={{ color: AMBER_DIM, fontSize: 8 }}>—</span>}
          >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                margin: 6,
                borderRadius: 2,
                border: `1px dashed ${AMBER_DIM}44`,
                background: "rgba(8,8,8,0.35)",
              }}
              aria-label="Reserved EW console slot"
            />
          </Panel>
        </div>

        <div style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <Panel
            title="Multi-Function Display"
            style={{ flex: 1, minHeight: 0 }}
            headerRight={
              ewMfdTab === "MAP" ? (
                <span style={{ color: AMBER_DIM, fontSize: 8 }}>MAP ONLINE</span>
              ) : ewMfdTab === "RADAR" ? (
                <span style={{ color: GREEN_DIM, fontSize: 8, letterSpacing: 1 }}>B-SCOPE</span>
              ) : (
                <span style={{ color: GREEN_DIM, fontSize: 8, letterSpacing: 1 }}>PILOT VIEW</span>
              )
            }
          >
            <div style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
            >
              <div style={{
                display: "flex",
                gap: 4,
                padding: "6px 8px",
                borderBottom: `1px solid ${AMBER_DIM}55`,
                background: "rgba(0,0,0,0.28)",
                flexShrink: 0,
              }}
              >
                {EW_MFD_TABS.map((tab) => {
                  const active = tab === ewMfdTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEwMfdTab(tab)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 1,
                        border: `1px solid ${active ? AMBER : AMBER_DIM}`,
                        background: active ? "rgba(255,176,0,0.14)" : "rgba(255,176,0,0.04)",
                        color: active ? AMBER_GLOW : AMBER_DIM,
                        fontFamily: font,
                        fontSize: 10,
                        letterSpacing: 1,
                        cursor: "pointer",
                      }}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
              <div style={{
                flex: 1,
                minHeight: 0,
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
              >
                {ewMfdTab === "TV" ? (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        border: "1px solid rgba(125,132,142,0.28)",
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 14,
                        left: 16,
                        color: AMBER_GLOW,
                        fontFamily: font,
                        fontSize: 12,
                        letterSpacing: 1,
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    >
                      EXT VIS — ORBIT CAM
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        bottom: 14,
                        left: 16,
                        color: AMBER_DIM,
                        fontFamily: font,
                        fontSize: 11,
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    >
                      {`${EW_ORBIT_FEED_W}×${EW_ORBIT_FEED_H} · PILOT VIEW`}
                    </div>
                    <div
                      ref={ewTvWrapperRef}
                      style={{
                        position: "absolute",
                        inset: 10,
                        background: "#000",
                        border: `1px solid ${AMBER_DIM}88`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      <canvas
                        ref={ewTvDisplayRef}
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "block",
                        }}
                        aria-label="External visual: pilot orbit camera"
                      />
                    </div>
                  </>
                ) : (
                  <EWSystemMap time={time} mfdTab={ewMfdTab} />
                )}
              </div>
            </div>
          </Panel>
          <div style={{
            display: "flex",
            flexDirection: "row",
            gap: 6,
            height: scannerPanelHeightPx,
            minHeight: scannerPanelHeightPx,
            flex: "0 0 auto",
            width: "100%",
            minWidth: 0,
          }}>
            <div
              style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
              title="Remote Warp Core Attenuator"
            >
              <Panel
                title="RWCA"
                style={{ flex: 1, minWidth: 0, minHeight: 0 }}
                headerCenter={rwcaPowered ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      touchAction: "none",
                      height: 28,
                      maxHeight: 28,
                      boxSizing: "border-box",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: font,
                      whiteSpace: "nowrap",
                      color: AMBER_GLOW,
                      letterSpacing: "0.02em",
                      lineHeight: 1,
                      textShadow: "0 0 6px rgba(255, 204, 68, 0.35)",
                    }}>
                      {rwcaRangeKm.toFixed(0)}
                      <span style={{ fontSize: 8, fontWeight: 600, color: AMBER, marginLeft: 3, opacity: 0.92 }}>
                        km
                      </span>
                    </span>
                    <input
                      type="range" min={0} max={1} step={0.01} value={rwcaPower}
                      onChange={e => setRwcaPower(+e.target.value)}
                      style={{
                        width: 96,
                        minWidth: 96,
                        accentColor: AMBER,
                        height: 14,
                        margin: 0,
                        cursor: "pointer",
                        touchAction: "none",
                      }}
                    />
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: font,
                      whiteSpace: "nowrap",
                      color: AMBER_GLOW,
                      letterSpacing: "0.06em",
                      lineHeight: 1,
                    }}>
                      {Math.round(rwcaPower * 100)}% PWR
                    </span>
                  </div>
                ) : null}
                headerRight={(
                  <EwSysPowerArmHeader
                    font={font}
                    isPowered={rwcaPowered}
                    isArmed={rwcaArmed}
                    onTogglePower={() => setRwcaPowered((p) => !p)}
                    onToggleArmed={() => setRwcaArmed((a) => !a)}
                  />
                )}
              >
                <div style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  opacity: rwcaPowered && rwcaArmed ? 1 : 0.4,
                  filter: rwcaPowered && rwcaArmed ? "none" : "grayscale(1)",
                  pointerEvents: rwcaPowered && rwcaArmed ? "auto" : "none",
                }}
                >
                  <RWCAPanel
                    contacts={contacts}
                    lockState={lockState}
                    time={time}
                    power={rwcaPower}
                    rangeKm={rwcaRangeKm}
                    rwcaPowered={rwcaPowered}
                    rwcaArmed={rwcaArmed}
                  />
                </div>
              </Panel>
            </div>
            <div
              style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
              title="Relativistic Drag Net Emitter"
            >
              <Panel
                title="RDNE"
                style={{ flex: 1, minWidth: 0, minHeight: 0 }}
                headerCenter={rdnePowered && rdneArmed ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      touchAction: "none",
                      height: 28,
                      maxHeight: 28,
                      boxSizing: "border-box",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: font,
                      whiteSpace: "nowrap",
                      color: AMBER_GLOW,
                      letterSpacing: "0.02em",
                      lineHeight: 1,
                      textShadow: "0 0 6px rgba(255, 204, 68, 0.35)",
                    }}>
                      {rdneRangeKm.toFixed(0)}
                      <span style={{ fontSize: 8, fontWeight: 600, color: AMBER, marginLeft: 3, opacity: 0.92 }}>
                        km
                      </span>
                    </span>
                    <input
                      type="range" min={0} max={1} step={0.01} value={rdnePower}
                      onChange={e => setRdnePower(+e.target.value)}
                      style={{
                        width: 96,
                        minWidth: 96,
                        accentColor: AMBER,
                        height: 14,
                        margin: 0,
                        cursor: "pointer",
                        touchAction: "none",
                      }}
                    />
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: font,
                      whiteSpace: "nowrap",
                      color: AMBER_GLOW,
                      letterSpacing: "0.06em",
                      lineHeight: 1,
                    }}>
                      {Math.round(rdnePower * 100)}% PWR
                    </span>
                  </div>
                ) : null}
                headerRight={(
                  <EwSysPowerArmHeader
                    font={font}
                    isPowered={rdnePowered}
                    isArmed={rdneArmed}
                    onTogglePower={() => setRdnePowered((p) => !p)}
                    onToggleArmed={() => setRdneArmed((a) => !a)}
                  />
                )}
              >
                <div style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  opacity: rdnePowered && rdneArmed ? 1 : 0.4,
                  filter: rdnePowered && rdneArmed ? "none" : "grayscale(1)",
                  pointerEvents: rdnePowered && rdneArmed ? "auto" : "none",
                }}
                >
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      margin: 6,
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "stretch",
                      gap: 2,
                    }}
                  >
                  <div
                    ref={rdneSurfaceRef}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 0,
                      borderRadius: 2,
                      border: `1px dashed ${AMBER_DIM}44`,
                      background: "rgba(8,8,8,0.35)",
                      position: "relative",
                      overflow: "hidden",
                      touchAction: "none",
                    }}
                    aria-label="RDNE — Relativistic Drag Net Emitter range cue"
                    onContextMenu={(e) => e.preventDefault()}
                    onPointerDown={(e) => {
                      if (!rdnePowered || !rdneArmed) return;
                      const surface = rdneSurfaceRef.current;
                      if (!surface) return;
                      if (e.button === 0 || e.button === 2) e.preventDefault();
                      if (e.button === 0) {
                        const { nx, ny } = rdneNormFromClient(e.clientX, e.clientY, surface);
                        setRdneUserMarker({ kind: "amber", nx, ny });
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } else if (e.button === 2) {
                        const { nx, ny } = rdneNormFromClient(e.clientX, e.clientY, surface);
                        setRdneUserMarker({ kind: "blue", nx, ny });
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }
                    }}
                    onPointerMove={(e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const surface = rdneSurfaceRef.current;
                      if (!surface) return;
                      const { nx, ny } = rdneNormFromClient(e.clientX, e.clientY, surface);
                      setRdneUserMarker((prev) => (prev ? { ...prev, nx, ny } : null));
                    }}
                    onPointerUp={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    }}
                    onPointerCancel={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    }}
                  >
                    {rdneLockedTargetMarker ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 0,
                          pointerEvents: "none",
                          backgroundImage:
                            "radial-gradient(circle, rgba(255, 204, 68, 0.26) 1px, transparent 1.45px)",
                          backgroundSize: `${RDNE_LOCK_GRID_STEP_PX}px ${RDNE_LOCK_GRID_STEP_PX}px`,
                          backgroundPosition: `${RDNE_LOCK_GRID_STEP_PX / 2}px ${RDNE_LOCK_GRID_STEP_PX / 2}px`,
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {rdneLockedTargetMarker ? (
                      <div
                        style={{
                          position: "absolute",
                          left: `${rdneLockCueNormX(rdneLockedTargetMarker.t) * 100}%`,
                          top: "50%",
                          width: 0,
                          height: 0,
                          overflow: "visible",
                          pointerEvents: "none",
                          zIndex: 2,
                        }}
                        aria-hidden
                      >
                        <svg
                          width={28}
                          height={26}
                          viewBox="0 0 28 26"
                          style={{
                            position: "absolute",
                            left: -RDNE_LOCK_TRI_CX,
                            top: -RDNE_LOCK_TRI_CY,
                            transform: `rotate(${rdneLockedTargetMarker.displayRotationDeg}deg)`,
                            transformOrigin: `${RDNE_LOCK_TRI_CX}px ${RDNE_LOCK_TRI_CY}px`,
                            overflow: "visible",
                            filter: "drop-shadow(0 0 3px rgba(255,204,68,0.4))",
                          }}
                        >
                          <polygon
                            points="14,5 6,24 22,24"
                            fill={AMBER_GLOW}
                            stroke={AMBER}
                            strokeWidth={0.55}
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    ) : null}
                    {rdnePowered && rdneArmed && rdneUserMarker && rdneVectorArrows.length > 0 ? (
                      <svg
                        width={rdneSurfacePx.w}
                        height={rdneSurfacePx.h}
                        viewBox={`0 0 ${rdneSurfacePx.w} ${rdneSurfacePx.h}`}
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          display: "block",
                          pointerEvents: "none",
                          zIndex: 0,
                          overflow: "visible",
                        }}
                        aria-hidden
                      >
                        {rdneVectorArrows.map((a, i) => {
                          const stroke =
                            rdneUserMarker.kind === "amber"
                              ? AMBER_DIM
                              : "rgba(126, 200, 255, 0.82)";
                          return (
                            <g key={`${a.gx}_${a.gy}_${i}`}>
                              <line
                                x1={a.gx}
                                y1={a.gy}
                                x2={a.bx}
                                y2={a.by}
                                stroke={stroke}
                                strokeWidth={1}
                                strokeLinecap="round"
                              />
                              <line
                                x1={a.tx}
                                y1={a.ty}
                                x2={a.w1x}
                                y2={a.w1y}
                                stroke={stroke}
                                strokeWidth={1}
                                strokeLinecap="round"
                              />
                              <line
                                x1={a.tx}
                                y1={a.ty}
                                x2={a.w2x}
                                y2={a.w2y}
                                stroke={stroke}
                                strokeWidth={1}
                                strokeLinecap="round"
                              />
                            </g>
                          );
                        })}
                      </svg>
                    ) : null}
                    {rdnePowered && rdneArmed && rdneResultantForceArrow ? (
                      <svg
                        width={rdneSurfacePx.w}
                        height={rdneSurfacePx.h}
                        viewBox={`0 0 ${rdneSurfacePx.w} ${rdneSurfacePx.h}`}
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          display: "block",
                          pointerEvents: "none",
                          zIndex: 1,
                          overflow: "visible",
                        }}
                        aria-hidden
                      >
                        <defs>
                          <filter id={rdneResultantFilterId} x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="1.2" result="b" />
                            <feMerge>
                              <feMergeNode in="b" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                          </filter>
                        </defs>
                        <g filter={`url(#${rdneResultantFilterId})`}>
                          <line
                            x1={rdneResultantForceArrow.sx}
                            y1={rdneResultantForceArrow.sy}
                            x2={rdneResultantForceArrow.bx}
                            y2={rdneResultantForceArrow.by}
                            stroke="rgba(255, 64, 64, 0.95)"
                            strokeWidth={1.35}
                            strokeLinecap="round"
                          />
                          <line
                            x1={rdneResultantForceArrow.tx}
                            y1={rdneResultantForceArrow.ty}
                            x2={rdneResultantForceArrow.w1x}
                            y2={rdneResultantForceArrow.w1y}
                            stroke="rgba(255, 64, 64, 0.95)"
                            strokeWidth={1.35}
                            strokeLinecap="round"
                          />
                          <line
                            x1={rdneResultantForceArrow.tx}
                            y1={rdneResultantForceArrow.ty}
                            x2={rdneResultantForceArrow.w2x}
                            y2={rdneResultantForceArrow.w2y}
                            stroke="rgba(255, 64, 64, 0.95)"
                            strokeWidth={1.35}
                            strokeLinecap="round"
                          />
                        </g>
                      </svg>
                    ) : null}
                    {rdnePowered && rdneArmed && rdneUserMarker ? (
                      <div
                        role="presentation"
                        style={{
                          position: "absolute",
                          left: `${rdneUserMarker.nx * 100}%`,
                          top: `${rdneUserMarker.ny * 100}%`,
                          width: RDNE_USER_MARKER_HIT_PX,
                          height: RDNE_USER_MARKER_HIT_PX,
                          marginLeft: -RDNE_USER_MARKER_HIT_PX / 2,
                          marginTop: -RDNE_USER_MARKER_HIT_PX / 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          zIndex: 3,
                          cursor: "grab",
                          touchAction: "none",
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const dragAmber = rdneUserMarker.kind === "amber" && e.button === 0;
                          const dragBlue = rdneUserMarker.kind === "blue" && e.button === 2;
                          if (!dragAmber && !dragBlue) return;
                          e.preventDefault();
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                          const surface = rdneSurfaceRef.current;
                          if (!surface) return;
                          const { nx, ny } = rdneNormFromClient(e.clientX, e.clientY, surface);
                          setRdneUserMarker((prev) => (prev ? { ...prev, nx, ny } : null));
                        }}
                        onPointerUp={(e) => {
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                        }}
                        onPointerCancel={(e) => {
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                        }}
                      >
                        <div
                          aria-hidden
                          style={{
                            width: RDNE_USER_MARKER_DIAM_PX,
                            height: RDNE_USER_MARKER_DIAM_PX,
                            borderRadius: "50%",
                            flexShrink: 0,
                            pointerEvents: "none",
                            background:
                              rdneUserMarker.kind === "amber"
                                ? AMBER_GLOW
                                : "radial-gradient(circle at 30% 30%, #a8dcff, #4a9fe8)",
                            boxShadow:
                              rdneUserMarker.kind === "amber"
                                ? "0 0 6px rgba(255, 204, 68, 0.55)"
                                : "0 0 6px rgba(100, 180, 255, 0.5)",
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      width: 48,
                      flexShrink: 0,
                      alignSelf: "stretch",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "4px 4px 6px",
                      boxSizing: "border-box",
                      touchAction: "none",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        fontFamily: font,
                        color: AMBER_GLOW,
                        letterSpacing: "0.14em",
                        userSelect: "none",
                        flexShrink: 0,
                        lineHeight: 1,
                        textAlign: "center",
                        marginTop: 10,
                      }}
                    >
                      FLUX
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minHeight: 40,
                        width: "100%",
                        position: "relative",
                        marginTop: 6,
                      }}
                    >
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={rdneFieldIntensity}
                        onChange={(e) => setRdneFieldIntensity(+e.target.value)}
                        aria-label="RDNE flux — field radius and strength (0–1)"
                        title="Flux — field radius and strength"
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          width: 112,
                          height: 18,
                          margin: 0,
                          padding: 0,
                          transform: "translate(-50%, -50%) rotate(-90deg)",
                          accentColor: AMBER,
                          cursor: "pointer",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: font,
                        color: AMBER,
                        letterSpacing: "0.02em",
                        userSelect: "none",
                        flexShrink: 0,
                        lineHeight: 1,
                        marginTop: 4,
                        fontVariantNumeric: "tabular-nums",
                      }}
                      aria-live="polite"
                    >
                      {(Math.round(rdneFieldIntensity * 10) / 10).toFixed(1)}
                    </span>
                  </div>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "3px 12px",
        borderTop: `1px solid ${AMBER_DIM}33`,
        fontSize: 8,
        color: AMBER_DIM,
      }}>
        <span>CONTACTS TRACKED: {visibleContacts.length}</span>
        <span>RADAR: {radarOn ? effectiveRadarMode : "OFF"}</span>
        <span>FREQ: {(radarFreq * 18 + 2).toFixed(1)} GHz</span>
        <span>PRF: {radarPRF}</span>
        <span style={{ color: radarOn ? RED_ALERT : AMBER_DIM }}>
          {radarOn ? "⚠ ACTIVELY EMITTING" : "LOW OBSERVABLE"}
        </span>
      </div>
    </div>
  );
}
