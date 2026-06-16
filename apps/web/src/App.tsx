import { useCallback, useEffect, useState, useRef } from "react";
import { testConnection, checkSession, loginRequest, logoutRequest, apiGet, apiRequest, parseMagicLink, setServerConfig } from "./api.js";
import { defaultSettings } from "./types.js";
import type { Page, RefreshStatus, ToastKind, Permissions, Reading, RefreshRun, Settings, RefreshResult, Toast } from "./types.js";
import { asReadings, asRuns, asSettings, messageFromError, readingToPayload, settingsToPayload, normalizeReading, emptyReading, labelStatus } from "./helpers.js";
import LoginScreen from "./components/LoginScreen.js";
import Header from "./components/Header.js";
import Dashboard from "./components/Dashboard.js";
import ReadingsPage from "./components/ReadingsPage.js";
import SettingsPage from "./components/SettingsPage.js";
import HistoryPage from "./components/HistoryPage.js";
import ReadingModal, { Panel } from "./components/ReadingModal.js";

let nextToastId = 0;

function App() {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
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
  const [connectionOk, setConnectionOk] = useState(true);

  const isReadOnly = permissions === "readonly";

  // Check session on mount (magic link takes priority)
  useEffect(() => {
    const magic = parseMagicLink();
    if (magic) {
      let cancelled = false;
      loginRequest(magic.serverUrl, magic.apiKey).then((r) => {
        if (cancelled) return;
        if (r.ok && r.permissions) {
          setServerConfig(magic.serverUrl, magic.apiKey);
          setServerUrl(magic.serverUrl);
          setPermissions(r.permissions);
        }
      }).catch(() => {});
      return () => { cancelled = true; };
    }

    const url = localStorage.getItem("serverUrl");
    const key = localStorage.getItem("apiKey");
    if (url && key) {
      let cancelled = false;
      checkSession(url).then((s) => {
        if (cancelled) return;
        if (s.authenticated) {
          setServerUrl(url);
          setPermissions(s.permissions ?? "readonly");
        } else {
          loginRequest(url, key).then((r) => {
            if (cancelled) return;
            if (r.ok && r.permissions) {
              setServerUrl(url);
              setPermissions(r.permissions);
            }
          }).catch(() => {});
        }
      }).catch(() => {});
      return () => { cancelled = true; };
    }
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (serverUrl && permissions) {
      void loadAll();
    }
  }, [serverUrl, permissions]);

  // Connection heartbeat
  useEffect(() => {
    if (!serverUrl) return;
    const controller = new AbortController();
    const interval = setInterval(async () => {
      const ok = await testConnection(serverUrl, controller.signal);
      if (!controller.signal.aborted) setConnectionOk(ok);
    }, 30000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [serverUrl]);

  const loadAllController = useRef<AbortController | null>(null);

  const loadAll = useCallback(async () => {
    loadAllController.current?.abort();
    const controller = new AbortController();
    loadAllController.current = controller;

    setLoading(true);
    try {
      const [readingsData, runsData, settingsData] = await Promise.all([
        apiGet("/readings"),
        apiGet("/refresh-runs"),
        apiGet("/settings"),
      ]);
      if (controller.signal.aborted) return;
      setReadings(asReadings(readingsData));
      setRuns(asRuns(runsData));
      setSettings(asSettings(settingsData));
    } catch (error) {
      if (controller.signal.aborted) return;
      pushToast("error", messageFromError(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Poll for new data every 30 seconds (other clients may have triggered refresh)
  useEffect(() => {
    if (!serverUrl || !permissions) return;
    const interval = setInterval(() => {
      void loadAll();
    }, 30000);
    return () => clearInterval(interval);
  }, [serverUrl, permissions, loadAll]);

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

  function handleLogout() {
    if (!window.confirm("Are you sure you want to logout?")) return;
    if (serverUrl) void logoutRequest(serverUrl);
    setServerUrl(null);
    setPermissions(null);
  }

  function pushToast(kind: ToastKind, message: string) {
    const id = ++nextToastId;
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

  if (!serverUrl || !permissions) {
    return <LoginScreen onLogin={(url, perm) => { setServerUrl(url); setPermissions(perm); }} />;
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
        isReadOnly={isReadOnly}
        connectionOk={connectionOk}
        onLogout={handleLogout}
      />
      <main className="container">
        {loading && <Panel>Loading\u2026</Panel>}
        {!loading && page === "dashboard" && <Dashboard readings={readings} latest={latest} previous={previous} runs={runs} />}
        {!loading && page === "readings" && <ReadingsPage readings={readings} isReadOnly={isReadOnly} onAdd={() => setEditing(emptyReading())} onEdit={setEditing} onDelete={deleteReading} />}
        {!loading && page === "settings" && <SettingsPage settings={settings} isReadOnly={isReadOnly} onSave={saveSettings} />}
        {!loading && page === "history" && <HistoryPage runs={runs} />}
      </main>
      {editing && !isReadOnly && (
        <ReadingModal title={editing.id ? "Edit reading" : "Add reading"} initial={editing} onSave={saveReading} onClose={() => setEditing(null)} />
      )}
      {review?.reading && (
        <ReadingModal
          title="Review extraction"
          initial={normalizeReading(review.reading)}
          confirmLabel="Confirm"
          onSave={confirmReview}
          onClose={() => { setReview(null); setRefreshStatus("warning"); setRefreshMessage("Extraction cancelled."); pushToast("info", "Extraction cancelled."); }}
        />
      )}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
