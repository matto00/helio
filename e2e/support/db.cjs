// HEL-1301 — the one e2e DB connection: `DATABASE_URL`/`DB_USER`/`DB_PASSWORD` from the environment,
// falling back to the worktree's `backend/.env` (the file the dev backend itself loads), run through
// `psql`. Extracted from historySeed.ts so the throwaway-user cleanup shares it.
//
// Nothing about the connection is ever printed. A failure carries only psql's own stderr, bounded
// and scrubbed of the resolved URL, user and password (psql's execFileSync error message embeds the
// whole argv, i.e. the connection URL, which is why the raw error is never interpolated).

// CommonJS on purpose: Playwright transpiles imports of TS/ESM-syntax files into CJS, which a `.mjs`
// file with `import` statements cannot survive; a `.cjs` module loads identically from the specs'
// TS and from plain `node` (the selftests).
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ENV_FILE = resolve(__dirname, "../../backend/.env");
const MAX_STDERR_CHARS = 600;

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Resolves the connection from the process environment, then `backend/.env`. */
function dbConnection() {
  const file = readEnvFile(ENV_FILE);
  const jdbc = process.env.DATABASE_URL ?? file.DATABASE_URL;
  if (!jdbc) {
    throw new Error("e2e db: DATABASE_URL is unset in the environment and backend/.env");
  }
  const url = jdbc.replace(/^jdbc:/, "");
  const user = process.env.DB_USER ?? file.DB_USER;
  const password = process.env.DB_PASSWORD ?? file.DB_PASSWORD;
  return {
    url,
    secrets: [jdbc, url, user, password],
    env: {
      ...process.env,
      ...(user ? { PGUSER: user } : {}),
      ...(password ? { PGPASSWORD: password } : {}),
    },
  };
}

/** Removes every non-empty secret from `text`; longest first so a URL goes before its parts. */
function scrubSecrets(text, secrets) {
  return [...new Set(secrets.filter((s) => typeof s === "string" && s.length > 0))]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, s) => acc.split(s).join("<redacted>"), String(text));
}

/** Runs `sql` through psql and returns the non-empty output lines. `connection` is injectable for
 *  the leak probe; the default resolves it from the environment. */
function psql(sql, label = "e2e db", connection = dbConnection()) {
  const { url, env, secrets } = connection;
  try {
    const out = execFileSync("psql", ["-q", "-At", "-v", "ON_ERROR_STOP=1", url], {
      input: sql,
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.split("\n").filter((l) => l !== "");
  } catch (e) {
    const stderr = scrubSecrets(typeof e?.stderr === "string" ? e.stderr : "", secrets)
      .trim()
      .slice(0, MAX_STDERR_CHARS);
    const reason =
      e?.code === "ENOENT"
        ? "psql is not installed"
        : stderr || `exit status ${e?.status ?? "unknown"}${e?.code ? ` (${e.code})` : ""}`;
    throw new Error(`${label}: psql failed (is psql installed and the DB reachable?): ${reason}`);
  }
}

module.exports = { dbConnection, scrubSecrets, psql };
