// HEL-1575 D4/D7: every capture time in the tabs/warm-cache code is in SERVER time, so a skewed client
// clock can neither hide a change nor invent one. The offset is measured when a change-signals response
// arrives (`serverNow - Date.now()`); it carries up to one round trip of error (design D7, accepted).
// Module-level (not Redux) so thunks, reducers' meta creators and the warm cache can read it without a
// store handle.

let serverOffsetMs = 0;

export function setServerOffsetMs(offsetMs: number): void {
  serverOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
}

export function getServerOffsetMs(): number {
  return serverOffsetMs;
}

/** The current instant in server time, epoch milliseconds. */
export function serverNowMs(): number {
  return Date.now() + serverOffsetMs;
}

/** The current instant in server time, ISO-8601 (the wire form of `lastViewedAt`/`ownWriteAt`). */
export function serverNowIso(): string {
  return new Date(serverNowMs()).toISOString();
}

export function resetServerClock(): void {
  serverOffsetMs = 0;
}
