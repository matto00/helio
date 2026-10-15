#!/usr/bin/env node
// HEL-1601: dependency-free 1 Hz runner load sampler for the CI frontend job.
//   node scripts/ci-load-sampler.cjs <out.ndjson> <maxSeconds>
// Appends one JSON line per second (epoch-ms `t`, CPU percentages since the previous sample, run queue, 1-min load,
// MemAvailable and swap used in MB). It exits by itself after maxSeconds and on SIGTERM, so a forgotten sampler can
// never outlive the job.
const fs = require("fs");

/** @returns {{user:number,system:number,iowait:number,steal:number,idle:number,total:number}|null} jiffy counters */
function parseCpuStat(text) {
  const line = String(text)
    .split("\n")
    .find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { user: user + nice, system: system + irq + softirq, iowait, steal, idle, total };
}

/** CPU percentages between two parseCpuStat() results, or null when no time elapsed. */
function cpuPercent(prev, cur) {
  if (!prev || !cur) return null;
  const dt = cur.total - prev.total;
  if (dt <= 0) return null;
  const pct = (k) => Math.round(((cur[k] - prev[k]) / dt) * 1000) / 10;
  return {
    user: pct("user"),
    system: pct("system"),
    iowait: pct("iowait"),
    steal: pct("steal"),
    idle: pct("idle"),
  };
}

/** @returns {{load1:number,procsRunning:number}|null} */
function parseLoadAvg(text) {
  const m = String(text)
    .trim()
    .match(/^(\S+)\s+\S+\s+\S+\s+(\d+)\//);
  if (!m || !Number.isFinite(Number(m[1]))) return null;
  return { load1: Number(m[1]), procsRunning: Number(m[2]) };
}

/** @returns {{memAvailableMb:number,swapUsedMb:number}|null} */
function parseMemInfo(text) {
  const kb = (key) => {
    const m = String(text).match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m"));
    return m ? Number(m[1]) : null;
  };
  const avail = kb("MemAvailable");
  if (avail === null) return null;
  const swapTotal = kb("SwapTotal") || 0;
  const swapFree = kb("SwapFree") || 0;
  return {
    memAvailableMb: Math.round(avail / 1024),
    swapUsedMb: Math.round((swapTotal - swapFree) / 1024),
  };
}

function readProc(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function main(argv) {
  const [out, maxRaw] = argv;
  const maxSeconds = Number(maxRaw);
  if (!out || !Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    console.error("usage: ci-load-sampler.cjs <out.ndjson> <maxSeconds>");
    return 2;
  }
  try {
    fs.mkdirSync(require("path").dirname(out), { recursive: true });
  } catch {
    // the first write reports the failure
  }
  let prev = parseCpuStat(readProc("/proc/stat"));
  let ticks = 0;
  const timer = setInterval(() => {
    const cur = parseCpuStat(readProc("/proc/stat"));
    const cpu = cpuPercent(prev, cur);
    prev = cur;
    const load = parseLoadAvg(readProc("/proc/loadavg"));
    const mem = parseMemInfo(readProc("/proc/meminfo"));
    try {
      fs.appendFileSync(
        out,
        `${JSON.stringify({ t: Date.now(), ...(cpu || {}), ...(load || {}), ...(mem || {}) })}\n`,
      );
    } catch (err) {
      console.error(`[ci-load-sampler] write failed: ${err.message}`);
      clearInterval(timer);
      return;
    }
    ticks += 1;
    if (ticks >= maxSeconds) clearInterval(timer);
  }, 1000);
  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
  return null;
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}

module.exports = { main, parseCpuStat, cpuPercent, parseLoadAvg, parseMemInfo };
