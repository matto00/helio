// HEL-1575 D4: the warm-cache numbers, named once. 15 minutes is owner ruling `client-persistent-15m`;
// 8 warm tabs is ruling `scroll-cap20-lru`.

/** How long after a tab was last viewed its loaded state still renders instantly on return. */
export const WARM_TTL_MS = 15 * 60_000;

/** Only this many most-recently-viewed tabs are kept warm (the active tab is always live). */
export const WARM_MAX = 8;

/** D5: the largest stored entry (JSON.stringify length); a bigger one is not stored. */
export const WARM_ENTRY_MAX_BYTES = 1024 * 1024;

/** D5: lazily restoring a non-target tab on activation waits at most this long for IndexedDB. */
export const LAZY_RESTORE_TIMEOUT_MS = 500;

/** D1 step 3: hydration waits at most this long for the target's warm restore decision. */
export const HYDRATE_RESTORE_TIMEOUT_MS = 3000;

/** D5: logout waits at most this long for the browser copy to be cleared. */
export const LOGOUT_CLEAR_TIMEOUT_MS = 1000;

/** D5: IndexedDB writes are debounced, off the interaction path. */
export const WARM_WRITE_DEBOUNCE_MS = 400;

/** D4: expired retentions are swept at this cadence while tabs exist. */
export const WARM_SWEEP_INTERVAL_MS = 60_000;

/** D4: `ownWriteAt` carries this much slack for server-clock offset error. */
export const OWN_WRITE_SLACK_MS = 2000;
