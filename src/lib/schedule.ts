/*
 * Fixture schedule (bảng thống kê đèn) for the current project: fixture types
 * with their photometric and electrical data, areas, and quantities per area.
 * Kept in localStorage per project; small enough that it syncs whole.
 */

import { currentProjectId, touchProject } from './projects';

export type Fixture = {
  id: string;
  code: string; // L1, L2…
  description: string;
  manufacturer: string;
  model: string;
  mounting: string;
  cct?: number;
  cri?: number;
  beam?: number;
  lumens?: number;
  watts?: number;
  dimming: string;
  ip: string;
  notes: string;
  source?: string;
  /** quantity per area id */
  qty: Record<string, number>;
};

export type Area = { id: string; name: string; m2?: number; lpdLimit?: number };

export type Schedule = { areas: Area[]; fixtures: Fixture[]; updatedAt: number };

const key = (pid = currentProjectId()) => `pastelux-schedule:${pid}`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function emptySchedule(): Schedule {
  return { areas: [{ id: uid(), name: 'Area 1' }], fixtures: [], updatedAt: 0 };
}

export function loadSchedule(pid?: string): Schedule {
  try {
    const raw = localStorage.getItem(key(pid));
    if (raw) return JSON.parse(raw) as Schedule;
  } catch {}
  return emptySchedule();
}

export function saveSchedule(s: Schedule, pid = currentProjectId(), at = Date.now()) {
  const next = { ...s, updatedAt: at };
  try {
    localStorage.setItem(key(pid), JSON.stringify(next));
  } catch {}
  touchProject(pid, at);
  window.dispatchEvent(new CustomEvent('pastelux:schedule', { detail: pid }));
  return next;
}

export function nextCode(s: Schedule) {
  const used = new Set(s.fixtures.map((f) => f.code));
  let n = s.fixtures.length + 1;
  while (used.has(`L${n}`)) n++;
  return `L${n}`;
}

export function newFixture(s: Schedule, partial: Partial<Fixture> = {}): Fixture {
  return {
    id: uid(),
    code: nextCode(s),
    description: '',
    manufacturer: '',
    model: '',
    mounting: 'recessed',
    dimming: 'none',
    ip: '',
    notes: '',
    qty: {},
    ...partial,
  };
}

export function newArea(s: Schedule, name?: string): Area {
  return { id: uid(), name: name ?? `Area ${s.areas.length + 1}` };
}

/** Adds a fixture type to the current project's schedule (from the IES viewer). */
export function addFixture(partial: Partial<Fixture>) {
  const s = loadSchedule();
  s.fixtures.push(newFixture(s, partial));
  return saveSchedule(s);
}

export function totals(s: Schedule) {
  const perArea = s.areas.map((a) => {
    let watts = 0, lumens = 0, count = 0;
    for (const f of s.fixtures) {
      const q = f.qty[a.id] ?? 0;
      count += q;
      watts += q * (f.watts ?? 0);
      lumens += q * (f.lumens ?? 0);
    }
    const lpd = a.m2 ? watts / a.m2 : null;
    return { area: a, count, watts, lumens, lpd, over: lpd != null && a.lpdLimit != null && lpd > a.lpdLimit };
  });
  const perFixture = s.fixtures.map((f) => {
    const q = Object.values(f.qty).reduce((x, y) => x + (y || 0), 0);
    return { fixture: f, qty: q, watts: q * (f.watts ?? 0) };
  });
  return {
    perArea,
    perFixture,
    count: perFixture.reduce((a, b) => a + b.qty, 0),
    watts: perFixture.reduce((a, b) => a + b.watts, 0),
    m2: s.areas.reduce((a, b) => a + (b.m2 ?? 0), 0),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV that opens straight in Excel (UTF-8 BOM keeps Vietnamese intact). */
export function scheduleCSV(s: Schedule, projectName: string) {
  const head = ['Code', 'Description', 'Manufacturer', 'Model', 'Mounting', 'CCT (K)', 'CRI', 'Beam (°)', 'Lumens', 'Watts', 'Dimming', 'IP', ...s.areas.map((a) => `Qty ${a.name}`), 'Total qty', 'Total W', 'Notes'];
  const rows = s.fixtures.map((f) => {
    const q = s.areas.map((a) => f.qty[a.id] ?? 0);
    const tq = q.reduce((a, b) => a + b, 0);
    return [f.code, f.description, f.manufacturer, f.model, f.mounting, f.cct, f.cri, f.beam, f.lumens, f.watts, f.dimming, f.ip, ...q, tq, tq * (f.watts ?? 0), f.notes];
  });
  const t = totals(s);
  const areaRows = [[], ['Area', 'm²', 'Fixtures', 'W', 'W/m²', 'Limit W/m²'], ...t.perArea.map((a) => [a.area.name, a.area.m2, a.count, a.watts, a.lpd?.toFixed(2), a.area.lpdLimit])];
  const lines = [[`Fixture schedule — ${projectName}`], [], head, ...rows, ...areaRows];
  return '﻿' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
