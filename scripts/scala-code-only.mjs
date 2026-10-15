// Pass 2 engine for scripts/check-scala-quality.mjs (HEL-1386): returns a length-preserving view
// of one Scala line in which ONLY the code inside `${...}` splices of interpolated literals is
// kept; everything else (ordinary code, string text, comments) is replaced by spaces. Pass 2 of
// the guard matches FQNs in this view, so it can only ADD findings to the base pass.
//
// Scanner state is an explicit stack that survives line breaks (`state.stack`):
//   - { kind: "lit", triple, interpolated }  a string literal
//   - { kind: "splice", depth }              a `${` splice (depth = open `{` inside it)
//   - { kind: "comment", depth }             an unclosed `/*`; Scala block comments nest, so `/*` inside
//                                            raises depth and only the `*/` that brings it to 0 returns to code
// so multi-line `"""` literals, multi-line splices and nested literals resume on the next line.
// `"` literals cannot span lines: the stack is cut at the first one at end of line.
//
// A `"` directly after an identifier character (`s"`, `f"`, `raw"`, `id"`) opens an interpolated
// literal; inside one `$$` and `$"` are text, `$ident` is plain text (no special case needed: all literal text is skipped), `${` opens a splice.
// A run of 4+ quotes closes a triple literal at its last three. Simple char literals (`'x'`,
// `'"'`, `'}'`, `'\n'`, `'A'`) are skipped. Known pass-2-only limits (they can only lose
// splice findings, never base findings): backtick identifiers containing `"`, exotic char
// literals, and a `"""` opened after code on a line that a `//` comment truncates.

export const newScanState = () => ({ stack: [] });

const isWordChar = (c) => c !== undefined && /\w/.test(c);

export function spliceCodeOnly(line, state = newScanState()) {
  const n = line.length;
  const keep = new Array(n).fill(false);
  const stack = state.stack;
  let i = 0;

  const skip = (count) => {
    i = Math.min(n, i + count);
  };

  const stepLiteral = (top) => {
    const { triple, interpolated } = top;
    if (triple ? line.startsWith('"""', i) : line[i] === '"') {
      // A run of 4+ quotes closes a triple literal at its LAST three; the rest is text.
      let run = triple ? 3 : 1;
      while (triple && line[i + run] === '"') run++;
      skip(run);
      stack.pop();
      return;
    }
    const c = line[i];
    const next = line[i + 1];
    if (!triple && c === "\\") {
      skip(2);
    } else if (interpolated && c === "$" && (next === "$" || next === '"')) {
      skip(2);
    } else if (interpolated && c === "$" && next === "{") {
      skip(2);
      stack.push({ kind: "splice", depth: 0 });
    } else {
      skip(1);
    }
  };

  const stepCode = (top) => {
    const c = line[i];
    if (c === '"') {
      const triple = line.startsWith('"""', i);
      const interpolated = isWordChar(line[i - 1]);
      skip(triple ? 3 : 1);
      stack.push({ kind: "lit", triple, interpolated });
    } else if (c === "/" && line[i + 1] === "/") {
      i = n;
    } else if (c === "/" && line[i + 1] === "*") {
      skip(2);
      stack.push({ kind: "comment", depth: 1 });
    } else if (c === "'" && charLiteralEnd() > 0) {
      const end = charLiteralEnd();
      for (let k = i; k < end; k++) keep[k] = top !== undefined;
      i = end;
    } else if (top && c === "}" && top.depth === 0) {
      stack.pop();
      skip(1); // the splice's closing `}` is not code
    } else {
      if (top) {
        keep[i] = true;
        if (c === "{") top.depth++;
        else if (c === "}") top.depth--;
      }
      skip(1);
    }
  };

  // Index just past a simple char literal starting at i, or -1.
  const charLiteralEnd = () => {
    const close = line[i + 1] === "\\" ? line.indexOf("'", i + 3) : i + 2;
    return line[close] === "'" && close - i <= 8 && line[i + 1] !== "'" ? close + 1 : -1;
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    if (top && top.kind === "comment") {
      // Earliest of `/*` (opens a level) and `*/` (closes one); each consumes both characters.
      const open = line.indexOf("/*", i);
      const close = line.indexOf("*/", i);
      if (open >= 0 && (close < 0 || open < close)) {
        top.depth++;
        i = open + 2;
      } else if (close >= 0) {
        i = close + 2;
        if (--top.depth === 0) stack.pop();
      } else i = n;
    } else if (top && top.kind === "lit") stepLiteral(top);
    else stepCode(top);
  }

  // Single-quote literals (and anything inside them) cannot continue onto the next line.
  const cut = stack.findIndex((f) => f.kind === "lit" && !f.triple);
  if (cut >= 0) stack.length = cut;
  return Array.from(line, (ch, k) => (keep[k] ? ch : " ")).join("");
}
