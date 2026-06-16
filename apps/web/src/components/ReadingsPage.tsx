import { useState } from "react";
import type { Reading, TankReading } from "../types.js";
import { TANKS } from "../types.js";
import { formatDate, formatNumber, formatConfidence } from "../helpers.js";

export default function ReadingsPage({ readings, isReadOnly, onAdd, onEdit, onDelete }: { readings: Reading[]; isReadOnly: boolean; onAdd: () => void; onEdit: (reading: Reading) => void; onDelete: (id?: number) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <section className="panel full-width">
      <div className="section-header">
        <h2>Readings</h2>
        {!isReadOnly && <button className="primary" onClick={onAdd}>Add reading</button>}
      </div>
      <div className="readings-list">
        {!readings.length && <p className="empty-text">No readings yet.</p>}
        {readings.map((r, i) => (
          <ReadingCard
            key={r.id ?? r.capturedAt}
            reading={r}
            previous={readings[i + 1]}
            isExpanded={expanded === r.id}
            isReadOnly={isReadOnly}
            onToggle={() => setExpanded(expanded === r.id ? null : r.id ?? null)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ReadingCard({ reading, previous, isExpanded, isReadOnly, onToggle, onEdit, onDelete }: { reading: Reading; previous?: Reading; isExpanded: boolean; isReadOnly: boolean; onToggle: () => void; onEdit: (r: Reading) => void; onDelete: (id?: number) => void }) {
  const byTank = Object.fromEntries(reading.tanks.map((t) => [t.tank, t]));
  const prevByTank = previous ? Object.fromEntries(previous.tanks.map((t) => [t.tank, t])) : {};
  return (
    <div className={`reading-card ${isExpanded ? "expanded" : ""}`}>
      <button className="reading-card-header" onClick={onToggle} aria-expanded={isExpanded}>
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
                <th>GSV Diff</th>
              </tr>
            </thead>
            <tbody>
              {TANKS.map((tank) => {
                const t = byTank[tank] as TankReading | undefined;
                const prev = prevByTank[tank] as TankReading | undefined;
                const gsvDiff = t?.gsvM3 != null && prev?.gsvM3 != null ? t.gsvM3 - prev.gsvM3 : null;
                return (
                  <tr key={tank}>
                    <td className="tank-id">{tank}</td>
                    <td>{formatNumber(t?.levelMm)}</td>
                    <td>{formatNumber(t?.temperatureC)}</td>
                    <td>{formatNumber(t?.tovM3)}</td>
                    <td>{formatNumber(t?.gsvM3)}</td>
                    <td className={gsvDiff != null && gsvDiff < 0 ? "diff-negative" : ""}>{gsvDiff != null ? `${gsvDiff > 0 ? "+" : ""}${formatNumber(gsvDiff)}` : "\u2014"}</td>
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
          {!isReadOnly && (
            <div className="reading-card-actions">
              <button onClick={() => onEdit(reading)}>Edit</button>
              <button className="danger" onClick={() => onDelete(reading.id)}>Delete</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
