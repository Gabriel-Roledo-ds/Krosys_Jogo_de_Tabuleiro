import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  base: "./",
  build: { outDir: "../../dist/client", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { proxy: { "/ws": { target: "ws://localhost:3000", ws: true } } },
});
