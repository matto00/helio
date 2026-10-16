/**
 * HEL-1617: process-level safety net. Node >= 15 kills the process on an unhandled rejection, which
 * for a stdio MCP server means every connected agent loses its tools mid-run. This logs a bounded
 * line to stderr (never stdout: that is the JSON-RPC stream) and keeps serving. It is a backstop
 * only -- code paths must still observe their own promises. `uncaughtException` is deliberately
 * NOT handled: a synchronous throw can leave state inconsistent.
 */

const MAX_LOG_CHARS = 500;

/** The slice of `process` the guard needs (lets tests pass a fake emitter). */
export interface RejectionEmitter {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

export function installUnhandledRejectionGuard(
  proc: RejectionEmitter,
  write: (line: string) => void,
): void {
  proc.on("unhandledRejection", (reason) => {
    const text = reason instanceof Error ? reason.message : String(reason);
    const msg =
      text.length > MAX_LOG_CHARS ? `${text.slice(0, MAX_LOG_CHARS)}... [truncated]` : text;
    write(`helio-mcp: unhandled rejection: ${msg}\n`);
  });
}
