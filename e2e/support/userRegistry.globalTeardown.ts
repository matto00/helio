import { deleteRecordedUsers } from "./userCleanup";

// HEL-1301 — see userCleanup.ts. Runs once, after every worker finished (pass or fail).
export default function globalTeardown(): void {
  const n = deleteRecordedUsers();
  console.log(`[HEL-1301 e2e] deleted ${n} recorded throwaway user(s)`);
}
