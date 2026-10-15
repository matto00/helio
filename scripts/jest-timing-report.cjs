#!/usr/bin/env node
// HEL-1601: reads a jest-timing capture directory (jest-timing-*.ndjson + load.ndjson) and prints the slowest test
// cases with the runner load samples overlapping each.
//   node scripts/jest-timing-report.cjs <dir> [--top N] [--markdown]
const fs = require("fs");
const path = require("path");

function readNdjson(file) {
  const records = [];
  let malformed = 0;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { records, malformed };
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

function loadCapture(dir) {
  const cases = [];
  const files = [];
  let load = [];
  let malformed = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (/^jest-timing-.*\.ndjson$/.test(name)) {
      const r = readNdjson(full);
      malformed += r.malformed;
      for (const rec of r.records) {
        if (rec.type === "case") cases.push(rec);
        else if (rec.type === "file") files.push(rec);
      }
    } else if (name === "load.ndjson") {
      const r = readNdjson(full);
      malformed += r.malformed;
      load = r.records.filter((s) => typeof s.t === "number");
    }
  }
  return { cases, files, load, malformed };
}

/** Peaks/minimum of the load samples whose timestamp is within [start, end] (padded by one sample interval). */
function loadOverlap(load, start, end, padMs = 1000) {
  const s = load.filter((x) => x.t >= start - padMs && x.t <= end + padMs);
  if (!s.length) return null;
  const max = (k) => Math.max(...s.map((x) => x[k] ?? 0));
  const mems = s.map((x) => x.memAvailableMb).filter((n) => typeof n === "number");
  return {
    samples: s.length,
    maxSteal: max("steal"),
    maxIowait: max("iowait"),
    maxBusy: Math.max(...s.map((x) => (x.user ?? 0) + (x.system ?? 0))),
    minMemAvailableMb: mems.length ? Math.min(...mems) : null,
  };
}

function buildReport(capture, top = 15) {
  const { cases, files, load } = capture;
  const t0 = Math.min(...cases.map((c) => c.start), ...load.map((s) => s.t), Infinity);
  const slowest = [...cases]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, top)
    .map((c) => ({ ...c, offsetMs: c.start - t0, load: loadOverlap(load, c.start, c.end) }));
  const num = (k) => (load.length ? Math.max(...load.map((x) => x[k] ?? 0)) : null);
  const mems = load.map((x) => x.memAvailableMb).filter((n) => typeof n === "number");
  return {
    cases: cases.length,
    files: files.length,
    loadSamples: load.length,
    malformed: capture.malformed,
    peaks: {
      steal: num("steal"),
      iowait: num("iowait"),
      load1: num("load1"),
      minMemAvailableMb: mems.length ? Math.min(...mems) : null,
    },
    slowest,
  };
}

function fmtLoad(l) {
  if (!l) return "no load samples";
  return `steal<=${l.maxSteal}% iowait<=${l.maxIowait}% busy<=${Math.round(l.maxBusy)}% memAvail>=${l.minMemAvailableMb}MB (${l.samples} samples)`;
}

function formatText(r) {
  const out = [
    `cases=${r.cases} files=${r.files} loadSamples=${r.loadSamples} malformedLines=${r.malformed}`,
    `peaks: steal=${r.peaks.steal}% iowait=${r.peaks.iowait}% load1=${r.peaks.load1} minMemAvailable=${r.peaks.minMemAvailableMb}MB`,
    `slowest ${r.slowest.length} test cases:`,
  ];
  for (const c of r.slowest) {
    out.push(
      `${String(c.duration).padStart(7)} ms  +${c.offsetMs} ms  [${c.label}] ${c.file} :: ${c.name} (${c.status})`,
    );
    out.push(`            load: ${fmtLoad(c.load)}`);
  }
  return out.join("\n");
}

function formatMarkdown(r) {
  const out = [
    "### Jest timing capture",
    "",
    `${r.cases} cases, ${r.files} files, ${r.loadSamples} load samples, ${r.malformed} malformed lines. ` +
      `Peaks: steal ${r.peaks.steal}%, iowait ${r.peaks.iowait}%, load1 ${r.peaks.load1}, min MemAvailable ${r.peaks.minMemAvailableMb} MB.`,
    "",
    "| ms | suite | file | test | load during test |",
    "| --: | --- | --- | --- | --- |",
  ];
  // Escape the backslash first so a name ending in `\` or containing `\|` cannot un-escape the pipe escape.
  const esc = (s) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/[\r\n]+/g, " ");
  for (const c of r.slowest) {
    out.push(
      `| ${c.duration} | ${c.label} | ${esc(c.file)} | ${esc(c.name)} | ${fmtLoad(c.load)} |`,
    );
  }
  return out.join("\n");
}

function main(argv) {
  const topIdx = argv.indexOf("--top");
  const dir = argv.filter((a, i) => !a.startsWith("--") && (topIdx < 0 || i !== topIdx + 1))[0];
  const top = topIdx >= 0 ? Number(argv[topIdx + 1]) : 15;
  if (!dir || !Number.isInteger(top) || top < 1) {
    console.error("usage: jest-timing-report.cjs <dir> [--top N] [--markdown]");
    return 2;
  }
  const report = buildReport(loadCapture(dir), top);
  console.log(argv.includes("--markdown") ? formatMarkdown(report) : formatText(report));
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  main,
  readNdjson,
  loadCapture,
  loadOverlap,
  buildReport,
  formatText,
  formatMarkdown,
};
