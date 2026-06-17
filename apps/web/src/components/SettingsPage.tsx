import { useState, useEffect } from "react";
import type { Settings } from "../types.js";
import { formatDate } from "../helpers.js";

export default function SettingsPage({ settings, isReadOnly, onSave }: { settings: Settings; isReadOnly: boolean; onSave: (s: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="section-header">
        <h2>Settings</h2>
        {!isReadOnly && <button className="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving\u2026" : "Save"}</button>}
      </div>
      <label>
        Refresh schedule
        <select value={draft.scheduleMode} onChange={(e) => setDraft({ ...draft, scheduleMode: e.target.value as Settings["scheduleMode"] })} disabled={isReadOnly}>
          <option value="manual">Manual only</option>
          <option value="10m">Every 10 minutes</option>
          <option value="30m">Every 30 minutes</option>
          <option value="1h">Every hour</option>
          <option value="onTheHour">Every hour on the hour</option>
          <option value="custom">Custom interval</option>
        </select>
      </label>
      <label>
        Custom interval (minutes)
        <input type="number" min="1" value={draft.customIntervalMinutes} onChange={(e) => setDraft({ ...draft, customIntervalMinutes: Number(e.target.value) })} disabled={draft.scheduleMode !== "custom" || isReadOnly} />
      </label>
      <div className="check-grid">
        <label><input type="checkbox" checked={draft.notifySuccess} onChange={(e) => setDraft({ ...draft, notifySuccess: e.target.checked })} disabled={isReadOnly} /> On success</label>
        <label><input type="checkbox" checked={draft.notifyWarning} onChange={(e) => setDraft({ ...draft, notifyWarning: e.target.checked })} disabled={isReadOnly} /> On warning</label>
        <label><input type="checkbox" checked={draft.notifyFailure} onChange={(e) => setDraft({ ...draft, notifyFailure: e.target.checked })} disabled={isReadOnly} /> On failure</label>
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
