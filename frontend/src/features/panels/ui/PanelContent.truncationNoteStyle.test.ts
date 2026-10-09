import { readFileSync } from "fs";
import { join } from "path";

// HEL-1358 skeptic-final-1 CR1 — STRUCTURAL guard only (jsdom does no layout): the truncation note
// must share the annotation's 2-line-clamp rule and never be forced to one line, so the total is not
// ellipsised away at the grid's narrowest width. It does not prove the rendered layout (the HEL-1398
// e2e does). HEL-1398 item 3: the standalone-rule match runs on comment-stripped CSS and anchors the
// selector at a rule boundary, so a rule that follows a comment (or a `}`) is still caught while the
// shared `a,\n.note {` list and the `a + .note {` join are not.
const css = readFileSync(join(__dirname, "PanelContent.css"), "utf8");

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/** The pre-HEL-1398 matcher: misses a rule that follows a comment. */
const OLD_STANDALONE = /(?:^|\})\s*\.chart-panel__truncation-note\s*\{([^}]*)\}/;
/** A selector that starts a rule: it must follow the start of input or a `}` / `{` / `;` (plus
 *  whitespace). That boundary anchor is what excludes a selector preceded by a comma (the shared
 *  `a,\n.note {` list) or a combinator (`a + .note {`) -- both put other characters in between. */
const STANDALONE_NOTE_RULE = /(?:^|[};{])\s*\.chart-panel__truncation-note\s*\{([^}]*)\}/;

const standaloneNoteRule = (source: string) => stripComments(source).match(STANDALONE_NOTE_RULE);

it("shares the annotation's multi-line clamp rule and has no nowrap", () => {
  const shared = stripComments(css).match(
    /\.chart-panel__annotation,\s*\.chart-panel__truncation-note\s*\{([^}]*)\}/,
  );
  expect(shared).not.toBeNull();
  expect(shared![1]).toMatch(/-webkit-line-clamp:\s*2/);
  expect(standaloneNoteRule(css)).toBeNull();
  expect(shared![1]).not.toMatch(/white-space:\s*nowrap/);
});

describe("standalone-note-rule matcher (HEL-1398)", () => {
  const afterComment = `.a { color: red; }\n/* note */\n.chart-panel__truncation-note { white-space: nowrap; }`;

  it("old matcher is a false green on a rule after a comment; the new one is red", () => {
    expect(afterComment.match(OLD_STANDALONE)).toBeNull(); // the false green
    expect(standaloneNoteRule(afterComment)).not.toBeNull(); // red: now caught
  });

  it("catches a rule right after a closing brace and a first-in-file rule", () => {
    expect(
      standaloneNoteRule(`.a { x: y; }\n.chart-panel__truncation-note { x: y; }`),
    ).not.toBeNull();
    expect(standaloneNoteRule(`.chart-panel__truncation-note { x: y; }`)).not.toBeNull();
  });

  it("catches a standalone rule nested in a container query block", () => {
    expect(
      standaloneNoteRule(
        `@container panel-card (max-width: 1px) {\n  .chart-panel__truncation-note { x: y; }\n}`,
      ),
    ).not.toBeNull();
  });

  it("does not match a selector preceded by a comma (C1: the shared list)", () => {
    expect(
      standaloneNoteRule(`.chart-panel__annotation,\n.chart-panel__truncation-note { x: y; }`),
    ).toBeNull();
    expect(
      standaloneNoteRule(
        `/* c */\n.chart-panel__annotation,\n/* d */\n.chart-panel__truncation-note { x: y; }`,
      ),
    ).toBeNull();
  });

  it("does not match the join rule or the inner-span rules", () => {
    expect(
      standaloneNoteRule(`.chart-panel__annotation + .chart-panel__truncation-note { x: y; }`),
    ).toBeNull();
    expect(standaloneNoteRule(`.chart-panel__truncation-note-short { x: y; }`)).toBeNull();
  });

  it("ignores a commented-out rule", () => {
    expect(standaloneNoteRule(`/* .chart-panel__truncation-note { x: y; } */`)).toBeNull();
  });
});
