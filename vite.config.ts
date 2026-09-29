import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// The Workers AI binding only exists remotely, so local dev and preview need a
// Cloudflare login. GAMEKIT_NO_REMOTE=1 skips it (E2E, CI, no account): image
// generation then reports "not configured" and everything else still works.
const remoteBindings = process.env.GAMEKIT_NO_REMOTE !== "1";

export default defineConfig({
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare({ remoteBindings })],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
