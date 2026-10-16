/**
 * HEL-1617 process-level reproduction. Jest does not surface a bare orphaned rejection as a
 * process crash, so the crash is proven in a real Node child: `scripts/rateLimitedContextRepro.ts`
 * (run via tsx, NO unhandledRejection guard) must exit 0 and report the build rejecting with the
 * rate-limit error. Before the fix it exits 1 with an unhandled `HelioRateLimitError`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const packageRoot = path.resolve(__dirname, "..");

describe("rate-limited workspace context build in a real Node process (HEL-1617)", () => {
  it("survives: exit 0, no unhandled rejection, build fails with the rate-limit error", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", path.join("scripts", "rateLimitedContextRepro.ts")],
      { cwd: packageRoot, encoding: "utf8", timeout: 60_000 },
    );
    expect({ status: result.status, stdout: result.stdout.trim(), stderr: result.stderr }).toEqual({
      status: 0,
      stdout: "survived outcome=rate-limit-error",
      stderr: expect.not.stringMatching(/HelioRateLimitError|unhandled/i),
    });
  }, 90_000);
});
