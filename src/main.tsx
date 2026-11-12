import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isTauri } from "./db";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && !isTauri() && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* sans service worker, l'app marche quand même en ligne */
  });
}
