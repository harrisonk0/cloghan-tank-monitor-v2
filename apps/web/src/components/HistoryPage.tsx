import type { RefreshRun } from "../types.js";
import { formatDate, formatConfidence, formatDuration } from "../helpers.js";

export default function HistoryPage({ runs }: { runs: RefreshRun[] }) {
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
