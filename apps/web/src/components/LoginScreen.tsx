import { useState } from "react";
import { testConnection, loginRequest, setServerConfig } from "../api.js";
import type { Permissions } from "../types.js";

export default function LoginScreen({ onLogin }: { onLogin: (url: string, permissions: Permissions) => void }) {
  const [serverUrl, setServerUrl] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setLoading(true);
    setError("");
    const url = serverUrl.replace(/\/+$/, "");

    // Step 1: Check server is reachable
    const ok = await testConnection(url);
    if (!ok) {
      setLoading(false);
      setError("Cannot reach server. Check the URL and ensure the server is running.");
      return;
    }

    // Step 2: Login with password
    const result = await loginRequest(url, password);
    setLoading(false);

    if (result.ok && result.token && result.permissions) {
      setServerConfig(url, result.token);
      onLogin(url, result.permissions);
    } else {
      setError(result.error || "Invalid password.");
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

        <div className="login-field">
          <label>Server URL</label>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://xxxx.trycloudflare.com"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && serverUrl && password) handleConnect(); }}
          />
        </div>

        <div className="login-field">
          <label>Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Ask the server admin"
            type="password"
            onKeyDown={(e) => { if (e.key === "Enter" && serverUrl && password) handleConnect(); }}
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button className="primary login-btn" onClick={handleConnect} disabled={!serverUrl || !password || loading}>
          {loading ? "Connecting\u2026" : "Connect"}
        </button>

        <div className="login-help">
          <p>Get the URL and password from the server's system tray icon.</p>
        </div>
      </div>
    </div>
  );
}
