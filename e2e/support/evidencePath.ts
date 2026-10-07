import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// HEL-1363: the one place an e2e spec may resolve an evidence-file path. The root is computed
// from this file's own location (never process.cwd()), so the file lands in the worktree that
// is running the spec, under a gitignored directory outside openspec/.
const WORKTREE_ROOT = resolve(__dirname, "../..");
const TICKET_RE = /^HEL-\d+$/;
const FILE_RE = /^[A-Za-z0-9._-]+$/;

export function evidencePath(ticket: string, file: string): string {
  if (!TICKET_RE.test(ticket)) {
    throw new Error(`evidencePath: invalid ticket id ${JSON.stringify(ticket)}`);
  }
  if (!FILE_RE.test(file) || file === "." || file === "..") {
    throw new Error(`evidencePath: invalid file name ${JSON.stringify(file)}`);
  }
  const dir = resolve(WORKTREE_ROOT, "e2e-evidence", ticket);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, file);
}
