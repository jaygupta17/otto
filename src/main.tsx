import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { isTauri } from "./lib/platform";

// Dev: mirror webview errors/warnings to the `tauri dev` terminal.
if (import.meta.env.DEV && isTauri) {
  void import("@tauri-apps/api/core").then(({ invoke }) => {
    const send = (level: string, args: unknown[]) =>
      void invoke("dev_log", { line: `${level} ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}` }).catch(() => {});
    for (const level of ["error", "warn", "info"] as const) {
      const orig = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        orig(...args);
        send(level, args);
      };
    }
    window.addEventListener("error", (e) => send("uncaught", [e.message]));
    window.addEventListener("unhandledrejection", (e) => send("rejection", [e.reason]));
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
