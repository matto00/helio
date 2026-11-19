// HEL-1746 D1-D6: the shared ask body through the real service, thunks and store (only httpClient is mocked). react-markdown is not
// rendered in jest; the stub below renders text and the chips for cited markers, and the real renderer is asserted in e2e.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";

import { httpClient } from "../../../services/httpClient";
import { renderWithStore } from "../../../test/renderWithStore";
import { resetProvenanceCache } from "../../panels/provenance/provenanceCache";
import type { User } from "../../auth/types/user";
import type { AskScope } from "../types/ask";
import { PIN_DRAFT_REASON } from "./AskAnswerCard";
import { AskPanel } from "./AskPanel";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../panels/provenance/provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));
jest.mock("../../panels/insight/InsightMarkdown", () => ({
  InsightMarkdown: ({
    markdown,
    citations,
    renderCitation,
  }: {
    markdown: string;
    citations: string[];
    renderCitation: (id: string) => import("react").ReactNode;
  }) => (
    <p>
      {markdown.split(/(\[c\d+\])/).map((part, i) => {
        const id = /^\[(c\d+)\]$/.exec(part)?.[1];
        return id && citations.includes(id) ? <span key={i}>{renderCitation(id)}</span> : part;
      })}
    </p>
  ),
}));
const http = jest.mocked(httpClient);

const user = (tier: User["tier"], id = "u-1"): User => ({
  id,
  email: "a@example.com",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier,
});

const PIN_REQUEST = {
  kind: "insight",
  name: "Why is revenue up?",
  rootId: "p-1",
  config: { prompt: "Why is revenue up?", reads: { outputs: ["o-1", "o-2"] }, refresh: "manual" },
};

function answer(over: Record<string, unknown> = {}) {
  return {
    answer: "Revenue is 10 [c1] and cost is 5 [c2]. Unknown [c9].",
    citations: [
      { id: "c1", outputId: "o-1", field: "revenue", number: 10, isPct: false },
      { id: "c2", outputId: "o-2", field: "cost", number: 5, isPct: false },
    ],
    citedOutputs: [
      { id: "o-1", name: "Revenue" },
      { id: "o-2", name: "Cost" },
    ],
    pin: { pipelineId: "p-1", request: PIN_REQUEST },
    ...over,
  };
}

function failure(status: number, data: unknown): AxiosError {
  return new AxiosError("fail", undefined, undefined, undefined, { status, data } as AxiosResponse);
}

const DASHBOARD: AskScope = { kind: "dashboard", id: "d-1" };
const OUTPUT: AskScope = { kind: "output", id: "o-1" };

function setup(
  tier: User["tier"] = "beta",
  props: { scope?: AskScope; draftActive?: boolean; ownerId?: string } = {},
) {
  const ctx = renderWithStore(
    <AskPanel scope={props.scope ?? DASHBOARD} draftActive={props.draftActive} />,
    {
      auth: { status: "authenticated", currentUser: user(tier) },
      dashboards: {
        items: [{ id: "d-1", name: "Board", ownerId: props.ownerId ?? "u-1" }],
        selectedDashboardId: "d-1",
      },
      pipelines: {
        items: [
          {
            id: "p-1",
            name: "Revenue rollup",
            roots: [],
            lastRunStatus: null,
            lastRunAt: null,
            lastRunRowCount: null,
          },
        ],
      },
    },
  );
  return ctx;
}

const field = () => screen.getByRole("textbox", { name: "Your question" });
const askButton = () => screen.getByRole("button", { name: "Ask" });

function ask(text = "Why is revenue up?") {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.click(askButton());
}

const asks = () => http.post.mock.calls.filter(([url]) => String(url).endsWith("/ask"));

beforeEach(() => {
  jest.resetAllMocks();
  resetProvenanceCache();
  http.get.mockResolvedValue({ data: { items: [] } });
});

describe("AskPanel form (D6)", () => {
  it("has a visible label, a disabled submit while empty, and no model picker", () => {
    setup();
    expect(field()).toBeInTheDocument();
    expect(askButton()).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/model/i)).not.toBeInTheDocument();
  });

  it("disables submit over 2000 characters and sends nothing", () => {
    setup();
    fireEvent.change(field(), { target: { value: "x".repeat(2001) } });
    expect(askButton()).toBeDisabled();
    expect(asks()).toHaveLength(0);
  });

  it("Enter submits exactly one request with {question}; Shift+Enter does not", async () => {
    http.post.mockResolvedValue({ data: answer({ pin: null }) });
    setup();
    fireEvent.change(field(), { target: { value: "Why?" } });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(asks()).toHaveLength(0);
    fireEvent.keyDown(field(), { key: "Enter" });
    await screen.findByRole("region", { name: "Answer" });
    expect(asks()).toEqual([["/api/dashboards/d-1/ask", { question: "Why?" }]]);
  });

  it("an Output scope posts to the Output route", async () => {
    http.post.mockResolvedValue({ data: answer({ pin: null }) });
    setup("beta", { scope: OUTPUT });
    ask("Why?");
    await screen.findByRole("region", { name: "Answer" });
    expect(asks()).toEqual([["/api/outputs/o-1/ask", { question: "Why?" }]]);
  });

  it("announces pending then arrival in one live region and leaves focus in the field", async () => {
    let resolve!: (v: unknown) => void;
    http.post.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    setup();
    field().focus();
    ask();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Asking…");
    resolve({ data: answer({ pin: null }) });
    await screen.findByRole("region", { name: "Answer" });
    expect(screen.getByRole("status")).toHaveTextContent("Answer ready.");
    expect(field()).toHaveFocus();
  });
});

describe("AskPanel answer card (D2)", () => {
  it("renders a chip per cited marker with its ordinal, plain text for an uncited marker, and names the cited Outputs", async () => {
    http.post.mockResolvedValue({ data: answer() });
    setup();
    ask();
    const chips = await screen.findAllByRole("button", { name: /open provenance/ });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAccessibleName("Source: revenue 10, open provenance");
    expect(chips[0]).toHaveTextContent("1");
    expect(chips[1]).toHaveTextContent("2");
    expect(screen.getByRole("region", { name: "Answer" })).toHaveTextContent("Unknown [c9].");
    expect(screen.getByText("Based on Revenue, Cost")).toBeInTheDocument();
  });

  it("never shows a model, token or cost value even if the server sent one", async () => {
    http.post.mockResolvedValue({
      data: { ...answer(), model: "model-secret-xyz", inputTokens: 987654, costMicros: 4242421 },
    });
    const { container } = setup();
    ask();
    await screen.findByRole("region", { name: "Answer" });
    for (const secret of ["model-secret-xyz", "987654", "4242421"]) {
      expect(container).not.toHaveTextContent(secret);
    }
  });
});

describe("AskPanel pin (D4)", () => {
  it("renders no Pin action when pin is null (a viewer)", async () => {
    http.post.mockResolvedValue({ data: answer({ pin: null }) });
    setup();
    ask();
    await screen.findByRole("region", { name: "Answer" });
    expect(screen.queryByRole("button", { name: /pin/i })).not.toBeInTheDocument();
  });

  it("POSTs pin.request unchanged (no answer text), places a panel for the dashboard owner, and cannot be repeated", async () => {
    http.post.mockImplementation((url: string) => {
      if (url.endsWith("/ask")) return Promise.resolve({ data: answer() });
      if (url === "/api/pipelines/p-1/outputs") {
        return Promise.resolve({
          data: { id: "o-new", pipelineId: "p-1", name: "Why is revenue up?", kind: "insight" },
        });
      }
      if (url === "/api/panels")
        return Promise.resolve({ data: { id: "pn-1", dashboardId: "d-1" } });
      return Promise.reject(new Error(url));
    });
    setup();
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    await screen.findByText("Pinned.");
    const pin = http.post.mock.calls.find(([url]) => url === "/api/pipelines/p-1/outputs");
    expect(pin?.[1]).toEqual(PIN_REQUEST);
    expect(JSON.stringify(pin?.[1])).not.toContain("Revenue is 10");
    const panel = http.post.mock.calls.find(([url]) => url === "/api/panels");
    expect(panel?.[1]).toMatchObject({
      dashboardId: "d-1",
      type: "output",
      config: { outputId: "o-new" },
    });
    expect(screen.getByText(/placed on this dashboard/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pin as insight" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Pinned as an insight."),
    );
  });

  it("a non-owner's pin is saved to the pipeline with a link, and no panel is placed", async () => {
    http.post.mockImplementation((url: string) =>
      url.endsWith("/ask")
        ? Promise.resolve({ data: answer() })
        : Promise.resolve({ data: { id: "o-new", pipelineId: "p-1", name: "n", kind: "insight" } }),
    );
    setup("beta", { ownerId: "someone-else" });
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    await screen.findByText("Pinned.");
    expect(http.post.mock.calls.some(([url]) => url === "/api/panels")).toBe(false);
    expect(screen.getByRole("link", { name: "Revenue rollup" })).toHaveAttribute(
      "href",
      "/pipelines/p-1",
    );
  });

  // HEL-1743 D13: a pin renders once, with trigger `pin`; the render request never decides the pin's outcome.
  it("starts exactly one render with trigger pin after a successful create", async () => {
    http.post.mockImplementation((url: string) => {
      if (url.endsWith("/ask")) return Promise.resolve({ data: answer() });
      if (url.endsWith("/insight/refresh"))
        return Promise.resolve({ data: { outputId: "o-new", started: true } });
      return Promise.resolve({
        data: { id: "o-new", pipelineId: "p-1", name: "n", kind: "insight" },
      });
    });
    setup("beta", { ownerId: "someone-else" });
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    await screen.findByText("Pinned.");
    const refreshes = http.post.mock.calls.filter(([url]) =>
      String(url).endsWith("/insight/refresh"),
    );
    expect(refreshes).toEqual([["/api/outputs/o-new/insight/refresh", { trigger: "pin" }]]);
  });

  it("a failing refresh request leaves the pin announced as successful", async () => {
    http.post.mockImplementation((url: string) => {
      if (url.endsWith("/ask")) return Promise.resolve({ data: answer() });
      if (url.endsWith("/insight/refresh")) return Promise.reject(failure(429, {}));
      return Promise.resolve({
        data: { id: "o-new", pipelineId: "p-1", name: "n", kind: "insight" },
      });
    });
    setup("beta", { ownerId: "someone-else" });
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    await screen.findByText("Pinned.");
    expect(screen.queryByText("Couldn't pin this answer.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pin as insight" })).not.toBeInTheDocument();
  });

  it("a failed placement leaves the Output saved with the pipeline link", async () => {
    http.post.mockImplementation((url: string) => {
      if (url.endsWith("/ask")) return Promise.resolve({ data: answer() });
      if (url === "/api/panels") return Promise.reject(failure(500, {}));
      return Promise.resolve({
        data: { id: "o-new", pipelineId: "p-1", name: "n", kind: "insight" },
      });
    });
    setup();
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    await screen.findByText("Pinned.");
    expect(screen.getByRole("link", { name: "Revenue rollup" })).toBeInTheDocument();
  });

  it("a failed pin shows an inline error with Retry, and Retry pins", async () => {
    let creates = 0;
    http.post.mockImplementation((url: string) => {
      if (url.endsWith("/ask")) return Promise.resolve({ data: answer() });
      if (url === "/api/pipelines/p-1/outputs" && creates++ === 0)
        return Promise.reject(failure(500, {}));
      return Promise.resolve({
        data: { id: "o-new", pipelineId: "p-1", name: "n", kind: "insight" },
      });
    });
    setup("beta", { scope: OUTPUT });
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    expect(await screen.findByText("Couldn't pin this answer.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Pinned.");
    expect(screen.getByText(/Pinned as an insight in this pipeline/)).toBeInTheDocument();
  });

  it("a pin from the Output sheet goes through the thunk, so a loaded Output list gains the insight", async () => {
    http.post.mockImplementation((url: string) =>
      url.endsWith("/ask")
        ? Promise.resolve({ data: answer() })
        : Promise.resolve({ data: { id: "o-new", pipelineId: "p-1", name: "n", kind: "insight" } }),
    );
    const { store } = setup("beta", { scope: OUTPUT });
    const { createOutput } = await import("../../pipelines/state/outputsSlice");
    store.dispatch(
      createOutput.fulfilled({ id: "o-1", pipelineId: "p-1" } as never, "r", {} as never),
    );
    ask();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as insight" }));
    await screen.findByText("Pinned.");
    expect(store.getState().outputs.byPipeline["p-1"].map((o: { id: string }) => o.id)).toEqual([
      "o-1",
      "o-new",
    ]);
  });

  it("while a pipeline draft exists Pin is disabled with the visible reason", async () => {
    http.post.mockResolvedValue({ data: answer() });
    setup("beta", { scope: OUTPUT, draftActive: true });
    ask();
    const pin = await screen.findByRole("button", { name: "Pin as insight" });
    expect(pin).toBeDisabled();
    expect(screen.getByText(PIN_DRAFT_REASON)).toBeInTheDocument();
    expect(pin).toHaveAccessibleDescription(PIN_DRAFT_REASON);
    fireEvent.click(pin);
    expect(http.post.mock.calls.some(([url]) => String(url).endsWith("/outputs"))).toBe(false);
  });
});

describe("AskPanel tier and error states (D5)", () => {
  it("a free-tier user sees the upsell instead of the field, and no ask request is ever sent", () => {
    setup("free");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Asking about your data is on the beta plan\./)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Request Beta access/ });
    expect(link).toHaveAttribute("href", "/settings#beta-access");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("(opens in a new tab)");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("a 403 TIER_FORBIDDEN shows the same upsell", async () => {
    http.post.mockRejectedValue(failure(403, { code: "TIER_FORBIDDEN", message: "x" }));
    setup();
    ask();
    expect(
      await screen.findByText(/Asking about your data is on the beta plan\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("a 429 shows the daily-chat-limit copy and never a digit of the limit", async () => {
    http.post.mockRejectedValue(
      failure(429, { code: "CHAT_LIMIT_REACHED", message: "limit 7351", limit: 7351 }),
    );
    const { container } = setup();
    ask();
    expect(
      await screen.findByText(
        "Daily chat limit reached. It resets at the start of the next UTC day.",
      ),
    ).toBeInTheDocument();
    for (const digit of "7351") expect(container).not.toHaveTextContent(digit);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("truncated asks for a narrower question and keeps the question", async () => {
    http.post.mockRejectedValue(failure(422, { code: "ASK_ANSWER_TRUNCATED", message: "m" }));
    setup();
    ask("A very broad question");
    expect(
      await screen.findByText("That answer ran out of room. Try a narrower question."),
    ).toBeInTheDocument();
    expect(field()).toHaveValue("A very broad question");
  });

  it("ungrounded is neutral and never echoes server reasons", async () => {
    http.post.mockRejectedValue(
      failure(422, {
        code: "ASK_UNGROUNDED",
        message: "m",
        reasons: ["a number is not backed by a cited value"],
      }),
    );
    const { container } = setup();
    ask();
    expect(await screen.findByText("Couldn't ground an answer in this data.")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("not backed");
    expect(field()).toHaveValue("Why is revenue up?");
  });

  it.each([
    ["503", () => failure(503, {})],
    ["network", () => new AxiosError("Network Error")],
  ])("%s shows the generic message and Retry re-sends the same question", async (_name, make) => {
    http.post.mockRejectedValueOnce(make());
    http.post.mockResolvedValueOnce({ data: answer({ pin: null }) });
    setup();
    ask("Same question");
    expect(await screen.findByText("Ask is unavailable right now.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("region", { name: "Answer" });
    expect(asks().map(([, body]) => body)).toEqual([
      { question: "Same question" },
      { question: "Same question" },
    ]);
  });
});
