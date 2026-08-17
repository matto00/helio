// HEL-698 design.md D6/testing — MessageComposer's per-logical-message idempotency key lifecycle
// and post-error reconciliation. Rendered standalone (via `renderWithStore`, mirrors
// `ActiveConversationPanel.test.tsx`'s own mocking shape) rather than through
// `ActiveConversationPanel`, so these assertions are about the composer's own local
// `pendingSend` state and the real `converse` thunk it dispatches, not the surrounding panel.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  converse as converseRequest,
  createConversation as createConversationRequest,
  getConversation as getConversationRequest,
} from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { AssistantConversationDetail } from "../types";
import { MessageComposer } from "./MessageComposer";

jest.mock("../services/assistantConversationsService", () => ({
  createConversation: jest.fn(),
  converse: jest.fn(),
  getConversation: jest.fn(),
}));

const converseMock = jest.mocked(converseRequest);
const createConversationMock = jest.mocked(createConversationRequest);
const getConversationMock = jest.mocked(getConversationRequest);

function detailWith(
  transcript: AssistantConversationDetail["transcript"],
): AssistantConversationDetail {
  return {
    id: "conv-1",
    title: "Chat",
    pinned: false,
    updatedAt: "2026-08-16T00:00:00Z",
    transcript,
  };
}

/** The `idempotencyKey` (3rd positional arg) the mocked `converse` service function received on
 * its `callIndex`-th invocation. */
function keyOf(callIndex: number): string {
  return converseMock.mock.calls[callIndex][2] as string;
}

describe("MessageComposer", () => {
  beforeEach(() => {
    converseMock.mockReset();
    createConversationMock.mockReset();
    getConversationMock.mockReset();
  });

  it("reuses the same idempotency key when retrying the identical preserved text after a failure", async () => {
    converseMock.mockRejectedValueOnce(new Error("network error"));
    // A failed reconciliation fetch (no key match) falls through to the original rejection --
    // this test is about the KEY the retry sends, not the reconciliation path itself.
    getConversationMock.mockRejectedValueOnce(new Error("reconciliation fetch failed"));
    converseMock.mockResolvedValueOnce(detailWith([]));

    renderWithStore(<MessageComposer conversationId="conv-1" />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Wait for the visible failure state -- "sending" only clears once the WHOLE thunk (including
    // its reconciliation attempt) settles, not merely once converseMock's first call fires.
    await waitFor(() => expect(screen.getByText("network error")).toBeInTheDocument());
    // A failed send preserves the typed input -- the retry below resubmits identical text.
    expect((input as HTMLTextAreaElement).value).toBe("Hello");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(2));

    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("generates a fresh idempotency key when the preserved text is edited before retrying", async () => {
    converseMock.mockRejectedValueOnce(new Error("network error"));
    getConversationMock.mockRejectedValueOnce(new Error("reconciliation fetch failed"));
    converseMock.mockResolvedValueOnce(detailWith([]));

    renderWithStore(<MessageComposer conversationId="conv-1" />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("network error")).toBeInTheDocument());

    fireEvent.change(input, { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(2));

    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("clears pendingSend on success -- a later send of identical text mints a fresh key, not the succeeded send's key", async () => {
    converseMock.mockResolvedValueOnce(detailWith([]));
    converseMock.mockResolvedValueOnce(detailWith([]));

    renderWithStore(<MessageComposer conversationId="conv-1" />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(1));
    // Cleared on success (tasks.md 6.9's existing input-clear behavior).
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));

    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(2));

    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("a reconciliation fetch whose lastIdempotencyKey matches the sent key clears the input and shows no error banner", async () => {
    converseMock.mockRejectedValueOnce(new Error("network error"));
    getConversationMock.mockImplementationOnce(async () => ({
      ...detailWith([
        { role: "user", content: [{ blockType: "text", text: "Hello" }] },
        { role: "assistant", content: [{ blockType: "text", text: "Hi!" }] },
      ]),
      lastIdempotencyKey: keyOf(0),
    }));

    renderWithStore(<MessageComposer conversationId="conv-1" />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
    expect(screen.queryByText("network error")).not.toBeInTheDocument();
  });

  it("a reconciliation fetch whose lastIdempotencyKey does NOT match keeps the failure UX -- error shown, input preserved", async () => {
    converseMock.mockRejectedValueOnce(new Error("network error"));
    getConversationMock.mockResolvedValueOnce({
      ...detailWith([]),
      lastIdempotencyKey: "some-other-key",
    });

    renderWithStore(<MessageComposer conversationId="conv-1" />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("network error")).toBeInTheDocument());
    expect((input as HTMLTextAreaElement).value).toBe("Hello");
  });

  // HEL-711 -- reset-on-switch: `conversationId`/`error`/`pendingSend` are local, un-conversation-
  // scoped state left over from before the composer stopped remounting across switches (HEL-695's
  // F-021 fix). Without an explicit reset, a draft/failure/retry-key leak across an ordinary switch.
  describe("reset on conversation switch (HEL-711)", () => {
    it("clears a typed draft when conversationId changes to a different existing conversation", () => {
      const { rerender } = renderWithStore(<MessageComposer conversationId="conv-1" />);

      const input = screen.getByLabelText("Message");
      fireEvent.change(input, { target: { value: "Draft for A" } });
      expect((input as HTMLTextAreaElement).value).toBe("Draft for A");

      rerender(<MessageComposer conversationId="conv-2" />);

      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    });

    it("clears a failed send's preserved draft and pending-send key when switching away before retrying -- a later send from the new conversation mints a fresh key", async () => {
      converseMock.mockRejectedValueOnce(new Error("network error"));
      getConversationMock.mockRejectedValueOnce(new Error("reconciliation fetch failed"));
      converseMock.mockResolvedValueOnce(detailWith([]));

      const { rerender } = renderWithStore(<MessageComposer conversationId="conv-1" />);

      const input = screen.getByLabelText("Message");
      fireEvent.change(input, { target: { value: "Hello" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(screen.getByText("network error")).toBeInTheDocument());
      // Failure preserves the draft + pending-send key for a same-conversation retry (pre-existing).
      expect((input as HTMLTextAreaElement).value).toBe("Hello");

      rerender(<MessageComposer conversationId="conv-2" />);

      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
      expect(screen.queryByText("network error")).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(2));

      // Not A's preserved key -- switching away cleared pendingSend, so identical text mints fresh.
      expect(keyOf(1)).not.toBe(keyOf(0));
    });

    it("preserves sending/draft/pending-send state through its own null -> newId self-created transition -- no regression of HEL-695's continuous-sending-indication fix", async () => {
      createConversationMock.mockResolvedValueOnce({
        id: "new-conv",
        title: "New conversation",
        pinned: false,
        updatedAt: "2026-08-16T00:00:00Z",
        transcript: [],
      });
      let resolveConverse: (detail: AssistantConversationDetail) => void = () => {};
      converseMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveConverse = resolve;
        }),
      );

      const { rerender } = renderWithStore(<MessageComposer conversationId={null} />);

      const input = screen.getByLabelText("Message");
      fireEvent.change(input, { target: { value: "Hello there" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(createConversationMock).toHaveBeenCalledWith({}));
      await waitFor(() => expect(converseMock).toHaveBeenCalled());

      // Simulate `ActiveConversationPanel`'s `effectiveId` flipping from `null` to the freshly
      // created id -- a side effect of THIS send, not a user-initiated switch (design.md D2).
      rerender(<MessageComposer conversationId="new-conv" />);

      // The in-flight send's state must survive the transition -- not reset.
      expect(screen.getByText("Sending…")).toBeInTheDocument();
      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Hello there");

      resolveConverse(detailWith([]));
      await waitFor(() =>
        expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(""),
      );
    });
  });
});
