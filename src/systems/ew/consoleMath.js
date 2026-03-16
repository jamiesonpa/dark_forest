import {
  GRAV_ANALYSIS_MAX_MS,
  GRAV_ANALYSIS_MIN_MS,
} from "@/systems/ew/consoleTheme";

export function gravMassForCelestialType(type) {
  if (type === "planet") return 1.25;
  if (type === "moon") return 0.8;
  if (type === "asteroid_belt") return 0.55;
  return 0.3;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function highPassFade(value, fullAt, goneAt) {
  if (value >= fullAt) return 1;
  if (value <= goneAt) return 0;
  return (value - goneAt) / (fullAt - goneAt);
}

export function gravHighPassAttenuation(type, highPassPct = 100) {
  const hp = clamp(highPassPct, 0, 100);
  if (type === "planet") return highPassFade(hp, 100, 70);
  if (type === "moon") return highPassFade(hp, 70, 40);
  if (type === "asteroid_belt") return highPassFade(hp, 60, 30);
  return 1;
}

export function gravNoiseFloorScale(highPassPct = 100) {
  const hpNorm = clamp(highPassPct, 0, 100) / 100;
  return 0.18 + Math.pow(hpNorm, 1.35) * 0.82;
}

export function gravRelativeIntensityBoost(type, highPassPct = 100) {
  const planetSuppression = 1 - gravHighPassAttenuation("planet", highPassPct);
  const moonSuppression = 1 - gravHighPassAttenuation("moon", highPassPct);

  if (type === "planet") return 1;
  if (type === "moon") return 1 + planetSuppression * 0.85;
  if (type === "asteroid_belt") return 1 + planetSuppression * 0.75 + moonSuppression * 0.95;
  return 1;
}

export function deriveGravAnalysisDurationMs(clarity) {
  const normalizedClarity = clamp(clarity, 0, 1);
  return Math.round(
    GRAV_ANALYSIS_MAX_MS - normalizedClarity * (GRAV_ANALYSIS_MAX_MS - GRAV_ANALYSIS_MIN_MS)
  );
}

function rcsFromType(type) {
  if (type === "battleship") return 22;
  if (type === "destroyer") return 8;
  return 2;
}

function radarModeFactor(mode) {
  if (mode === "STT") return 1.35;
  if (mode === "HOJ") return 1.15;
  if (mode === "TWS") return 0.92;
  if (mode === "SCM") return 0.72;
  return 1.0;
}

function prfFactor(prf) {
  if (prf === "LOW") return 1.15;
  if (prf === "HIGH") return 0.9;
  if (prf === "INTER") return 1.05;
  return 1.0;
}

export function computeActiveDetectRangeM(contact, radarPower, radarFreq, radarPRF, radarMode) {
  const baseRange = 18000;
  const powerFactor = 0.55 + (radarPower / 100) * 1.25;
  const freqFactor = 0.7 + radarFreq * 0.9;
  const rcsFactor = Math.pow(Math.max(0.5, contact.rcs ?? rcsFromType(contact.type)), 0.25);
  const modeFactor = radarModeFactor(radarMode);
  const prfMod = prfFactor(radarPRF);
  const range = baseRange * powerFactor * freqFactor * rcsFactor * modeFactor * prfMod;
  return Math.min(120000, Math.max(6000, range));
}
