import { extractProposal } from "./proposalExtraction";
import type { ClaudeToolMessageDto } from "./types";

describe("extractProposal", () => {
  it("returns null for a transcript with no propose_* tool calls", () => {
    const transcript: ClaudeToolMessageDto[] = [
      { role: "user", content: [{ blockType: "text", text: "hi" }] },
      { role: "assistant", content: [{ blockType: "text", text: "hello" }] },
    ];

    expect(extractProposal(transcript)).toBeNull();
  });

  it("extracts a successful propose_dashboard call's tool_use input", () => {
    const dashboardProposal = { dashboardName: "Revenue", panels: [] };
    const transcript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [
          {
            blockType: "tool_use",
            id: "tu-1",
            name: "propose_dashboard",
            input: dashboardProposal,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            blockType: "tool_result",
            toolUseId: "tu-1",
            content: JSON.stringify(dashboardProposal),
            isError: false,
          },
        ],
      },
    ];

    expect(extractProposal(transcript)).toEqual({ kind: "dashboard", input: dashboardProposal });
  });

  it("ignores a propose_* call whose tool_result is isError: true", () => {
    const transcript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [
          {
            blockType: "tool_use",
            id: "tu-1",
            name: "propose_dashboard",
            input: { dashboardName: "X", panels: [] },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            blockType: "tool_result",
            toolUseId: "tu-1",
            content: "validation failed",
            isError: true,
          },
        ],
      },
    ];

    expect(extractProposal(transcript)).toBeNull();
  });

  it("ignores a propose_* call with no paired tool_result yet", () => {
    const transcript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [
          {
            blockType: "tool_use",
            id: "tu-1",
            name: "propose_dashboard",
            input: { dashboardName: "X", panels: [] },
          },
        ],
      },
    ];

    expect(extractProposal(transcript)).toBeNull();
  });

  it("recognizes propose_pipeline and propose_combined kinds", () => {
    const pipelineTranscript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [
          {
            blockType: "tool_use",
            id: "tu-1",
            name: "propose_pipeline",
            input: { pipelineName: "ETL" },
          },
        ],
      },
      {
        role: "user",
        content: [{ blockType: "tool_result", toolUseId: "tu-1", content: "{}", isError: false }],
      },
    ];
    expect(extractProposal(pipelineTranscript)?.kind).toBe("pipeline");

    const combinedTranscript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [{ blockType: "tool_use", id: "tu-2", name: "propose_combined", input: {} }],
      },
      {
        role: "user",
        content: [{ blockType: "tool_result", toolUseId: "tu-2", content: "{}", isError: false }],
      },
    ];
    expect(extractProposal(combinedTranscript)?.kind).toBe("combined");
  });

  // HEL-665 regression: `AssistantToolExecutor.executeProposePatchSet` (backend) returns the
  // *preview* (`{edits: EditPreview[]}`) as the tool_result content, NOT the original `PatchSet`
  // (`{summary?, edits: Edit[]}`) design.md D4 originally described parsing the tool_result as.
  // This locks in reading the `PatchSet` shape from `tool_use.input` instead — the tool_result's
  // differently-shaped `edits` array must never leak through as the extracted proposal.
  it("extracts propose_patch_set's PatchSet from tool_use.input, not the differently-shaped tool_result preview", () => {
    const patchSet = {
      summary: "Rename a panel",
      edits: [{ target: { kind: "panel", id: "p-1" }, op: "update", patch: { title: "New" } }],
    };
    const previewResponse = { edits: [{ index: 0, kind: "panel", before: {}, after: {} }] };
    const transcript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [
          { blockType: "tool_use", id: "tu-1", name: "propose_patch_set", input: patchSet },
        ],
      },
      {
        role: "user",
        content: [
          {
            blockType: "tool_result",
            toolUseId: "tu-1",
            content: JSON.stringify(previewResponse),
            isError: false,
          },
        ],
      },
    ];

    const extraction = extractProposal(transcript);
    expect(extraction).toEqual({ kind: "patch", input: patchSet });
  });

  it("returns the LATEST successful propose_* call when there are multiple", () => {
    const first = { dashboardName: "First draft", panels: [] };
    const second = { dashboardName: "Revised draft", panels: [] };
    const transcript: ClaudeToolMessageDto[] = [
      {
        role: "assistant",
        content: [{ blockType: "tool_use", id: "tu-1", name: "propose_dashboard", input: first }],
      },
      {
        role: "user",
        content: [
          {
            blockType: "tool_result",
            toolUseId: "tu-1",
            content: JSON.stringify(first),
            isError: false,
          },
        ],
      },
      { role: "user", content: [{ blockType: "text", text: "Actually, make it different" }] },
      {
        role: "assistant",
        content: [{ blockType: "tool_use", id: "tu-2", name: "propose_dashboard", input: second }],
      },
      {
        role: "user",
        content: [
          {
            blockType: "tool_result",
            toolUseId: "tu-2",
            content: JSON.stringify(second),
            isError: false,
          },
        ],
      },
    ];

    expect(extractProposal(transcript)).toEqual({ kind: "dashboard", input: second });
  });
});
