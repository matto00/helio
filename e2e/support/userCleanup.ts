import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { psql } from "./db.cjs";
import { buildUserDeleteSql, readRegistryDir } from "./userCleanupCore.cjs";

// HEL-1301 — every e2e run deletes the throwaway users it registered, by exact recorded id.
//
// Setup (global) creates a fresh per-run directory and exports its path; every registration appends
// the created user's `{id, email}` (from the 201 response body) to a per-process file in it; teardown
// (global) reads ONLY that directory and deletes exactly those users in one transaction (the pure
// builder is userCleanupCore.cjs, unit-tested by userCleanup.selftest.mjs). No HTTP route, service
// or migration exists for this: it is a test-harness DB path only.

export const REGISTRY_ENV = "E2E_USER_REGISTRY_DIR";
const REGISTRY_ROOT = resolve(__dirname, "../../.e2e-user-registry");

/** The slice of Playwright's `APIResponse` / `Response` this needs (a UI signup yields the latter). */
export interface RegisterResponse {
  status(): number;
  json(): Promise<unknown>;
}

export interface CreatedUser {
  id: string;
  email: string;
}

/** globalSetup: a fresh, empty per-run registry directory; its path goes to the workers via env. */
export function startUserRegistry(): string {
  const dir = resolve(REGISTRY_ROOT, `${Date.now()}-${process.pid}`);
  mkdirSync(REGISTRY_ROOT, { recursive: true });
  mkdirSync(dir); // not recursive: throws if the directory already exists
  if (readdirSync(dir).length !== 0) {
    throw new Error("userCleanup: refusing a non-empty run registry directory");
  }
  process.env[REGISTRY_ENV] = dir;
  return dir;
}

/** Records a user the run just created (call right after the 201). Fails closed: with no registry
 *  there is nowhere to record, and an unrecorded user would be exactly the residue this prevents. */
export function recordCreatedUser(user: CreatedUser): void {
  const dir = process.env[REGISTRY_ENV];
  if (!dir) {
    throw new Error(
      `userCleanup: ${REGISTRY_ENV} is unset - recordCreatedUser must run under the Playwright config (globalSetup)`,
    );
  }
  appendFileSync(
    resolve(dir, `${process.pid}.jsonl`),
    `${JSON.stringify({ id: user.id, email: user.email })}\n`,
  );
}

/** Records the user a register response created: only on 201, from the body's `user`
 *  (`AuthResponse{expiresAt, user}`) - id AND email as the server stored them. A 201 whose body has
 *  no user throws rather than leaving an unrecorded user behind. Returns the recorded user, or
 *  `undefined` for a non-201 (nothing was created, so there is nothing to delete). */
export async function recordRegisteredUser(
  res: RegisterResponse,
): Promise<CreatedUser | undefined> {
  if (res.status() !== 201) return undefined;
  const body = (await res.json()) as { user?: { id?: unknown; email?: unknown } };
  const { id, email } = body.user ?? {};
  if (typeof id !== "string" || typeof email !== "string") {
    throw new Error("userCleanup: a 201 register response carried no user id/email to record");
  }
  recordCreatedUser({ id, email });
  return { id, email };
}

/** globalTeardown: deletes exactly this run's recorded users, then removes the registry directory.
 *  On failure the directory is left in place (the ids stay recoverable by exact value) and it throws. */
export function deleteRecordedUsers(): number {
  const dir = process.env[REGISTRY_ENV];
  if (!dir) return 0;
  const records = readRegistryDir(dir);
  if (records.length > 0) psql(buildUserDeleteSql(records), "userCleanup");
  rmSync(dir, { recursive: true, force: true });
  return records.length;
}
