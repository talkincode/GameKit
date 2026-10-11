import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { checkAssetPacks, packGateFailure } from "./src/lib/assets/check-disk";

/** Refuses to build when a shipped pack fails schema, provenance, or hash checks. */
function assetPackGate(): Plugin {
  return {
    name: "gamekit-asset-pack-gate",
    async buildStart() {
      const failure = packGateFailure(await checkAssetPacks(resolve(import.meta.dirname, "public/asset-packs")));
      if (failure) this.error(failure);
    },
  };
}

// The Worker has no bindings that need a Cloudflare login: text and images both go
// through server-held keys, so local dev, preview and CI all run the same code.
export default defineConfig({
  plugins: process.env.VITEST ? [assetPackGate(), react()] : [assetPackGate(), react(), cloudflare()],
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
