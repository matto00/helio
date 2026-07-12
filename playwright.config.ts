import { defineConfig } from "@playwright/test";

// HEL-287 (httpOnly-cookie session migration) live verification. Assumes the
// frontend (Vite, proxying /api to the backend — same-origin, matching the
// dev `SameSite=Lax` cookie shape in design.md D1) and backend dev servers
// are already running — see scripts/concertino/start-servers.sh, which uses
// these same DEV_PORT / BACKEND_PORT env vars.
const DEV_PORT = process.env.DEV_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "retain-on-failure",
    // Optional escape hatch: point at an already-installed Chromium binary
    // directly (e.g. when a sandboxed CI/dev environment's OS isn't one of
    // Playwright's officially-supported distros and the bundled
    // chromium-headless-shell build isn't published for it). Unset by
    // default everywhere else.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
