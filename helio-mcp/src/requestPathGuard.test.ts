/**
 * GUARD (HEL-1160, widened by HEL-1161) -- static scans over helio-mcp/src (tests, `testing/`,
 * `__golden__/` and `contextBudgetFixture.ts` excluded). Three checks:
 *
 * - (existing) every `${...}` inside an `/api/` request-path template is a `pathSegment(...)` call, so
 *   a raw id never reaches a path;
 * - (a) no request URL is built by joining a base/prefix variable with a path: a template with an
 *   interpolation before its first `/api/`, a `fetch(` whose argument is bare interpolations, or a `+`
 *   joining a non-literal operand to a `/api...` string literal. Such a URL bypasses the prefix and
 *   origin checks of `buildRequestUrl`;
 * - (b) every `fetch(` call is on a short allow-list, and the two that build URLs pass the result of
 *   `buildRequestUrl(...)`.
 *
 * Both matchers are pure functions run against inline fixtures first, so a matcher that silently stops
 * matching fails the suite instead of passing vacuously.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = __dirname;
const EXCLUDED_DIRS = new Set(["testing", "__golden__"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return EXCLUDED_DIRS.has(name) ? [] : sourceFiles(full);
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) return [];
    if (name === "contextBudgetFixture.ts") return [];
    return [full];
  });
}

/** Template literals whose text starts with `/api/` (no nested backticks inside the expressions). */
const TEMPLATE = /`\/api\/[^`]*`/g;
/** Any template literal (no nested backticks inside the expressions). */
const ANY_TEMPLATE = /`(?:[^`\\]|\\.)*`/g;

/** The `${...}` expressions of one template literal, and the literal text left once they are removed. */
function parts(template: string): { exprs: string[]; text: string } {
  const exprs: string[] = [];
  let text = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "$" && template[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < template.length && depth > 0) {
        if (template[j] === "{") depth++;
        else if (template[j] === "}") depth--;
        j++;
      }
      exprs.push(template.slice(i + 2, j - 1).trim());
      i = j;
    } else {
      text += template[i];
      i++;
    }
  }
  return { exprs, text };
}

function expressions(template: string): string[] {
  return parts(template).exprs;
}

/** Check (a): request URLs built by joining a base/prefix with a path. Returns the offending snippets. */
export function findJoinedRequestUrls(src: string): string[] {
  const hits: string[] = [];
  // (a1) an interpolation BEFORE the first `/api/` of a template.
  for (const m of src.matchAll(ANY_TEMPLATE)) {
    const idx = m[0].indexOf("/api/");
    if (idx >= 0 && m[0].slice(0, idx).includes("${")) hits.push(m[0]);
  }
  // (a2) `fetch(` whose first argument is a template of two or more bare interpolations.
  for (const m of src.matchAll(/\bfetch\(\s*(`(?:[^`\\]|\\.)*`)/g)) {
    const { exprs, text } = parts((m[1] ?? "").slice(1, -1));
    if (exprs.length >= 2 && text === "") hits.push(m[0]);
  }
  // (a3) `+` between a `/api...` string literal and a non-literal operand, either side.
  for (const m of src.matchAll(/["']\/api[^"'\n]*["']\s*\+\s*[A-Za-z_$(]/g)) hits.push(m[0]);
  for (const m of src.matchAll(/[A-Za-z0-9_$)\]]\s*\+\s*["']\/api/g)) hits.push(m[0]);
  return hits;
}

/** Check (b): the literal token `fetch(` (no whitespace: a `\s*` form matches prose in comments). */
export function findFetchCalls(src: string): string[] {
  return [...src.matchAll(/(?<![\w$])fetch\(([^\n]*)/g)].map((m) => m[1] ?? "");
}

// Measured after implementation (62 helioApi + 1 familyClient).
// The existing check's floor: it must keep scanning at least the sites HEL-1160 found.
const MIN_SITES = 63;
// Check (b)'s floor: exactly the three known `fetch(` sites.
const FETCH_SITES = [
  "httpClient.ts",
  path.join("oauth", "familyClient.ts"),
  path.join("oauth", "patCheck.ts"),
];

describe("GUARD: request paths interpolate only pathSegment(...)", () => {
  const found = sourceFiles(SRC).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(TEMPLATE)].flatMap((t) =>
      expressions(t[0]).map((expr) => ({ file: path.relative(SRC, file), expr })),
    ),
  );

  it("scans enough sites to not be vacuous", () => {
    expect(found.length).toBeGreaterThanOrEqual(MIN_SITES);
    expect(found.length).toBeGreaterThan(0);
  });

  it("has no raw interpolation in an /api/ template", () => {
    const raw = found.filter((f) => !f.expr.startsWith("pathSegment("));
    expect(raw).toEqual([]);
  });
});

describe("GUARD (a): no request URL joins a base with a path", () => {
  it.each([
    "fetch(`${this.apiBaseUrl}${path}`, {",
    "fetch(`${apiBaseUrl}/api/tokens`, {",
    "const u = `${prefix}/api/x/${id}`;",
    'const u = base + "/api/x";',
    "const u = '/api/x/' + id;",
    "const u = this.apiBaseUrl + path + '/api/y';",
  ])("matcher flags %s", (snippet) => {
    expect(findJoinedRequestUrls(snippet).length).toBeGreaterThan(0);
  });

  it.each([
    // The real tools/write.ts shape: string literal + string literal-with-/api + template with ${}.
    [
      'description:\n  "FULL-REPLACEMENT update (PATCH " +\n  "/api/data-sources/:id/schema) — any field " +\n  `DROPPED. MUST be one of the ${CANONICAL_COLUMN_TYPES_LIST} ` +\n  "canonical types. "',
    ],
    ["const p = `/api/x/${pathSegment(id)}`;"],
  ])("matcher does not flag %s", (snippet) => {
    expect(findJoinedRequestUrls(snippet)).toEqual([]);
  });

  it("finds none across the real source set", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      findJoinedRequestUrls(readFileSync(file, "utf8")).map(
        (h) => `${path.relative(SRC, file)}: ${h}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("GUARD (b): fetch( is allow-listed and fed by buildRequestUrl", () => {
  it("matcher finds a fetch( and ignores prose and fetchImpl", () => {
    expect(findFetchCalls("await fetch(url, {")).toEqual(["url, {"]);
    expect(findFetchCalls("call fetch (the api) and this.deps.fetchImpl(url)")).toEqual([]);
  });

  const withFetch = sourceFiles(SRC)
    .map((file) => ({ rel: path.relative(SRC, file), src: readFileSync(file, "utf8") }))
    .filter((f) => findFetchCalls(f.src).length > 0);

  it("only the three known files call fetch(", () => {
    expect(withFetch.map((f) => f.rel).sort()).toEqual([...FETCH_SITES].sort());
  });

  it("httpClient.ts's only fetch( is the default fetchImpl forwarding its url", () => {
    const f = withFetch.find((x) => x.rel === "httpClient.ts");
    expect(findFetchCalls(f?.src ?? "")).toEqual(["url, init),"]);
  });

  it.each(["familyClient.ts", "patCheck.ts"])(
    "%s passes buildRequestUrl(...) to fetch(",
    (name) => {
      const f = withFetch.find((x) => path.basename(x.rel) === name);
      expect(f).toBeDefined();
      const args = findFetchCalls(f?.src ?? "");
      expect(args.length).toBeGreaterThan(0);
      for (const arg of args) {
        const first = /^\s*([A-Za-z_$][\w$]*)/.exec(arg)?.[1];
        const direct = arg.trimStart().startsWith("buildRequestUrl(");
        const viaConst =
          first !== undefined &&
          new RegExp(`const ${first} = buildRequestUrl\\(`).test(f?.src ?? "");
        expect(direct || viaConst).toBe(true);
      }
    },
  );
});
