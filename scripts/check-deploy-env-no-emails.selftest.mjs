#!/usr/bin/env node
// Self-test for check-deploy-env-no-emails.mjs. Mutates each real file independently and asserts
// on the REASON text, never on a non-zero result alone. Fixtures use fake addresses only.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  check,
  checkWorkflow,
  checkDeployScript,
  checkNoPersonalEmails,
  checkDeployScriptEmails,
} from "./check-deploy-env-no-emails.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(join(root, ".github/workflows/cd-backend.yml"), "utf8");
const sh = readFileSync(join(root, "infra/deploy-backend.sh"), "utf8");
const SECRET = "HELIO_OWNER_EMAILS=helio-owner-emails:latest";

let failed = 0;
function expect(name, problems, substr) {
  const ok = substr === null ? problems.length === 0 : problems.some((p) => p.includes(substr));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(problems)}`}`);
  if (!ok) failed++;
}

expect("control: real workflow passes", checkWorkflow(wf), null);
expect("control: real deploy script passes", checkDeployScript(sh), null);
expect("control: whole repo passes", check(root), null);

// Workflow mutations.
expect(
  "workflow: fake address added to --update-env-vars",
  checkWorkflow(
    wf.replace("--update-env-vars=", "--update-env-vars=HELIO_OWNER_EMAILS=owner@example.test,"),
  ),
  "contains an email address",
);
expect(
  "workflow: HELIO_OWNER_EMAILS entry (no @) in --update-env-vars",
  checkWorkflow(wf.replace("--update-env-vars=", "--update-env-vars=HELIO_OWNER_EMAILS=x,")),
  "must not be an env-vars entry",
);
expect(
  "workflow: secret mapping removed",
  checkWorkflow(wf.replace(`,${SECRET}`, "").replace(`${SECRET},`, "")),
  "must map HELIO_OWNER_EMAILS=helio-owner-emails:latest",
);
expect(
  "workflow: secret mapping only in a comment does not satisfy",
  checkWorkflow(
    wf
      .replace(`,${SECRET}`, "")
      .replace(`${SECRET},`, "")
      .replace(/^(\s*)flags:/m, `$1# ${SECRET}\n$1flags:`),
  ),
  "must map HELIO_OWNER_EMAILS=helio-owner-emails:latest",
);
expect(
  "workflow: an @ outside the env-vars value is not flagged",
  checkWorkflow(
    wf.replace("--max-instances=2", "--service-account=sa@example.test --max-instances=2"),
  ),
  null,
);
expect("workflow: no flags line", checkWorkflow("name: x\n"), "no flags: value");

// Deploy script mutations.
expect(
  "script: fake address added to --set-env-vars",
  checkDeployScript(
    sh.replace("|LOG_FORMAT=json|", "|LOG_FORMAT=json|CONTACT=owner@example.test|"),
  ),
  "contains an email address",
);
expect(
  "script: HELIO_OWNER_EMAILS entry in --set-env-vars",
  checkDeployScript(
    sh.replace("|LOG_FORMAT=json|", "|LOG_FORMAT=json|HELIO_OWNER_EMAILS=${HELIO_OWNER_EMAILS}|"),
  ),
  "must not be an env-vars entry",
);
expect(
  "script: secret mapping removed",
  checkDeployScript(sh.replace(`,${SECRET}`, "").replace(`${SECRET},`, "")),
  "must map HELIO_OWNER_EMAILS=helio-owner-emails:latest",
);
expect(
  "script: mapping only in a comment does not satisfy",
  checkDeployScript(
    `${sh.replace(`,${SECRET}`, "").replace(`${SECRET},`, "")}\n# --set-secrets=${SECRET}\n`,
  ),
  "must map HELIO_OWNER_EMAILS=helio-owner-emails:latest",
);
expect("script: no deploy invocation", checkDeployScript("echo hi\n"), "no gcloud run deploy");

// HEL-1852 D10: personal addresses anywhere in a workflow file (comments included) or in the
// deploy invocation fail; example and allowlisted domains pass. Fixtures use fake addresses only.
const PERSONAL = "someone@gmail.test";
expect(
  "emails: personal address in a workflow comment fails",
  checkNoPersonalEmails("wf.yml", `# contact ${PERSONAL}\nname: x\n`),
  "wf.yml:1: personal email address",
);
expect(
  "emails: personal address in a workflow value fails",
  checkNoPersonalEmails("wf.yml", `name: x\nenv: ${PERSONAL}\n`),
  "wf.yml:2: personal email address",
);
expect(
  "emails: personal address in the deploy invocation fails",
  checkDeployScriptEmails(`gcloud run deploy x \\\n  --labels=owner=${PERSONAL}\n`),
  "infra/deploy-backend.sh",
);
expect(
  "emails: personal address in a deploy-script comment is not the invocation",
  checkDeployScriptEmails(`# ${PERSONAL}\ngcloud run deploy x\n`),
  null,
);
for (const ok of [
  "owner@example.com",
  "owner@example.test",
  "owner@example.org",
  "helio-backend-sa@helio-1.iam.gserviceaccount.com",
  "123+bot@users.noreply.github.com",
]) {
  expect(`emails: ${ok} passes`, checkNoPersonalEmails("wf.yml", `# ${ok}\n`), null);
}
expect(
  "emails: the whole-tree scan reports a personal address planted in a workflow",
  (() => {
    const tmp = mkdtempSync(join(tmpdir(), "check-owner-env-wf-"));
    try {
      mkdirSync(join(tmp, ".github/workflows"), { recursive: true });
      mkdirSync(join(tmp, "infra"));
      writeFileSync(join(tmp, ".github/workflows/cd-backend.yml"), wf);
      writeFileSync(join(tmp, ".github/workflows/other.yml"), `# ${PERSONAL}\n`);
      writeFileSync(join(tmp, "infra/deploy-backend.sh"), sh);
      return check(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  })(),
  "other.yml:1: personal email address",
);

// Missing files never pass vacuously.
const tmp = mkdtempSync(join(tmpdir(), "check-owner-env-"));
try {
  const problems = check(tmp);
  expect("missing workflow fails", problems, "cd-backend.yml: file not found");
  expect("missing deploy script fails", problems, "deploy-backend.sh: file not found");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`${failed} selftest case(s) failed`);
  process.exit(1);
}
console.log("check-deploy-env-no-emails selftest OK");
