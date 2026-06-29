import { useMemo } from "react";
import type { Reading, RefreshRun, TankName, TankReading } from "../types.js";
import { TANKS, MAX_LEVEL } from "../types.js";
import { formatNumber, formatDate, formatShortDate, formatConfidence, formatDuration } from "../helpers.js";
import ChartPanel from "./ChartPanel.js";

export default function Dashboard({ readings, latest, previous, runs }: { readings: Reading[]; latest?: Reading; previous?: Reading; runs: RefreshRun[] }) {
  const chartData = useMemo(() => readings.slice(0, 30).reverse().map((r) => ({
    time: formatShortDate(r.capturedAt),
    level: r.totalLevelMm ?? 0,
    gsv: r.totalGsvM3 ?? 0,
  })), [readings]);

  const levelDomain = useMemo(() => computeDomain(chartData, "level"), [chartData]);
  const gsvDomain = useMemo(() => computeDomain(chartData, "gsv"), [chartData]);

  if (!latest) {
    return <div className="page-grid"><div className="empty-state">No readings yet. Click Refresh to capture tank data.</div></div>;
  }

  const latestRun = runs[0];

  return (
    <div className="page-grid">
      <TankVisualisations latest={latest} previous={previous} />

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

      <ChartPanel title="Level trend" data={chartData} dataKey="level" stroke="var(--accent-cyan)" suffix=" mm" domain={levelDomain} />
      <ChartPanel title="GSV trend" data={chartData} dataKey="gsv" stroke="var(--accent-green)" suffix=" m\u00B3" domain={gsvDomain} />
    </div>
  );
}

function TankVisualisations({ latest, previous }: { latest: Reading; previous?: Reading }) {
  return (
    <section className="tanks-visual">
      <div className="tanks-visual-header">
        <h2>Tank levels</h2>
        <span className="eyebrow">{formatDate(latest.capturedAt)}</span>
      </div>
      <div className="tanks-grid">
        {TANKS.map((tank) => {
          const t = latest.tanks.find((item) => item.tank === tank);
          const prev = previous?.tanks.find((item) => item.tank === tank);
          return <TankViz key={tank} tank={tank} reading={t} previous={prev} />;
        })}
      </div>
    </section>
  );
}

function TankViz({ tank, reading, previous }: { tank: TankName; reading?: TankReading; previous?: TankReading }) {
  const level = reading?.levelMm;
  const fillPct = level != null ? Math.min((level / MAX_LEVEL) * 100, 100) : 0;
  const gsvDiff = reading?.gsvM3 != null && previous?.gsvM3 != null ? reading.gsvM3 - previous.gsvM3 : null;

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
          <span className="tank-viz-meta-value">
            {reading?.gsvM3 != null ? `${formatNumber(reading.gsvM3)} m\u00B3` : "\u2014"}
            {gsvDiff != null && <span className={`gsv-diff ${gsvDiff < 0 ? "negative" : ""}`}> {gsvDiff > 0 ? "+" : ""}{formatNumber(gsvDiff)}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function computeDomain(data: Array<Record<string, string | number>>, key: string): [number, number] {
  const values = data.map((d) => Number(d[key])).filter((v) => Number.isFinite(v) && v !== 0);
  if (values.length === 0) return [0, 100];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.15 || 10;
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}
