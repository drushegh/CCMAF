/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

/**
 * Dev only: inject the per-launch token meta into the Vite-served index.html.
 * In production Fastify serves + injects index.html, but in `npm run dev` Vite
 * serves the page, so without this the SPA has no token and write requests 401.
 * scripts/dev.mjs generates CONSOLE_TOKEN and gives the same value to the API.
 */
function injectConsoleToken(): Plugin {
  return {
    name: "inject-console-token",
    transformIndexHtml(html) {
      const token = process.env.CONSOLE_TOKEN;
      if (!token) return html;
      const meta = `<meta name="x-console-token" content="${token}" />`;
      return html.includes("</head>")
        ? html.replace("</head>", `  ${meta}\n</head>`)
        : `${meta}\n${html}`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), injectConsoleToken()],

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },

  server: {
    host: "127.0.0.1",
    port: 6120,
    strictPort: false,
    // Dev: Vite serves the SPA on 6120; the Fastify API runs on 6121
    // (npm run dev launches both). Proxy /api → the API server so the
    // pages fetch real data in dev, exactly as they do in production
    // (where one server serves both). See scripts/dev.mjs.
    proxy: {
      "/api": { target: "http://127.0.0.1:6121", changeOrigin: true },
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Server/verify tests use @vitest-environment node annotation (no jsdom needed)
    environmentMatchGlobs: [
      ["tests/server.test.ts", "node"],
      ["tests/parsers.test.ts", "node"],
      ["tests/verify.test.ts", "node"],
    ],
  },
});
