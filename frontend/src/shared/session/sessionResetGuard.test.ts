/**
 * HEL-1634 D5 -- the guard that makes forgetting a per-user cache or storage key fail the tests.
 *
 * STATIC HALF. Scans every non-test file under `frontend/src` for module-level mutable state and
 * browser-storage keys, and requires each to be accounted for, per identifier (`file#identifier`).
 *
 * How registered coverage is collected: the test requires `store/store` (which pulls in most
 * modules) and every file that mentions `registerSessionReset(` or `declareSessionResetCoverage(`,
 * so each module's top-level registration has run, then reads `listSessionResets()` (the `covers`
 * of every hook) and `listDeclaredCoverage()` (identifiers declared by a mechanism that is not a
 * hook, with the `via` that owns them). An identifier is accounted for when it is in that
 * registered coverage or in `MODULE_STATE_NOT_USER_DATA` (with a reason). Every `via` must name a
 * registered hook or a known mechanism (`COVERAGE_MECHANISMS`).
 *
 * Detected shapes (column 0 only): `new Map/Set/WeakMap/WeakSet(`, any top-level `let`,
 * `= create...(` factory singletons, `= new Xxx(`, and `= []` / `= {}`. A declaration whose line
 * says `readonly` / `Readonly` / `as const` / `Object.freeze` is a frozen constant and is skipped,
 * and so are `new Intl.*` and `new RegExp` (immutable value objects).
 * KNOWN LIMIT: a multi-line object or array literal (`= {` / `= [` that continues on the next
 * lines) is NOT detected, nor is state created inside a function or class. The runtime half and the
 * e2e are the net for those.
 *
 * Storage: every `helio.` / `helio-` string literal in a file that mentions `localStorage`,
 * `sessionStorage` or `indexedDB` must be in `STORAGE_KEYS_KEPT` or `STORAGE_KEYS_CLEARED_BY_HOOK`.
 *
 * RUNTIME HALF. Seeds every listed key, dispatches `clearAuth`, then asserts kept keys are
 * untouched, cleared keys are gone and no other key remains.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import { clearAuth } from "../../features/auth/state/authSlice";
import { store } from "../../store/store";
import { COVERAGE_MECHANISMS, listDeclaredCoverage, listSessionResets } from "./sessionReset";
import {
  MODULE_STATE_NOT_USER_DATA,
  STORAGE_KEYS_CLEARED_BY_HOOK,
  STORAGE_KEYS_KEPT,
} from "./sessionStateAllowlist";

const SRC = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "test" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).map((full) => ({ full, rel: relative(SRC, full) }));

const FROZEN = /readonly|Readonly|as const|Object\.freeze/;
const LIBRARY_FACTORIES =
  /^create(Slice|AsyncThunk|Selector|StructuredSelector|Context|Action|Reducer|ListenerMiddleware|EntityAdapter|Root|Element|Ref)\b/;

function firstAssignment(rest: string): number {
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] !== "=") continue;
    if (rest[i + 1] === ">" || rest[i + 1] === "=") {
      i += 1;
      continue;
    }
    if (i > 0 && "=!<>".includes(rest[i - 1])) continue;
    return i;
  }
  return -1;
}

export function detectModuleState(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const m = /^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\b(.*)$/.exec(line);
    if (!m) continue;
    const [, kind, name, rest] = m;
    const eq = firstAssignment(rest);
    const rhs = eq === -1 ? "" : rest.slice(eq + 1).trim();
    if (kind !== "const") {
      found.push(name);
      continue;
    }
    if (FROZEN.test(line) || eq === -1) continue;
    const isCollection = /^new\s+(Map|Set|WeakMap|WeakSet)\b/.test(rhs);
    const isFactory = /^create\w*\(/.test(rhs) && !LIBRARY_FACTORIES.test(rhs);
    const isNew = /^new\s+\w+\(/.test(rhs) && !/^new\s+(Intl\.|RegExp\b)/.test(rhs);
    const isEmptyLiteral = /^(\[\]|\{\})\s*(as\b[^;]*)?;?\s*$/.test(rhs);
    if (isCollection || isFactory || isNew || isEmptyLiteral) found.push(name);
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function detectStorageKeys(source: string): string[] {
  if (!/localStorage|sessionStorage|indexedDB/.test(source)) return [];
  const keys = new Set<string>();
  for (const m of stripComments(source).matchAll(/["'`](helio[.-][A-Za-z0-9._-]*)/g)) {
    keys.add(m[1]);
  }
  return [...keys];
}

// The registrations run at module load, so require every file that registers before reading them.
beforeAll(() => {
  void store;
  for (const { full, rel } of FILES) {
    if (rel.startsWith(join("shared", "session"))) continue;
    const text = readFileSync(full, "utf8");
    if (/registerSessionReset\(|declareSessionResetCoverage\(/.test(text)) {
      require(full);
    }
  }
});

describe("static half", () => {
  test("every module-level mutable identifier is registered or allowlisted with a reason", () => {
    const registered = new Set<string>([
      ...listSessionResets().flatMap((hook) => hook.covers),
      ...listDeclaredCoverage().flatMap((c) => c.identifiers.map((id) => `${c.file}#${id}`)),
    ]);
    const allowed = new Set(MODULE_STATE_NOT_USER_DATA.map((entry) => entry.id));
    const unaccounted: string[] = [];
    for (const { full, rel } of FILES) {
      for (const name of detectModuleState(readFileSync(full, "utf8"))) {
        const id = `${rel.split("\\").join("/")}#${name}`;
        if (!registered.has(id) && !allowed.has(id)) unaccounted.push(id);
      }
    }
    expect(unaccounted).toEqual([]);
  });

  test("every allowlist entry names a reason and a real declaration", () => {
    const detected = new Set<string>();
    for (const { full, rel } of FILES) {
      for (const name of detectModuleState(readFileSync(full, "utf8"))) {
        detected.add(`${rel.split("\\").join("/")}#${name}`);
      }
    }
    const bad = MODULE_STATE_NOT_USER_DATA.filter(
      (entry) => entry.reason.trim().length < 8 || !detected.has(entry.id),
    ).map((entry) => entry.id);
    expect(bad).toEqual([]);
  });

  test("every coverage `via` names a registered hook or a known mechanism", () => {
    const hooks = new Set(listSessionResets().map((hook) => hook.name));
    const bad = listDeclaredCoverage()
      .filter((c) => !hooks.has(c.via) && !COVERAGE_MECHANISMS.includes(c.via))
      .map((c) => `${c.file} via ${c.via}`);
    expect(bad).toEqual([]);
  });

  test("every browser storage key is in a keep list", () => {
    const listed = new Set(
      [...STORAGE_KEYS_KEPT, ...STORAGE_KEYS_CLEARED_BY_HOOK].map((entry) => entry.key),
    );
    const unlisted: string[] = [];
    for (const { full, rel } of FILES) {
      for (const key of detectStorageKeys(readFileSync(full, "utf8"))) {
        if (!listed.has(key)) unlisted.push(`${rel}: ${key}`);
      }
    }
    expect(unlisted).toEqual([]);
  });

  test("every cleared key names a registered hook or a known mechanism", () => {
    const names = new Set([
      ...listSessionResets().map((hook) => hook.name),
      ...COVERAGE_MECHANISMS,
    ]);
    const bad = STORAGE_KEYS_CLEARED_BY_HOOK.filter((e) => !names.has(e.clearedBy ?? "")).map(
      (e) => `${e.key} cleared by ${e.clearedBy}`,
    );
    expect(bad).toEqual([]);
  });

  test("every cleared key names a registered hook or a known mechanism", () => {
    const names = new Set([
      ...listSessionResets().map((hook) => hook.name),
      ...COVERAGE_MECHANISMS,
    ]);
    const bad = STORAGE_KEYS_CLEARED_BY_HOOK.filter((e) => !names.has(e.clearedBy ?? "")).map(
      (e) => `${e.key} cleared by ${e.clearedBy}`,
    );
    expect(bad).toEqual([]);
  });

  test("every storage allowlist entry has a reason, and cleared entries name their hook", () => {
    const bad = [
      ...STORAGE_KEYS_KEPT.filter((e) => e.reason.trim().length < 8),
      ...STORAGE_KEYS_CLEARED_BY_HOOK.filter((e) => e.reason.trim().length < 8 || !e.clearedBy),
    ].map((e) => e.key);
    expect(bad).toEqual([]);
  });

  test("the detector sees each declaration shape", () => {
    const sample = [
      "const a = new Map<string, number>();",
      "let b = 0;",
      "export const c = createFooStore();",
      "const d = new FooClient();",
      "const e: string[] = [];",
      "const f: Record<string, string> = {};",
      "const g: ReadonlyMap<string, string> = new Map();",
      "const h = [] as const;",
      "const i = new Intl.Collator();",
      "let j: (() => void) | null = null;",
      "const k = createSlice({",
    ].join("\n");
    expect(detectModuleState(sample)).toEqual(["a", "b", "c", "d", "e", "f", "j"]);
  });
});

describe("runtime half", () => {
  const storeFor = (kind: "local" | "session" | "indexeddb") =>
    kind === "local" ? window.localStorage : kind === "session" ? window.sessionStorage : null;
  const seedKey = (key: string) => (/[.-]$/.test(key) ? `${key}probe` : key);

  test("sign-out clears the cleared keys, keeps the kept keys, and leaves no other key", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const all = [...STORAGE_KEYS_KEPT, ...STORAGE_KEYS_CLEARED_BY_HOOK];
    for (const entry of all) storeFor(entry.store)?.setItem(seedKey(entry.key), "seeded");
    store.dispatch(clearAuth());
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const entry of STORAGE_KEYS_KEPT) {
      expect([entry.key, storeFor(entry.store)?.getItem(seedKey(entry.key)) ?? "n/a"]).toEqual([
        entry.key,
        storeFor(entry.store) ? "seeded" : "n/a",
      ]);
    }
    for (const entry of STORAGE_KEYS_CLEARED_BY_HOOK) {
      expect([entry.key, storeFor(entry.store)?.getItem(seedKey(entry.key)) ?? null]).toEqual([
        entry.key,
        null,
      ]);
    }
    const expectedLeft = new Set(
      STORAGE_KEYS_KEPT.filter((e) => storeFor(e.store)).map((e) => seedKey(e.key)),
    );
    const left = [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
    ].filter((key) => !expectedLeft.has(key));
    expect(left).toEqual([]);
  });
});
