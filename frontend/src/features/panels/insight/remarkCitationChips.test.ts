// HEL-1744 D5 -- the pure citation plugin, unmocked (react-markdown itself is mocked in jest; the sanitiser is asserted in e2e).
import { CITATION_ELEMENT, remarkCitationChips } from "./remarkCitationChips";

type N = {
  type: string;
  value?: string;
  label?: string;
  children?: N[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

function run(children: N[], known = ["c1", "c2"]): N[] {
  const root = { type: "root", children } as unknown as Parameters<
    ReturnType<typeof remarkCitationChips>
  >[0];
  remarkCitationChips({ known })(root);
  return (root as unknown as N).children ?? [];
}
const p = (...kids: N[]): N => ({ type: "paragraph", children: kids });
const text = (value: string): N => ({ type: "text", value });

describe("remarkCitationChips", () => {
  it("turns a known marker into a citation element and keeps the text around it", () => {
    const [para] = run([p(text("Up [c1]. Down."))]);
    expect(para.children?.map((c) => c.type)).toEqual(["text", "citation", "text"]);
    expect(para.children?.[1].data).toEqual({
      hName: CITATION_ELEMENT,
      hProperties: { dataCitation: "c1" },
    });
    expect(para.children?.[0].value).toBe("Up ");
    expect(para.children?.[2].value).toBe(". Down.");
  });

  it("leaves an unknown marker as plain text", () => {
    const [para] = run([p(text("Odd [c9]."))]);
    expect(para.children).toEqual([text("Odd [c9].")]);
  });

  it("removes definitions, and a reference using one becomes a chip (known) or literal text (unknown)", () => {
    const out = run([
      { type: "definition", label: "c1" },
      p(
        { type: "linkReference", label: "c1", children: [text("c1")] },
        { type: "linkReference", label: "c9", children: [text("c9")] },
      ),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].children?.[0].type).toBe("citation");
    expect(out[0].children?.[1]).toEqual(text("[c9]"));
  });

  it("makes a heading a strong paragraph and drops an image reference", () => {
    const out = run([
      { type: "heading", children: [text("Title [c2]")] },
      p({ type: "imageReference", label: "x" }),
    ]);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].children?.[0].type).toBe("strong");
    expect(out[0].children?.[0].children?.map((c) => c.type)).toEqual(["text", "citation"]);
    expect(out[1].children).toEqual([]);
  });

  it("does not touch inline code", () => {
    const code: N = { type: "inlineCode", value: "[c1]" };
    expect(run([p(code)])[0].children).toEqual([code]);
  });
});
