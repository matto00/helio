#!/usr/bin/env node
// HEL-1802 self-test for scripts/prune-orphan-conversation-folders.mjs. No database: the query is
// injected; the CLI-level cases use an unreachable URL carrying a sentinel password. Temp dirs only.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = process.env.HEL1802_PRUNE_PATH
  ? resolve(process.env.HEL1802_PRUNE_PATH)
  : join(here, "prune-orphan-conversation-folders.mjs");
const mod = await import(pathToFileURL(scriptPath).href).catch((e) => ({ importError: String(e) }));

let passed = 0;
let failed = 0;
function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const PRESENT = "11111111-1111-4111-8111-111111111111";
const IN_SECOND_DB = "22222222-2222-4222-8222-222222222222";
const ORPHAN = "33333333-3333-4333-8333-333333333333";
const ORPHAN2 = "44444444-4444-4444-8444-444444444444";

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      out.push(p);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort().join("\n");
}

const root = mkdtempSync(join(tmpdir(), "hel1802-prune-"));
try {
  const conv = join(root, "assistant-conversations");
  mkdirSync(conv);
  for (const id of [PRESENT, IN_SECOND_DB, ORPHAN, ORPHAN2]) {
    mkdirSync(join(conv, id));
    writeFileSync(join(conv, id, "c.json"), "{}");
  }
  mkdirSync(join(conv, "not-a-uuid"));
  writeFileSync(join(conv, "stray.txt"), "x");
  const outside = mkdtempSync(join(tmpdir(), "hel1802-outside-"));
  symlinkSync(outside, join(conv, "55555555-5555-4555-8555-555555555555"));
  mkdirSync(join(root, "images"));
  writeFileSync(join(root, "images", "a.png"), "x");

  const dbA = async (ids) => new Set(ids.filter((i) => i === PRESENT));
  const dbB = async (ids) => new Set(ids.filter((i) => i === IN_SECOND_DB));
  const before = snapshot(root);

  const dry = await mod.prune?.({ uploadsRoot: root, queries: [dbA, dbB], doDelete: false });
  record(
    "dry run lists exactly the two orphans",
    dry && JSON.stringify([...dry.orphans].sort()) === JSON.stringify([ORPHAN, ORPHAN2].sort()),
    JSON.stringify(dry),
  );
  record(
    "dry run counts kept, skipped and deleted=0",
    dry && dry.kept === 2 && dry.skipped === 3 && dry.deleted === 0,
    JSON.stringify(dry),
  );
  record(
    "dry run reports how many users each database matched (counts only)",
    dry && JSON.stringify(dry.matchedPerDatabase) === JSON.stringify([1, 1]),
    JSON.stringify(dry),
  );
  record("dry run changes nothing on disk", snapshot(root) === before);
  record(
    "a user present only in the second database is not an orphan",
    dry && !dry.orphans.includes(IN_SECOND_DB),
  );

  let threw = false;
  try {
    await mod.prune({
      uploadsRoot: root,
      queries: [
        dbA,
        async () => {
          throw new Error("db down");
        },
      ],
      doDelete: true,
    });
  } catch {
    threw = true;
  }
  record(
    "an unreadable database fails closed: throws and deletes nothing",
    threw && snapshot(root) === before,
  );

  const sum = mod.formatSummary?.(dry) ?? "";
  record(
    "summary is counts only",
    /orphans=2 kept=2 skipped=3 deleted=0/.test(sum) &&
      !sum.includes(ORPHAN) &&
      !sum.includes(root),
    sum,
  );

  const real = await mod.prune?.({ uploadsRoot: root, queries: [dbA, dbB], doDelete: true });
  record("delete removes exactly the orphans", real && real.deleted === 2, JSON.stringify(real));
  record(
    "orphans are gone; present, second-db, skipped, symlink target and other families are intact",
    !existsSync(join(conv, ORPHAN)) &&
      !existsSync(join(conv, ORPHAN2)) &&
      existsSync(join(conv, PRESENT, "c.json")) &&
      existsSync(join(conv, IN_SECOND_DB, "c.json")) &&
      existsSync(join(conv, "not-a-uuid")) &&
      existsSync(join(conv, "stray.txt")) &&
      existsSync(outside) &&
      existsSync(join(root, "images", "a.png")),
  );
  rmSync(outside, { recursive: true, force: true });

  // --- CLI ---------------------------------------------------------------------------------
  const SENTINEL = "hel1802sentinelpw";
  const url = `postgresql://u:${SENTINEL}@127.0.0.1:1/hel1802sentineldb`;
  const cli = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [scriptPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, PGCONNECT_TIMEOUT: "3", ...extraEnv },
    });
  const noRoot = cli(["--database-url", url]);
  record("CLI requires --uploads-root", noRoot.status !== 0 && /uploads-root/.test(noRoot.stderr));
  const noDb = cli(["--uploads-root", root]);
  record(
    "CLI requires at least one --database-url",
    noDb.status !== 0 && /database/.test(noDb.stderr),
  );
  const relRoot = cli(["--uploads-root", "relative/path", "--database-url", url]);
  record("CLI refuses a relative uploads root", relRoot.status !== 0);
  const before2 = snapshot(root);
  const down = cli(["--uploads-root", root, "--database-url", url, "--delete"]);
  record(
    "CLI with an unreachable database exits non-zero, lists no orphan, deletes nothing",
    down.status !== 0 &&
      snapshot(root) === before2 &&
      !down.stdout.includes("assistant-conversations"),
    `${down.status} ${down.stdout}`,
  );
  record(
    "CLI never prints the connection string or password",
    ![SENTINEL, "sentineldb"].some((x) => down.stdout.includes(x) || down.stderr.includes(x)),
    down.stderr,
  );

  // --- HEL-1817: credentials from DB_USER / DB_PASSWORD, via a fake psql on PATH -------------------
  const shimDir = mkdtempSync(join(tmpdir(), "hel1817-shim-"));
  try {
    const seen = join(shimDir, "seen.txt");
    const USER_S = "hel1817sentineluser";
    const PASS_S = "hel1817sentinelpass";
    const shim = join(shimDir, "psql");
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        'if [ "$PGUSER" = "$HEL1817_EXPECT_USER" ]; then u=true; else u=false; fi',
        'if [ "$PGPASSWORD" = "$HEL1817_EXPECT_PASS" ]; then p=true; else p=false; fi',
        'echo "user=$u pass=$p" >> "$HEL1817_SEEN"',
        'if [ "$HEL1817_MODE" = "fail" ]; then',
        '  echo "FATAL: auth failed for $PGUSER with $PGPASSWORD" >&2',
        "  exit 2",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
    const credUrl = "postgresql://127.0.0.1:1/hel1817credentialless";
    const runShim = (mode, withCreds = true) =>
      cli(["--uploads-root", root, "--database-url", credUrl], {
        PATH: `${shimDir}:${process.env.PATH}`,
        HEL1817_SEEN: seen,
        HEL1817_MODE: mode,
        HEL1817_EXPECT_USER: USER_S,
        HEL1817_EXPECT_PASS: PASS_S,
        ...(withCreds ? { DB_USER: USER_S, DB_PASSWORD: PASS_S } : {}),
      });
    const readSeen = () => (existsSync(seen) ? readFileSync(seen, "utf8") : "");
    const okRun = runShim("ok");
    record(
      "CLI maps DB_USER/DB_PASSWORD to PGUSER/PGPASSWORD for the psql it spawns",
      okRun.status === 0 && readSeen().includes("user=true pass=true"),
      `${okRun.status} ${okRun.stderr} seen=${readSeen()}`,
    );
    const outOk = okRun.stdout + okRun.stderr;
    record(
      "CLI success output never contains the credentials or the URL",
      ![USER_S, PASS_S, credUrl, "credentialless"].some((x) => outOk.includes(x)),
      outOk,
    );
    rmSync(seen, { force: true });
    const failRun = runShim("fail");
    const outFail = failRun.stdout + failRun.stderr;
    record(
      "CLI failure output redacts DB_USER, DB_PASSWORD and the URL",
      failRun.status !== 0 &&
        outFail.includes("<redacted>") &&
        ![USER_S, PASS_S, credUrl, "credentialless"].some((x) => outFail.includes(x)),
      outFail,
    );
    rmSync(seen, { force: true });
    runShim("ok", false);
    record(
      "CLI without DB_USER/DB_PASSWORD passes no credential through",
      readSeen().includes("user=false pass=false"),
      readSeen(),
    );
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
