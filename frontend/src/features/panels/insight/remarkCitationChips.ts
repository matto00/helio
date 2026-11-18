import type { Root } from "mdast";

/** HEL-1744 D5 -- the remark plugin of the insight renderer. Pure (no ESM-only imports), so it is unit-tested unmocked.
 *
 *  - a `[cN]` marker whose id is a citation of the render becomes a `citation` node, which remark-rehype turns into the
 *    dedicated `helio-citation` element (via `data.hName`); any other marker stays plain text;
 *  - reference definitions (`[c1]: https://...`) are removed, and a reference that used one is flattened back to its literal
 *    `[label]` text, so a definition can never turn a marker into a link;
 *  - headings become a strong paragraph (the renderer allows no heading element, and unwrapping one would run its text into
 *    the next block);
 *  - image references are dropped. */
export interface CitationChipsOptions {
  /** The citation ids of this render. */
  known: readonly string[];
}

/** The element name the plugin emits and the renderer maps to the chip. */
export const CITATION_ELEMENT = "helio-citation";
/** The hast property carrying the citation id (rendered as the `data-citation` attribute). */
export const CITATION_PROP = "dataCitation";

const MARKER = /\[(c\d+)\]/g;

interface Node {
  type: string;
  value?: string;
  label?: string | null;
  identifier?: string;
  children?: Node[];
  data?: Record<string, unknown>;
}

function citation(id: string): Node {
  return {
    type: "citation",
    data: { hName: CITATION_ELEMENT, hProperties: { [CITATION_PROP]: id } },
    children: [],
  };
}

function splitText(value: string, known: ReadonlySet<string>): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of value.matchAll(MARKER)) {
    if (!known.has(m[1])) continue;
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push(citation(m[1]));
    last = start + m[0].length;
  }
  if (last === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(children: Node[], known: ReadonlySet<string>): Node[] {
  const out: Node[] = [];
  for (const child of children) {
    switch (child.type) {
      case "definition":
      case "imageReference":
        break;
      case "text":
        out.push(...splitText(child.value ?? "", known));
        break;
      case "linkReference": {
        // The label as written; a known marker is a chip, anything else keeps its brackets as text.
        const label = child.label ?? child.identifier ?? "";
        out.push(
          /^c\d+$/.test(label) && known.has(label)
            ? citation(label)
            : { type: "text", value: `[${label}]` },
        );
        break;
      }
      case "heading":
        out.push({
          type: "paragraph",
          children: [{ type: "strong", children: transform(child.children ?? [], known) }],
        });
        break;
      default:
        out.push(child.children ? { ...child, children: transform(child.children, known) } : child);
    }
  }
  return out;
}

export function remarkCitationChips(options: CitationChipsOptions) {
  const known = new Set(options.known);
  return (tree: Root) => {
    const root = tree as unknown as Node;
    root.children = transform(root.children ?? [], known);
  };
}
