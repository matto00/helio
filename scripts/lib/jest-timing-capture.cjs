// HEL-1601: opt-in per-test timing capture for jest, shared by the root and frontend jest configs.
//
// The capture is enabled ONLY by HELIO_JEST_TIMING_DIR (the CI frontend job sets it on its `npm test` step). When it
// is unset this returns `{}`, so the resolved jest config is identical to one without this capability. It never keys
// off `CI`, so the HEL-1442 local caps and the CI=true values are untouched.
const path = require("path");

const TIMING_DIR_ENV = "HELIO_JEST_TIMING_DIR";
const REPORTER_PATH = path.join(__dirname, "jest-timing-reporter.cjs");

/**
 * @param {string} label suite label written into the capture ("root" or "frontend")
 * @param {string} rootDir the jest config's directory
 * @param {object} env environment to read (defaults to process.env)
 * @returns {object} config keys to spread into the jest config; `{}` when the capture is not requested
 */
function timingReporters(label, rootDir, env = process.env) {
  const dir = env[TIMING_DIR_ENV];
  if (!dir) return {};
  // `reporters` replaces jest's implicit default, so "default" is listed explicitly.
  return {
    reporters: [
      "default",
      [
        REPORTER_PATH,
        { dir, label, repoRoot: path.resolve(rootDir, label === "frontend" ? ".." : ".") },
      ],
    ],
  };
}

module.exports = { timingReporters, TIMING_DIR_ENV, REPORTER_PATH };
