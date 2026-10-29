import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadSchedule,
  saveSchedule,
  newFixture,
  newArea,
  totals,
  scheduleCSV,
  type Schedule,
  type Fixture,
  type Area,
} from '../lib/schedule';
import { listProjects, currentProjectId, setCurrentProject, createProject, DEFAULT_ID, type Project } from '../lib/projects';
import { syncEnabled, syncProjects, syncSchedules } from '../lib/boardsync';

/*
 * Fixture schedule (bảng thống kê đèn) for the current project: areas with
 * their floor area and the W/m² limit the designer enters, fixture types
 * with quantities per area, live totals, CSV for Excel and a print view.
 */

const readLang = () => (typeof document !== 'undefined' && document.documentElement.classList.contains('lang-vi') ? 'vi' : 'en');

const MOUNTING: [string, string, string][] = [
  ['recessed', 'Recessed', 'Âm trần'],
  ['surface', 'Surface', 'Gắn nổi'],
  ['pendant', 'Pendant', 'Thả trần'],
  ['track', 'Track', 'Ray'],
  ['wall', 'Wall', 'Gắn tường'],
  ['linear', 'Linear / cove', 'Đèn hắt / tuyến tính'],
  ['strip', 'LED strip', 'LED dây'],
  ['inground', 'In-ground', 'Âm sàn'],
  ['floor', 'Floor / table', 'Đèn sàn / bàn'],
  ['other', 'Other', 'Khác'],
];
const DIMMING: [string, string, string][] = [
  ['none', 'None', 'Không'],
  ['phase', 'Phase-cut', 'Phase-cut'],
  ['0-10V', '0–10 V', '0–10 V'],
  ['DALI', 'DALI', 'DALI'],
  ['DALI-2', 'DALI-2 / D4i', 'DALI-2 / D4i'],
  ['DMX', 'DMX', 'DMX'],
  ['wireless', 'Casambi / wireless', 'Casambi / không dây'],
  ['other', 'Other', 'Khác'],
];

const num = (v: string) => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const fmt = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));

/** A number box that keeps what is being typed ("12." or "0,5") until it parses. */
function NumInput({ value, onValue, className, ...rest }: { value: number | undefined; onValue: (n: number | undefined, raw: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);
  return (
    <input
      {...rest}
      className={className}
      inputMode="decimal"
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value == null ? '' : String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onValue(num(e.target.value), e.target.value);
      }}
    />
  );
}

export default function ScheduleApp() {
  const [lang, setLang] = useState<'vi' | 'en'>(readLang);
  const vi = lang === 'vi';
  const t = (en: string, v: string) => (vi ? v : en);
  const [pid, setPid] = useState(currentProjectId);
  const [projects, setProjects] = useState<Project[]>(() => listProjects());
  const [s, setS] = useState<Schedule>(() => loadSchedule(currentProjectId()));
  const [sync, setSync] = useState<'off' | 'syncing' | 'ok' | 'offline'>(() => (syncEnabled() ? 'syncing' : 'off'));
  const saveTimer = useRef<number | undefined>(undefined);
  const syncTimer = useRef<number | undefined>(undefined);
  const busy = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const mo = new MutationObserver(() => setLang(readLang()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // ------------------------------------------------------------ sync
  const runSync = useCallback(async () => {
    if (!syncEnabled() || busy.current) return;
    busy.current = true;
    setSync('syncing');
    try {
      setProjects(await syncProjects());
      await syncSchedules();
      setSync('ok');
    } catch {
      setSync('offline');
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    if (!syncEnabled()) return;
    runSync();
    const every = window.setInterval(() => document.visibilityState === 'visible' && runSync(), 20000);
    const onVis = () => document.visibilityState === 'visible' && runSync();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [runSync]);
  // a newer copy arrived from another device (and nothing typed here is pending)
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === pid && !dirty.current) setS(loadSchedule(pid));
    };
    window.addEventListener('pastelux:schedule', on);
    return () => window.removeEventListener('pastelux:schedule', on);
  }, [pid]);

  // ------------------------------------------------------------ editing
  const commit = (next: Schedule) => {
    setS(next);
    dirty.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveSchedule(next, pid);
      dirty.current = false;
      if (syncEnabled()) {
        window.clearTimeout(syncTimer.current);
        syncTimer.current = window.setTimeout(runSync, 1500);
      }
    }, 400);
  };
  const flush = () => {
    if (!dirty.current) return;
    window.clearTimeout(saveTimer.current);
    saveSchedule(s, pid);
    dirty.current = false;
  };
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  });

  const setFixture = (id: string, patch: Partial<Fixture>) => commit({ ...s, fixtures: s.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const setQty = (fid: string, aid: string, v: string) => {
    const f = s.fixtures.find((x) => x.id === fid);
    if (!f) return;
    const q = { ...f.qty };
    const n = num(v);
    if (n == null || n <= 0) delete q[aid];
    else q[aid] = Math.round(n);
    setFixture(fid, { qty: q });
  };
  const addFixture = () => commit({ ...s, fixtures: [...s.fixtures, newFixture(s)] });
  const duplicate = (f: Fixture) => {
    const { id: _id, code: _code, ...rest } = f;
    const copy = newFixture(s, { ...rest, qty: { ...f.qty } });
    const i = s.fixtures.findIndex((x) => x.id === f.id);
    const list = [...s.fixtures];
    list.splice(i + 1, 0, copy);
    commit({ ...s, fixtures: list });
  };
  const removeFixture = (f: Fixture) => {
    if (!window.confirm(t(`Remove ${f.code}${f.description ? ` (${f.description})` : ''} from the schedule?`, `Xoá ${f.code}${f.description ? ` (${f.description})` : ''} khỏi bảng?`))) return;
    commit({ ...s, fixtures: s.fixtures.filter((x) => x.id !== f.id) });
  };
  const moveFixture = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= s.fixtures.length) return;
    const list = [...s.fixtures];
    [list[i], list[j]] = [list[j], list[i]];
    commit({ ...s, fixtures: list });
  };
  const setArea = (id: string, patch: Partial<Area>) => commit({ ...s, areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const addArea = () => commit({ ...s, areas: [...s.areas, newArea(s, t(`Area ${s.areas.length + 1}`, `Khu vực ${s.areas.length + 1}`))] });
  const removeArea = (a: Area) => {
    if (s.areas.length < 2) return;
    const used = s.fixtures.some((f) => (f.qty[a.id] ?? 0) > 0);
    if (used && !window.confirm(t(`“${a.name}” has fixtures counted in it. Remove the area and its quantities?`, `“${a.name}” đang có đèn. Xoá khu vực này cùng số lượng đèn trong đó?`))) return;
    commit({
      ...s,
      areas: s.areas.filter((x) => x.id !== a.id),
      fixtures: s.fixtures.map((f) => {
        const q = { ...f.qty };
        delete q[a.id];
        return { ...f, qty: q };
      }),
    });
  };

  // ------------------------------------------------------------ projects
  const projectName = (p: Project) => (p.id === DEFAULT_ID && p.name === 'My first project' ? t('My first project', 'Project đầu tiên') : p.name);
  const switchTo = (id: string) => {
    flush();
    setCurrentProject(id);
    setPid(id);
    setS(loadSchedule(id));
  };
  const newProject = () => {
    const name = window.prompt(t('Name of the new project', 'Tên project mới'), '');
    if (name === null) return;
    const p = createProject(name || t('Untitled', 'Chưa đặt tên'));
    setProjects(listProjects());
    switchTo(p.id);
    if (syncEnabled()) runSync();
  };

  // ------------------------------------------------------------ output
  const tot = useMemo(() => totals(s), [s]);
  const exportCSV = () => {
    flush();
    const name = projects.find((p) => p.id === pid)?.name ?? 'project';
    const blob = new Blob([scheduleCSV(s, name)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fixture-schedule-${name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const label = (list: [string, string, string][], key: string) => {
    const it = list.find((x) => x[0] === key);
    return it ? (vi ? it[2] : it[1]) : key;
  };

  return (
    <div className="sch">
      <div className="sch-bar">
        <label className="sch-proj">
          <span className="label">{t('Project', 'Project')}</span>
          <select className="field" value={pid} onChange={(e) => (e.target.value === '__new' ? newProject() : switchTo(e.target.value))}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {projectName(p)}
              </option>
            ))}
            <option value="__new">{t('+ New project…', '+ Project mới…')}</option>
          </select>
        </label>
        {sync !== 'off' && (
          <span className={`sch-sync sch-sync-${sync}`} role="status">
            {sync === 'ok' ? t('✓ Synced', '✓ Đã đồng bộ') : sync === 'syncing' ? t('Syncing…', 'Đang đồng bộ…') : t('Offline: kept here, syncs later', 'Mất mạng: vẫn lưu ở máy này, sẽ đồng bộ sau')}
          </span>
        )}
        <div className="sch-actions">
          <button type="button" className="btn" onClick={exportCSV} disabled={!s.fixtures.length}>
            {t('Export CSV (Excel)', 'Xuất CSV (Excel)')}
          </button>
          <button type="button" className="btn" onClick={() => { flush(); window.print(); }} disabled={!s.fixtures.length}>
            {t('Print / PDF', 'In / PDF')}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------ areas */}
      <section className="card sch-card">
        <div className="sch-head">
          <h2>{t('Areas', 'Khu vực')}</h2>
          <button type="button" className="btn sch-noprint" onClick={addArea}>
            {t('+ Area', '+ Khu vực')}
          </button>
        </div>
        <div className="sch-scroll">
          <table className="sch-table sch-areas">
            <thead>
              <tr>
                <th>{t('Area', 'Khu vực')}</th>
                <th className="r">{t('Floor area (m²)', 'Diện tích (m²)')}</th>
                <th className="r">{t('Limit (W/m²)', 'Giới hạn (W/m²)')}</th>
                <th className="r">{t('Fixtures', 'Số đèn')}</th>
                <th className="r">W</th>
                <th className="r">lm</th>
                <th className="r">W/m²</th>
                <th className="sch-noprint" aria-label={t('Actions', 'Thao tác')} />
              </tr>
            </thead>
            <tbody>
              {tot.perArea.map(({ area: a, count, watts, lumens, lpd, over }) => (
                <tr key={a.id}>
                  <td>
                    <input className="sch-in sch-wide" value={a.name} onChange={(e) => setArea(a.id, { name: e.target.value })} aria-label={t('Area name', 'Tên khu vực')} />
                  </td>
                  <td className="r">
                    <NumInput className="sch-in sch-num" value={a.m2} onValue={(n) => setArea(a.id, { m2: n })} aria-label={t('Floor area', 'Diện tích')} />
                  </td>
                  <td className="r">
                    <NumInput className="sch-in sch-num" value={a.lpdLimit} placeholder={t('your code', 'theo QC')} onValue={(n) => setArea(a.id, { lpdLimit: n })} aria-label={t('W/m² limit from the code you follow', 'Giới hạn W/m² theo quy chuẩn bạn áp dụng')} />
                  </td>
                  <td className="r">{fmt(count)}</td>
                  <td className="r">{fmt(watts, 1)}</td>
                  <td className="r">{fmt(lumens)}</td>
                  <td className={`r ${over ? 'sch-over' : lpd != null && a.lpdLimit != null ? 'sch-ok' : ''}`}>
                    {fmt(lpd, 2)}
                    {over ? ` ▲ ${fmt(((lpd! - a.lpdLimit!) / a.lpdLimit!) * 100, 0)}%` : lpd != null && a.lpdLimit != null ? ' ✓' : ''}
                  </td>
                  <td className="sch-noprint">
                    {s.areas.length > 1 && (
                      <button type="button" className="sch-x" onClick={() => removeArea(a)} title={t('Remove area', 'Xoá khu vực')} aria-label={t('Remove area', 'Xoá khu vực')}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t('Total', 'Tổng')}</th>
                <th className="r">{fmt(tot.m2, 1)}</th>
                <th />
                <th className="r">{fmt(tot.count)}</th>
                <th className="r">{fmt(tot.watts, 1)}</th>
                <th className="r">{fmt(tot.perArea.reduce((x, y) => x + y.lumens, 0))}</th>
                <th className="r">{tot.m2 ? fmt(tot.watts / tot.m2, 2) : '–'}</th>
                <th className="sch-noprint" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="sch-hint">
          {t(
            'Enter the W/m² limit from the energy code your project follows (for example QCVN 09, ASHRAE 90.1 or the client’s brief): the schedule does not assume one.',
            'Nhập giới hạn W/m² theo quy chuẩn năng lượng mà dự án áp dụng (ví dụ QCVN 09, ASHRAE 90.1 hoặc yêu cầu của chủ đầu tư). Bảng không tự giả định con số nào.'
          )}
        </p>
      </section>

      {/* ------------------------------------------------ fixtures */}
      <section className="card sch-card">
        <div className="sch-head">
          <h2>{t('Fixture types', 'Loại đèn')}</h2>
          <button type="button" className="btn btn-primary sch-noprint" onClick={addFixture}>
            {t('+ Fixture type', '+ Loại đèn')}
          </button>
        </div>
        {s.fixtures.length ? (
          <div className="sch-scroll">
            <table className="sch-table sch-fixtures">
              <thead>
                <tr>
                  <th>{t('Code', 'Mã')}</th>
                  <th>{t('Description', 'Mô tả')}</th>
                  <th>{t('Manufacturer · model', 'Hãng · model')}</th>
                  <th>{t('Mounting', 'Lắp đặt')}</th>
                  <th className="r">CCT (K)</th>
                  <th className="r">CRI</th>
                  <th className="r">{t('Beam (°)', 'Góc (°)')}</th>
                  <th className="r">lm</th>
                  <th className="r">W</th>
                  <th className="r">lm/W</th>
                  <th>{t('Dimming', 'Dimming')}</th>
                  <th>IP</th>
                  {s.areas.map((a) => (
                    <th key={a.id} className="r sch-qty-h" title={a.name}>
                      {a.name}
                    </th>
                  ))}
                  <th className="r">{t('Qty', 'SL')}</th>
                  <th className="r">{t('Total W', 'Tổng W')}</th>
                  <th>{t('Notes', 'Ghi chú')}</th>
                  <th className="sch-noprint" aria-label={t('Actions', 'Thao tác')} />
                </tr>
              </thead>
              <tbody>
                {s.fixtures.map((f, i) => {
                  const q = tot.perFixture[i];
                  const eff = f.lumens && f.watts ? f.lumens / f.watts : null;
                  return (
                    <tr key={f.id}>
                      <td>
                        <input className="sch-in sch-code" value={f.code} onChange={(e) => setFixture(f.id, { code: e.target.value })} aria-label={t('Code', 'Mã')} />
                      </td>
                      <td>
                        <input className="sch-in sch-wide" value={f.description} placeholder={t('e.g. downlight, corridor', 'vd. downlight hành lang')} onChange={(e) => setFixture(f.id, { description: e.target.value })} aria-label={t('Description', 'Mô tả')} />
                      </td>
                      <td>
                        <input className="sch-in" value={f.manufacturer} placeholder={t('Brand', 'Hãng')} onChange={(e) => setFixture(f.id, { manufacturer: e.target.value })} aria-label={t('Manufacturer', 'Hãng')} />
                        <input className="sch-in" value={f.model} placeholder="Model" onChange={(e) => setFixture(f.id, { model: e.target.value })} aria-label="Model" />
                      </td>
                      <td>
                        <select className="sch-in" value={f.mounting} onChange={(e) => setFixture(f.id, { mounting: e.target.value })} aria-label={t('Mounting', 'Lắp đặt')}>
                          {MOUNTING.map((m) => (
                            <option key={m[0]} value={m[0]}>
                              {vi ? m[2] : m[1]}
                            </option>
                          ))}
                        </select>
                        <span className="sch-print-only">{label(MOUNTING, f.mounting)}</span>
                      </td>
                      {(['cct', 'cri', 'beam', 'lumens', 'watts'] as const).map((k) => (
                        <td key={k} className="r">
                          <NumInput className="sch-in sch-num" value={f[k]} onValue={(n) => setFixture(f.id, { [k]: n } as Partial<Fixture>)} aria-label={k} />
                        </td>
                      ))}
                      <td className="r sch-muted">{fmt(eff, 0)}</td>
                      <td>
                        <select className="sch-in" value={f.dimming} onChange={(e) => setFixture(f.id, { dimming: e.target.value })} aria-label="Dimming">
                          {DIMMING.map((m) => (
                            <option key={m[0]} value={m[0]}>
                              {vi ? m[2] : m[1]}
                            </option>
                          ))}
                        </select>
                        <span className="sch-print-only">{label(DIMMING, f.dimming)}</span>
                      </td>
                      <td>
                        <input className="sch-in sch-ip" value={f.ip} placeholder="IP20" onChange={(e) => setFixture(f.id, { ip: e.target.value })} aria-label="IP" />
                      </td>
                      {s.areas.map((a) => (
                        <td key={a.id} className="r">
                          <NumInput className="sch-in sch-qty" value={f.qty[a.id]} onValue={(_n, raw) => setQty(f.id, a.id, raw)} aria-label={`${t('Quantity in', 'Số lượng ở')} ${a.name}`} />
                        </td>
                      ))}
                      <td className="r sch-strong">{fmt(q?.qty)}</td>
                      <td className="r sch-strong">{fmt(q?.watts, 1)}</td>
                      <td>
                        <input className="sch-in sch-wide" value={f.notes} onChange={(e) => setFixture(f.id, { notes: e.target.value })} aria-label={t('Notes', 'Ghi chú')} />
                        {f.source && <span className="sch-src" title={f.source}>IES</span>}
                      </td>
                      <td className="sch-noprint sch-row-actions">
                        <button type="button" onClick={() => moveFixture(i, -1)} disabled={i === 0} title={t('Move up', 'Lên')} aria-label={t('Move up', 'Lên')}>↑</button>
                        <button type="button" onClick={() => moveFixture(i, 1)} disabled={i === s.fixtures.length - 1} title={t('Move down', 'Xuống')} aria-label={t('Move down', 'Xuống')}>↓</button>
                        <button type="button" onClick={() => duplicate(f)} title={t('Duplicate', 'Nhân bản')} aria-label={t('Duplicate', 'Nhân bản')}>⧉</button>
                        <button type="button" className="sch-x" onClick={() => removeFixture(f)} title={t('Remove', 'Xoá')} aria-label={t('Remove', 'Xoá')}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sch-empty">
            {t('No fixture types yet. Add one, or open a manufacturer’s IES file in the ', 'Chưa có loại đèn nào. Thêm một loại, hoặc mở file IES của hãng trong ')}
            <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/tools/photometry`}>{t('photometric viewer', 'trình xem trắc quang')}</a>
            {t(' and add it from there with its lumens, beam and wattage filled in.', ' rồi thêm vào đây, quang thông, góc chiếu và công suất được điền sẵn.')}
          </p>
        )}
      </section>
      <p className="sch-hint">
        {syncEnabled()
          ? t('Saved in this browser and synced to every device unlocked with the Stas code.', 'Lưu trong trình duyệt này và đồng bộ sang mọi máy đã mở khoá bằng mã của Stas.')
          : t('Saved in this browser. Unlock Stas on a device to sync schedules there.', 'Lưu trong trình duyệt này. Mở khoá Stas trên máy nào thì bảng đồng bộ sang máy đó.')}
      </p>
    </div>
  );
}
