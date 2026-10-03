#!/usr/bin/env node
// Self-test for check-cloud-run-cpu.mjs. Mutates each real file independently
// and asserts on the REASON text, never on a non-zero result alone.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkWorkflow, checkDeployScript } from "./check-cloud-run-cpu.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(join(root, ".github/workflows/cd-backend.yml"), "utf8");
const sh = readFileSync(join(root, "infra/deploy-backend.sh"), "utf8");

let failed = 0;
function expect(name, problems, substr) {
  const ok = substr === null ? problems.length === 0 : problems.some((p) => p.includes(substr));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(problems)}`}`);
  if (!ok) failed++;
}

expect("control: real workflow passes", checkWorkflow(wf), null);
expect("control: real deploy script passes", checkDeployScript(sh), null);

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

if (failed) {
  console.error(`${failed} selftest case(s) failed`);
  process.exit(1);
}
console.log("check-cloud-run-cpu selftest OK");
