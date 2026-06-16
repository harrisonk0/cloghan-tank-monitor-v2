import { useState, useEffect } from "react";
import type { Reading, TankReading } from "../types.js";
import { nullableNumber, toDateTimeLocal, normalizeReading } from "../helpers.js";

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel full-width">{children}</div>;
}

export { Panel };

export default function ReadingModal({ title, initial, confirmLabel = "Save", onSave, onClose }: { title: string; initial: Reading; confirmLabel?: string; onSave: (r: Reading) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(normalizeReading(initial));
  const setField = (key: keyof Reading, value: Reading[keyof Reading]) => setDraft((c) => ({ ...c, [key]: value }));
  const setTank = (tank: string, key: keyof TankReading, value: number | null) =>
    setDraft((c) => ({ ...c, tanks: c.tanks.map((t) => t.tank === tank ? { ...t, [key]: value } : t) }));

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
