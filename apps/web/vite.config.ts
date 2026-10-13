import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const repoRoot = resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  // Same `.env` as the API, so the dev proxy follows its PORT.
  const env = loadEnv(mode, repoRoot, "");
  const apiPort = env["PORT"] || "3001";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": resolve(import.meta.dirname, "src") },
    },
    server: {
      port: 3000,
      strictPort: true,
      // One origin in development too: the SPA calls `/api/...` and Vite
      // forwards it to NestJS. The proxy streams, so server-sent events are
      // not buffered.
      proxy: {
        "/api": { target: `http://localhost:${apiPort}` },
      },
    },
    build: {
      sourcemap: true,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/testing/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
  };
});
