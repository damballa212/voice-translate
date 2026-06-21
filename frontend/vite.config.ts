import { defineConfig } from "vite";

// Proxy opcional hacia tu backend durante `npm run dev`.
// Define la variable de entorno BACKEND (p. ej. BACKEND=http://localhost:8000 npm run dev)
// para enrutar /auth, /ws, /recordings y /export al servidor real.
// Si no defines BACKEND, esas rutas devuelven 404 y la app arranca en MODO DEMO.
const BACKEND = process.env.BACKEND || "";

export default defineConfig({
  server: BACKEND
    ? {
        proxy: {
          "/auth": { target: BACKEND, changeOrigin: true },
          "/recordings": { target: BACKEND, changeOrigin: true },
          "/export": { target: BACKEND, changeOrigin: true },
          "/ws": { target: BACKEND, changeOrigin: true, ws: true },
        },
      }
    : {},
  base: "/",
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
