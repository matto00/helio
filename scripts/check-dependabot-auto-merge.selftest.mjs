#!/usr/bin/env node
// HEL-1825 selftest for .github/workflows/dependabot-auto-merge.yml. Runs the workflow's REAL `if:`, `env:` and `run:`
// text per scenario against a stub `gh` (the only gh its PATH can reach) and asserts the logged `gh` calls and the
// resolve step's abort line. Each mutated copy of the workflow must fail at least one scenario.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(here, "..", ".github", "workflows", "dependabot-auto-merge.yml");
const REPO = "matto00/helio";
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const BOT = "dependabot[bot]";

for (const tool of ["jq", "bash"]) {
  if (spawnSync(tool, ["--version"]).error) {
    process.stderr.write(`selftest needs '${tool}' on PATH\n`);
    process.exit(2);
  }
}

// ---- minimal `if:` evaluator: == != && || ( ) 'literals' and a fixed set of context paths --------------------------
function evalIf(expr, ctx) {
  const toks = [];
  const re = /\s*(==|!=|&&|\|\||\(|\)|'[^']*'|[A-Za-z_][\w.-]*)/y;
  let pos = 0;
  const src = expr.trim();
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`unsupported token in if: at ${pos} of: ${src}`);
    toks.push(m[1]);
    pos = re.lastIndex;
  }
  let i = 0;
  const value = (t) => {
    if (t.startsWith("'")) return t.slice(1, -1);
    if (!(t in ctx) && !t.startsWith("steps.resolve.outputs."))
      throw new Error(`unmapped context ${t}`);
    return ctx[t] ?? "";
  };
  const primary = () => {
    const t = toks[i++];
    if (t === "(") {
      const v = or();
      if (toks[i++] !== ")") throw new Error("expected )");
      return v;
    }
    if (["==", "!=", "&&", "||", ")", undefined].includes(t)) throw new Error(`unexpected ${t}`);
    return value(t);
  };
  const cmp = () => {
    const l = primary();
    if (toks[i] === "==" || toks[i] === "!=") {
      const op = toks[i++];
      const r = primary();
      return op === "==" ? l === r : l !== r;
    }
    return l;
  };
  const and = () => {
    let v = cmp();
    while (toks[i] === "&&") {
      i++;
      const r = cmp();
      v = v && r;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (toks[i] === "||") {
      i++;
      const r = and();
      v = v || r;
    }
    return v;
  };
  const out = or();
  if (i !== toks.length) throw new Error(`trailing tokens in if: ${src}`);
  return Boolean(out);
}

const substitute = (str, ctx) =>
  String(str).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => {
    if (e === "secrets.GITHUB_TOKEN") return "stub-token";
    if (e === "github.repository") return REPO;
    if (e in ctx || e.startsWith("steps.resolve.outputs.")) return ctx[e] ?? "";
    throw new Error(`unmapped expression \${{ ${e} }}`);
  });

const STUB = `#!/usr/bin/env bash
printf '%s\\037' "$@" >> "$STUB_DIR/calls.log"; printf '\\n' >> "$STUB_DIR/calls.log"
case "$1 $2" in
  "pr list")
    sha=""; while [ $# -gt 0 ]; do [ "$1" = "--search" ] && sha="$2"; shift; done
    if [ "$sha" = "sha:$(cat "$STUB_DIR/list_sha")" ]; then cat "$STUB_DIR/list_out"; fi; exit 0;;
  "pr view") cat "$STUB_DIR/view.json"; exit 0;;
  "pr merge"|"pr edit"|"label create") exit 0;;
  "label list") exit 0;;
  "api repos/$(cat "$STUB_DIR/repo")/pulls/$(cat "$STUB_DIR/pr")") cat "$STUB_DIR/rest.json"; exit 0;;
esac
printf 'unhandled\\n' >> "$STUB_DIR/unhandled.log"; exit 99
`;

const base = {
  pr: "1222",
  restLogin: BOT,
  restType: "Bot",
  actor: BOT,
  conclusion: "success",
  event: "pull_request",
  labels: ["dependencies", "dependabot-semver-patch"],
  restHead: SHA,
  baseRef: "main",
  listed: true,
  bypassJobIf: false,
};
const merged = { merge: true };
const aborts = (line) => ({ abort: line });
const scenarios = [
  { name: "patch merges", ...base, expect: merged },
  {
    name: "minor merges",
    ...base,
    labels: ["dependencies", "dependabot-semver-minor"],
    expect: merged,
  },
  {
    name: "major is labelled, never merged",
    ...base,
    labels: ["dependabot-semver-major"],
    expect: { label: true },
  },
  { name: "display-form app/dependabot via pr view does not matter", ...base, expect: merged },
  {
    name: "REST human author aborts",
    ...base,
    restLogin: "octocat",
    expect: aborts("author is 'octocat', not dependabot[bot]"),
  },
  {
    name: "REST type User aborts",
    ...base,
    restType: "User",
    expect: aborts("author type is 'User', not Bot"),
  },
  {
    name: "human run actor skipped by job if",
    ...base,
    actor: "octocat",
    expect: { skipped: true },
  },
  {
    name: "human run actor aborts in-script",
    ...base,
    actor: "octocat",
    bypassJobIf: true,
    expect: aborts("CI run actor is 'octocat', not dependabot[bot]"),
  },
  {
    name: "CI failure skipped by job if",
    ...base,
    conclusion: "failure",
    expect: { skipped: true },
  },
  {
    name: "non pull_request event skipped by job if",
    ...base,
    event: "push",
    expect: { skipped: true },
  },
  {
    name: "head SHA mismatch aborts",
    ...base,
    restHead: OTHER_SHA,
    expect: aborts("no longer matches"),
  },
  {
    name: "base not main aborts",
    ...base,
    baseRef: "release/x",
    expect: aborts("base ref is 'release/x', not main"),
  },
  {
    name: "no semver label aborts",
    ...base,
    labels: ["dependencies"],
    expect: aborts("No dependabot-semver-* label"),
  },
  { name: "no PR aborts", ...base, listed: false, expect: aborts("No open PR found") },
];

function runScenario(doc, sc, root) {
  const problems = [];
  const dir = mkdtempSync(join(root, "sc-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), STUB);
  chmodSync(join(bin, "gh"), 0o755);
  const wr = (f, c) => writeFileSync(join(dir, f), c);
  wr("repo", REPO);
  wr("pr", sc.pr);
  wr("list_sha", SHA);
  wr("list_out", sc.listed ? `${sc.pr}\n` : "");
  wr(
    "rest.json",
    JSON.stringify({
      number: Number(sc.pr),
      head: { sha: sc.restHead },
      user: { login: sc.restLogin, type: sc.restType },
      base: { ref: sc.baseRef },
      labels: sc.labels.map((name) => ({ name })),
    }),
  );
  // the recorded `gh pr view` display shape: author pinned to app/dependabot in every scenario
  wr(
    "view.json",
    JSON.stringify({
      number: Number(sc.pr),
      headRefOid: sc.restHead,
      author: { is_bot: true, login: "app/dependabot" },
      baseRefName: sc.baseRef,
      labels: sc.labels.map((name) => ({ name })),
    }),
  );
  wr("calls.log", "");
  const out = join(dir, "github_output");
  wr("github_output", "");

  const ctx = {
    "github.event.workflow_run.conclusion": sc.conclusion,
    "github.event.workflow_run.event": sc.event,
    "github.event.workflow_run.actor.login": sc.actor,
    "github.event.workflow_run.head_sha": SHA,
  };
  const job = doc.jobs["auto-merge"];
  const jobRuns = sc.bypassJobIf || evalIf(job.if ?? "true", ctx);
  let stdout = "";
  if (jobRuns) {
    for (const step of job.steps) {
      if (step.if !== undefined && !evalIf(step.if, ctx)) continue;
      const env = {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: dir,
        STUB_DIR: dir,
        GITHUB_OUTPUT: out,
      };
      for (const [k, v] of Object.entries(step.env ?? {})) env[k] = substitute(v, ctx);
      const r = spawnSync("bash", ["-e", "-c", step.run], { env, cwd: dir, encoding: "utf8" });
      if (step.id === "resolve") stdout = r.stdout;
      if (r.status !== 0) problems.push(`step '${step.name}' exited ${r.status}: ${r.stderr}`);
      if (step.id) {
        for (const line of readFileSync(out, "utf8").split("\n")) {
          const m = /^(\w+)=(.*)$/.exec(line);
          if (m) ctx[`steps.${step.id}.outputs.${m[1]}`] = m[2];
        }
      }
    }
  }
  const calls = readFileSync(join(dir, "calls.log"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x1f").filter((x, i, a) => i < a.length - 1 || x !== ""));
  let unhandled = false;
  try {
    readFileSync(join(dir, "unhandled.log"));
    unhandled = true;
  } catch {
    /* none */
  }
  if (unhandled) problems.push("unhandled gh call logged");
  const find = (a, b) => calls.filter((c) => c[0] === a && c[1] === b);
  const ex = sc.expect;
  if (ex.skipped) {
    if (jobRuns) problems.push("job should have been skipped by its if:");
    if (calls.length) problems.push("skipped job made gh calls");
  } else if (ex.merge) {
    const want = [
      "pr",
      "merge",
      sc.pr,
      "--repo",
      REPO,
      "--squash",
      "--match-head-commit",
      SHA,
      "--delete-branch",
    ];
    const got = find("pr", "merge");
    if (got.length !== 1 || JSON.stringify(got[0]) !== JSON.stringify(want))
      problems.push(
        `expected exactly one merge ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      );
    if (find("pr", "edit").length) problems.push("unexpected pr edit");
  } else if (ex.label) {
    if (find("pr", "merge").length) problems.push("major must not merge");
    const want = ["pr", "edit", sc.pr, "--repo", REPO, "--add-label", "major-update"];
    const got = find("pr", "edit");
    if (got.length !== 1 || JSON.stringify(got[0]) !== JSON.stringify(want))
      problems.push(`expected pr edit ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  } else if (ex.abort) {
    if (!stdout.includes(ex.abort)) problems.push(`expected abort line containing "${ex.abort}"`);
    if (find("pr", "merge").length || find("pr", "edit").length || find("label", "create").length)
      problems.push("aborted run still wrote");
    if (ctx["steps.resolve.outputs.verified"]) problems.push("aborted run set verified");
  }
  return problems.map((p) => `${p}\n      resolve stdout: ${JSON.stringify(stdout)}`);
}

export function runAll(text) {
  const doc = yaml.load(text);
  const root = mkdtempSync(join(tmpdir(), "hel1825-"));
  const results = [];
  try {
    for (const sc of scenarios) {
      let problems;
      try {
        problems = runScenario(doc, sc, root);
      } catch (e) {
        problems = [`threw: ${e.message}`];
      }
      results.push({ name: sc.name, problems });
    }
    // comment lines may name `--auto` to explain its absence; only commands count
    const runs = (doc.jobs["auto-merge"].steps ?? []).map((s) =>
      (s.run ?? "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"))
        .join("\n"),
    );
    results.push({
      name: "static: no --auto in any run",
      problems: runs.some((r) => r.includes("--auto")) ? ["found --auto"] : [],
    });
    results.push({
      name: "static: no ${{ inside any run",
      problems: runs.some((r) => r.includes("${{")) ? ["found expression in run"] : [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return results;
}

const real = readFileSync(WORKFLOW, "utf8");
let failed = 0;
const report = (prefix, results) => {
  for (const r of results) {
    const bad = r.problems.length > 0;
    if (bad) failed++;
    process.stdout.write(
      `${bad ? "FAIL" : "ok  "} ${prefix}${r.name}${bad ? `\n    ${r.problems.join("\n    ")}` : ""}\n`,
    );
  }
};
const realResults = runAll(real);
report("", realResults);

if (realResults.every((r) => r.problems.length === 0)) {
  const mutations = {
    "revert author check": (t) =>
      t.replace('"$AUTHOR_LOGIN" != "dependabot[bot]"', '"$AUTHOR_LOGIN" != "app/dependabot"'),
    "drop in-script actor check": (t) =>
      t.replace(/ {10}if \[ "\$RUN_ACTOR"[\s\S]*?\n {10}fi\n\n/, ""),
    "drop type check": (t) => t.replace(/ {10}if \[ "\$AUTHOR_TYPE"[\s\S]*?\n {10}fi\n\n/, ""),
    "drop --match-head-commit": (t) => t.replace(' --match-head-commit "$HEAD_SHA"', ""),
    "add --auto": (t) => t.replace("--squash", "--squash --auto"),
    "remove actor from job if": (t) =>
      t.replace(" &&\n      github.event.workflow_run.actor.login == 'dependabot[bot]'", ""),
    "widen merge if to semver-major": (t) =>
      t.replace(
        "(steps.resolve.outputs.update_type == 'version-update:semver-patch' ||",
        "(steps.resolve.outputs.update_type == 'version-update:semver-major' ||",
      ),
    "drop conclusion from job if": (t) =>
      t.replace("github.event.workflow_run.conclusion == 'success' &&\n      ", ""),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const mutated = mutate(real);
    const caught = mutated !== real && runAll(mutated).some((r) => r.problems.length > 0);
    if (!caught) failed++;
    process.stdout.write(
      `${caught ? "ok  " : "FAIL"} mutation rejected: ${name}${caught ? "" : " -- not applied or not detected"}\n`,
    );
  }
} else {
  process.stdout.write("skipping mutations: the real workflow does not pass\n");
}
if (failed) {
  process.stdout.write(`${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("all dependabot-auto-merge checks passed\n");
