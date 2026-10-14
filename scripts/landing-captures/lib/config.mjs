import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The backend and the Vite dev server the capture runs against. Defaults are the repo's stock local ports; a
// delivery worktree passes its own pinned ports.
export const API_BASE_URL = (process.env.HELIO_API_BASE_URL ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
export const APP_BASE_URL = (process.env.HELIO_BASE_URL ?? "http://localhost:5173").replace(
  /\/+$/,
  "",
);

export const CSRF_HEADER = "X-Helio-Requested-With";

export const SHOTS_DIR = resolve(REPO_ROOT, "frontend/src/landing/shots");
export const RECTS_FILE = resolve(REPO_ROOT, "frontend/src/landing/rects.json");
export const OG_FILE = resolve(REPO_ROOT, "frontend/public/landing/og.jpg");

// All six dashboards share one 10-column ("md") layout so the hotspot rectangles are identical.
export const MD_LAYOUT = [
  [0, 0, 4, 4],
  [4, 0, 6, 4],
  [0, 4, 5, 5],
  [5, 4, 5, 5],
];

// Every tag the pipeline creates resources under, so teardown can name them.
export const TAGS = [
  "landing-mock-launch",
  "landing-mock-revenue",
  "landing-mock-oss",
  "landing-mock-fantasy",
  "landing-mock-news",
  "landing-mock-helio",
];
