/**
 * Isolated verify run (HEL-1297): the existing harness against a backend on a dedicated, uniquely named
 * database no other backend connects to, so no other backend's retention purge can thin the 30-point
 * history read. See openspec/changes/deterministic-verify-history-read/design.md D1–D5.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canCreateDb,
  createDb,
  dbExists,
  dedicatedUrl,
  dropDb,
  parseDatabaseUrl,
  readDotEnv,
  tickCounter,
  userRowExists,
  type DbConn,
} from "./isolatedDb.js";
import {
  launchBackend,
  listenerIsRecordedJvm,
  pidAlive,
  portAnswers,
  readLog,
  sleep,
  stopBackend,
  stopPid,
  waitHealthy,
  freePort,
  type Backend,
} from "./isolatedBackend.js";
import { mintBootstrapPat, register, revokePat, type Bootstrap } from "./isolatedAuth.js";

export interface IsolatedOptions {
  /** helio worktree root (holds `backend/`). */
  repoRoot: string;
  /** `helio-mcp/` root (holds `scripts/verify.ts`, `dist/`). */
  mcpRoot: string;
  healthTimeoutMs?: number;
  /** Bound on the wait for the startup retention pass to complete (design D2). */
  startupPassTimeoutMs?: number;
  /** Bound on dropdb retries against Postgres session-exit lag. */
  dropRetryMs?: number;
  tickSeconds?: number;
  /** Test seam for the identity guard (design D3); defaults to the real `psql` user-row check. */
  userRowCheck?: (conn: DbConn, db: string, email: string) => Promise<boolean>;
}

/** Local wall-clock `HH:MM:SS.mmm`, the format of the backend's log lines, so purge lines can be placed in the window. */
function localClock(): string {
  const d = new Date();
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** A jar older than the newest backend source silently verifies old code; warn (not refuse) so the run stays usable. */
function warnIfStaleJar(jar: string, srcDir: string): void {
  const newest = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce((max, e) => {
      const p = join(dir, e.name);
      return Math.max(max, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
    }, 0);
  if (newest(srcDir) > statSync(jar).mtimeMs) {
    process.stderr.write(
      `WARNING: ${jar} is older than backend/src/main — run \`sbt assembly\` to verify current code\n`,
    );
  }
}

const TICK_FAIL_MARK = "PipelineSchedulerService.tick() failed";

export async function runIsolated(opts: IsolatedOptions): Promise<number> {
  const log = (line: string): void => void process.stdout.write(`${line}\n`);
  const runId = randomBytes(4).toString("hex");
  const dbName = `helio_verify_${randomBytes(6).toString("hex")}`;
  const workDir = join(tmpdir(), `helio-verify-isolated-${runId}`);
  const ledgerPath = join(workDir, "ledger.txt");
  const uploadsDir = join(workDir, "uploads");
  const backendLog = join(workDir, "backend.log");
  const ledger = (line: string): void => {
    log(`LEDGER ${line}`);
    appendFileSync(ledgerPath, `${line}\n`);
  };

  const env = readDotEnv(join(opts.repoRoot, "backend", ".env"));
  const conn = parseDatabaseUrl(env);
  const jar = join(opts.repoRoot, "backend", "target", "scala-2.13", "helio-backend.jar");
  if (!existsSync(jar))
    throw new Error(`${jar} missing — run \`cd backend && sbt assembly\` first`);
  warnIfStaleJar(jar, join(opts.repoRoot, "backend", "src", "main"));
  if (!existsSync(join(opts.mcpRoot, "dist", "index.js"))) {
    throw new Error("helio-mcp/dist missing — run `npm run build` in helio-mcp first");
  }
  if (!(await canCreateDb(conn))) {
    throw new Error("the backend/.env database role lacks CREATEDB; the isolated run needs it");
  }

  mkdirSync(uploadsDir, { recursive: true });
  appendFileSync(ledgerPath, "");
  log(`isolated verify run ${runId}; ledger file: ${ledgerPath}`);

  const state: {
    dbCreated: boolean;
    backend: Backend | null;
    bootstrap: Bootstrap | null;
    harness: ChildProcess | null;
  } = { dbCreated: false, backend: null, bootstrap: null, harness: null };
  let tornDown: Promise<string[]> | null = null;

  const teardown = (): Promise<string[]> => {
    tornDown ??= (async () => {
      const failures: string[] = [];
      const { backend, bootstrap, harness } = state;
      if (harness?.pid) {
        if (await stopPid(harness.pid, 10_000, 5_000)) log(`  stopped harness pid ${harness.pid}`);
        else failures.push(`harness pid ${harness.pid} still running`);
      }
      if (bootstrap && backend) {
        if (pidAlive(backend.pid)) {
          const f = await revokePat(`http://127.0.0.1:${backend.port}`, bootstrap).catch(
            (e: Error) => `bootstrap PAT ${bootstrap.patId}: ${e.message}`,
          );
          if (f) failures.push(f);
          else log(`  revoked bootstrap PAT ${bootstrap.patId} (confirmed 401)`);
        } else {
          // C4: the JVM is already dead; the PAT dies with the dropped database, not an unconfirmed removal.
          log(
            `  bootstrap PAT ${bootstrap.patId}: JVM already dead — moot (database is dropped below)`,
          );
        }
      }
      if (backend) {
        if (await stopBackend(backend))
          log(`  stopped backend JVM pid ${backend.pid} (port ${backend.port} no longer answers)`);
        else
          failures.push(
            `backend JVM pid ${backend.pid} (port ${backend.port}) still running/answering`,
          );
      }
      if (state.dbCreated)
        failures.push(...(await dropDedicated(conn, dbName, opts.dropRetryMs ?? 20_000, log)));
      rmSync(uploadsDir, { recursive: true, force: true });
      if (existsSync(uploadsDir)) failures.push(`uploads dir ${uploadsDir} still exists`);
      return failures;
    })();
    return tornDown;
  };

  let interrupted: string | null = null;
  const onSignal = (sig: "SIGINT" | "SIGTERM"): void => {
    interrupted ??= sig;
    log(`${sig} received — tearing down`);
    void teardown().then((f) => {
      for (const x of f) process.stderr.write(`TEARDOWN FAILED: ${x}\n`);
      process.exit(f.length > 0 ? 1 : sig === "SIGINT" ? 130 : 143);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let harnessCode = 1;
  try {
    ledger(`database ${dbName} (host ${conn.host}:${conn.port})`);
    ledger(`uploads dir ${uploadsDir}`);
    await createDb(conn, dbName);
    state.dbCreated = true;

    const port = await freePort();
    if (await portAnswers(port))
      throw new Error(`port ${port} already answers — refusing to start`);
    state.backend = launchBackend({
      jar,
      port,
      logPath: backendLog,
      env: backendEnv(env, conn, dbName, uploadsDir, opts.tickSeconds ?? 5),
    });
    const backend = state.backend;
    ledger(`backend JVM pid ${backend.pid} port ${port} log ${backendLog}`);
    await waitHealthy(backend, opts.healthTimeoutMs ?? 240_000);
    log(`backend healthy on port ${port}`);
    await waitStartupPass(conn, dbName, backend, opts.startupPassTimeoutMs ?? 180_000, log);

    // C3: prove the listener is the recorded JVM before any write, including register.
    if (!(await listenerIsRecordedJvm(backend))) {
      throw new Error(
        `listener on port ${port} is not the recorded JVM ${backend.pid} — aborting before any write`,
      );
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    const email = `verify-${runId}@helio-verify.invalid`;
    const reg = await register(baseUrl, email, randomBytes(12).toString("hex"));
    ledger(`user ${reg.userId} ${email}`);
    const check = opts.userRowCheck ?? userRowExists;
    if (!(await check(conn, dbName, email))) {
      throw new Error(
        `user ${email} not found in dedicated database ${dbName} — wrong backend answered; aborting`,
      );
    }
    const pat = await mintBootstrapPat(baseUrl, reg.cookie, runId);
    state.bootstrap = {
      email,
      userId: reg.userId,
      cookie: reg.cookie,
      patId: pat.id,
      pat: pat.token,
    };
    ledger(`bootstrap PAT ${pat.id}`);
    log(`harness window start ${localClock()}`);
    harnessCode = await runHarness(opts.mcpRoot, baseUrl, pat.token, state, ledger);
    log(`harness window end ${localClock()} exit ${harnessCode}`);
  } catch (err) {
    process.stderr.write(`isolated verify failed: ${(err as Error).message}\n`);
  }

  const failures = await teardown();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  for (const f of failures) process.stderr.write(`TEARDOWN FAILED: ${f}\n`);
  if (interrupted) return 1;
  if (failures.length > 0) return 1;
  log(
    harnessCode === 0
      ? "ISOLATED VERIFY OK (teardown confirmed)"
      : `isolated verify exit ${harnessCode}`,
  );
  return harnessCode;
}

export function backendEnv(
  dotEnv: Record<string, string>,
  conn: DbConn,
  dbName: string,
  uploadsDir: string,
  tickSeconds: number,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const base = { ...dotEnv };
  delete base.HELIO_HTTP_PORT;
  delete base.HELIO_UPLOADS_DIR;
  return {
    ...base,
    PATH: process.env.PATH ?? "",
    DATABASE_URL: dedicatedUrl(conn, dbName),
    HELIO_HTTP_HOST: "127.0.0.1",
    HELIO_UPLOADS_ROOT: uploadsDir,
    // The one startup pass is the only pass in the run; a busy/failed one must not re-arm inside it (D1/D2).
    OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES: "1440",
    OUTPUT_HISTORY_LOCK_RETRY_SECONDS: "86400",
    SCHEDULER_TICK_INTERVAL_SECONDS: String(tickSeconds),
    // The throwaway backend has one user: lift the per-user budgets so the harness's 30 runs are never
    // met by a 429 whose Retry-After outlasts the MCP client's 60s request timeout (seen in the dropfail demo).
    PIPELINE_RUN_RATE_LIMIT_PER_WINDOW: "100000",
    RATE_LIMIT_REQUESTS_PER_WINDOW: "100000",
    ...overrides,
  };
}

/** Design D2: proceed only after a SECOND scheduler tick is observed, which proves the first tick's pass finished. */
async function waitStartupPass(
  conn: DbConn,
  db: string,
  backend: Backend,
  timeoutMs: number,
  log: (l: string) => void,
): Promise<void> {
  const v0 = await tickCounter(conn, db);
  log(`  D2: pipeline_schedules scan counter at first health v0=${v0}; waiting for >= ${v0 + 2}`);
  const deadline = Date.now() + timeoutMs;
  let last = v0;
  while (Date.now() < deadline) {
    if (!pidAlive(backend.pid))
      throw new Error(`backend JVM ${backend.pid} died during the startup-pass wait`);
    if (readLog(backend.logPath).includes(TICK_FAIL_MARK)) {
      throw new Error(
        `backend log shows '${TICK_FAIL_MARK}' — cannot prove the startup pass finished`,
      );
    }
    const v = await tickCounter(conn, db);
    if (v !== last)
      log(`  D2: ${new Date().toISOString()} counter=${v} (v0${v - v0 >= 0 ? "+" : ""}${v - v0})`);
    last = v;
    if (v >= v0 + 2) {
      log("  D2: second scheduler tick observed — startup retention pass completed");
      return;
    }
    await sleep(1000);
  }
  throw new Error(
    `startup retention pass not proven complete within ${timeoutMs / 1000}s (counter stayed < v0+2)`,
  );
}

function runHarness(
  mcpRoot: string,
  baseUrl: string,
  pat: string,
  state: { harness: ChildProcess | null },
  ledger: (l: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(join(mcpRoot, "node_modules", ".bin", "tsx"), ["scripts/verify.ts"], {
      cwd: mcpRoot,
      env: { PATH: process.env.PATH ?? "", HELIO_API_BASE_URL: baseUrl, HELIO_PAT: pat },
      stdio: "inherit",
    });
    state.harness = child;
    ledger(`harness pid ${child.pid}`);
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/** Drops the dedicated DB by its exact recorded name; bounded retry for session-exit lag; confirms absence. */
async function dropDedicated(
  conn: DbConn,
  dbName: string,
  retryMs: number,
  log: (l: string) => void,
): Promise<string[]> {
  const deadline = Date.now() + retryMs;
  let lastErr = "";
  for (;;) {
    try {
      await dropDb(conn, dbName);
      break;
    } catch (e) {
      lastErr = (e as Error).message.split("\n")[0] ?? "";
      if (!(await dbExists(conn, dbName).catch(() => true))) break;
      if (Date.now() >= deadline) break;
      await sleep(1000);
    }
  }
  if (await dbExists(conn, dbName).catch(() => true)) {
    return [`database ${dbName}: could not confirm it was dropped (${lastErr})`];
  }
  log(`  dropped database ${dbName} (confirmed absent from pg_database)`);
  return [];
}
