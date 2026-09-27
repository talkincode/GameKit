import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
