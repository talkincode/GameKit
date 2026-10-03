import { defineConfig, devices } from "@playwright/test";

// E2E runs against the production build (`pnpm build` first) served by
// `vite preview`, which runs the real Worker in workerd.
//
// Identity uses the local sign-in form (LOCAL_DEV_AUTH=1 on localhost); the
// text model is tests/e2e/mock-model.mjs. No Cloudflare account is needed.
const MODEL_PORT = 4199;
export const ALLOWED_EMAIL = "kid@example.com";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 860 } } }],
  webServer: [
    {
      command: "node tests/e2e/mock-model.mjs",
      url: `http://127.0.0.1:${MODEL_PORT}/__health`,
      env: { MOCK_MODEL_PORT: String(MODEL_PORT) },
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: false,
      env: {
        CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
        LOCAL_DEV_AUTH: "1",
        ACCESS_AUD: "",
        ALLOW_GITHUB_USERS: ALLOWED_EMAIL,
        OPENAI_API_URL: `http://127.0.0.1:${MODEL_PORT}`,
        OPENAI_API_KEY: "e2e-key",
        OPENAI_MODEL: "e2e-model",
        // Image generation is stubbed at the network boundary in assets.spec.ts:
        // the page's own pipeline runs, the provider does not.
        GEMINI_APIKEY: "e2e-gemini-key",
        GEMINI_IMAGE_MODEL: "models/e2e-image",
      },
    },
  ],
});
