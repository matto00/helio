// The compute expression function reference shown in the step editor's "Functions" disclosure.
// `computeFunctionReference.test.ts` asserts the names equal
// shared-test-fixtures/compute-expression-functions.json, which the backend asserts equals
// ExpressionEvaluator.SupportedFunctions, so a function added to the engine cannot go undocumented here.
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
