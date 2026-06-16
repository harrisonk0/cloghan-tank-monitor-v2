import type { RefreshStatus, Page } from "../types.js";
import { labelStatus, titleCase } from "../helpers.js";

export default function Header(props: {
  page: Page;
  setPage: (page: Page) => void;
  refreshData: () => void;
  refreshStatus: RefreshStatus;
  refreshMessage: string;
  progress: number;
  isReadOnly: boolean;
  connectionOk: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="site-header">
      <div className="header-top">
        <div className="header-title">
          <span className="eyebrow">Cloghan Terminal</span>
          <h1>Tank Monitor</h1>
        </div>
        <div className="header-actions">
          <span className={`connection-dot ${props.connectionOk ? "connected" : "disconnected"}`} title={props.connectionOk ? "Connected" : "Disconnected"} />
          {props.isReadOnly && <span className="readonly-badge">Read Only</span>}
          {!props.isReadOnly && (
            <button className="primary" onClick={props.refreshData} disabled={props.refreshStatus === "running"}>
              {props.refreshStatus === "running" ? "Extracting\u2026" : "Refresh"}
            </button>
          )}
          <button className="logout-btn" onClick={props.onLogout} title="Logout">{"\u2190"}</button>
        </div>
      </div>
      <div className="status-row">
        <span className={`status-pill ${props.refreshStatus}`}>{labelStatus(props.refreshStatus)}</span>
        <span>{props.refreshMessage}</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={props.progress} aria-valuemin={0} aria-valuemax={100}><div className="progress-fill" style={{ width: `${props.progress}%` }} /></div>
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
