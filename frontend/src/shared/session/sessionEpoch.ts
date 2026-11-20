/**
 * HEL-1634 D2 -- the session epoch. It is bumped by the epoch middleware on every `clearAuth`, so a
 * thunk, listener effect or cache load that captured the epoch when it started can tell, when its
 * result arrives, that the session it belonged to has ended and must not write.
 */
let epoch = 0;

export function getSessionEpoch(): number {
  return epoch;
}

export function bumpSessionEpoch(): void {
  epoch += 1;
}

/**
 * Dispatches `action` only if the session that started the work is still the current one. For the
 * plain (non-thunk) actions a thunk or effect dispatches after an `await`; the thunk lifecycle
 * actions themselves are gated by the epoch middleware. Returns whether it dispatched.
 */
export function dispatchIfSameSession(
  dispatch: (action: never) => unknown,
  startEpoch: number,
  action: unknown,
): boolean {
  if (startEpoch !== epoch) return false;
  dispatch(action as never);
  return true;
}
