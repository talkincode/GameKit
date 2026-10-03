import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { resolve } from "node:path";

// The Worker has no bindings that need a Cloudflare login: text and images both go
// through server-held keys, so local dev, preview and CI all run the same code.
export default defineConfig({
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare()],
  resolve: {
    alias: process.env.VITEST
      ? {
          "cloudflare:workers": resolve(import.meta.dirname, "tests/mocks/cloudflare-workers.ts"),
        }
      : {},
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    server: {
      deps: {
        inline: ["@cloudflare/workers-oauth-provider"],
      },
    },
  },
});
