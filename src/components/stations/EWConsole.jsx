import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useGameStore } from "@/state/gameStore";
import { getCelestialById } from "@/utils/systemData";
import { EWSystemMap } from "@/components/stations/EWSystemMap";
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

function buildContactsFromGame(enemy) {
  const gameState = useGameStore.getState();
  const playerPos = gameState.ship.position;
  const dx = enemy.position[0] - playerPos[0];
  const dz = enemy.position[2] - playerPos[2];
  const range = Math.sqrt(dx * dx + dz * dz);
  const bearing = ((Math.atan2(dx, dz) * 180 / Math.PI) + 360) % 360;
  const radarMode = enemy.radarMode;

  const thermal = enemy.thrustersOn ? 0.3 + (enemy.speed / 215) * 0.4 : 0.08;
  const type = radarMode === "off" ? "unknown" : "battleship";

  // Different radar modes produce different spectrum signatures
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
  } else if (radarMode === "deception") {
    emStrength = 0.7;
    freq = 0.42;
    sigWidth = 0.06;
    sigType = "deception";
  } else {
    emStrength = 0.0;
    freq = 0.42;
    sigWidth = 0.08;
    sigType = "none";
  }

  const contacts = [
    {
      id: "Σ",
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
      jamming: radarMode === "deception",
      rcs: type === "battleship" ? 22 : 2,
      heading: enemy.heading,
      speed: enemy.speed,
      relDx: dx,
      relDz: dz,
    },
  ];

  // Add missile seeker as separate contact if launched
  if (enemy.missileLaunched) {
    contacts.push({
      id: "M",
      bearing,
      range: Math.max(0, range - 2000),
      freq: 0.72,
      sigWidth: 0.01,
      sigType: "missile",
      emStrength: 0.95,
      thermal: 0.9,
      type: "missile",
      driftBearing: 0,
      driftRange: 0,
      active: true,
      jamming: false,
      rcs: 0.5,
      heading: enemy.heading,
      speed: 800,
      relDx: dx,
      relDz: dz,
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

// Noise generator
const noise = (x, t) => {
  const s = Math.sin(x * 12.9898 + t * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Panel frame component
const Panel = ({ title, children, style, className = "", headerRight = null, dimmed = false }) => (
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
      padding: "4px 10px",
      fontSize: 10,
      fontFamily: "'Consolas', 'Monaco', monospace",
      color: AMBER,
      letterSpacing: 3,
      textTransform: "uppercase",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}>
      <span>{title}</span>
      {headerRight ?? <span style={{ color: AMBER_DIM, fontSize: 8 }}>■ ACTIVE</span>}
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
      const bDist = Math.abs(relBrg);
      if (bDist > 180) return;

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
      }

      const proxFactor = 1 - bDist / 180;
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
            displacement += shaped * totalMass * massScale * proxFactor * H * amp;
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
            displacement += beltContribution * totalMass * proxFactor * H * 0.26;
          }
        } else {
          const fallbackWidth = 0.045;
          if (wellDist < fallbackWidth) {
            const wellDepth = (1 - wellDist / fallbackWidth) * totalMass * proxFactor;
            displacement += wellDepth * H * 0.3;
          }
        }
      } else {
        const wellWidth = 0.06;
        if (wellDist < wellWidth) {
          const wellDepth = (1 - wellDist / wellWidth) * totalMass * proxFactor;
          displacement -= wellDepth * wellDepth * H * 0.25;
        }
      }
      if (!isCelestial && wellDist < 0.03) {
        const dragFreq = 40 + c.range * 0.002;
        displacement += Math.sin(t * dragFreq + time * 2) * totalMass * proxFactor * 5;
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
                ? `${Math.ceil(activeAnalysisRemaining / 1000)}s`
                : targetAlreadyRevealed
                  ? "KNOWN"
                  : gravQuality.state !== "none" && gravQuality.celestialId
                    ? `ANALYZE ${Math.ceil(gravQuality.durationMs / 1000)}s`
                    : "ANALYZE"}
            </span>
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
        const enemyHRad = c.heading * Math.PI / 180;
        // Match simulation kinematics: enemy X velocity uses -sin(heading).
        const vxVis = -Math.sin(enemyHRad) * c.speed;
        const vzVis = -Math.cos(enemyHRad) * c.speed;

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

// Main Component
export default function EWConsole() {
  const [time, setTime] = useState(0);
  const enemy = useGameStore((s) => s.enemy);
  const starSystem = useGameStore((s) => s.starSystem);
  const currentCelestialId = useGameStore((s) => s.currentCelestialId);
  const gravScannerOn = useGameStore((s) => s.ewGravScannerOn);
  const setGravScannerOn = useGameStore((s) => s.setEwGravScannerOn);
  const [contacts, setContacts] = useState(() => buildContactsFromGame(enemy));
  const [selectedContact, setSelectedContact] = useState("Σ");
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
  const [gravResetToken, setGravResetToken] = useState(0);
  const [staleContacts, setStaleContacts] = useState({});
  const [classifierMenu, setClassifierMenu] = useState(null);
  const radarWasOnRef = useRef(false);
  const [logEntries, setLogEntries] = useState([
    { t: "00:00:00", msg: "SYSTEM ONLINE — PASSIVE ELINT MODE", type: "sys" },
  ]);
  const contactUpdateAtRef = useRef(0);
  const timeUpdateAtRef = useRef(0);

  useEffect(() => {
    let frame;
    const tick = () => {
      const now = performance.now();
      if (now - timeUpdateAtRef.current >= 33) {
        setTime(t => t + 0.033);
        timeUpdateAtRef.current = now;
      }
      if (now - contactUpdateAtRef.current >= 33) {
        const currentEnemy = useGameStore.getState().enemy;
        setContacts(buildContactsFromGame(currentEnemy));
        contactUpdateAtRef.current = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

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
        <div style={{ flex: "0 0 36%", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <Panel
            title="Gravimetric Scanner"
            style={{ minHeight: 160 }}
            dimmed={!gravScannerOn}
            headerRight={(
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => setGravResetToken((v) => v + 1)}
                  style={{
                    padding: "1px 6px",
                    fontSize: 8,
                    letterSpacing: 1,
                    borderRadius: 1,
                    border: `1px solid ${gravScannerOn ? GRAV_CYAN_DIM : "rgba(130,130,130,0.35)"}`,
                    background: gravScannerOn ? "rgba(0,204,170,0.08)" : "rgba(90,90,90,0.12)",
                    color: gravScannerOn ? GRAV_CYAN : "rgba(180,180,180,0.65)",
                    fontFamily: font,
                    cursor: gravScannerOn ? "pointer" : "not-allowed",
                  }}
                  disabled={!gravScannerOn}
                  aria-label="Reset gravimetric scanner gate"
                >
                  RESET
                </button>
                <button
                  onClick={() => setGravScannerOn(!gravScannerOn)}
                  style={{
                    padding: "1px 6px",
                    fontSize: 8,
                    letterSpacing: 1,
                    borderRadius: 1,
                    border: `1px solid ${gravScannerOn ? GRAV_CYAN : "rgba(130,130,130,0.5)"}`,
                    background: gravScannerOn ? "rgba(0,204,170,0.14)" : "rgba(90,90,90,0.16)",
                    color: gravScannerOn ? GRAV_CYAN_GLOW : "rgba(180,180,180,0.85)",
                    fontFamily: font,
                    cursor: "pointer",
                  }}
                  aria-label="Toggle gravimetric scanner"
                >
                  {gravScannerOn ? "ON" : "OFF"}
                </button>
              </div>
            )}
          >
            <GravAnalyzer
              contacts={visibleContacts}
              time={time}
              selectedBearing={selectedBearing}
              onBearingChange={setSelectedBearing}
              resetToken={gravResetToken}
              scannerOn={gravScannerOn}
            />
          </Panel>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
          <Panel
            title="Multi-Function Display"
            style={{ flex: 1, minHeight: 160 }}
            headerRight={<span style={{ color: AMBER_DIM, fontSize: 8 }}>MAP ONLINE</span>}
          >
            <EWSystemMap time={time} />
          </Panel>
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
