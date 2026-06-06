#!/usr/bin/env node
/**
 * openspec — CLI for the Helio OpenSpec workflow.
 *
 * Commands
 *   new change <name>                        Scaffold a new change directory
 *   list [--json]                            List active changes
 *   status --change <name> [--json]          Status of a change
 *   instructions <artifact|apply>            Artifact or apply instructions
 *     --change <name> [--json]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changesDir = join(repoRoot, "openspec/changes");
const configPath = join(repoRoot, "openspec/config.yaml");

// ── Tiny YAML reader (only handles the subset used in config.yaml / .openspec.yaml) ──

function parseSimpleYaml(text) {
  const result = {};
  let multilineKey = null;
  let multilineLines = [];
  let inRulesBlock = false;
  let rulesKey = null;
  let rulesLines = [];

  for (const raw of text.split("\n")) {
    const line = raw;

    // Detect top-level key: value or key: |
    const topMatch = line.match(/^(\w[\w.]*)\s*:\s*(.*)/);
    if (topMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      // Flush pending multiline
      if (multilineKey) {
        result[multilineKey] = multilineLines.join("\n").trimEnd();
        multilineKey = null;
        multilineLines = [];
      }
      if (inRulesBlock) {
        inRulesBlock = false;
      }

      const [, key, val] = topMatch;

      if (val.trim() === "|") {
        multilineKey = key;
        multilineLines = [];
      } else if (val.trim() === "") {
        // Possible nested block (e.g. rules:)
        result[key] = result[key] ?? {};
        inRulesBlock = key === "rules";
        rulesKey = null;
        rulesLines = [];
      } else {
        result[key] = val.trim();
      }
      continue;
    }

    // Inside rules block
    if (inRulesBlock) {
      const rulesTopMatch = line.match(/^ {2}(\w[\w-]*)\s*:/);
      if (rulesTopMatch) {
        if (rulesKey && rulesLines.length) {
          result["rules"] = result["rules"] ?? {};
          result["rules"][rulesKey] = rulesLines;
          rulesLines = [];
        }
        rulesKey = rulesTopMatch[1];
        rulesLines = [];
        continue;
      }
      if (rulesKey && line.match(/^ {4}- /)) {
        rulesLines.push(line.replace(/^ {4}- /, "").trim());
        continue;
      }
    }

    // Inside multiline block
    if (multilineKey !== null) {
      multilineLines.push(line.replace(/^ {2}/, ""));
    }
  }

  // Flush
  if (multilineKey) {
    result[multilineKey] = multilineLines.join("\n").trimEnd();
  }
  if (inRulesBlock && rulesKey && rulesLines.length) {
    result["rules"] = result["rules"] ?? {};
    result["rules"][rulesKey] = rulesLines;
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readConfig() {
  if (!existsSync(configPath)) return { schema: "spec-driven", context: "", rules: {} };
  return parseSimpleYaml(readFileSync(configPath, "utf8"));
}

function readChangeConfig(name) {
  const yamlPath = join(changesDir, name, ".openspec.yaml");
  if (!existsSync(yamlPath)) return { schema: "spec-driven" };
  return parseSimpleYaml(readFileSync(yamlPath, "utf8"));
}

function listActiveChanges() {
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir).filter((entry) => {
    if (entry === "archive") return false;
    return statSync(join(changesDir, entry)).isDirectory();
  });
}

function parseTasks(name) {
  const tasksPath = join(changesDir, name, "tasks.md");
  if (!existsSync(tasksPath)) return { total: 0, complete: 0, tasks: [] };

  const lines = readFileSync(tasksPath, "utf8").split("\n");
  const tasks = [];
  for (const line of lines) {
    const done = line.match(/^\s*-\s*\[x\]\s+(.+)/i);
    const todo = line.match(/^\s*-\s*\[ \]\s+(.+)/);
    if (done) tasks.push({ text: done[1].trim(), done: true });
    else if (todo) tasks.push({ text: todo[1].trim(), done: false });
  }
  return { total: tasks.length, complete: tasks.filter((t) => t.done).length, tasks };
}

function artifactExists(name, id) {
  return existsSync(join(changesDir, name, `${id}.md`));
}

// For spec-driven schema: proposal → design → tasks
const SPEC_DRIVEN_ARTIFACTS = [
  { id: "proposal", deps: [] },
  { id: "design", deps: ["proposal"] },
  { id: "tasks", deps: ["design"] },
];

function buildArtifactStatuses(name) {
  return SPEC_DRIVEN_ARTIFACTS.map(({ id, deps }) => {
    const exists = artifactExists(name, id);
    const depsReady = deps.every((d) => artifactExists(name, d));
    let status;
    if (exists) status = "done";
    else if (depsReady) status = "ready";
    else status = "pending";
    return { id, status, dependencies: deps };
  });
}

function changeStatus(name) {
  const { total, complete } = parseTasks(name);
  const artifacts = buildArtifactStatuses(name);
  const schemaName = readChangeConfig(name).schema ?? "spec-driven";

  let status;
  if (total === 0) status = "no-tasks";
  else if (complete === total) status = "complete";
  else status = "in-progress";

  return {
    name,
    schemaName,
    status,
    artifacts,
    applyRequires: ["tasks"],
    completedTasks: complete,
    totalTasks: total,
  };
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES = {
  proposal: `## Why

<!-- Why does this change need to happen? What problem does it solve? -->

## What Changes

<!-- Bullet-list of specific changes. Keep under 300 words total. -->

## Non-Goals

<!-- What is explicitly out of scope for this change? -->
`,
  design: `## Context

<!-- Relevant existing code patterns, constraints, and architecture notes. -->

## Goals / Non-Goals

**Goals:**
<!-- What this design achieves. -->

**Non-Goals:**
<!-- What this design deliberately skips. -->

## Decisions

<!-- Numbered architectural decisions with rationale grounded in actual codebase patterns. -->

## Planner Notes

<!-- Self-approved decisions and rationale that don't warrant a full decision entry. -->
`,
  tasks: `## Backend

<!-- Backend implementation tasks -->
- [ ]

## Frontend

<!-- Frontend implementation tasks -->
- [ ]

## Tests

<!-- Test coverage tasks -->
- [ ]
`,
};

const ARTIFACT_INSTRUCTIONS = {
  proposal:
    "Summarise the problem and solution in plain language. Follow the rules in config. Keep under 300 words and 80 lines.",
  design:
    "Ground every decision in actual files/patterns from the codebase. Document self-approved decisions under Planner Notes. Max 150 lines.",
  tasks:
    "One task per line, prefixed by section (Backend / Frontend / Tests). Each task completable in a single focused session. Max 80 lines.",
};

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdNewChange(name) {
  if (!name) {
    console.error("Usage: openspec new change <name>");
    process.exit(1);
  }
  const dir = join(changesDir, name);
  if (existsSync(dir)) {
    console.error(`Change "${name}" already exists at ${dir}`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, ".openspec.yaml"), `schema: spec-driven\ncreated: ${today}\n`);
  console.log(`Created change: openspec/changes/${name}/`);
}

function cmdList(json) {
  const changes = listActiveChanges().map((name) => {
    const { status, completedTasks, totalTasks } = changeStatus(name);
    return { name, status, completedTasks, totalTasks };
  });
  if (json) {
    console.log(JSON.stringify({ changes }, null, 2));
  } else {
    if (changes.length === 0) {
      console.log("No active changes.");
      return;
    }
    for (const c of changes) {
      console.log(`${c.name}  [${c.status}]  ${c.completedTasks}/${c.totalTasks} tasks`);
    }
  }
}

function cmdStatus(name, json) {
  if (!name) {
    console.error("--change <name> required");
    process.exit(1);
  }
  const dir = join(changesDir, name);
  if (!existsSync(dir)) {
    console.error(`Change "${name}" not found`);
    process.exit(1);
  }
  const s = changeStatus(name);
  if (json) {
    console.log(JSON.stringify(s, null, 2));
  } else {
    console.log(`Change: ${s.name}  (${s.schemaName})`);
    console.log(`Tasks: ${s.completedTasks}/${s.totalTasks}`);
    for (const a of s.artifacts) {
      console.log(`  ${a.id}: ${a.status}`);
    }
  }
}

function cmdInstructions(artifactId, name, json) {
  if (!name) {
    console.error("--change <name> required");
    process.exit(1);
  }

  if (artifactId === "apply") {
    const dir = join(changesDir, name);
    if (!existsSync(dir)) {
      console.error(`Change "${name}" not found`);
      process.exit(1);
    }
    const { total, complete, tasks } = parseTasks(name);
    const artifacts = buildArtifactStatuses(name);
    const tasksArtifact = artifacts.find((a) => a.id === "tasks");

    let state;
    if (tasksArtifact?.status !== "done") state = "blocked";
    else if (total > 0 && complete === total) state = "all_done";
    else state = "ready";

    const contextFiles = ["proposal", "design", "tasks"]
      .filter((id) => artifactExists(name, id))
      .map((id) => `openspec/changes/${name}/${id}.md`);

    const out = {
      state,
      contextFiles,
      progress: { total, complete, remaining: total - complete },
      tasks: tasks.map((t, i) => ({ id: String(i + 1), text: t.text, done: t.done })),
      instruction:
        state === "blocked"
          ? "Missing required artifacts. Run /opsx-propose to create them."
          : state === "all_done"
            ? "All tasks complete! Run /opsx-archive to archive this change."
            : "Read context files, then implement remaining tasks in order. Mark each task done immediately after completing it.",
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (!TEMPLATES[artifactId]) {
    console.error(
      `Unknown artifact: ${artifactId}. Expected one of: proposal, design, tasks, apply`,
    );
    process.exit(1);
  }

  const config = readConfig();
  const dir = join(changesDir, name);
  if (!existsSync(dir)) {
    console.error(`Change "${name}" not found`);
    process.exit(1);
  }

  const artifact = SPEC_DRIVEN_ARTIFACTS.find((a) => a.id === artifactId);
  const deps = artifact?.deps ?? [];

  const out = {
    context: config.context ?? "",
    rules: config.rules?.[artifactId] ?? [],
    template: TEMPLATES[artifactId],
    instruction: ARTIFACT_INSTRUCTIONS[artifactId] ?? "",
    outputPath: `openspec/changes/${name}/${artifactId}.md`,
    dependencies: deps
      .filter((d) => artifactExists(name, d))
      .map((d) => `openspec/changes/${name}/${d}.md`),
  };

  if (json) console.log(JSON.stringify(out, null, 2));
  else console.log(JSON.stringify(out, null, 2));
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  if (i !== -1) {
    args.splice(i, 1);
    return true;
  }
  return false;
}

function option(name) {
  const i = args.indexOf(name);
  if (i !== -1 && args[i + 1]) {
    const val = args[i + 1];
    args.splice(i, 2);
    return val;
  }
  return null;
}

const json = flag("--json");
const changeName = option("--change");

const [cmd, sub, ...rest] = args;

if (cmd === "new" && sub === "change") {
  cmdNewChange(rest[0]);
} else if (cmd === "list") {
  cmdList(json);
} else if (cmd === "status") {
  cmdStatus(changeName, json);
} else if (cmd === "instructions") {
  cmdInstructions(sub, changeName, json);
} else {
  console.error(`Unknown command: ${cmd ?? "(none)"}`);
  console.error("Usage: openspec <new change|list|status|instructions>");
  process.exit(1);
}
