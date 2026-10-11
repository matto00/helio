// The compute expression function and operator reference shown in the step editor's "Functions and operators"
// disclosure. `computeFunctionReference.test.ts` asserts the names equal
// shared-test-fixtures/compute-expression-functions.json, which the backend asserts equals
// ExpressionEvaluator.SupportedFunctions / SupportedOperators / BooleanLiterals, so a function or operator added
// to the engine cannot go undocumented here.
// Semantics: docs/compute-expression-grammar.md.

export interface ComputeFunctionDoc {
  name: string;
  signature: string;
  description: string;
}

export const COMPUTE_FUNCTION_REFERENCE: readonly ComputeFunctionDoc[] = [
  { name: "abs", signature: "abs(x)", description: "Absolute value." },
  {
    name: "add_days",
    signature: "add_days(ts, n)",
    description:
      "ts plus exactly n x 86400 seconds (n may be fractional) as a UTC timestamp. n must be a number.",
  },
  { name: "ceil", signature: "ceil(x)", description: "Round up to a whole number." },
  {
    name: "coalesce",
    signature: "coalesce(a, b, ...)",
    description: "The first argument that is not null.",
  },
  { name: "concat", signature: "concat(a, b, ...)", description: "Join values as text." },
  {
    name: "date_trunc",
    signature: 'date_trunc("unit", ts)',
    description:
      "Floor ts to the start of a UTC bucket. Unit, in double quotes: second, minute, hour, day, week (Monday), month, quarter, year.",
  },
  { name: "floor", signature: "floor(x)", description: "Round down to a whole number." },
  {
    name: "if",
    signature: "if(cond, then, else)",
    description:
      "then when cond is true, else when it is false or null; only the chosen branch is evaluated. Nest for several cases. Both branches must have the same type (numbers may mix). Count rows: sum of if(cond, 1, 0).",
  },
  { name: "length", signature: "length(s)", description: "Number of characters in s." },
  { name: "lower", signature: "lower(s)", description: "Lowercase text." },
  { name: "mod", signature: "mod(a, b)", description: "Remainder; the sign follows b." },
  {
    name: "round",
    signature: "round(x) / round(x, digits)",
    description: "Round half away from zero, optionally to a number of digits.",
  },
  {
    name: "seconds_between",
    signature: "seconds_between(end, start)",
    description:
      "end minus start in seconds, with fractions. Timestamps are read as UTC; an unreadable one gives null.",
  },
  {
    name: "substring",
    signature: "substring(s, start, end)",
    description: "Part of s from start up to (not including) end, counted from 0.",
  },
  { name: "upper", signature: "upper(s)", description: "Uppercase text." },
];

const COMPARE_NOTE =
  "Compares two numbers, or two texts exactly (by character code, so case matters); a number against text is an error. A null side gives null. Cannot be chained.";

/** Comparison and boolean operators, in the order the backend lists them (loosest-binding group last). */
export const COMPUTE_OPERATOR_REFERENCE: readonly ComputeFunctionDoc[] = [
  { name: "=", signature: "a = b", description: `Equal. ${COMPARE_NOTE}` },
  { name: "!=", signature: "a != b", description: "Not equal. Same rules as =." },
  { name: "<", signature: "a < b", description: "Less than. Same rules as =; not for booleans." },
  { name: "<=", signature: "a <= b", description: "Less than or equal. Same rules as <." },
  { name: ">", signature: "a > b", description: "Greater than. Same rules as <." },
  { name: ">=", signature: "a >= b", description: "Greater than or equal. Same rules as <." },
  {
    name: "and",
    signature: "a and b",
    description:
      "True when both are true. false and anything is false, even null. Binds tighter than or.",
  },
  {
    name: "or",
    signature: "a or b",
    description: "True when either is true. true or anything is true, even null. Loosest operator.",
  },
  {
    name: "not",
    signature: "not a",
    description: "Reverses a boolean; not null is null. Applies to the whole comparison after it.",
  },
];

/** The boolean literals; reserved words, so they are never column names here. */
export const COMPUTE_LITERAL_REFERENCE: readonly ComputeFunctionDoc[] = [
  { name: "true", signature: "true", description: "The boolean true." },
  { name: "false", signature: "false", description: "The boolean false." },
];
