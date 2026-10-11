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
  "ceil(x), abs(x), round(x[,digits]), mod(a,b), coalesce(a,b,...) (first non-null), if(cond,then,else), and the UTC " +
  "date/time functions seconds_between(end,start) (float seconds, fractions kept; use it instead " +
  'of `-` on timestamps), date_trunc("unit",ts) (unit is a double-quoted literal: second, ' +
  "minute, hour, day, week (ISO Monday), month, quarter, year; a bad unit is a parse error) and " +
  "add_days(ts,n) (exact 86400-second days, fractions allowed). date_trunc/add_days return an " +
  'ISO-8601 UTC string like "2026-07-01T00:00:00Z". Timestamps may be ISO instants/offsets, ' +
  "timezone-less date-times (read as UTC), bare dates (midnight UTC) or whole-number epoch " +
  "seconds/milliseconds; a null or unparseable timestamp makes that row's result null. There is " +
  "no now(). Numeric functions are strict: a text or timestamp column used as a number nulls the " +
  "row (analyze warns numeric-op-on-text-field) — cast text to a number first. Conditionals and " +
  "booleans: if(cond,then,else) evaluates only the chosen branch (a false or null cond takes " +
  "else; nest it for several cases); both branches must share a type (integer and float mix to " +
  "float). Comparison operators = != < <= > >= are non-associative (no chaining; == and <> are " +
  "errors) and compare two numbers or two texts exactly (case-sensitive, timestamps as text — use " +
  "seconds_between for instants); number vs text is an analyze error (cast first) and a null " +
  "operand gives null. Boolean operators and, or, not (case-insensitive reserved words) and the " +
  "literals true, false follow SQL three-valued logic with precedence or < and < not < " +
  "comparison < + - < * / < unary -; and/or short-circuit. Comparisons and boolean operators " +
  "produce JSON booleans (type boolean), and a boolean column reads as a boolean ($flag + 1 " +
  'still concatenates to "true1"). A boolean expression used as a number is an analyze error — ' +
  'use if(cond,1,0), so a conditional count is a compute if($status = "Done",1,0) column then ' +
  "an aggregate sum";
