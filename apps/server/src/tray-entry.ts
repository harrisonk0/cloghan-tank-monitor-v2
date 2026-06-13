import { initTray } from "./tray.js";

initTray().catch((error) => {
  console.error("[tray] Failed to initialize:", error);
  process.exit(1);
});
