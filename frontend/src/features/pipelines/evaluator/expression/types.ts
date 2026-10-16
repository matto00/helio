// HEL-1581 — the compute interpreter's intermediate value: a number (VNum), string (VStr), boolean
// (VBool) or null (VNull). The JS types are disjoint, so no wrapper is needed.
export type Val = number | string | boolean | null;

/** A per-row evaluation error (type error, unknown field, division by zero): the row's value is `null`. */
export class EvalError extends Error {}
