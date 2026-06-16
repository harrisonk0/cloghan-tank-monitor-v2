import { useState } from "react";
import { testConnection, loginRequest, setServerConfig } from "../api.js";
import type { Permissions } from "../types.js";

export default function LoginScreen({ onLogin }: { onLogin: (url: string, permissions: Permissions) => void }) {
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"url" | "key">("url");
  const [reachable, setReachable] = useState(false);

  async function handleTestUrl() {
    setLoading(true);
    setError("");
    const url = serverUrl.replace(/\/+$/, "");
    const ok = await testConnection(url);
    setReachable(ok);
    setLoading(false);
    if (ok) {
      setStep("key");
    } else {
      setError("Cannot reach server. Check the URL and ensure the server is running.");
    }
  }

  async function handleConnect() {
    setLoading(true);
    setError("");
    const url = serverUrl.replace(/\/+$/, "");
    const result = await loginRequest(url, apiKey);
    setLoading(false);
    if (result.ok && result.permissions) {
      setServerConfig(url, apiKey);
      onLogin(url, result.permissions);
    } else {
      setError(result.error || "Invalid API key.");
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <span className="eyebrow">Cloghan Terminal</span>
          <h1>Tank Monitor</h1>
          <p className="login-subtitle">Connect to your server</p>
        </div>

        {step === "url" ? (
          <>
            <div className="login-field">
              <label>Server URL</label>
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://xxxx.ngrok-free.app"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && serverUrl) handleTestUrl(); }}
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button className="primary login-btn" onClick={handleTestUrl} disabled={!serverUrl || loading}>
              {loading ? "Testing\u2026" : "Test Connection"}
            </button>
          </>
        ) : (
          <>
            <div className="login-field">
              <label>Server URL</label>
              <div className="login-url-confirmed">{serverUrl} <span className="login-ok">Reachable</span></div>
            </div>
            <div className="login-field">
              <label>API Key</label>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ctm_live_..."
                type="password"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && apiKey) handleConnect(); }}
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <div className="login-actions">
              <button onClick={() => { setStep("url"); setError(""); }}>Back</button>
              <button className="primary" onClick={handleConnect} disabled={!apiKey || loading}>
                {loading ? "Connecting\u2026" : "Connect"}
              </button>
            </div>
          </>
        )}

        <div className="login-help">
          <p>Generate an API key from the server tray menu:</p>
          <p className="login-help-cmd">Right-click tray icon &rarr; Generate Read/Write API Key</p>
        </div>
      </div>
    </div>
  );
}
