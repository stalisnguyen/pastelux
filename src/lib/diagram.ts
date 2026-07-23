/**
 * Shared maths for the SVG diagrams.
 *
 * Everything here runs at build time, so the diagrams ship as static markup —
 * no runtime cost, no layout shift, and they stay sharp at any zoom level.
 */

export const deg = (d: number) => (d * Math.PI) / 180;

/** Round to 2dp so path data stays readable in view-source. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export const pt = (x: number, y: number) => `${r2(x)},${r2(y)}`;

/**
 * Cosine-power model of a rotationally symmetric beam.
 * `n` is chosen so intensity falls to 50% at half the nominal beam angle,
 * which is exactly how beam angle is defined.
 */
export function cosPower(beamAngleDeg: number): number {
  const half = deg(Math.min(beamAngleDeg, 178) / 2);
  return Math.log(0.5) / Math.log(Math.max(Math.cos(half), 1e-6));
}

export function intensityAt(angleDeg: number, beamAngleDeg: number): number {
  const a = deg(Math.abs(angleDeg));
  if (a >= Math.PI / 2) return 0;
  return Math.pow(Math.cos(a), cosPower(beamAngleDeg));
}

/**
 * Polar photometric curve, drawn downward from an origin — the convention
 * used on every luminaire datasheet.
 */
export function polarPath(
  beamAngleDeg: number,
  cx: number,
  cy: number,
  radius: number,
  step = 2
): string {
  const points: string[] = [];
  for (let a = -90; a <= 90; a += step) {
    const i = intensityAt(a, beamAngleDeg);
    const x = cx + Math.sin(deg(a)) * i * radius;
    const y = cy + Math.cos(deg(a)) * i * radius;
    points.push(pt(x, y));
  }
  return `M ${points.join(' L ')}`;
}

/** Spot diameter of a beam at a given throw. */
export function spotDiameter(throwM: number, beamAngleDeg: number): number {
  return 2 * throwM * Math.tan(deg(beamAngleDeg) / 2);
}

/** Gaussian lobe, used for the schematic action-spectrum curves. */
function gauss(x: number, peak: number, width: number): number {
  return Math.exp(-Math.pow((x - peak) / width, 2));
}

/**
 * Schematic action spectra, normalised to 1.0 at peak.
 * Shapes are approximations for teaching, not photometric data — the article
 * says so explicitly.
 */
export function photopic(nm: number): number {
  return gauss(nm, 555, 68);
}

export function melanopic(nm: number): number {
  return gauss(nm, 490, 52);
}

/** Build an SVG path across a wavelength range for one of the curves above. */
export function spectrumPath(
  fn: (nm: number) => number,
  x0: number,
  x1: number,
  yBase: number,
  height: number,
  nmMin = 380,
  nmMax = 780,
  step = 4
): string {
  const points: string[] = [];
  for (let nm = nmMin; nm <= nmMax; nm += step) {
    const x = x0 + ((nm - nmMin) / (nmMax - nmMin)) * (x1 - x0);
    const y = yBase - fn(nm) * height;
    points.push(pt(x, y));
  }
  return `M ${points.join(' L ')}`;
}

/**
 * Approximate sRGB for a wavelength — used only for the spectrum strip's
 * decorative gradient, never to communicate data.
 */
export function wavelengthToRgb(nm: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 780) {
    r = 1;
  }
  // Roll off the response at both ends of the visible range.
  let f = 1;
  if (nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.3 + (0.7 * (780 - nm)) / 80;

  const ch = (v: number) => Math.round(255 * Math.pow(Math.max(v, 0) * f, 0.8));
  return `rgb(${ch(r)},${ch(g)},${ch(b)})`;
}

/**
 * Melanopic daylight efficacy ratio by CCT — the single source of truth for the
 * article table, the Kelvin scale diagram and the animated day cycle, so a
 * reader comparing them never sees three different numbers for 2700 K.
 * Typical values for phosphor-converted white LEDs.
 */
export const MDER_TABLE: ReadonlyArray<readonly [number, number]> = [
  [2200, 0.35],
  [2700, 0.45],
  [3000, 0.52],
  [3500, 0.65],
  [4000, 0.75],
  [5000, 0.9],
  [6500, 1.0],
];

/** Linear interpolation across MDER_TABLE, clamped at both ends. */
export function mder(cct: number): number {
  const t = MDER_TABLE;
  if (cct <= t[0][0]) return t[0][1];
  if (cct >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 0; i < t.length - 1; i++) {
    const [k0, v0] = t[i];
    const [k1, v1] = t[i + 1];
    if (cct <= k1) return v0 + ((cct - k0) / (k1 - k0)) * (v1 - v0);
  }
  return t[t.length - 1][1];
}

/**
 * Approximate sRGB of a blackbody at a given CCT, for the Kelvin ramp.
 * Based on the widely used Tanner Helland piecewise fit.
 */
export function kelvinToRgb(k: number): string {
  const t = Math.min(Math.max(k, 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }

  const c = (v: number) => Math.round(Math.min(Math.max(v, 0), 255));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
