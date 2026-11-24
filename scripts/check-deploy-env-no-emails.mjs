#!/usr/bin/env node
// HEL-1852: the owner-email allowlist (HELIO_OWNER_EMAILS) assigns the `owner` tier, and this
// repository is public, so the address must never be a literal deploy flag. Both deploy paths
// must inject it from Secret Manager (`helio-owner-emails`):
//   - .github/workflows/cd-backend.yml  via --update-secrets (inside the non-comment `flags:` value)
//   - infra/deploy-backend.sh           via --set-secrets    (inside the `gcloud run deploy` command)
// Fails when an env-vars flag VALUE (--update-env-vars / --set-env-vars) contains an `@`-address
// token or a `HELIO_OWNER_EMAILS=` entry, when a secrets flag does not map
// HELIO_OWNER_EMAILS=helio-owner-emails:latest, or when a file / flag is missing (never a vacuous
// pass). Only the env-vars VALUE is scanned for `@`, because other flags legitimately carry one
// (e.g. --service-account=helio-backend-sa@...). Comments never count.
//
// Usage: node check-deploy-env-no-emails.mjs [repoRoot]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_ENTRY = "HELIO_OWNER_EMAILS=helio-owner-emails:latest";
const ENV_FLAGS = ["--update-env-vars=", "--set-env-vars="];
const SECRET_FLAGS = ["--update-secrets=", "--set-secrets="];

// HEL-1852 (design D10): beyond the env-vars flags, NO workflow file (comments included) and no
// `gcloud run deploy` invocation may carry a personal email address. Reserved example domains and a
// small explicit allowlist of non-personal address shapes pass. The guarded value is never embedded.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const ALLOWED_DOMAINS = new Set(["example.com", "example.test", "example.org"]);
const ALLOWED_DOMAIN_SUFFIXES = [".iam.gserviceaccount.com", ".users.noreply.github.com"];
const ALLOWED_DOMAINS_EXACT = new Set(["users.noreply.github.com"]);

function domainAllowed(domain) {
  const d = domain.toLowerCase();
  return (
    ALLOWED_DOMAINS.has(d) ||
    ALLOWED_DOMAINS_EXACT.has(d) ||
    ALLOWED_DOMAIN_SUFFIXES.some((suffix) => d.endsWith(suffix))
  );
}

/** Problems for every email-shaped token in `text` whose domain is not allowed (value never echoed). */
export function checkNoPersonalEmails(label, text) {
  const problems = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(EMAIL_RE)) {
      if (!domainAllowed(m[1]))
        problems.push(`${label}:${i + 1}: personal email address (non-allowlisted domain)`);
    }
  });
  return problems;
}

function flagValues(tokens, prefixes) {
  return tokens
    .filter((t) => prefixes.some((p) => t.startsWith(p)))
    .map((t) => t.slice(t.indexOf("=") + 1).replace(/^["']|["']$/g, ""));
}

function verdict(label, tokens, secretsFlag) {
  const problems = [];
  const envValues = flagValues(tokens, ENV_FLAGS);
  if (envValues.length === 0) problems.push(`${label}: no env-vars flag found`);
  for (const v of envValues) {
    if (v.includes("@"))
      problems.push(`${label}: an env-vars flag value contains an email address`);
    if (v.includes("HELIO_OWNER_EMAILS="))
      problems.push(`${label}: HELIO_OWNER_EMAILS must not be an env-vars entry`);
  }
  const secretValues = flagValues(tokens, SECRET_FLAGS);
  if (secretValues.length === 0) problems.push(`${label}: no ${secretsFlag} flag found`);
  else if (!secretValues.some((v) => v.split(",").includes(SECRET_ENTRY)))
    problems.push(`${label}: ${secretsFlag} must map ${SECRET_ENTRY}`);
  return problems;
}

/** Check the CD workflow text: the non-comment `flags:` value(s). */
export function checkWorkflow(text) {
  const label = ".github/workflows/cd-backend.yml";
  const values = [];
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*flags:\s*(.*)$/);
    if (m) values.push(m[1].replace(/^["']|["']\s*$/g, ""));
  }
  if (values.length === 0) return [`${label}: no flags: value found`];
  return values.flatMap((v) => verdict(label, v.split(/\s+/), "--update-secrets"));
}

/** The (backslash-continued) non-comment `gcloud run deploy` command as tokens, or null. */
function deployCommandTokens(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => !/^\s*#/.test(l) && /gcloud\s+run\s+deploy\b/.test(l));
  if (start === -1) return null;
  let cmd = "";
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].replace(/\s+$/, "");
    if (l.endsWith("\\")) cmd += ` ${l.slice(0, -1)}`;
    else {
      cmd += ` ${l}`;
      break;
    }
  }
  return cmd.trim().split(/\s+/);
}

/** Check the deploy script text: the (backslash-continued) `gcloud run deploy` command. */
export function checkDeployScript(text) {
  const label = "infra/deploy-backend.sh";
  const tokens = deployCommandTokens(text);
  if (tokens === null) return [`${label}: no gcloud run deploy invocation found`];
  return verdict(label, tokens, "--set-secrets");
}

/** Every `.github/workflows/*.yml` file, comments included. */
export function checkWorkflowDir(root) {
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return [".github/workflows: directory not found"];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .flatMap((f) =>
      checkNoPersonalEmails(`.github/workflows/${f}`, readFileSync(join(dir, f), "utf8")),
    );
}

/** The non-comment `gcloud run deploy` invocation of the deploy script. */
export function checkDeployScriptEmails(text) {
  const tokens = deployCommandTokens(text);
  return tokens === null ? [] : checkNoPersonalEmails("infra/deploy-backend.sh", tokens.join("\n"));
}

export function check(root) {
  const wf = join(root, ".github/workflows/cd-backend.yml");
  const sh = join(root, "infra/deploy-backend.sh");
  const problems = [];
  problems.push(
    ...(existsSync(wf)
      ? checkWorkflow(readFileSync(wf, "utf8"))
      : [".github/workflows/cd-backend.yml: file not found"]),
  );
  problems.push(
    ...(existsSync(sh)
      ? checkDeployScript(readFileSync(sh, "utf8"))
      : ["infra/deploy-backend.sh: file not found"]),
  );
  problems.push(...checkWorkflowDir(root));
  if (existsSync(sh)) problems.push(...checkDeployScriptEmails(readFileSync(sh, "utf8")));
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = check(root);
  if (problems.length) {
    console.error(
      `check-deploy-env-no-emails FAILED (HEL-1852):\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("check-deploy-env-no-emails OK");
}
