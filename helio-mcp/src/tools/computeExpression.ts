/**
 * The compute-step expression reference, one exported string so every tool description that
 * authors or validates a compute step (`add_pipeline_step`, `propose_pipeline`,
 * `analyze_pipeline_proposal`) says the same thing. `computeExpressionDescription.test.ts` asserts it
 * names every function in `shared-test-fixtures/compute-expression-functions.json`, which the
 * backend asserts equals `ExpressionEvaluator.SupportedFunctions`. Grammar: docs/compute-expression-grammar.md.
 */
export const COMPUTE_EXPRESSION_DOC =
  "{column, expression, type?} — appends `column`, computed per row from `expression`. Columns are " +
  "referenced as `$name` (the `$` is required); literals are numbers and double-quoted strings; " +
  "operators + - * / and unary -; `+` concatenates when either side is text or a timestamp. " +
  "Functions: concat(a,b,...), substring(s,start,end), lower(s), upper(s), length(s), floor(x), " +
  "ceil(x), abs(x), round(x[,digits]), mod(a,b), coalesce(a,b,...) (first non-null), and the UTC " +
  "date/time functions seconds_between(end,start) (float seconds, fractions kept; use it instead " +
  'of `-` on timestamps), date_trunc("unit",ts) (unit is a double-quoted literal: second, ' +
  "minute, hour, day, week (ISO Monday), month, quarter, year; a bad unit is a parse error) and " +
  "add_days(ts,n) (exact 86400-second days, fractions allowed). date_trunc/add_days return an " +
  'ISO-8601 UTC string like "2026-07-01T00:00:00Z". Timestamps may be ISO instants/offsets, ' +
  "timezone-less date-times (read as UTC), bare dates (midnight UTC) or whole-number epoch " +
  "seconds/milliseconds; a null or unparseable timestamp makes that row's result null. There is " +
  "no now(). Numeric functions are strict: a text or timestamp column used as a number nulls the " +
  "row (analyze warns numeric-op-on-text-field) — cast text to a number first";
