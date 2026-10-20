// `vite build` copies the developer's .dev.vars into dist/gamekit/.dev.vars.
// Preview reads that file and, when it exists, does not look at process.env,
// so LOCAL_DEV_AUTH and the mock model never reach the Worker. Rewrite it
// from the environment Playwright set for this run.
import { existsSync, writeFileSync } from "node:fs";

const dir = "dist/gamekit";
if (!existsSync(dir)) {
  console.error("preview-vars: dist/gamekit is missing. Run pnpm build first.");
  process.exit(1);
}

const keys = [
  "LOCAL_DEV_AUTH",
  "ACCESS_AUD",
  "ALLOW_GITHUB_USERS",
  "OPENAI_API_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GEMINI_APIKEY",
  "GEMINI_IMAGE_MODEL",
];

const lines = [];
for (const key of keys) {
  const value = process.env[key];
  if (value === undefined) {
    console.error(`preview-vars: ${key} is not set`);
    process.exit(1);
  }
  if (value.includes("'") || value.includes("\n") || value.includes("\r")) {
    console.error(`preview-vars: ${key} cannot be written safely`);
    process.exit(1);
  }
  lines.push(`${key}='${value}'`);
}

writeFileSync(`${dir}/.dev.vars`, `${lines.join("\n")}\n`);
