// HEL-1601: the sampler's /proc parsers, against fixture text.
const { parseCpuStat, cpuPercent, parseLoadAvg, parseMemInfo } = require("./ci-load-sampler.cjs");

const STAT_A = "cpu  100 0 50 800 20 0 0 30 0 0\ncpu0 1 2 3 4\n";
const STAT_B = "cpu  200 0 100 1600 40 0 0 60 0 0\n";

describe("ci-load-sampler parsers", () => {
  it("parses the aggregate cpu line and computes percentages between two samples", () => {
    const a = parseCpuStat(STAT_A);
    const b = parseCpuStat(STAT_B);
    expect(a).toMatchObject({
      user: 100,
      system: 50,
      idle: 800,
      iowait: 20,
      steal: 30,
      total: 1000,
    });
    expect(cpuPercent(a, b)).toEqual({ user: 10, system: 5, iowait: 2, steal: 3, idle: 80 });
  });

  it("returns null for garbage or zero elapsed time", () => {
    expect(parseCpuStat("nothing")).toBeNull();
    const a = parseCpuStat(STAT_A);
    expect(cpuPercent(a, a)).toBeNull();
    expect(cpuPercent(null, a)).toBeNull();
  });

  it("parses loadavg", () => {
    expect(parseLoadAvg("1.25 0.9 0.5 3/412 9999\n")).toEqual({ load1: 1.25, procsRunning: 3 });
    expect(parseLoadAvg("")).toBeNull();
  });

  it("parses meminfo available memory and swap used in MB", () => {
    const text =
      "MemTotal: 16000000 kB\nMemAvailable: 2097152 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n";
    expect(parseMemInfo(text)).toEqual({ memAvailableMb: 2048, swapUsedMb: 512 });
    expect(parseMemInfo("MemTotal: 1 kB\n")).toBeNull();
  });
});
