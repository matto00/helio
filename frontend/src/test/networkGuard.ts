/**
 * HEL-1600 -- global jest guard against unmocked network calls.
 *
 * Every app HTTP call goes through one axios instance whose XHR adapter runs on jsdom's
 * XMLHttpRequest. A test that reaches a service function without mocking it opens a real socket,
 * gets ECONNREFUSED, and jsdom logs an XHR `AggregateError`. Those were 342 console errors across
 * 22 files before this guard (HEL-1353 had fixed one file and the class kept growing).
 *
 * The guard wraps `XMLHttpRequest.prototype.open/send` (and `fetch`, when the environment defines
 * it). An unmocked request never reaches `send`'s socket: it is recorded as a violation and settled
 * as an ordinary network error (an `error` ProgressEvent -- axios rejects with ERR_NETWORK; a
 * `this.abort()` would leave the axios promise pending forever). `afterEach` then fails the test
 * that issued it, naming the method and URL. Fix the call by mocking the service function it
 * reaches at its module (`jest.mock("<service>", () => ({ ...jest.requireActual(...), fn: jest.fn() }))`),
 * never by silencing the console.
 *
 * Requests fired after jsdom teardown cannot be seen; a request fired late by test N is reported on
 * test N+1 (the message carries the URL, which names the source).
 */

export interface NetworkViolation {
  method: string;
  url: string;
  testName: string;
}

/**
 * Test files that still make real network calls because a parked lane's branch edits them and this
 * change must not. Keys are repo-relative path suffixes (never basenames). In an allowlisted file
 * requests pass through unchanged and are recorded, and the file FAILS in `afterAll` once it
 * records zero requests -- the entry must be removed then (an exception must be able to expire).
 */
export const NETWORK_ALLOWLIST: Readonly<Record<string, string>> = {
  // Drain after the owning lane merges: delete the entry and mock the file's calls (follow-up ticket).
  "src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx": "HEL-1576",
  "src/features/pipelines/ui/PipelineDetailPage.test.tsx": "HEL-1579",
  "src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx": "HEL-1579",
  "src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx": "HEL-1579",
  "src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx": "HEL-1579",
  "src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx": "HEL-1579",
};

const FIX_HINT =
  "mock the service function it reaches at its module (jest.mock with a requireActual spread); see frontend/src/test/networkGuard.ts";

let violations: NetworkViolation[] = [];
let allowlistedRequests = 0;

/** Returns and clears the violations recorded so far (for the guard's own self-test). */
export function takeNetworkViolations(): NetworkViolation[] {
  const taken = violations;
  violations = [];
  return taken;
}

function currentTestPath(): string {
  return (expect.getState().testPath ?? "").replace(/\\/g, "/");
}

/** The owning ticket when the running test file is allowlisted, else undefined. */
export function allowlistOwner(
  testPath: string = currentTestPath(),
  allowlist: Readonly<Record<string, string>> = NETWORK_ALLOWLIST,
): string | undefined {
  const key = Object.keys(allowlist).find((suffix) => testPath.endsWith(`/${suffix}`));
  return key === undefined ? undefined : allowlist[key];
}

function describeViolations(list: NetworkViolation[]): string {
  const lines = list.map(
    (v) => `  - ${v.method} ${v.url} (in "${v.testName || "<outside a test>"}")`,
  );
  return `Unmocked network request(s) from a unit test:\n${lines.join("\n")}\nFix: ${FIX_HINT}.`;
}

function failOnViolations(): void {
  if (violations.length === 0) return;
  const message = describeViolations(takeNetworkViolations());
  throw new Error(message);
}

function installXhrGuard(): void {
  if (typeof XMLHttpRequest === "undefined") return;
  const proto = XMLHttpRequest.prototype;
  const realOpen = proto.open;
  const realSend = proto.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  proto.open = function guardedOpen(this: XMLHttpRequest, method: string, url: string | URL) {
    meta.set(this, { method: String(method).toUpperCase(), url: String(url) });
    // eslint-disable-next-line prefer-rest-params
    return (realOpen as (...a: unknown[]) => void).apply(this, arguments as unknown as unknown[]);
  } as typeof proto.open;

  proto.send = function guardedSend(this: XMLHttpRequest, ...args: unknown[]) {
    if (allowlistOwner() !== undefined) {
      allowlistedRequests += 1;
      return (realSend as (...a: unknown[]) => void).apply(this, args);
    }
    const info = meta.get(this) ?? { method: "?", url: "?" };
    violations.push({ ...info, testName: expect.getState().currentTestName ?? "" });
    // No socket: settle as a plain network error. `abort()` would never settle the axios promise.
    this.dispatchEvent(new ProgressEvent("error"));
    return undefined;
  } as typeof proto.send;
}

function installFetchGuard(): void {
  const realFetch = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof realFetch !== "function") return;
  globalThis.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (allowlistOwner() !== undefined) {
      allowlistedRequests += 1;
      return realFetch(input, init);
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    violations.push({
      method: (
        init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase(),
      url,
      testName: expect.getState().currentTestName ?? "",
    });
    return Promise.reject(new TypeError("Failed to fetch (blocked by networkGuard)"));
  } as typeof fetch;
}

export function installNetworkGuard(): void {
  installXhrGuard();
  installFetchGuard();
  beforeAll(() => {
    allowlistedRequests = 0;
  });
  afterEach(failOnViolations);
  afterAll(() => {
    failOnViolations();
    if (allowlistOwner() !== undefined && allowlistedRequests === 0) {
      throw new Error(
        `${currentTestPath()} is on the networkGuard allowlist (${allowlistOwner()}) but made no network request: remove it from NETWORK_ALLOWLIST in frontend/src/test/networkGuard.ts.`,
      );
    }
  });
}
