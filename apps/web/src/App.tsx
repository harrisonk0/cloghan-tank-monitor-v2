import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API_BASE = "http://localhost:3000/api";
const TANKS = ["C1", "C2", "C3", "C4"] as const;

type Page = "dashboard" | "readings" | "settings" | "history";
type RefreshStatus = "idle" | "running" | "success" | "warning" | "failed" | "needs_review";
type ToastKind = "success" | "warning" | "error" | "info";

type TankName = (typeof TANKS)[number];

type TankReading = {
  id?: number;
  tank: TankName | string;
  levelMm: number | null;
  temperatureC: number | null;
  tovM3: number | null;
  gsvM3: number | null;
};

type Reading = {
  id?: number;
  capturedAt: string;
  source: string;
  confidence: number | null;
  totalLevelMm: number | null;
  totalLevelDiffMm: number | null;
  totalGsvM3: number | null;
  totalGsvDiffM3: number | null;
  verified: boolean;
  notes?: string | null;
  tanks: TankReading[];
};

type RefreshRun = {
  id?: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorCode: string | null;
  message: string | null;
  confidence: number | null;
  durationMs: number | null;
  readingId: number | null;
};

type Settings = {
  scheduleMode: "manual" | "10m" | "30m" | "1h" | "custom";
  customIntervalMinutes: number;
  notifySuccess: boolean;
  notifyWarning: boolean;
  notifyFailure: boolean;
  screenshotRetentionHours: number | null;
  aiConfigured: boolean;
  aiBaseUrl?: string;
  aiModel?: string;
  scheduler?: {
    nextRunAt: string | null;
    running: boolean;
    message: string;
  };
};

type RefreshResult = {
  status: RefreshStatus;
  errorCode?: string | null;
  message?: string;
  confidence?: number | null;
  readingId?: number | null;
  reading?: Partial<Reading>;
  refreshRunId?: number;
  reviewId?: string;
};

type Toast = { id: number; kind: ToastKind; message: string };

type RawReading = Partial<Reading> & {
  captured_at?: unknown;
  total_level_mm?: unknown;
  total_level_diff_mm?: unknown;
  total_gsv_m3?: unknown;
  total_gsv_diff_m3?: unknown;
};

type RawTank = Partial<TankReading> & {
  level_mm?: unknown;
  temperature_c?: unknown;
  tov_m3?: unknown;
  gsv_m3?: unknown;
};

type RawRun = Partial<RefreshRun> & {
  started_at?: unknown;
  finished_at?: unknown;
  error_code?: unknown;
  duration_ms?: unknown;
  reading_id?: unknown;
};

const emptyTank = (tank: TankName): TankReading => ({
  tank,
  levelMm: null,
  temperatureC: null,
  tovM3: null,
  gsvM3: null,
});

const emptyReading = (): Reading => ({
  capturedAt: new Date().toISOString(),
  source: "manual",
  confidence: null,
  totalLevelMm: null,
  totalLevelDiffMm: null,
  totalGsvM3: null,
  totalGsvDiffM3: null,
  verified: true,
  notes: "",
  tanks: TANKS.map(emptyTank),
});

const defaultSettings: Settings = {
  scheduleMode: "manual",
  customIntervalMinutes: 15,
  notifySuccess: true,
  notifyWarning: true,
  notifyFailure: true,
  screenshotRetentionHours: 3,
  aiConfigured: false,
};

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [runs, setRuns] = useState<RefreshRun[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>("idle");
  const [refreshMessage, setRefreshMessage] = useState("Ready");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editing, setEditing] = useState<Reading | null>(null);
  const [review, setReview] = useState<RefreshResult | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [readingsData, runsData, settingsData] = await Promise.all([
        apiGet("/readings"),
        apiGet("/refresh-runs"),
        apiGet("/settings"),
      ]);
      setReadings(asReadings(readingsData));
      setRuns(asRuns(runsData));
      setSettings(asSettings(settingsData));
    } catch (error) {
      pushToast("error", messageFromError(error));
    } finally {
      setLoading(false);
    }
  }

  async function refreshData() {
    setRefreshStatus("running");
    setRefreshMessage("Capturing and extracting tank table...");
    try {
      const result = (await apiRequest("/refresh", { method: "POST" })) as RefreshResult;
      setRefreshStatus(result.status);
      setRefreshMessage(result.message || labelStatus(result.status));
      if (result.status === "needs_review") {
        setReview(result);
        pushToast("warning", "Low confidence extraction - review required.");
        return;
      }
      notifyForRefresh(result);
      await loadAll();
    } catch (error) {
      setRefreshStatus("failed");
      setRefreshMessage(messageFromError(error));
      pushToast("error", `Refresh failed - ${messageFromError(error)}`);
    }
  }

  async function confirmReview(reading: Reading) {
    if (!review) return;
    try {
      const result = (await apiRequest("/refresh/confirm", {
        method: "POST",
        body: JSON.stringify({
          reading: readingToPayload(reading),
          refreshRunId: review.refreshRunId,
          reviewId: review.reviewId,
        }),
      })) as RefreshResult;
      setReview(null);
      setRefreshStatus(result.status || "success");
      setRefreshMessage(result.message || "Reviewed reading inserted.");
      notifyForRefresh(result.status ? result : { status: "success", message: "Reviewed reading inserted." });
      await loadAll();
    } catch (error) {
      pushToast("error", messageFromError(error));
    }
  }

  async function saveReading(reading: Reading) {
    const isUpdate = reading.id !== undefined;
    try {
      await apiRequest(isUpdate ? `/readings/${reading.id}` : "/readings", {
        method: isUpdate ? "PUT" : "POST",
        body: JSON.stringify(readingToPayload(reading)),
      });
      setEditing(null);
      pushToast("success", isUpdate ? "Reading updated." : "Reading added.");
      await loadAll();
    } catch (error) {
      pushToast("error", messageFromError(error));
    }
  }

  async function deleteReading(id: number | undefined) {
    if (!id || !window.confirm("Delete this reading?")) return;
    try {
      await apiRequest(`/readings/${id}`, { method: "DELETE" });
      pushToast("success", "Reading deleted.");
      await loadAll();
    } catch (error) {
      pushToast("error", messageFromError(error));
    }
  }

  async function saveSettings(next: Settings) {
    try {
      const saved = await apiRequest("/settings", {
        method: "PUT",
        body: JSON.stringify(settingsToPayload(next)),
      });
      setSettings(asSettings(saved));
      pushToast("success", "Settings saved.");
    } catch (error) {
      pushToast("error", messageFromError(error));
    }
  }

  function pushToast(kind: ToastKind, message: string) {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 4500);
  }

  function notifyForRefresh(result: RefreshResult) {
    if (result.status === "success") {
      pushToast("success", result.readingId ? `Refresh successful - reading #${result.readingId} inserted.` : result.message || "Refresh successful.");
    } else if (result.status === "warning" || result.status === "needs_review") {
      pushToast("warning", result.message || "Refresh completed with a warning.");
    } else if (result.status === "failed") {
      pushToast("error", result.message || "Refresh failed.");
    } else {
      pushToast("info", result.message || labelStatus(result.status));
    }
  }

  const latest = readings[0];
  const previous = readings[1];
  const progress = refreshStatus === "running" ? 66 : refreshStatus === "idle" ? 0 : 100;

  return (
    <div className="app-shell">
      <Header
        page={page}
        setPage={setPage}
        refreshData={refreshData}
        refreshStatus={refreshStatus}
        refreshMessage={refreshMessage}
        progress={progress}
      />
      <main className="container">
        {loading ? <div className="panel">Loading tank monitor data...</div> : null}
        {!loading && page === "dashboard" ? <Dashboard readings={readings} latest={latest} previous={previous} runs={runs} /> : null}
        {!loading && page === "readings" ? <ReadingsPage readings={readings} onAdd={() => setEditing(emptyReading())} onEdit={setEditing} onDelete={deleteReading} /> : null}
        {!loading && page === "settings" ? <SettingsPage settings={settings} onSave={saveSettings} /> : null}
        {!loading && page === "history" ? <HistoryPage runs={runs} /> : null}
      </main>
      {editing ? <ReadingModal title={editing.id ? "Edit Reading" : "Add Reading"} initial={editing} onSave={saveReading} onClose={() => setEditing(null)} /> : null}
      {review?.reading ? (
        <ReadingModal
          title="Review Low-Confidence Extraction"
          initial={normalizeReading(review.reading)}
          confirmLabel="Confirm Insert"
          onSave={confirmReview}
          onClose={() => {
            setReview(null);
            setRefreshStatus("warning");
            setRefreshMessage("Low-confidence extraction cancelled.");
            pushToast("info", "Low-confidence extraction cancelled.");
          }}
        />
      ) : null}
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
        ))}
      </div>
    </div>
  );
}

function Header(props: {
  page: Page;
  setPage: (page: Page) => void;
  refreshData: () => void;
  refreshStatus: RefreshStatus;
  refreshMessage: string;
  progress: number;
}) {
  return (
    <header className="site-header">
      <div className="header-top">
        <div>
          <p className="eyebrow">Local monitoring</p>
          <h1>Cloghan Tank Monitor</h1>
        </div>
        <button className="primary" onClick={props.refreshData} disabled={props.refreshStatus === "running"}>
          {props.refreshStatus === "running" ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>
      <div className="status-row">
        <span className={`status-pill ${props.refreshStatus}`}>{labelStatus(props.refreshStatus)}</span>
        <span>{props.refreshMessage}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${props.progress}%` }} /></div>
      <nav className="tabs">
        {(["dashboard", "readings", "settings", "history"] as Page[]).map((item) => (
          <button key={item} className={props.page === item ? "active" : ""} onClick={() => props.setPage(item)}>
            {item === "history" ? "Refresh History" : titleCase(item)}
          </button>
        ))}
      </nav>
    </header>
  );
}

function Dashboard({ readings, latest, previous, runs }: { readings: Reading[]; latest?: Reading; previous?: Reading; runs: RefreshRun[] }) {
  const chartData = readings.slice(0, 24).reverse().map((reading) => ({
    time: formatShortDate(reading.capturedAt),
    level: reading.totalLevelMm ?? 0,
    gsv: reading.totalGsvM3 ?? 0,
  }));
  const latestRun = runs[0];
  return (
    <div className="page-grid">
      <section className="panel hero-panel">
        <div>
          <p className="eyebrow">Latest reading</p>
          <h2>{latest ? formatDate(latest.capturedAt) : "No readings yet"}</h2>
          <p>{latest ? `${latest.source} source - ${formatConfidence(latest.confidence)} confidence` : "Run a refresh or add a manual reading."}</p>
        </div>
        <div className="metric-pair">
          <Metric label="Total Level" value={formatNumber(latest?.totalLevelMm, " mm")} delta={diffLabel(latest?.totalLevelDiffMm, previous?.totalLevelDiffMm, " mm")} />
          <Metric label="Total GSV" value={formatNumber(latest?.totalGsvM3, " m3")} delta={diffLabel(latest?.totalGsvDiffM3, previous?.totalGsvDiffM3, " m3")} />
        </div>
      </section>
      <section className="cards-grid">
        {TANKS.map((tank) => {
          const tankReading = latest?.tanks.find((item) => item.tank === tank);
          return <TankCard key={tank} tank={tank} reading={tankReading} />;
        })}
      </section>
      <ChartPanel title="Level Trend" data={chartData} dataKey="level" stroke="#2563eb" suffix=" mm" />
      <ChartPanel title="GSV Trend" data={chartData} dataKey="gsv" stroke="#0f766e" suffix=" m3" />
      <section className="panel">
        <h3>Recent Refresh Status</h3>
        {latestRun ? (
          <div className="history-summary">
            <span className={`status-pill ${latestRun.status}`}>{latestRun.status}</span>
            <strong>{latestRun.message || "No message"}</strong>
            <span>{formatDate(latestRun.startedAt)} - {formatDuration(latestRun.durationMs)}</span>
          </div>
        ) : <p>No refresh attempts recorded.</p>}
      </section>
    </div>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{delta ? <small>{delta}</small> : null}</div>;
}

function TankCard({ tank, reading }: { tank: TankName; reading?: TankReading }) {
  return (
    <article className="tank-card">
      <div className="tank-badge">{tank}</div>
      <Metric label="Level" value={formatNumber(reading?.levelMm, " mm")} />
      <Metric label="GSV" value={formatNumber(reading?.gsvM3, " m3")} />
      <span className="muted">Temp {formatNumber(reading?.temperatureC, " C")} - TOV {formatNumber(reading?.tovM3, " m3")}</span>
    </article>
  );
}

function ChartPanel({ title, data, dataKey, stroke, suffix }: { title: string; data: Array<Record<string, string | number>>; dataKey: string; stroke: string; suffix: string }) {
  return (
    <section className="panel chart-panel">
      <h3>{title}</h3>
      {data.length ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" minTickGap={24} />
            <YAxis width={72} />
            <Tooltip formatter={(value) => [`${value}${suffix}`, title]} />
            <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : <p>No chart data available.</p>}
    </section>
  );
}

function ReadingsPage({ readings, onAdd, onEdit, onDelete }: { readings: Reading[]; onAdd: () => void; onEdit: (reading: Reading) => void; onDelete: (id?: number) => void }) {
  return (
    <section className="panel full-width">
      <div className="section-header"><h2>Readings</h2><button className="primary" onClick={onAdd}>Add Reading</button></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th><th>C1 level</th><th>C1 temp</th><th>C1 TOV</th><th>C1 GSV</th><th>C2 level</th><th>C2 temp</th><th>C2 TOV</th><th>C2 GSV</th><th>C3 level</th><th>C3 temp</th><th>C3 TOV</th><th>C3 GSV</th><th>C4 level</th><th>C4 temp</th><th>C4 TOV</th><th>C4 GSV</th><th>Total level</th><th>Level diff</th><th>Total GSV</th><th>GSV diff</th><th>Source</th><th>Confidence</th><th>Verified</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((reading) => <ReadingRow key={reading.id ?? reading.capturedAt} reading={reading} onEdit={onEdit} onDelete={onDelete} />)}
            {!readings.length ? <tr><td colSpan={25}>No readings found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReadingRow({ reading, onEdit, onDelete }: { reading: Reading; onEdit: (reading: Reading) => void; onDelete: (id?: number) => void }) {
  const byTank = Object.fromEntries(reading.tanks.map((tank) => [tank.tank, tank]));
  return (
    <tr>
      <td>{formatDate(reading.capturedAt)}</td>
      {TANKS.flatMap((tank) => {
        const item = byTank[tank] as TankReading | undefined;
        return [
          <td key={`${tank}-level`}>{formatNumber(item?.levelMm)}</td>,
          <td key={`${tank}-temp`}>{formatNumber(item?.temperatureC)}</td>,
          <td key={`${tank}-tov`}>{formatNumber(item?.tovM3)}</td>,
          <td key={`${tank}-gsv`}>{formatNumber(item?.gsvM3)}</td>,
        ];
      })}
      <td>{formatNumber(reading.totalLevelMm)}</td><td>{formatNumber(reading.totalLevelDiffMm)}</td><td>{formatNumber(reading.totalGsvM3)}</td><td>{formatNumber(reading.totalGsvDiffM3)}</td><td>{reading.source}</td><td>{formatConfidence(reading.confidence)}</td><td>{reading.verified ? "Yes" : "No"}</td>
      <td className="actions"><button onClick={() => onEdit(reading)}>Edit</button><button className="danger" onClick={() => onDelete(reading.id)}>Delete</button></td>
    </tr>
  );
}

function SettingsPage({ settings, onSave }: { settings: Settings; onSave: (settings: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <section className="panel settings-panel">
      <div className="section-header"><h2>Settings</h2><button className="primary" onClick={() => onSave(draft)}>Save Settings</button></div>
      <label>Refresh schedule<select value={draft.scheduleMode} onChange={(event) => setDraft({ ...draft, scheduleMode: event.target.value as Settings["scheduleMode"] })}><option value="manual">Manual only</option><option value="10m">Every 10 minutes</option><option value="30m">Every 30 minutes</option><option value="1h">Every hour</option><option value="custom">Custom interval</option></select></label>
      <label>Custom interval minutes<input type="number" min="1" value={draft.customIntervalMinutes} onChange={(event) => setDraft({ ...draft, customIntervalMinutes: Number(event.target.value) })} disabled={draft.scheduleMode !== "custom"} /></label>
      <div className="check-grid"><label><input type="checkbox" checked={draft.notifySuccess} onChange={(event) => setDraft({ ...draft, notifySuccess: event.target.checked })} /> Notify on success</label><label><input type="checkbox" checked={draft.notifyWarning} onChange={(event) => setDraft({ ...draft, notifyWarning: event.target.checked })} /> Notify on warning</label><label><input type="checkbox" checked={draft.notifyFailure} onChange={(event) => setDraft({ ...draft, notifyFailure: event.target.checked })} /> Notify on failure</label></div>
      <div className="readonly-grid"><div><span>Screenshot retention</span><strong>{draft.screenshotRetentionHours ?? 3} hours for successful refreshes</strong></div><div><span>AI config</span><strong>{draft.aiConfigured ? "Configured" : "Not configured"}</strong></div><div><span>AI base URL</span><strong>{draft.aiBaseUrl || "From .env only"}</strong></div><div><span>AI model</span><strong>{draft.aiModel || "From .env only"}</strong></div></div>
    </section>
  );
}

function HistoryPage({ runs }: { runs: RefreshRun[] }) {
  return (
    <section className="panel full-width">
      <h2>Refresh History</h2>
      <div className="table-wrap"><table><thead><tr><th>Started at</th><th>Finished at</th><th>Status</th><th>Error code</th><th>Message</th><th>Confidence</th><th>Duration</th><th>Reading ID</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id ?? run.startedAt}><td>{formatDate(run.startedAt)}</td><td>{run.finishedAt ? formatDate(run.finishedAt) : "-"}</td><td><span className={`status-pill ${run.status}`}>{run.status}</span></td><td>{run.errorCode || "-"}</td><td>{run.message || "-"}</td><td>{formatConfidence(run.confidence)}</td><td>{formatDuration(run.durationMs)}</td><td>{run.readingId ?? "-"}</td></tr>)}{!runs.length ? <tr><td colSpan={8}>No refresh attempts found.</td></tr> : null}</tbody></table></div>
    </section>
  );
}

function ReadingModal({ title, initial, confirmLabel = "Save Reading", onSave, onClose }: { title: string; initial: Reading; confirmLabel?: string; onSave: (reading: Reading) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(normalizeReading(initial));
  const setField = (key: keyof Reading, value: Reading[keyof Reading]) => setDraft((current) => ({ ...current, [key]: value }));
  const setTank = (tank: string, key: keyof TankReading, value: number | null) => setDraft((current) => ({ ...current, tanks: current.tanks.map((item) => item.tank === tank ? { ...item, [key]: value } : item) }));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="section-header"><h2>{title}</h2><button onClick={onClose}>Cancel</button></div>
        <div className="form-grid"><label>Captured at<input type="datetime-local" value={toDateTimeLocal(draft.capturedAt)} onChange={(event) => setField("capturedAt", new Date(event.target.value).toISOString())} /></label><label>Source<input value={draft.source} onChange={(event) => setField("source", event.target.value)} /></label><label>Confidence<input type="number" step="0.01" min="0" max="1" value={draft.confidence ?? ""} onChange={(event) => setField("confidence", nullableNumber(event.target.value))} /></label><label className="checkbox-label"><input type="checkbox" checked={draft.verified} onChange={(event) => setField("verified", event.target.checked)} /> Verified</label></div>
        <div className="tank-form-grid">{draft.tanks.map((tank) => <fieldset key={tank.tank}><legend>{tank.tank}</legend><label>Level mm<input type="number" value={tank.levelMm ?? ""} onChange={(event) => setTank(tank.tank, "levelMm", nullableNumber(event.target.value))} /></label><label>Temperature C<input type="number" step="0.01" value={tank.temperatureC ?? ""} onChange={(event) => setTank(tank.tank, "temperatureC", nullableNumber(event.target.value))} /></label><label>TOV m3<input type="number" step="0.001" value={tank.tovM3 ?? ""} onChange={(event) => setTank(tank.tank, "tovM3", nullableNumber(event.target.value))} /></label><label>GSV m3<input type="number" step="0.001" value={tank.gsvM3 ?? ""} onChange={(event) => setTank(tank.tank, "gsvM3", nullableNumber(event.target.value))} /></label></fieldset>)}</div>
        <div className="form-grid"><label>Total level mm<input type="number" value={draft.totalLevelMm ?? ""} onChange={(event) => setField("totalLevelMm", nullableNumber(event.target.value))} /></label><label>Total level diff mm<input type="number" value={draft.totalLevelDiffMm ?? ""} onChange={(event) => setField("totalLevelDiffMm", nullableNumber(event.target.value))} /></label><label>Total GSV m3<input type="number" step="0.001" value={draft.totalGsvM3 ?? ""} onChange={(event) => setField("totalGsvM3", nullableNumber(event.target.value))} /></label><label>Total GSV diff m3<input type="number" step="0.001" value={draft.totalGsvDiffM3 ?? ""} onChange={(event) => setField("totalGsvDiffM3", nullableNumber(event.target.value))} /></label></div>
        <label>Notes<textarea value={draft.notes ?? ""} onChange={(event) => setField("notes", event.target.value)} /></label>
        <div className="modal-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave(draft)}>{confirmLabel}</button></div>
      </div>
    </div>
  );
}

async function apiGet(path: string) {
  return apiRequest(path, { method: "GET" });
}

async function apiRequest(path: string, init: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || response.statusText);
  return data;
}

function asReadings(data: unknown): Reading[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { readings?: unknown[] })?.readings) ? (data as { readings: unknown[] }).readings : [];
  return list.map((item) => normalizeReading(item as RawReading)).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

function asRuns(data: unknown): RefreshRun[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { refreshRuns?: unknown[]; runs?: unknown[] })?.refreshRuns) ? (data as { refreshRuns: unknown[] }).refreshRuns : Array.isArray((data as { runs?: unknown[] })?.runs) ? (data as { runs: unknown[] }).runs : [];
  return list.map((item) => normalizeRun(item as RawRun)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function asSettings(data: unknown): Settings {
  const source = ((data as { settings?: unknown })?.settings || data || {}) as Record<string, unknown>;
  return { ...defaultSettings, scheduleMode: String(source.scheduleMode || source.refreshSchedule || defaultSettings.scheduleMode) as Settings["scheduleMode"], customIntervalMinutes: Number(source.customIntervalMinutes || defaultSettings.customIntervalMinutes), notifySuccess: toBool(source.notifySuccess, true), notifyWarning: toBool(source.notifyWarning, true), notifyFailure: toBool(source.notifyFailure, true), screenshotRetentionHours: source.screenshotRetentionHours == null ? defaultSettings.screenshotRetentionHours : Number(source.screenshotRetentionHours), aiConfigured: toBool(source.aiConfigured || source.ai_configured, false), aiBaseUrl: stringOrUndefined(source.aiBaseUrl), aiModel: stringOrUndefined(source.aiModel) };
}

function normalizeReading(raw: RawReading): Reading {
  const tanks = Array.isArray(raw.tanks) ? raw.tanks : [];
  return { id: numberOrUndefined(raw.id), capturedAt: String(raw.capturedAt || raw.captured_at || new Date().toISOString()), source: String(raw.source || "ai"), confidence: nullableNumber(raw.confidence), totalLevelMm: nullableNumber(raw.totalLevelMm ?? raw.total_level_mm), totalLevelDiffMm: nullableNumber(raw.totalLevelDiffMm ?? raw.total_level_diff_mm), totalGsvM3: nullableNumber(raw.totalGsvM3 ?? raw.total_gsv_m3), totalGsvDiffM3: nullableNumber(raw.totalGsvDiffM3 ?? raw.total_gsv_diff_m3), verified: toBool(raw.verified, false), notes: stringOrUndefined(raw.notes) || "", tanks: TANKS.map((tank) => normalizeTank(tanks.find((item) => (item as TankReading).tank === tank) as RawTank | undefined, tank)) };
}

function normalizeTank(raw: RawTank | undefined, tank: TankName): TankReading {
  return { id: numberOrUndefined(raw?.id), tank, levelMm: nullableNumber(raw?.levelMm ?? raw?.level_mm), temperatureC: nullableNumber(raw?.temperatureC ?? raw?.temperature_c), tovM3: nullableNumber(raw?.tovM3 ?? raw?.tov_m3), gsvM3: nullableNumber(raw?.gsvM3 ?? raw?.gsv_m3) };
}

function normalizeRun(raw: RawRun): RefreshRun {
  return { id: numberOrUndefined(raw.id), startedAt: String(raw.startedAt || raw.started_at || new Date().toISOString()), finishedAt: raw.finishedAt || raw.finished_at ? String(raw.finishedAt || raw.finished_at) : null, status: String(raw.status || "unknown"), errorCode: stringOrUndefined(raw.errorCode ?? raw.error_code) || null, message: stringOrUndefined(raw.message) || null, confidence: nullableNumber(raw.confidence), durationMs: nullableNumber(raw.durationMs ?? raw.duration_ms), readingId: nullableNumber(raw.readingId ?? raw.reading_id) };
}

function readingToPayload(reading: Reading) {
  return { ...reading, tanks: reading.tanks.map(({ tank, levelMm, temperatureC, tovM3, gsvM3 }) => ({ tank, levelMm, temperatureC, tovM3, gsvM3 })) };
}

function settingsToPayload(settings: Settings) {
  return { scheduleMode: settings.scheduleMode, customIntervalMinutes: settings.customIntervalMinutes, notifySuccess: settings.notifySuccess, notifyWarning: settings.notifyWarning, notifyFailure: settings.notifyFailure };
}

function nullableNumber(value: unknown): number | null {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = nullableNumber(value);
  return number === null ? undefined : number;
}

function toBool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatNumber(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "-" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value)}${suffix}`;
}

function formatConfidence(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${Math.round(value / 100) / 10}s`;
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

function diffLabel(current: number | null | undefined, previous: number | null | undefined, suffix: string) {
  const value = current ?? previous;
  if (value === null || value === undefined) return undefined;
  return `${value > 0 ? "+" : ""}${formatNumber(value, suffix)} from previous`;
}

function labelStatus(status: string) {
  return status === "idle" ? "Ready" : status.replace("_", " ");
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

export default App;
