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
const MAX_LEVEL = 22000; // approximate max mm for visual scaling

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

// ============================================================
// App
// ============================================================

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

  useEffect(() => { void loadAll(); }, []);

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
    setRefreshMessage("Capturing screens and extracting tank data\u2026");
    try {
      const result = (await apiRequest("/refresh", { method: "POST" })) as RefreshResult;
      setRefreshStatus(result.status);
      setRefreshMessage(result.message || labelStatus(result.status));
      if (result.status === "needs_review") {
        setReview(result);
        pushToast("warning", "Low confidence \u2014 review the extraction before saving.");
        return;
      }
      notifyForRefresh(result);
      await loadAll();
    } catch (error) {
      setRefreshStatus("failed");
      setRefreshMessage(messageFromError(error));
      pushToast("error", `Refresh failed \u2014 ${messageFromError(error)}`);
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
      setRefreshMessage(result.message || "Confirmed reading saved.");
      notifyForRefresh(result.status ? result : { status: "success", message: "Confirmed reading saved." });
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
    window.setTimeout(() => setToasts((items) => items.filter((t) => t.id !== id)), 4500);
  }

  function notifyForRefresh(result: RefreshResult) {
    if (result.status === "success") {
      pushToast("success", result.readingId ? `Reading #${result.readingId} saved.` : result.message || "Refresh complete.");
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
        {loading && <Panel>Loading\u2026</Panel>}
        {!loading && page === "dashboard" && <Dashboard readings={readings} latest={latest} previous={previous} runs={runs} />}
        {!loading && page === "readings" && <ReadingsPage readings={readings} onAdd={() => setEditing(emptyReading())} onEdit={setEditing} onDelete={deleteReading} />}
        {!loading && page === "settings" && <SettingsPage settings={settings} onSave={saveSettings} />}
        {!loading && page === "history" && <HistoryPage runs={runs} />}
      </main>
      {editing && <ReadingModal title={editing.id ? "Edit reading" : "Add reading"} initial={editing} onSave={saveReading} onClose={() => setEditing(null)} />}
      {review?.reading && (
        <ReadingModal
          title="Review extraction"
          initial={normalizeReading(review.reading)}
          confirmLabel="Confirm"
          onSave={confirmReview}
          onClose={() => { setReview(null); setRefreshStatus("warning"); setRefreshMessage("Extraction cancelled."); pushToast("info", "Extraction cancelled."); }}
        />
      )}
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Header
// ============================================================

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
        <div className="header-title">
          <span className="eyebrow">Cloghan Terminal</span>
          <h1>Tank Monitor</h1>
        </div>
        <button className="primary" onClick={props.refreshData} disabled={props.refreshStatus === "running"}>
          {props.refreshStatus === "running" ? "Extracting\u2026" : "Refresh"}
        </button>
      </div>
      <div className="status-row">
        <span className={`status-pill ${props.refreshStatus}`}>{labelStatus(props.refreshStatus)}</span>
        <span>{props.refreshMessage}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${props.progress}%` }} /></div>
      <nav className="tabs" role="tablist">
        {(["dashboard", "readings", "settings", "history"] as Page[]).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={props.page === item}
            className={props.page === item ? "active" : ""}
            onClick={() => props.setPage(item)}
          >
            {item === "history" ? "History" : titleCase(item)}
          </button>
        ))}
      </nav>
    </header>
  );
}

// ============================================================
// Dashboard
// ============================================================

function Dashboard({ readings, latest, previous, runs }: { readings: Reading[]; latest?: Reading; previous?: Reading; runs: RefreshRun[] }) {
  if (!latest) {
    return <div className="page-grid"><div className="empty-state">No readings yet. Click Refresh to capture tank data.</div></div>;
  }

  const chartData = readings.slice(0, 30).reverse().map((r) => ({
    time: formatShortDate(r.capturedAt),
    level: r.totalLevelMm ?? 0,
    gsv: r.totalGsvM3 ?? 0,
  }));

  const latestRun = runs[0];

  return (
    <div className="page-grid">
      {/* Tank visualisations — the signature element */}
      <TankVisualisations latest={latest} />

      {/* Hero metrics */}
      <section className="panel hero-panel">
        <div className="hero-metrics">
          <div className="hero-metric">
            <span className="hero-metric-label">Total level</span>
            <strong className="hero-metric-value">{formatNumber(latest.totalLevelMm, " mm")}</strong>
            {latest.totalLevelDiffMm != null && previous?.totalLevelDiffMm != null && (
              <span className={`hero-metric-delta ${latest.totalLevelDiffMm < 0 ? "negative" : ""}`}>
                {latest.totalLevelDiffMm > 0 ? "+" : ""}{formatNumber(latest.totalLevelDiffMm, " mm")}
              </span>
            )}
          </div>
          <div className="hero-metric">
            <span className="hero-metric-label">Total GSV</span>
            <strong className="hero-metric-value">{formatNumber(latest.totalGsvM3, " m\u00B3")}</strong>
            {latest.totalGsvDiffM3 != null && previous?.totalGsvDiffM3 != null && (
              <span className={`hero-metric-delta ${latest.totalGsvDiffM3 < 0 ? "negative" : ""}`}>
                {latest.totalGsvDiffM3 > 0 ? "+" : ""}{formatNumber(latest.totalGsvDiffM3, " m\u00B3")}
              </span>
            )}
          </div>
        </div>
        <div>
          <p className="hero-timestamp">{formatDate(latest.capturedAt)}</p>
          <p className="hero-timestamp">{latest.source} &middot; {formatConfidence(latest.confidence)}</p>
          {latestRun && (
            <div className="history-summary" style={{ marginTop: "0.75rem" }}>
              <span className={`status-pill ${latestRun.status}`}>{latestRun.status}</span>
              <strong>{latestRun.message || "No message"}</strong>
              <span>{formatDuration(latestRun.durationMs)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Charts */}
      <ChartPanel title="Level trend" data={chartData} dataKey="level" stroke="var(--accent-cyan)" suffix=" mm" />
      <ChartPanel title="GSV trend" data={chartData} dataKey="gsv" stroke="var(--accent-green)" suffix=" m\u00B3" />
    </div>
  );
}

// ============================================================
// Tank Visualisations (signature element)
// ============================================================

function TankVisualisations({ latest }: { latest: Reading }) {
  return (
    <section className="tanks-visual">
      <div className="tanks-visual-header">
        <h2>Tank levels</h2>
        <span className="eyebrow">{formatDate(latest.capturedAt)}</span>
      </div>
      <div className="tanks-grid">
        {TANKS.map((tank) => {
          const t = latest.tanks.find((item) => item.tank === tank);
          return <TankViz key={tank} tank={tank} reading={t} />;
        })}
      </div>
    </section>
  );
}

function TankViz({ tank, reading }: { tank: TankName; reading?: TankReading }) {
  const level = reading?.levelMm;
  const fillPct = level != null ? Math.min((level / MAX_LEVEL) * 100, 100) : 0;

  return (
    <div className="tank-viz">
      <span className="tank-viz-label">{tank}</span>
      <div className="tank-viz-body">
        <div className="tank-viz-shell">
          <div className="tank-viz-fill" style={{ height: `${fillPct}%` }} />
        </div>
        <div className="tank-viz-ticks">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="tank-viz-tick" />)}
        </div>
      </div>
      <span className="tank-viz-value">
        {level != null ? formatNumber(level) : "\u2014"}
        {level != null && <span className="tank-viz-unit"> mm</span>}
      </span>
      <div className="tank-viz-meta">
        <div className="tank-viz-meta-row">
          <span className="tank-viz-meta-label">Temp</span>
          <span className="tank-viz-meta-value">{reading?.temperatureC != null ? `${reading.temperatureC}\u00B0C` : "\u2014"}</span>
        </div>
        <div className="tank-viz-meta-row">
          <span className="tank-viz-meta-label">TOV</span>
          <span className="tank-viz-meta-value">{reading?.tovM3 != null ? `${formatNumber(reading.tovM3)} m\u00B3` : "\u2014"}</span>
        </div>
        <div className="tank-viz-meta-row">
          <span className="tank-viz-meta-label">GSV</span>
          <span className="tank-viz-meta-value">{reading?.gsvM3 != null ? `${formatNumber(reading.gsvM3)} m\u00B3` : "\u2014"}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Charts
// ============================================================

function ChartPanel({ title, data, dataKey, stroke, suffix }: { title: string; data: Array<Record<string, string | number>>; dataKey: string; stroke: string; suffix: string }) {
  return (
    <section className="panel chart-panel">
      <h3>{title}</h3>
      {data.length ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" minTickGap={28} tick={{ fill: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={{ stroke: "var(--border)" }} />
            <YAxis width={68} tick={{ fill: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={{ stroke: "var(--border)" }} />
            <Tooltip
              contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}
              labelStyle={{ color: "var(--text-dim)" }}
              itemStyle={{ color: "var(--text-primary)" }}
              formatter={(value) => [`${Number(value).toLocaleString()}${suffix}`, title]}
            />
            <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p style={{ color: "var(--text-dim)", margin: 0 }}>No data yet.</p>
      )}
    </section>
  );
}

// ============================================================
// Readings Page
// ============================================================

function ReadingsPage({ readings, onAdd, onEdit, onDelete }: { readings: Reading[]; onAdd: () => void; onEdit: (reading: Reading) => void; onDelete: (id?: number) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <section className="panel full-width">
      <div className="section-header"><h2>Readings</h2><button className="primary" onClick={onAdd}>Add reading</button></div>
      <div className="readings-list">
        {!readings.length && <p className="empty-text">No readings yet.</p>}
        {readings.map((r) => (
          <ReadingCard
            key={r.id ?? r.capturedAt}
            reading={r}
            isExpanded={expanded === r.id}
            onToggle={() => setExpanded(expanded === r.id ? null : r.id ?? null)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ReadingCard({ reading, isExpanded, onToggle, onEdit, onDelete }: { reading: Reading; isExpanded: boolean; onToggle: () => void; onEdit: (r: Reading) => void; onDelete: (id?: number) => void }) {
  const byTank = Object.fromEntries(reading.tanks.map((t) => [t.tank, t]));
  return (
    <div className={`reading-card ${isExpanded ? "expanded" : ""}`}>
      <button className="reading-card-header" onClick={onToggle}>
        <div className="reading-card-summary">
          <span className="reading-card-time">{formatDate(reading.capturedAt)}</span>
          <span className={`status-pill ${reading.verified ? "success" : ""}`}>{reading.verified ? "verified" : "unverified"}</span>
          <span className="reading-card-meta">{reading.source}{reading.confidence != null ? ` \u00B7 ${formatConfidence(reading.confidence)}` : ""}</span>
        </div>
        <span className={`reading-card-chevron ${isExpanded ? "open" : ""}`}>{"\u25B6"}</span>
      </button>
      {isExpanded && (
        <div className="reading-card-body">
          <table className="tank-table">
            <thead>
              <tr>
                <th>Tank</th>
                <th>Level mm</th>
                <th>Temp &deg;C</th>
                <th>TOV m&sup3;</th>
                <th>GSV m&sup3;</th>
              </tr>
            </thead>
            <tbody>
              {TANKS.map((tank) => {
                const t = byTank[tank] as TankReading | undefined;
                return (
                  <tr key={tank}>
                    <td className="tank-id">{tank}</td>
                    <td>{formatNumber(t?.levelMm)}</td>
                    <td>{formatNumber(t?.temperatureC)}</td>
                    <td>{formatNumber(t?.tovM3)}</td>
                    <td>{formatNumber(t?.gsvM3)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="tank-id">Totals</td>
                <td className="total-cell">{formatNumber(reading.totalLevelMm)}</td>
                <td></td>
                <td></td>
                <td className="total-cell">{formatNumber(reading.totalGsvM3)}</td>
              </tr>
            </tfoot>
          </table>
          {reading.notes && <p className="reading-notes">{reading.notes}</p>}
          <div className="reading-card-actions">
            <button onClick={() => onEdit(reading)}>Edit</button>
            <button className="danger" onClick={() => onDelete(reading.id)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Settings Page
// ============================================================

function SettingsPage({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <section className="panel settings-panel">
      <div className="section-header"><h2>Settings</h2><button className="primary" onClick={() => onSave(draft)}>Save</button></div>
      <label>
        Refresh schedule
        <select value={draft.scheduleMode} onChange={(e) => setDraft({ ...draft, scheduleMode: e.target.value as Settings["scheduleMode"] })}>
          <option value="manual">Manual only</option>
          <option value="10m">Every 10 minutes</option>
          <option value="30m">Every 30 minutes</option>
          <option value="1h">Every hour</option>
          <option value="custom">Custom interval</option>
        </select>
      </label>
      <label>
        Custom interval (minutes)
        <input type="number" min="1" value={draft.customIntervalMinutes} onChange={(e) => setDraft({ ...draft, customIntervalMinutes: Number(e.target.value) })} disabled={draft.scheduleMode !== "custom"} />
      </label>
      <div className="check-grid">
        <label><input type="checkbox" checked={draft.notifySuccess} onChange={(e) => setDraft({ ...draft, notifySuccess: e.target.checked })} /> On success</label>
        <label><input type="checkbox" checked={draft.notifyWarning} onChange={(e) => setDraft({ ...draft, notifyWarning: e.target.checked })} /> On warning</label>
        <label><input type="checkbox" checked={draft.notifyFailure} onChange={(e) => setDraft({ ...draft, notifyFailure: e.target.checked })} /> On failure</label>
      </div>
      <div className="readonly-grid">
        <div><span>Screenshots</span><strong>{draft.screenshotRetentionHours ?? 3}h retention</strong></div>
        <div><span>AI model</span><strong>{draft.aiModel || "Not configured"}</strong></div>
        <div><span>AI status</span><strong>{draft.aiConfigured ? "Connected" : "Not configured"}</strong></div>
        <div><span>AI endpoint</span><strong>{draft.aiBaseUrl || "From .env"}</strong></div>
      </div>
      {settings.scheduler && (
        <div className="readonly-grid">
          <div><span>Next refresh</span><strong>{settings.scheduler.nextRunAt ? formatDate(settings.scheduler.nextRunAt) : "Manual"}</strong></div>
          <div><span>Scheduler</span><strong>{settings.scheduler.running ? "Running" : settings.scheduler.message}</strong></div>
        </div>
      )}
    </section>
  );
}

// ============================================================
// History Page
// ============================================================

function HistoryPage({ runs }: { runs: RefreshRun[] }) {
  return (
    <section className="panel full-width">
      <div className="section-header"><h2>Refresh history</h2></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th><th>Finished</th><th>Status</th><th>Error</th><th>Message</th><th>Confidence</th><th>Duration</th><th>Reading</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id ?? run.startedAt}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{formatDate(run.startedAt)}</td>
                <td>{run.finishedAt ? formatDate(run.finishedAt) : "\u2014"}</td>
                <td><span className={`status-pill ${run.status}`}>{run.status}</span></td>
                <td>{run.errorCode || "\u2014"}</td>
                <td>{run.message || "\u2014"}</td>
                <td>{formatConfidence(run.confidence)}</td>
                <td style={{ fontFamily: "var(--font-mono)" }}>{formatDuration(run.durationMs)}</td>
                <td>{run.readingId ?? "\u2014"}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)" }}>No refresh attempts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================================
// Modal
// ============================================================

function ReadingModal({ title, initial, confirmLabel = "Save", onSave, onClose }: { title: string; initial: Reading; confirmLabel?: string; onSave: (r: Reading) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(normalizeReading(initial));
  const setField = (key: keyof Reading, value: Reading[keyof Reading]) => setDraft((c) => ({ ...c, [key]: value }));
  const setTank = (tank: string, key: keyof TankReading, value: number | null) =>
    setDraft((c) => ({ ...c, tanks: c.tanks.map((t) => t.tank === tank ? { ...t, [key]: value } : t) }));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="section-header"><h2>{title}</h2><button onClick={onClose}>Cancel</button></div>
        <div className="form-grid">
          <label>Captured at<input type="datetime-local" value={toDateTimeLocal(draft.capturedAt)} onChange={(e) => setField("capturedAt", new Date(e.target.value).toISOString())} /></label>
          <label>Source<input value={draft.source} onChange={(e) => setField("source", e.target.value)} /></label>
          <label>Confidence<input type="number" step="0.01" min="0" max="1" value={draft.confidence ?? ""} onChange={(e) => setField("confidence", nullableNumber(e.target.value))} /></label>
          <label className="checkbox-label" style={{ marginTop: "1.4rem" }}><input type="checkbox" checked={draft.verified} onChange={(e) => setField("verified", e.target.checked)} /> Verified</label>
        </div>
        <div className="tank-form-grid">
          {draft.tanks.map((tank) => (
            <fieldset key={tank.tank}>
              <legend>{tank.tank}</legend>
              <label>Level (mm)<input type="number" value={tank.levelMm ?? ""} onChange={(e) => setTank(tank.tank, "levelMm", nullableNumber(e.target.value))} /></label>
              <label>Temp (&deg;C)<input type="number" step="0.01" value={tank.temperatureC ?? ""} onChange={(e) => setTank(tank.tank, "temperatureC", nullableNumber(e.target.value))} /></label>
              <label>TOV (m&sup3;)<input type="number" step="0.001" value={tank.tovM3 ?? ""} onChange={(e) => setTank(tank.tank, "tovM3", nullableNumber(e.target.value))} /></label>
              <label>GSV (m&sup3;)<input type="number" step="0.001" value={tank.gsvM3 ?? ""} onChange={(e) => setTank(tank.tank, "gsvM3", nullableNumber(e.target.value))} /></label>
            </fieldset>
          ))}
        </div>
        <div className="form-grid">
          <label>Total level (mm)<input type="number" value={draft.totalLevelMm ?? ""} onChange={(e) => setField("totalLevelMm", nullableNumber(e.target.value))} /></label>
          <label>Level diff (mm)<input type="number" value={draft.totalLevelDiffMm ?? ""} onChange={(e) => setField("totalLevelDiffMm", nullableNumber(e.target.value))} /></label>
          <label>Total GSV (m&sup3;)<input type="number" step="0.001" value={draft.totalGsvM3 ?? ""} onChange={(e) => setField("totalGsvM3", nullableNumber(e.target.value))} /></label>
          <label>GSV diff (m&sup3;)<input type="number" step="0.001" value={draft.totalGsvDiffM3 ?? ""} onChange={(e) => setField("totalGsvDiffM3", nullableNumber(e.target.value))} /></label>
        </div>
        <label>Notes<textarea value={draft.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} /></label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(draft)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Small shared components
// ============================================================

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel full-width">{children}</div>;
}

// ============================================================
// API layer
// ============================================================

async function apiGet(path: string) {
  return apiRequest(path, { method: "GET" });
}

async function apiRequest(path: string, init: RequestInit) {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: Record<string, string> = hasBody ? { "Content-Type": "application/json" } : {};
  const response = await fetch(`${API_BASE}${path}`, { headers, ...init });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || response.statusText);
  return data;
}

// ============================================================
// Data normalisation
// ============================================================

function asReadings(data: unknown): Reading[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { readings?: unknown[] })?.readings) ? (data as { readings: unknown[] }).readings : [];
  return list.map((item) => normalizeReading(item as RawReading)).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

function asRuns(data: unknown): RefreshRun[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { refreshRuns?: unknown[]; runs?: unknown[] })?.refreshRuns) ? (data as { refreshRuns: unknown[] }).refreshRuns : Array.isArray((data as { runs?: unknown[] })?.runs) ? (data as { runs: unknown[] }).runs : [];
  return list.map((item) => normalizeRun(item as RawRun)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function asSettings(data: unknown): Settings {
  const src = ((data as { settings?: unknown })?.settings || data || {}) as Record<string, unknown>;
  return {
    ...defaultSettings,
    scheduleMode: String(src.scheduleMode || src.refreshSchedule || defaultSettings.scheduleMode) as Settings["scheduleMode"],
    customIntervalMinutes: Number(src.customIntervalMinutes || defaultSettings.customIntervalMinutes),
    notifySuccess: toBool(src.notifySuccess, true),
    notifyWarning: toBool(src.notifyWarning, true),
    notifyFailure: toBool(src.notifyFailure, true),
    screenshotRetentionHours: src.screenshotRetentionHours == null ? defaultSettings.screenshotRetentionHours : Number(src.screenshotRetentionHours),
    aiConfigured: toBool(src.aiConfigured || src.ai_configured, false),
    aiBaseUrl: stringOrUndefined(src.aiBaseUrl),
    aiModel: stringOrUndefined(src.aiModel),
  };
}

function normalizeReading(raw: RawReading): Reading {
  const tanks = Array.isArray(raw.tanks) ? raw.tanks : [];
  return {
    id: numberOrUndefined(raw.id),
    capturedAt: String(raw.capturedAt || raw.captured_at || new Date().toISOString()),
    source: String(raw.source || "ai"),
    confidence: nullableNumber(raw.confidence),
    totalLevelMm: nullableNumber(raw.totalLevelMm ?? raw.total_level_mm),
    totalLevelDiffMm: nullableNumber(raw.totalLevelDiffMm ?? raw.total_level_diff_mm),
    totalGsvM3: nullableNumber(raw.totalGsvM3 ?? raw.total_gsv_m3),
    totalGsvDiffM3: nullableNumber(raw.totalGsvDiffM3 ?? raw.total_gsv_diff_m3),
    verified: toBool(raw.verified, false),
    notes: stringOrUndefined(raw.notes) || "",
    tanks: TANKS.map((tank) => normalizeTank(tanks.find((item) => (item as TankReading).tank === tank) as RawTank | undefined, tank)),
  };
}

function normalizeTank(raw: RawTank | undefined, tank: TankName): TankReading {
  return {
    id: numberOrUndefined(raw?.id),
    tank,
    levelMm: nullableNumber(raw?.levelMm ?? raw?.level_mm),
    temperatureC: nullableNumber(raw?.temperatureC ?? raw?.temperature_c),
    tovM3: nullableNumber(raw?.tovM3 ?? raw?.tov_m3),
    gsvM3: nullableNumber(raw?.gsvM3 ?? raw?.gsv_m3),
  };
}

function normalizeRun(raw: RawRun): RefreshRun {
  return {
    id: numberOrUndefined(raw.id),
    startedAt: String(raw.startedAt || raw.started_at || new Date().toISOString()),
    finishedAt: raw.finishedAt || raw.finished_at ? String(raw.finishedAt || raw.finished_at) : null,
    status: String(raw.status || "unknown"),
    errorCode: stringOrUndefined(raw.errorCode ?? raw.error_code) || null,
    message: stringOrUndefined(raw.message) || null,
    confidence: nullableNumber(raw.confidence),
    durationMs: nullableNumber(raw.durationMs ?? raw.duration_ms),
    readingId: nullableNumber(raw.readingId ?? raw.reading_id),
  };
}

function readingToPayload(reading: Reading) {
  return { ...reading, tanks: reading.tanks.map(({ tank, levelMm, temperatureC, tovM3, gsvM3 }) => ({ tank, levelMm, temperatureC, tovM3, gsvM3 })) };
}

function settingsToPayload(s: Settings) {
  return { scheduleMode: s.scheduleMode, customIntervalMinutes: s.customIntervalMinutes, notifySuccess: s.notifySuccess, notifyWarning: s.notifyWarning, notifyFailure: s.notifyFailure };
}

// ============================================================
// Helpers
// ============================================================

function nullableNumber(v: unknown): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = nullableNumber(v);
  return n === null ? undefined : n;
}

function toBool(v: unknown, fb: boolean): boolean {
  if (v === undefined || v === null) return fb;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  return ["true", "1", "yes"].includes(String(v).toLowerCase());
}

function stringOrUndefined(v: unknown) {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function formatNumber(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined) return "\u2014";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value)}${suffix}`;
}

function formatConfidence(value: number | null | undefined) {
  if (value === null || value === undefined) return "\u2014";
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "\u2014";
  return `${(Math.round(value) / 1000).toFixed(1)}s`;
}

function toDateTimeLocal(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16);
}

function labelStatus(status: string) {
  return status === "idle" ? "Ready" : status.replace(/_/g, " ");
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

export default App;
