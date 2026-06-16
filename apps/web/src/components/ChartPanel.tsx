import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function ChartPanel({ title, data, dataKey, stroke, suffix }: { title: string; data: Array<Record<string, string | number>>; dataKey: string; stroke: string; suffix: string }) {
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
