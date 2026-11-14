import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Le paquet SQLite charge son .wasm par URL relative : ne pas le pré-bundler.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
  clearScreen: false,
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/.claude/**", "**/src-tauri/**"] } },
  test: { environment: "node", exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "src-tauri/**"] },
});
