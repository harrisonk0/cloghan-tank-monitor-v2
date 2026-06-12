import notifier from "node-notifier";
import { getSettings } from "./db.js";

type NotificationKind = "success" | "warning" | "failure";

export function notify(kind: NotificationKind, message: string): void {
  const settings = getSettings();
  const settingKey = kind === "success" ? "notifyOnSuccess" : kind === "warning" ? "notifyOnWarning" : "notifyOnFailure";
  if (settings[settingKey] === "false") return;

  try {
    notifier.notify({ title: "Cloghan Tank Monitor", message, wait: false });
  } catch {
    // Notifications are best-effort; API responses and refresh_runs carry the real status.
  }
}
