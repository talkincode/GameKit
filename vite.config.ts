import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// The Worker has no bindings that need a Cloudflare login: text and images both go
// through server-held keys, so local dev, preview and CI all run the same code.
export default defineConfig({
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
