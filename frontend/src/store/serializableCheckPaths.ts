/** Action paths the store's serializability check skips: a toast's action closures are intentional
 *  non-serializable values (HEL-413). `payload.items` covers every row's `action.onClick` of a
 *  multi-item toast (HEL-1172). Kept apart from `store.ts` so a test can import the real list. */
export const TOAST_IGNORED_ACTION_PATHS = ["payload.action.onClick", "payload.items"];
