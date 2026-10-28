/*
 * Photometric files — IES LM-63 (1991/1995/2002/2019) and EULUMDAT (.ldt) —
 * parsed into one model: absolute candela on a full C-plane grid
 * (C 0..360) against gamma (0 = nadir, 180 = zenith). Everything runs
 * client-side; nothing is uploaded.
 */

export type Photometry = {
  format: 'IES' | 'LDT';
  info: { manufacturer?: string; catalog?: string; luminaire?: string; lamp?: string; date?: string; test?: string };
  /** Sorted C angles in degrees covering 0..360 after symmetry expansion. */
  cAngles: number[];
  /** Sorted gamma angles in degrees (0 = straight down). */
  gAngles: number[];
  /** candela[ci][gi], absolute cd. */
  candela: number[][];
  /** Rated lamp lumens (sum), when the file states them; null for absolute photometry. */
  lampLumens: number | null;
  watts: number | null;
  /** Light output ratio stated in the file (LDT), 0..1. */
  lor: number | null;
  dims: { length?: number; width?: number; height?: number; unit: 'm' };
  warnings: string[];
};

const nums = (s: string) =>
  s
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

// ---------------------------------------------------------------- IES
export function parseIES(text: string): Photometry {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const info: Photometry['info'] = {};
  const warnings: string[] = [];
  let i = 0;
  const kw = (k: string, v: string) => {
    const key = k.toUpperCase();
    if (key === 'MANUFAC') info.manufacturer = v;
    else if (key === 'LUMCAT') info.catalog = v;
    else if (key === 'LUMINAIRE') info.luminaire = v;
    else if (key === 'LAMP' || key === 'LAMPCAT') info.lamp = info.lamp ?? v;
    else if (key === 'TEST') info.test = v;
    else if (key === 'TESTDATE' || key === 'ISSUEDATE') info.date = v;
  };
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = l.match(/^\[([A-Z_]+)\]\s*(.*)$/i);
    if (m) kw(m[1], m[2].trim());
    if (/^TILT\s*=/i.test(l)) break;
  }
  if (i >= lines.length) throw new Error('Not an IES file: no TILT line');
  const tilt = lines[i].split('=')[1].trim().toUpperCase();
  i++;
  let rest = nums(lines.slice(i).join(' '));
  let p = 0;
  if (tilt === 'INCLUDE') {
    p += 1; // lamp-to-luminaire geometry
    const n = rest[p++];
    p += 2 * n; // angles + multipliers
  } else if (tilt !== 'NONE') {
    warnings.push('TILT file referenced but not available; tilt ignored.');
  }
  const nLamps = rest[p++];
  const lmPerLamp = rest[p++];
  const mult = rest[p++];
  const nV = rest[p++];
  const nH = rest[p++];
  const photType = rest[p++];
  const unitsType = rest[p++];
  const width = rest[p++], length = rest[p++], height = rest[p++];
  const ballast = rest[p++];
  p++; // future use / ballast-lamp factor
  const watts = rest[p++];
  if (![nV, nH].every((n) => Number.isInteger(n) && n > 0)) throw new Error('Malformed IES header');
  if (photType !== 1) warnings.push(`Photometry type ${photType === 2 ? 'B' : 'A'} read as type C; check the plot orientation.`);
  const vA = rest.slice(p, p + nV); p += nV;
  const hA = rest.slice(p, p + nH); p += nH;
  const k = (mult || 1) * (ballast || 1);
  const raw: number[][] = [];
  for (let h = 0; h < nH; h++) {
    raw.push(rest.slice(p, p + nV).map((v) => v * k));
    p += nV;
  }
  if (raw.some((r) => r.length !== nV || r.some((v) => !Number.isFinite(v)))) throw new Error('IES candela table is incomplete');
  const toM = unitsType === 1 ? 0.3048 : 1;
  const model = expandC(hA, vA, raw);
  return {
    format: 'IES',
    info,
    ...model,
    lampLumens: lmPerLamp > 0 ? lmPerLamp * nLamps : null,
    watts: watts > 0 ? watts : null,
    lor: null,
    dims: { width: Math.abs(width) * toM || undefined, length: Math.abs(length) * toM || undefined, height: Math.abs(height) * toM || undefined, unit: 'm' },
    warnings,
  };
}

/** Expand a C-plane set (any IES/LDT symmetry) to a full 0..360 grid. */
function expandC(cIn: number[], gAngles: number[], data: number[][]) {
  const pairs = cIn.map((c, idx) => [((c % 360) + 360) % 360, data[idx]] as [number, number[]]);
  const max = Math.max(...cIn);
  const min = Math.min(...cIn);
  const map = new Map<number, number[]>();
  const add = (c: number, d: number[]) => {
    const key = Math.round((((c % 360) + 360) % 360) * 1000) / 1000;
    if (!map.has(key)) map.set(key, d);
  };
  if (cIn.length === 1) {
    for (let c = 0; c < 360; c += 15) add(c, data[0]); // rotationally symmetric
  } else if (min === 0 && max === 90) {
    for (const [c, d] of pairs) {
      add(c, d);
      add(180 - c, d);
      add(180 + c, d);
      add(360 - c, d);
    }
  } else if (min === 0 && max === 180) {
    for (const [c, d] of pairs) {
      add(c, d);
      add(360 - c, d);
    }
  } else if (min === 90 && max === 270) {
    for (const [c, d] of pairs) {
      add(c, d);
      add(180 - c, d);
    }
  } else {
    for (const [c, d] of pairs) add(c, d);
  }
  const cAngles = [...map.keys()].sort((a, b) => a - b);
  return { cAngles, gAngles, candela: cAngles.map((c) => map.get(c)!) };
}

// ---------------------------------------------------------------- LDT
export function parseLDT(text: string): Photometry {
  const L = text.replace(/\r\n?/g, '\n').split('\n');
  const n = (i: number) => Number(String(L[i] ?? '').trim().replace(',', '.'));
  const s = (i: number) => String(L[i] ?? '').trim();
  const isym = n(2), mc = n(3), ng = n(5);
  if (!(mc > 0 && ng > 0) || !Number.isInteger(isym)) throw new Error('Not a EULUMDAT file');
  const info = { manufacturer: s(0) || undefined, luminaire: s(8) || undefined, catalog: s(9) || undefined, date: s(11) || undefined, lamp: undefined as string | undefined, test: s(7) || undefined };
  const lor = n(22) / 100;
  const conv = n(23) || 1;
  const sets = n(25);
  let i = 26;
  let flux = 0, watts = 0;
  const lamps: string[] = [];
  for (let k = 0; k < sets; k++) {
    const count = Math.abs(n(i));
    lamps.push(`${count}× ${s(i + 1)}`);
    flux += n(i + 2);
    watts += n(i + 5);
    i += 6;
  }
  info.lamp = lamps.join(', ') || undefined;
  i += 10; // direct ratios
  const cAll = Array.from({ length: mc }, (_, k) => n(i + k));
  i += mc;
  const gAll = Array.from({ length: ng }, (_, k) => n(i + k));
  i += ng;
  // which C planes carry data, by symmetry
  let first = 0, count = mc;
  if (isym === 1) count = 1;
  else if (isym === 2) count = mc / 2 + 1;
  else if (isym === 3) {
    first = (3 * mc) / 4;
    count = mc / 2 + 1;
  } else if (isym === 4) count = mc / 4 + 1;
  const values = nums(L.slice(i).join(' '));
  const scale = (flux / 1000) * conv;
  const planes: number[] = [];
  const data: number[][] = [];
  for (let k = 0; k < count; k++) {
    const ci = (first + k) % mc;
    planes.push(cAll[ci]);
    data.push(values.slice(k * ng, (k + 1) * ng).map((v) => v * scale));
  }
  if (data.some((r) => r.length !== ng)) throw new Error('EULUMDAT intensity table is incomplete');
  // isym 3 lists C270..C360/0..C90; normalise those angles before expanding
  const cIn = isym === 3 ? planes.map((c) => (c >= 270 ? c - 360 + 360 : c)) : planes;
  const model =
    isym === 3
      ? expandC90270(cIn, gAll, data)
      : expandC(isym === 1 ? [0] : cIn, gAll, isym === 1 ? [data[0]] : data);
  return {
    format: 'LDT',
    info,
    ...model,
    lampLumens: flux > 0 ? flux : null,
    watts: watts > 0 ? watts : null,
    lor: lor > 0 ? lor : null,
    dims: { length: n(12) / 1000 || undefined, width: n(13) / 1000 || undefined, height: n(14) / 1000 || undefined, unit: 'm' },
    warnings: [],
  };
}

function expandC90270(planes: number[], g: number[], data: number[][]) {
  // planes run 270..360(=0)..90; mirror across the C90–C270 plane
  const map = new Map<number, number[]>();
  planes.forEach((c, k) => {
    const cc = ((c % 360) + 360) % 360;
    map.set(cc, data[k]);
    map.set(((180 - cc) % 360 + 360) % 360, data[k]);
  });
  const cAngles = [...map.keys()].sort((a, b) => a - b);
  return { cAngles, gAngles: g, candela: cAngles.map((c) => map.get(c)!) };
}

export function parsePhotometry(name: string, text: string): Photometry {
  if (/\.ldt$/i.test(name) || !/TILT\s*=/i.test(text)) return parseLDT(text);
  return parseIES(text);
}

// ---------------------------------------------------------------- analysis
/** Linear interpolation of intensity at (c, g). */
export function intensity(p: Photometry, c: number, g: number): number {
  const cc = ((c % 360) + 360) % 360;
  const C = p.cAngles;
  let c0 = C.length - 1, c1 = 0, tc = 0;
  for (let k = 0; k < C.length; k++) {
    if (C[k] <= cc) c0 = k;
    if (C[k] >= cc) {
      c1 = k;
      break;
    }
    if (k === C.length - 1) c1 = 0;
  }
  const span = ((C[c1] - C[c0] + 360) % 360) || 0;
  tc = span ? (((cc - C[c0] + 360) % 360) / span) : 0;
  const atG = (row: number[]) => {
    const G = p.gAngles;
    if (g <= G[0]) return row[0];
    if (g >= G[G.length - 1]) return row[G.length - 1];
    let k = 0;
    while (G[k + 1] < g) k++;
    const t = (g - G[k]) / (G[k + 1] - G[k]);
    return row[k] + (row[k + 1] - row[k]) * t;
  };
  return atG(p.candela[c0]) * (1 - tc) + atG(p.candela[c1]) * tc;
}

/** Luminous flux by integrating I over the sphere (zonal method, 1° steps). */
export function totalFlux(p: Photometry): number {
  const dc = 5, dg = 1;
  let sum = 0;
  const gMax = p.gAngles[p.gAngles.length - 1];
  const gMin = p.gAngles[0];
  for (let c = 0; c < 360; c += dc) {
    for (let g = gMin; g < gMax; g += dg) {
      const I = intensity(p, c + dc / 2, g + dg / 2);
      const dOmega = ((dc * Math.PI) / 180) * (Math.cos((g * Math.PI) / 180) - Math.cos(((g + dg) * Math.PI) / 180));
      sum += I * dOmega;
    }
  }
  return sum;
}

/** Full angle across a vertical plane where I falls to `frac` of the plane's peak. */
export function spreadAngle(p: Photometry, c: number, frac: number): number | null {
  const side = (cc: number) => {
    const pts: Array<[number, number]> = [];
    for (let g = 0; g <= 90; g += 0.25) pts.push([g, intensity(p, cc, g)]);
    return pts;
  };
  const a = side(c), b = side(c + 180);
  const peak = Math.max(...a.map((x) => x[1]), ...b.map((x) => x[1]));
  if (!(peak > 0)) return null;
  const edge = (pts: Array<[number, number]>) => {
    // walk outward from the peak on this side
    let k = pts.reduce((best, x, idx) => (x[1] > pts[best][1] ? idx : best), 0);
    for (; k < pts.length; k++) if (pts[k][1] < peak * frac) return pts[k][0];
    return null;
  };
  const ea = edge(a), eb = edge(b);
  if (ea == null || eb == null) return null;
  return ea + eb;
}

export function summarize(p: Photometry) {
  let maxI = 0, maxAt = { c: 0, g: 0 };
  p.candela.forEach((row, ci) => row.forEach((v, gi) => {
    if (v > maxI) {
      maxI = v;
      maxAt = { c: p.cAngles[ci], g: p.gAngles[gi] };
    }
  }));
  const flux = totalFlux(p);
  const down = (() => {
    // flux below the horizontal
    const sub = { ...p, gAngles: p.gAngles.filter((g) => g <= 90) };
    sub.candela = p.candela.map((r) => r.slice(0, sub.gAngles.length));
    return sub.gAngles.length > 1 ? totalFlux(sub) : flux;
  })();
  const beam0 = spreadAngle(p, 0, 0.5), beam90 = spreadAngle(p, 90, 0.5);
  const field0 = spreadAngle(p, 0, 0.1), field90 = spreadAngle(p, 90, 0.1);
  return {
    maxI,
    maxAt,
    nadirI: intensity(p, 0, 0),
    flux,
    downwardFraction: flux > 0 ? down / flux : null,
    lor: p.lampLumens ? flux / p.lampLumens : p.lor,
    efficacy: p.watts ? flux / p.watts : null,
    beam: { c0: beam0, c90: beam90 },
    field: { c0: field0, c90: field90 },
  };
}

/** Illuminance cone under the luminaire: centre lux and beam diameter by height. */
export function cone(p: Photometry, heights: number[], beamDeg: number | null) {
  const I0 = intensity(p, 0, 0);
  return heights.map((h) => ({
    h,
    lux: I0 / (h * h),
    diameter: beamDeg != null ? 2 * h * Math.tan(((beamDeg / 2) * Math.PI) / 180) : null,
  }));
}
