// HEL-1631 (design.md D13): the leave guard. With a draft, a same-origin in-app link click is held and answered by the dialog
// the hook drives (Keep editing / Discard); modified clicks, other targets and same-path links pass through; the browser's
// `beforeunload` prompt is registered only while a draft exists.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { useDraftLeaveGuard } from "./useDraftLeaveGuard";

function Harness({ hasDraft, discard }: { hasDraft: boolean; discard: () => void }) {
  const guard = useDraftLeaveGuard(hasDraft, discard);
  const location = useLocation();
  return (
    <div>
      <span data-testid="loc">{location.pathname}</span>
      <span data-testid="asking">{guard.leaveRequested ? "yes" : "no"}</span>
      <button onClick={guard.stay}>Keep editing</button>
      <button onClick={guard.confirmLeave}>Discard draft</button>
      <a href="/pipelines">other</a>
      <a href="/pipelines" target="_blank">
        blank
      </a>
      <a href="/pipelines" download>
        dl
      </a>
      <a href={window.location.pathname}>same path</a>
      <a href="https://elsewhere.example/x">external</a>
    </div>
  );
}

function setup(hasDraft: boolean, discard = jest.fn()) {
  const view = render(
    <MemoryRouter initialEntries={["/start"]}>
      <Harness hasDraft={hasDraft} discard={discard} />
    </MemoryRouter>,
  );
  return { discard, ...view };
}

const asking = () => screen.getByTestId("asking").textContent;
const loc = () => screen.getByTestId("loc").textContent;

describe("useDraftLeaveGuard", () => {
  it("holds a same-origin link click while a draft exists and asks", () => {
    const { discard } = setup(true);
    expect(fireEvent.click(screen.getByText("other"))).toBe(false);
    expect(asking()).toBe("yes");
    expect(loc()).toBe("/start");
    expect(discard).not.toHaveBeenCalled();
  });

  it("Keep editing closes the question, keeps the draft and the location", () => {
    const { discard } = setup(true);
    fireEvent.click(screen.getByText("other"));
    fireEvent.click(screen.getByText("Keep editing"));
    expect(asking()).toBe("no");
    expect(loc()).toBe("/start");
    expect(discard).not.toHaveBeenCalled();
  });

  it("Discard draft discards, then navigates to the link", () => {
    const { discard } = setup(true);
    fireEvent.click(screen.getByText("other"));
    fireEvent.click(screen.getByText("Discard draft"));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(loc()).toBe("/pipelines");
  });

  it.each([
    ["a ctrl click", () => ({ ctrlKey: true })],
    ["a meta click", () => ({ metaKey: true })],
    ["a shift click", () => ({ shiftKey: true })],
    ["an alt click", () => ({ altKey: true })],
    ["a middle click", () => ({ button: 1 })],
  ])("lets %s pass through", (_name, init) => {
    setup(true);
    fireEvent.click(screen.getByText("other"), init());
    expect(asking()).toBe("no");
  });

  it("lets target=_blank, download, same-path and cross-origin links pass through", () => {
    setup(true);
    for (const text of ["blank", "dl", "same path", "external"]) {
      fireEvent.click(screen.getByText(text));
      expect([text, asking()]).toEqual([text, "no"]);
    }
  });

  it("does not intercept anything without a draft", () => {
    setup(false);
    expect(fireEvent.click(screen.getByText("other"))).toBe(true);
    expect(asking()).toBe("no");
  });

  it("registers beforeunload only while a draft exists", () => {
    const add = jest.spyOn(window, "addEventListener");
    const remove = jest.spyOn(window, "removeEventListener");
    const registered = () => add.mock.calls.filter(([t]) => t === "beforeunload").length;
    const removed = () => remove.mock.calls.filter(([t]) => t === "beforeunload").length;
    const view = setup(false);
    expect(registered()).toBe(0);
    const tree = (hasDraft: boolean) => (
      <MemoryRouter initialEntries={["/start"]}>
        <Harness hasDraft={hasDraft} discard={jest.fn()} />
      </MemoryRouter>
    );
    view.rerender(tree(true));
    expect(registered()).toBe(1);
    const event = new Event("beforeunload", { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    view.rerender(tree(false));
    expect(removed()).toBe(1);
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    add.mockRestore();
    remove.mockRestore();
  });
});
