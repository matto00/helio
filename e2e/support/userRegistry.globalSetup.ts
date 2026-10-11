import { startUserRegistry } from "./userCleanup";

// HEL-1301 — see userCleanup.ts. Runs once, before any worker starts.
export default function globalSetup(): void {
  startUserRegistry();
}
