/**
 * Postgres plumbing for the isolated verify run (HEL-1297). Everything goes through the `psql` /
 * `createdb` / `dropdb` CLIs — never a `pg` npm dependency (HEL-1204 audit gate). The credentials
 * come from the backend's own `.env` `DATABASE_URL` and are only ever handed to child processes via
 * the environment, never printed.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface DbConn {
  host: string;
  port: string;
  user: string;
  password: string;
  /** The `?user=…&password=…` query string, kept verbatim when the database name is swapped. */
  query: string;
}

/** Parses `backend/.env` the way `build.sbt`'s `loadDotEnv` does (KEY=VALUE, `#` comments). */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

export function readDotEnv(path: string): Record<string, string> {
  return parseDotEnv(readFileSync(path, "utf8"));
}

/** Host/port/credentials out of a JDBC URL (user/password in the query string or userinfo). */
export function parseDatabaseUrl(env: Record<string, string>): DbConn {
  const jdbc = env.DATABASE_URL;
  if (!jdbc?.startsWith("jdbc:postgresql://")) {
    throw new Error("backend/.env must define DATABASE_URL as jdbc:postgresql://host:port/db");
  }
  const url = new URL(jdbc.slice("jdbc:".length));
  const params = url.searchParams;
  return {
    host: url.hostname || "localhost",
    port: url.port || "5432",
    user: params.get("user") ?? (decodeURIComponent(url.username) || env.DB_USER || ""),
    password: params.get("password") ?? (decodeURIComponent(url.password) || env.DB_PASSWORD || ""),
    query: url.search,
  };
}

/** The JDBC URL for the dedicated database: same host and query string, different database name. */
export function dedicatedUrl(conn: DbConn, dbName: string): string {
  return `jdbc:postgresql://${conn.host}:${conn.port}/${dbName}${conn.query}`;
}

function pgEnv(conn: DbConn): Record<string, string> {
  return { PATH: process.env.PATH ?? "", PGPASSWORD: conn.password };
}

function pgArgs(conn: DbConn): string[] {
  return ["-h", conn.host, "-p", conn.port, ...(conn.user ? ["-U", conn.user] : [])];
}

const MAINTENANCE_DB = "postgres";

/** Single-value query; connects to `db` (the dedicated DB, or the maintenance DB for catalog reads). */
export async function psqlValue(conn: DbConn, db: string, sql: string): Promise<string> {
  const { stdout } = await run("psql", ["-X", "-A", "-t", ...pgArgs(conn), "-d", db, "-c", sql], {
    env: pgEnv(conn),
  });
  return stdout.trim();
}

export async function canCreateDb(conn: DbConn): Promise<boolean> {
  const v = await psqlValue(
    conn,
    MAINTENANCE_DB,
    "select rolcreatedb or rolsuper from pg_roles where rolname = current_user",
  );
  return v === "t";
}

export async function createDb(conn: DbConn, name: string): Promise<void> {
  await run("createdb", [...pgArgs(conn), "--maintenance-db", MAINTENANCE_DB, name], {
    env: pgEnv(conn),
  });
}

export async function dbExists(conn: DbConn, name: string): Promise<boolean> {
  // `name` is always the script's own generated `helio_verify_<hex>` — never user input.
  return (
    (await psqlValue(
      conn,
      MAINTENANCE_DB,
      `select count(*) from pg_database where datname = '${name}'`,
    )) !== "0"
  );
}

/** No `WITH (FORCE)`: a still-connected session must fail the drop loudly, not be killed. */
export async function dropDb(conn: DbConn, name: string): Promise<void> {
  await run("dropdb", [...pgArgs(conn), "--maintenance-db", MAINTENANCE_DB, name], {
    env: pgEnv(conn),
  });
}

/** Scan counter on `pipeline_schedules` — every scheduler tick's first query reads it (design D2). */
export function tickCounter(conn: DbConn, db: string): Promise<number> {
  return psqlValue(
    conn,
    db,
    "select coalesce(sum(seq_scan + coalesce(idx_scan, 0)), 0) from pg_stat_user_tables " +
      "where relname = 'pipeline_schedules'",
  ).then(Number);
}

export async function userRowExists(conn: DbConn, db: string, email: string): Promise<boolean> {
  const safe = email.replace(/'/g, "''");
  return (await psqlValue(conn, db, `select count(*) from users where email = '${safe}'`)) === "1";
}
