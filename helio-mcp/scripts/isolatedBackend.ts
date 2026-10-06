/**
 * Launches, identifies and stops a backend JVM for the isolated verify run (HEL-1297).
 *
 * The recorded PID is the server JVM ITSELF (`java -jar helio-backend.jar`), not an `sbt run`
 * wrapper, so stopping that exact PID cannot orphan the server. sbt 2's `export Runtime/fullClasspath`
 * emits virtual `${OUT}`/`${CSR_CACHE}` references that are not usable by `java -cp`, so the prod
 * `assembly` jar (what the Dockerfile ships) is the launch artifact.
 */

import { execFile, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The EFFECTIVE `Compile / run / javaOptions`: the project-level list (backend/build.sbt:107-121) that
 * `Compile / run / javaOptions ++=` builds on, plus that addendum (:224-235), de-duplicated. Matches the
 * Dockerfile ENTRYPOINT's flags (Spark local on Java 21).
 */
export const JAVA_OPTIONS = [
  "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
  "--add-opens=java.base/java.lang=ALL-UNNAMED",
  "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
  "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
  "--add-opens=java.base/java.io=ALL-UNNAMED",
  "--add-opens=java.base/java.net=ALL-UNNAMED",
  "--add-opens=java.base/java.nio=ALL-UNNAMED",
  "--add-opens=java.base/java.util=ALL-UNNAMED",
  "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED",
  "--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED",
  "--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED",
  "--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED",
  "--add-opens=java.nio.channels.spi/sun.nio.ch=ALL-UNNAMED",
  "--add-opens=java.base/sun.util.calendar=ALL-UNNAMED",
];

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Asks the OS for a free ephemeral port (never the lane range); closes it again before returning. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function portAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface Backend {
  pid: number;
  port: number;
  logPath: string;
}

export interface LaunchSpec {
  jar: string;
  port: number;
  logPath: string;
  /** Complete environment for the JVM (backend/.env values plus overrides) — nothing else is inherited. */
  env: Record<string, string>;
}

export function launchBackend(spec: LaunchSpec): Backend {
  const fd = openSync(spec.logPath, "a");
  const child = spawn("nice", ["-n", "19", "java", ...JAVA_OPTIONS, "-jar", spec.jar], {
    env: { ...spec.env, PORT: String(spec.port) },
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  closeSync(fd);
  child.unref();
  if (!child.pid) throw new Error("backend JVM failed to spawn");
  return { pid: child.pid, port: spec.port, logPath: spec.logPath };
}

/** The pid `ss` reports as owning the TCP listener on `port`, or null when it cannot say. */
export async function listenerPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ss", ["-H", "-ltnp", `sport = :${port}`]);
    const m = /pid=(\d+)/.exec(stdout);
    return m?.[1] ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export const readLog = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/**
 * Constraint C3: before ANY write, prove the listener on the port is the recorded JVM — `ss` names
 * the recorded PID, or (when `ss` cannot attribute) its own log printed the listening line for this port.
 */
export async function listenerIsRecordedJvm(b: Backend): Promise<boolean> {
  if (!pidAlive(b.pid)) return false;
  const owner = await listenerPid(b.port);
  if (owner !== null) return owner === b.pid;
  return (
    readLog(b.logPath).includes(`Helio backend listening on /127.0.0.1:${b.port}`) &&
    pidAlive(b.pid)
  );
}

/** Health succeeds only while the recorded PID is alive; bounded, never unbounded. */
export async function waitHealthy(b: Backend, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(b.pid)) throw new Error(`backend JVM ${b.pid} exited before becoming healthy`);
    try {
      const res = await fetch(`http://127.0.0.1:${b.port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`backend did not become healthy on port ${b.port} within ${timeoutMs / 1000}s`);
}

/** SIGTERM the exact recorded PID, wait for it to be gone, escalate to SIGKILL on the same PID. */
export async function stopPid(
  pid: number,
  termWaitMs = 30_000,
  killWaitMs = 10_000,
): Promise<boolean> {
  for (const [signal, waitMs] of [
    ["SIGTERM", termWaitMs],
    ["SIGKILL", killWaitMs],
  ] as const) {
    if (!pidAlive(pid)) break;
    try {
      process.kill(pid, signal);
    } catch {
      break;
    }
    const deadline = Date.now() + waitMs;
    while (pidAlive(pid) && Date.now() < deadline) await sleep(250);
  }
  return !pidAlive(pid);
}

export async function stopBackend(b: Backend): Promise<boolean> {
  return (await stopPid(b.pid)) && !(await portAnswers(b.port));
}
