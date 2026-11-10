#!/usr/bin/env node
// Self-test for check-cloud-run-cpu.mjs. Mutates each real file independently
// and asserts on the REASON text, never on a non-zero result alone.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  check,
  checkWorkflow,
  checkDeployScript,
  checkMcpDeployScript,
  checkMcpDeployFile,
} from "./check-cloud-run-cpu.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(join(root, ".github/workflows/cd-backend.yml"), "utf8");
const sh = readFileSync(join(root, "infra/deploy-backend.sh"), "utf8");
const mcp = readFileSync(join(root, "infra/deploy-mcp.sh"), "utf8");

let failed = 0;
function expect(name, problems, substr) {
  const ok = substr === null ? problems.length === 0 : problems.some((p) => p.includes(substr));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(problems)}`}`);
  if (!ok) failed++;
}

expect("control: real workflow passes", checkWorkflow(wf), null);
expect("control: real deploy script passes", checkDeployScript(sh), null);
expect("control: real MCP deploy script passes", checkMcpDeployScript(mcp), null);
expect("control: whole repo passes", check(root), null);

expect(
  "workflow: flag removed",
  checkWorkflow(wf.replaceAll(" --no-cpu-throttling", "")),
  "missing --no-cpu-throttling",
);
expect(
  "workflow: flag only in a comment does not satisfy",
  checkWorkflow(
    wf
      .replaceAll(' --no-cpu-throttling"', '"')
      .replace(/^(\s*)flags:/m, "$1# --no-cpu-throttling\n$1flags:"),
  ),
  "missing --no-cpu-throttling",
);
expect(
  "workflow: substring-only token rejected",
  checkWorkflow(wf.replaceAll(" --no-cpu-throttling", " --no-cpu-throttling-x")),
  "missing --no-cpu-throttling",
);
expect(
  "workflow: positive --cpu-throttling rejected",
  checkWorkflow(wf.replaceAll(" --no-cpu-throttling", " --no-cpu-throttling --cpu-throttling")),
  "must not pass --cpu-throttling",
);
expect("workflow: no flags line", checkWorkflow("name: x\n"), "no flags: value");

expect(
  "script: flag removed",
  checkDeployScript(sh.replace(/^\s*--no-cpu-throttling \\\n/m, "")),
  "missing --no-cpu-throttling",
);
expect(
  "script: flag only in a comment does not satisfy",
  checkDeployScript(
    sh.replace(/^(\s*)--no-cpu-throttling \\\n/m, "") + "\n# --no-cpu-throttling\n",
  ),
  "missing --no-cpu-throttling",
);
expect(
  "script: positive --cpu-throttling rejected",
  checkDeployScript(
    sh.replace(
      /^(\s*)--no-cpu-throttling \\\n/m,
      "$1--no-cpu-throttling \\\n$1--cpu-throttling \\\n",
    ),
  ),
  "must not pass --cpu-throttling",
);
expect("script: no deploy invocation", checkDeployScript("echo hi\n"), "no gcloud run deploy");

// HEL-1709: infra/deploy-mcp.sh must NOT carry --no-cpu-throttling (inverse of the backend rule).
expect(
  "mcp script: flag present is rejected",
  checkMcpDeployScript(
    mcp.replace(/^([ \t]*)gcloud run deploy helio-mcp \\\n/m, "$&$1  --no-cpu-throttling \\\n"),
  ),
  "must not pass --no-cpu-throttling",
);
expect("mcp script: flag absent passes", checkMcpDeployScript(mcp), null);
expect(
  "mcp script: flag only in a comment passes",
  checkMcpDeployScript(`${mcp}\n# --no-cpu-throttling\n`),
  null,
);
expect(
  "mcp script: no deploy invocation",
  checkMcpDeployScript("echo hi\n"),
  "no gcloud run deploy",
);
expect(
  "mcp script: deploy only in a comment is not a deploy",
  checkMcpDeployScript("# gcloud run deploy x --no-cpu-throttling\n"),
  "no gcloud run deploy",
);

// File missing: a temp root with no infra/deploy-mcp.sh.
const tmp = mkdtempSync(join(tmpdir(), "check-cpu-"));
try {
  expect("mcp file: missing fails", checkMcpDeployFile(tmp), "file not found");
  mkdirSync(join(tmp, "infra"));
  writeFileSync(join(tmp, "infra/deploy-mcp.sh"), mcp);
  expect("mcp file: present passes", checkMcpDeployFile(tmp), null);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Backend rule unchanged: the flag removed from the backend script still fails, whatever the MCP script says.
expect(
  "backend rule unchanged: flag removed still fails alongside a passing MCP script",
  [
    ...checkDeployScript(sh.replace(/^\s*--no-cpu-throttling \\\n/m, "")),
    ...checkMcpDeployScript(mcp),
  ],
  "infra/deploy-backend.sh: missing --no-cpu-throttling",
);

if (failed) {
  console.error(`${failed} selftest case(s) failed`);
  process.exit(1);
}
console.log("check-cloud-run-cpu selftest OK");
