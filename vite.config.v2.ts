import { defineConfig } from "vite";

// Build/dev do cliente v2 (tabuleiro hexagonal, roster de 10 campeões) —
// espelha vite.config.ts (MVP), mas com raiz/saída/porta próprias, pra não
// disputar com o build do MVP (dist/client).
export default defineConfig({
  root: "src/client-v2",
  base: "./",
  build: { outDir: "../../dist/client-v2", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { proxy: { "/ws": { target: "ws://localhost:3001", ws: true } } },
});
