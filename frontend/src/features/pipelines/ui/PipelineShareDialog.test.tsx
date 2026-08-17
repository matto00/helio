// Regression coverage for F-138/F-142/F-143 (design.md §5/§6 consistency —
// hand-rolled footer buttons, a non-accent-ink primary button, and a raw
// <input> instead of the shared TextField). No prior test file existed for
// this dialog; this one focuses on the fixed surface rather than attempting
// full coverage of the pre-existing grant/revoke flows.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PipelineShareDialog } from "./PipelineShareDialog";
import {
  listPipelinePermissions,
  grantPipelinePermission,
  revokePipelinePermission,
} from "../services/pipelineService";
import type { PermissionGrant } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  listPipelinePermissions: jest.fn(),
  grantPipelinePermission: jest.fn(),
  revokePipelinePermission: jest.fn(),
}));

const listPipelinePermissionsMock = jest.mocked(listPipelinePermissions);
const grantPipelinePermissionMock = jest.mocked(grantPipelinePermission);
const revokePipelinePermissionMock = jest.mocked(revokePipelinePermission);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

function renderDialog(onClose = jest.fn()) {
  return {
    onClose,
    ...render(
      <PipelineShareDialog pipelineId="p-1" pipelineName="My Pipeline" open onClose={onClose} />,
    ),
  };
}

describe("PipelineShareDialog", () => {
  it("F-138: 'Done' uses the shared ui-modal-btn secondary recipe, not a hand-rolled class", async () => {
    listPipelinePermissionsMock.mockResolvedValueOnce([]);
    renderDialog();
    await waitFor(() => expect(listPipelinePermissionsMock).toHaveBeenCalled());

    const doneBtn = screen.getByRole("button", { name: "Done" });
    expect(doneBtn).toHaveClass("ui-modal-btn", "ui-modal-btn--secondary");
    expect(doneBtn.className).not.toMatch(/pipeline-share-dialog__close-btn/);
  });

  it("F-138/F-142: 'Grant access' uses the shared primary recipe (accent-ink text, not --app-surface)", async () => {
    listPipelinePermissionsMock.mockResolvedValueOnce([]);
    renderDialog();
    await waitFor(() => expect(listPipelinePermissionsMock).toHaveBeenCalled());

    const grantBtn = screen.getByRole("button", { name: "Grant access" });
    expect(grantBtn).toHaveClass("ui-modal-btn", "ui-modal-btn--primary");
  });

  it("F-143: the grantee field is a labeled textbox (shared TextField), not an unstyled raw input", async () => {
    listPipelinePermissionsMock.mockResolvedValueOnce([]);
    renderDialog();
    await waitFor(() => expect(listPipelinePermissionsMock).toHaveBeenCalled());

    const input = screen.getByRole("textbox", { name: "Grantee user ID" });
    expect(input).toHaveClass("ui-input");
  });

  it("grants access with the typed user id and selected role, then clears the form", async () => {
    listPipelinePermissionsMock.mockResolvedValueOnce([]);
    const created: PermissionGrant = {
      granteeId: "user-42",
      role: "editor",
      createdAt: "2026-08-01T00:00:00Z",
    };
    grantPipelinePermissionMock.mockResolvedValueOnce(created);
    renderDialog();
    await waitFor(() => expect(listPipelinePermissionsMock).toHaveBeenCalled());

    fireEvent.change(screen.getByRole("textbox", { name: "Grantee user ID" }), {
      target: { value: "user-42" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Grant role" }));
    fireEvent.click(screen.getByRole("option", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));

    await waitFor(() =>
      expect(grantPipelinePermissionMock).toHaveBeenCalledWith("p-1", "user-42", "editor"),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Grantee user ID" })).toHaveValue(""),
    );
    expect(screen.getByText("user-42")).toBeInTheDocument();
  });

  it("revoking a grant calls the service and removes the row", async () => {
    listPipelinePermissionsMock.mockResolvedValueOnce([
      { granteeId: "user-9", role: "viewer", createdAt: "2026-08-01T00:00:00Z" },
    ]);
    revokePipelinePermissionMock.mockResolvedValueOnce(undefined);
    renderDialog();
    await waitFor(() => expect(screen.getByText("user-9")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Revoke access for user-9" }));

    await waitFor(() => expect(revokePipelinePermissionMock).toHaveBeenCalledWith("p-1", "user-9"));
    await waitFor(() => expect(screen.queryByText("user-9")).not.toBeInTheDocument());
  });
});
