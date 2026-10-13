// HEL-1501 hook-sequence comparison. Prints the ordered primitive React hook calls of
// usePipelineDetailPage (comment-stripped, argument text normalised via the TS printer) with the
// named extracted sub-hooks inlined. Usage:
//   node hook-sequence.cjs base <gitRef> <relFile> [inlineName=relFile ...]
//   node hook-sequence.cjs tree <relFile> [inlineName=relFile ...]
const ts = require(require.resolve("typescript", { paths: [process.cwd() + "/frontend"] }));
const fs = require("fs");
const { execFileSync } = require("child_process");
const mode = process.argv[2];
let ref, file, rest;
if (mode === "base") { ref = process.argv[3]; file = process.argv[4]; rest = process.argv.slice(5); }
else { file = process.argv[3]; rest = process.argv.slice(4); }
const read = (f) => (mode === "base" ? execFileSync("git", ["show", `${ref}:${f}`], { encoding: "utf8" }) : fs.readFileSync(f, "utf8"));
const inline = {};
for (const kv of rest) { const [n, f] = kv.split("="); inline[n] = f; }
const printer = ts.createPrinter({ removeComments: true });
function seqOf(src, fnName, out, paramMap) {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  sf.forEachChild(function find(n) {
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === fnName) fn = n;
  });
  if (!fn) throw new Error("no function " + fnName);
  const printNode = (n) => printer.printNode(ts.EmitHint.Unspecified, n, sf).replace(/\s+/g, " ");
  (function walk(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^use[A-Z]/.test(n.expression.text)) {
      const name = n.expression.text;
      if (inline[name] && !paramMap) {
        // visit the call's arguments' own hook calls first (none expected), then inline
        seqOf(read(inline[name]), name, out, true);
        return;
      }
      // normalise: callbacks' bodies are checked by their text; hooks inside callbacks don't exist
      out.push(name + "(" + n.arguments.map(printNode).join(", ") + ")");
      return;
    }
    n.forEachChild(walk);
  })(fn.body);
}
// `paramMap` flag just marks "currently inside an inlined hook" (no nested inlining needed).
const out = [];
seqOf(read(file), "usePipelineDetailPage", out, false);
console.log(out.join("\n"));
