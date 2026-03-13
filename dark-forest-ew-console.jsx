import { useState, useEffect, useRef, useCallback } from "react";

const AMBER = "#ffb000";
const AMBER_DIM = "#7a5500";
const AMBER_GLOW = "#ffcc44";
const BG_DARK = "#0a0a08";
const BG_PANEL = "#111110";
const BG_SCREEN = "#080808";
const GRID_COLOR = "rgba(255,176,0,0.07)";
const GRID_COLOR_BRIGHT = "rgba(255,176,0,0.15)";
const RED_ALERT = "#ff3333";
const GREEN_DIM = "#00ff6644";

// Simulated contacts
const createContacts = () => [
  { id: "α", bearing: 47, range: 7200, freq: 0.35, emStrength: 0.6, thermal: 0.3, type: "destroyer", driftBearing: 0.02, driftRange: -8, active: true, jamming: false },
  { id: "β", bearing: 192, range: 11500, freq: 0.62, emStrength: 0.25, thermal: 0.15, type: "unknown", driftBearing: -0.01, driftRange: 5, active: true, jamming: false },
  { id: "γ", bearing: 315, range: 4800, freq: 0.78, emStrength: 0.0, thermal: 0.08, type: "stealth", driftBearing: 0.005, driftRange: -2, active: false, jamming: false },
];

// Noise generator
const noise = (x, t) => {
  const s = Math.sin(x * 12.9898 + t * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Panel frame component
const Panel = ({ title, children, style, className = "" }) => (
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
      fontFamily: "'Share Tech Mono', monospace",
      color: AMBER,
      letterSpacing: 3,
      textTransform: "uppercase",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}>
      <span>{title}</span>
      <span style={{ color: AMBER_DIM, fontSize: 8 }}>■ ACTIVE</span>
    </div>
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      {children}
    </div>
  </div>
);

// Waterfall Display
const WaterfallDisplay = ({ contacts, time }) => {
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

    // New top row
    for (let x = 0; x < W; x++) {
      const bearing = (x / W) * 360;
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

    // Bearing labels
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, 14);
    ctx.font = "9px 'Share Tech Mono', monospace";
    ctx.fillStyle = AMBER_DIM;
    for (let b = 0; b < 360; b += 45) {
      const bx = (b / 360) * W;
      ctx.fillText(`${b}°`, bx + 2, 10);
      ctx.strokeStyle = GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(bx, 14);
      ctx.lineTo(bx, H);
      ctx.stroke();
    }
  }, [time, contacts]);

  return <canvas ref={canvasRef} width={520} height={200} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />;
};

// Spectrum Analyzer
const SpectrumAnalyzer = ({ contacts, time, selectedBearing }) => {
  const canvasRef = useRef(null);

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

    // Center line brighter
    ctx.strokeStyle = GRID_COLOR_BRIGHT;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    // Spectrum trace
    ctx.beginPath();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = AMBER_GLOW;
    ctx.shadowBlur = 6;

    for (let x = 0; x < W; x++) {
      const freq = x / W;
      let amplitude = (noise(freq * 50, time) * 0.08 + noise(freq * 120, time * 1.3) * 0.04) * H;

      contacts.forEach(c => {
        if (!c.active) return;
        const bearingDist = Math.abs(selectedBearing - c.bearing);
        const bDist = Math.min(bearingDist, 360 - bearingDist);
        if (bDist > 30) return;
        const bearingFactor = 1 - bDist / 30;
        const freqDist = Math.abs(freq - c.freq);
        if (freqDist < 0.08) {
          const spike = (1 - freqDist / 0.08) * c.emStrength * bearingFactor;
          amplitude += spike * H * 0.7 * (0.8 + Math.sin(time * 3 + c.freq * 20) * 0.2);
        }
        // Harmonics
        const harm = Math.abs(freq - c.freq * 2);
        if (harm < 0.04 && c.freq * 2 < 1) {
          amplitude += (1 - harm / 0.04) * c.emStrength * bearingFactor * H * 0.2;
        }
      });

      const y = H - 20 - amplitude;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Labels
    ctx.font = "8px 'Share Tech Mono', monospace";
    ctx.fillStyle = AMBER_DIM;
    ctx.fillText("0 Hz", 4, H - 4);
    ctx.fillText("FREQ →", W / 2 - 20, H - 4);
    ctx.fillText("MAX", W - 24, H - 4);
    ctx.fillText(`BRG: ${selectedBearing}°`, 4, 10);
    ctx.fillText("dBm", 4, 22);
  }, [time, contacts, selectedBearing]);

  return <canvas ref={canvasRef} width={400} height={160} style={{ width: "100%", height: "100%", background: BG_SCREEN }} />;
};

// Polar Scope (Bearing/Range)
const PolarScope = ({ contacts, time, selectedContact, onSelectContact }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(cx, cy) - 20;

    ctx.fillStyle = BG_SCREEN;
    ctx.fillRect(0, 0, W, H);

    // Range rings
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let r = 1; r <= 4; r++) {
      const radius = (r / 4) * maxR;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "7px 'Share Tech Mono', monospace";
      ctx.fillStyle = AMBER_DIM;
      ctx.fillText(`${r * 4}km`, cx + radius - 16, cy - 3);
    }

    // Bearing lines
    for (let b = 0; b < 360; b += 30) {
      const rad = (b - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
      ctx.strokeStyle = b % 90 === 0 ? GRID_COLOR_BRIGHT : GRID_COLOR;
      ctx.stroke();

      if (b % 90 === 0) {
        const labels = { 0: "000", 90: "090", 180: "180", 270: "270" };
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.fillStyle = AMBER_DIM;
        const lx = cx + Math.cos(rad) * (maxR + 12);
        const ly = cy + Math.sin(rad) * (maxR + 12);
        ctx.fillText(labels[b], lx - 8, ly + 3);
      }
    }

    // Sweep line
    const sweepAngle = (time * 0.4 % 1) * Math.PI * 2 - Math.PI / 2;
    const sweepGrad = ctx.createConicalGradient ? null : null;
    ctx.strokeStyle = "rgba(255,176,0,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
    ctx.stroke();

    // Sweep fade trail
    for (let i = 1; i < 20; i++) {
      const a = sweepAngle - i * 0.015;
      ctx.strokeStyle = `rgba(255,176,0,${0.02 * (20 - i) / 20})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
      ctx.stroke();
    }

    // Contacts
    contacts.forEach(c => {
      if (!c.active && c.emStrength === 0 && c.thermal < 0.05) return;
      const sig = Math.max(c.emStrength, c.thermal * 0.5);
      if (sig < 0.03) return;
      const maxRange = 16000;
      const rNorm = Math.min(c.range / maxRange, 1);
      const rad = (c.bearing - 90) * Math.PI / 180;
      const px = cx + Math.cos(rad) * rNorm * maxR;
      const py = cy + Math.sin(rad) * rNorm * maxR;

      // Uncertainty blob
      const uncertainty = (1 - sig) * 18 + 4;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, uncertainty);
      grad.addColorStop(0, `rgba(255,176,0,${0.4 * sig})`);
      grad.addColorStop(0.5, `rgba(255,176,0,${0.15 * sig})`);
      grad.addColorStop(1, "rgba(255,176,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, uncertainty, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.fillStyle = selectedContact === c.id ? AMBER_GLOW : AMBER;
      ctx.shadowColor = AMBER_GLOW;
      ctx.shadowBlur = selectedContact === c.id ? 10 : 4;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      ctx.font = "9px 'Share Tech Mono', monospace";
      ctx.fillStyle = selectedContact === c.id ? AMBER_GLOW : AMBER;
      ctx.fillText(c.id, px + 6, py - 4);
    });

    // Center ship
    ctx.fillStyle = GREEN_DIM;
    ctx.strokeStyle = "#00ff66";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

  }, [time, contacts, selectedContact]);

  return <canvas ref={canvasRef} width={280} height={280} style={{ width: "100%", height: "100%", background: BG_SCREEN }} />;
};

// EMCON status bars
const EmconBar = ({ label, value, warning }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
    <span style={{ width: 36, fontSize: 8, color: AMBER_DIM, fontFamily: "'Share Tech Mono', monospace", textAlign: "right" }}>{label}</span>
    <div style={{ flex: 1, height: 8, background: "#1a1a18", border: `1px solid ${AMBER_DIM}33`, borderRadius: 1, overflow: "hidden" }}>
      <div style={{
        width: `${value * 100}%`,
        height: "100%",
        background: warning ? `linear-gradient(90deg, ${AMBER}, ${RED_ALERT})` : `linear-gradient(90deg, ${AMBER_DIM}, ${AMBER})`,
        transition: "width 0.3s",
        boxShadow: warning ? `0 0 6px ${RED_ALERT}` : "none",
      }} />
    </div>
    <span style={{ width: 28, fontSize: 8, color: warning ? RED_ALERT : AMBER, fontFamily: "'Share Tech Mono', monospace" }}>
      {(value * 100).toFixed(0)}%
    </span>
  </div>
);

// Main Component
export default function EWConsole() {
  const [time, setTime] = useState(0);
  const [contacts, setContacts] = useState(createContacts);
  const [selectedContact, setSelectedContact] = useState("α");
  const [selectedBearing, setSelectedBearing] = useState(47);
  const [mode, setMode] = useState("PASSIVE");
  const [jamming, setJamming] = useState(false);
  const [emconLevel, setEmconLevel] = useState(0.3);
  const [freqBand, setFreqBand] = useState(0.5);
  const [logEntries, setLogEntries] = useState([
    { t: "00:00:12", msg: "SYSTEM ONLINE — PASSIVE ELINT MODE", type: "sys" },
    { t: "00:00:34", msg: "CONTACT α DETECTED — BRG 047 — EM SIG MODERATE", type: "detect" },
    { t: "00:01:15", msg: "CONTACT β DETECTED — BRG 192 — EM SIG WEAK", type: "detect" },
    { t: "00:02:41", msg: "THERMAL ANOMALY BRG 315 — CLASSIFYING...", type: "warn" },
  ]);

  // Animation loop
  useEffect(() => {
    let frame;
    const tick = () => {
      setTime(t => t + 0.016);
      setContacts(prev => prev.map(c => ({
        ...c,
        bearing: (c.bearing + c.driftBearing + 360) % 360,
        range: Math.max(1000, c.range + c.driftRange),
        emStrength: c.active ? Math.max(0, c.emStrength + (Math.random() - 0.5) * 0.01) : c.emStrength,
      })));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const selectedData = contacts.find(c => c.id === selectedContact);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    const timestamp = `00:${String(Math.floor(time / 60)).padStart(2, "0")}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
    setLogEntries(prev => [...prev.slice(-8), {
      t: timestamp,
      msg: newMode === "ACTIVE" ? "⚠ ACTIVE RADAR — EMITTING" : newMode === "JAM" ? "⚠ JAMMING INITIATED — EMITTING ON ALL BANDS" : "PASSIVE MODE — EMISSIONS MINIMAL",
      type: newMode === "PASSIVE" ? "sys" : "warn"
    }]);
    if (newMode === "ACTIVE") setEmconLevel(0.75);
    else if (newMode === "JAM") setEmconLevel(0.95);
    else setEmconLevel(0.3);
  };

  const toggleJam = () => {
    setJamming(!jamming);
    if (!jamming) handleModeChange("JAM");
    else handleModeChange("PASSIVE");
  };

  const font = "'Share Tech Mono', monospace";

  return (
    <div style={{
      width: "100%",
      minHeight: "100vh",
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
      <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />

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
          <span>VESSEL: <span style={{ color: AMBER_GLOW }}>CNS ACHERON</span></span>
          <span>GRID: <span style={{ color: AMBER_GLOW }}>Σ-7.24.119</span></span>
          <span style={{
            color: mode === "PASSIVE" ? AMBER : RED_ALERT,
            animation: mode !== "PASSIVE" ? undefined : undefined,
          }}>
            EMCON: {mode === "PASSIVE" ? "LOW" : mode === "ACTIVE" ? "⚠ HIGH" : "⚠ CRITICAL"}
          </span>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: "flex", gap: 6, flex: 1, minHeight: 0 }}>

        {/* Left column: Waterfall + Spectrum */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <Panel title="Waterfall — EM Spectrum / Bearing" style={{ flex: 1, minHeight: 180 }}>
            <WaterfallDisplay contacts={contacts} time={time} />
          </Panel>

          <Panel title="Spectrum Analyzer" style={{ flex: 0, minHeight: 140 }}>
            <SpectrumAnalyzer contacts={contacts} time={time} selectedBearing={selectedBearing} />
          </Panel>

          {/* Mode controls */}
          <div style={{
            display: "flex", gap: 4,
            padding: "4px 0",
          }}>
            {["PASSIVE", "ACTIVE", "JAM"].map(m => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  background: mode === m ? (m === "PASSIVE" ? "rgba(255,176,0,0.15)" : "rgba(255,50,50,0.2)") : "rgba(255,176,0,0.03)",
                  border: `1px solid ${mode === m ? (m === "PASSIVE" ? AMBER : RED_ALERT) : AMBER_DIM}`,
                  color: mode === m ? (m === "PASSIVE" ? AMBER_GLOW : RED_ALERT) : AMBER_DIM,
                  fontFamily: font,
                  fontSize: 10,
                  letterSpacing: 2,
                  cursor: "pointer",
                  borderRadius: 1,
                  transition: "all 0.2s",
                }}
              >
                {m === "PASSIVE" ? "◉ PASSIVE ELINT" : m === "ACTIVE" ? "◈ ACTIVE RADAR" : "◆ NOISE JAM"}
              </button>
            ))}
          </div>

          {/* Frequency Management */}
          <Panel title="Frequency Management" style={{ padding: 8, minHeight: 60 }}>
            <div style={{ padding: "6px 8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: AMBER_DIM, marginBottom: 2 }}>
                <span>OWN FREQ BAND</span>
                <span>{(freqBand * 18 + 2).toFixed(1)} GHz</span>
              </div>
              <input
                type="range"
                min={0} max={100} value={freqBand * 100}
                onChange={e => setFreqBand(e.target.value / 100)}
                style={{
                  width: "100%", height: 4,
                  accentColor: AMBER,
                  cursor: "pointer",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: AMBER_DIM, marginTop: 2 }}>
                <span>2 GHz</span>
                <span>20 GHz</span>
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <button onClick={() => setFreqBand(Math.random())} style={{
                  flex: 1, padding: "4px", fontSize: 8, letterSpacing: 1,
                  background: "rgba(255,176,0,0.06)", border: `1px solid ${AMBER_DIM}`,
                  color: AMBER, fontFamily: font, cursor: "pointer", borderRadius: 1,
                }}>
                  FREQ HOP
                </button>
                <button style={{
                  flex: 1, padding: "4px", fontSize: 8, letterSpacing: 1,
                  background: "rgba(255,176,0,0.06)", border: `1px solid ${AMBER_DIM}`,
                  color: AMBER, fontFamily: font, cursor: "pointer", borderRadius: 1,
                }}>
                  AUTO CYCLE
                </button>
              </div>
            </div>
          </Panel>
        </div>

        {/* Center column: Polar scope */}
        <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <Panel title="Bearing / Range — Polar" style={{ flex: 1, minHeight: 260 }}>
            <PolarScope
              contacts={contacts}
              time={time}
              selectedContact={selectedContact}
              onSelectContact={setSelectedContact}
            />
          </Panel>

          {/* EMCON Panel */}
          <Panel title="EMCON — Ship Emissions" style={{ minHeight: 100 }}>
            <div style={{ padding: "6px 8px" }}>
              <EmconBar label="EM" value={emconLevel} warning={emconLevel > 0.6} />
              <EmconBar label="THRM" value={0.22 + Math.sin(time * 0.5) * 0.03} warning={false} />
              <EmconBar label="GRAV" value={0.08} warning={false} />
              <EmconBar label="COMMS" value={0.12} warning={false} />
              <div style={{
                marginTop: 6, padding: "4px 8px",
                background: emconLevel > 0.6 ? "rgba(255,50,50,0.1)" : "rgba(255,176,0,0.04)",
                border: `1px solid ${emconLevel > 0.6 ? "rgba(255,50,50,0.3)" : AMBER_DIM + "33"}`,
                fontSize: 8, color: emconLevel > 0.6 ? RED_ALERT : AMBER_DIM,
                textAlign: "center", letterSpacing: 1,
                borderRadius: 1,
              }}>
                {emconLevel > 0.6 ? "⚠ DETECTABLE — EMISSIONS ABOVE THRESHOLD" : "EMISSIONS NOMINAL — LOW OBSERVABILITY"}
              </div>
            </div>
          </Panel>
        </div>

        {/* Right column: Contacts + Log */}
        <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {/* Contact Classifier */}
          <Panel title="Signal Classifier" style={{ flex: 1 }}>
            <div style={{ padding: "4px 0" }}>
              {contacts.map(c => (
                <div
                  key={c.id}
                  onClick={() => {
                    setSelectedContact(c.id);
                    setSelectedBearing(Math.round(c.bearing));
                  }}
                  style={{
                    padding: "6px 10px",
                    borderBottom: `1px solid ${AMBER_DIM}22`,
                    cursor: "pointer",
                    background: selectedContact === c.id ? "rgba(255,176,0,0.08)" : "transparent",
                    borderLeft: selectedContact === c.id ? `2px solid ${AMBER}` : "2px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: AMBER_GLOW, fontSize: 12, fontWeight: "bold" }}>CONTACT {c.id}</span>
                    <span style={{
                      fontSize: 7, padding: "1px 5px",
                      background: c.emStrength > 0.4 ? "rgba(255,176,0,0.15)" : c.emStrength > 0 ? "rgba(255,176,0,0.07)" : "rgba(255,50,50,0.1)",
                      border: `1px solid ${c.emStrength > 0.4 ? AMBER_DIM : c.emStrength > 0 ? AMBER_DIM + "66" : "rgba(255,50,50,0.3)"}`,
                      color: c.emStrength > 0 ? AMBER : RED_ALERT,
                      letterSpacing: 1,
                      borderRadius: 1,
                    }}>
                      {c.emStrength > 0.4 ? "STRONG" : c.emStrength > 0 ? "WEAK" : "GHOST"}
                    </span>
                  </div>
                  <div style={{ fontSize: 8, color: AMBER_DIM, lineHeight: 1.6 }}>
                    BRG: {c.bearing.toFixed(1)}° &nbsp; RNG: {(c.range / 1000).toFixed(1)}km<br />
                    EM: {(c.emStrength * 100).toFixed(0)}% &nbsp; THRM: {(c.thermal * 100).toFixed(0)}%<br />
                    CLASS: <span style={{ color: c.type === "unknown" ? RED_ALERT : AMBER }}>
                      {c.type.toUpperCase()}
                    </span>
                    &nbsp; CONF: {c.emStrength > 0.4 ? "72%" : c.emStrength > 0 ? "34%" : "11%"}
                  </div>
                </div>
              ))}
            </div>

            {/* Selected contact actions */}
            {selectedData && (
              <div style={{ padding: "6px 10px", borderTop: `1px solid ${AMBER_DIM}33` }}>
                <div style={{ fontSize: 8, color: AMBER_DIM, marginBottom: 4, letterSpacing: 1 }}>
                  ACTIONS — {selectedData.id}
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {["TRACK", "SPOT JAM", "SPOOF", "HANDOFF"].map(a => (
                    <button key={a} style={{
                      padding: "3px 8px", fontSize: 7, letterSpacing: 1,
                      background: "rgba(255,176,0,0.05)",
                      border: `1px solid ${AMBER_DIM}66`,
                      color: AMBER,
                      fontFamily: font,
                      cursor: "pointer",
                      borderRadius: 1,
                    }}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          {/* Event Log */}
          <Panel title="Event Log" style={{ minHeight: 140, maxHeight: 180 }}>
            <div style={{ padding: 4, overflowY: "auto", height: "100%" }}>
              {logEntries.map((entry, i) => (
                <div key={i} style={{
                  fontSize: 8,
                  lineHeight: 1.5,
                  color: entry.type === "warn" ? RED_ALERT : entry.type === "detect" ? AMBER : AMBER_DIM,
                  borderLeft: `2px solid ${entry.type === "warn" ? RED_ALERT + "66" : entry.type === "detect" ? AMBER_DIM : AMBER_DIM + "33"}`,
                  paddingLeft: 6,
                  marginBottom: 2,
                }}>
                  <span style={{ color: AMBER_DIM }}>{entry.t}</span> {entry.msg}
                </div>
              ))}
            </div>
          </Panel>

          {/* Deception Panel */}
          <Panel title="Deception / Countermeasures" style={{ minHeight: 80 }}>
            <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
              {[
                { label: "DEPLOY GHOST", desc: "Generate false contact" },
                { label: "REPEATER DECOY", desc: "Retransmit altered signal" },
                { label: "RANGE SPOOF", desc: "Falsify range return" },
              ].map((item, i) => (
                <button key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "5px 8px",
                  background: "rgba(255,176,0,0.04)",
                  border: `1px solid ${AMBER_DIM}44`,
                  color: AMBER,
                  fontFamily: font,
                  fontSize: 8,
                  cursor: "pointer",
                  borderRadius: 1,
                  letterSpacing: 1,
                  textAlign: "left",
                }}>
                  <span>{item.label}</span>
                  <span style={{ color: AMBER_DIM, fontSize: 7 }}>{item.desc}</span>
                </button>
              ))}
            </div>
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
        <span>CONTACTS TRACKED: {contacts.filter(c => c.active || c.thermal > 0.05).length}</span>
        <span>MODE: {mode}</span>
        <span>FREQ: {(freqBand * 18 + 2).toFixed(1)} GHz</span>
        <span>SIG STRENGTH: NOMINAL</span>
        <span style={{ color: mode !== "PASSIVE" ? RED_ALERT : AMBER_DIM }}>
          {mode !== "PASSIVE" ? "⚠ ACTIVELY EMITTING" : "LOW OBSERVABLE"}
        </span>
      </div>
    </div>
  );
}
