import { act, fireEvent, render, screen } from "@testing-library/react";

import { usePortalPopover, type PortalPopoverPlace } from "./usePortalPopover";

// HEL-1756: `reposition()` re-runs an opted-in `place` against the mounted panel and trigger.
type Api = ReturnType<typeof usePortalPopover<HTMLButtonElement>>;

function Harness({ place, onApi }: { place?: PortalPopoverPlace; onApi: (api: Api) => void }) {
  const api = usePortalPopover<HTMLButtonElement>(place ? { place } : undefined);
  onApi(api);
  const { triggerRef, panelRef, isOpen } = api;
  return (
    <div>
      <button ref={triggerRef} type="button">
        trigger
      </button>
      {isOpen && (
        <div
          ref={(el) => {
            panelRef.current = el;
          }}
          data-testid="panel"
        />
      )}
    </div>
  );
}

function setup(place?: PortalPopoverPlace) {
  let api!: Api;
  render(
    <Harness
      place={place}
      onApi={(a) => {
        api = a;
      }}
    />,
  );
  return () => api;
}

describe("usePortalPopover reposition (HEL-1756)", () => {
  it("re-runs place against the mounted panel and applies its result", () => {
    const place = jest.fn<ReturnType<PortalPopoverPlace>, Parameters<PortalPopoverPlace>>(() => ({
      top: 10,
    }));
    const get = setup(place);
    act(() => get().handleOpen());
    expect(get().placed).toBe(true);
    expect(get().panelPos).toEqual({ top: 10 });
    const callsAfterOpen = place.mock.calls.length;

    place.mockImplementation(() => ({ top: 99 }));
    act(() => get().reposition());
    expect(place.mock.calls.length).toBe(callsAfterOpen + 1);
    expect(get().panelPos).toEqual({ top: 99 });
  });

  it("is a no-op while closed", () => {
    const place = jest.fn(() => ({ top: 10 }));
    const get = setup(place);
    act(() => get().reposition());
    expect(place).not.toHaveBeenCalled();
    expect(get().placed).toBe(false);
  });

  it("is a no-op for a consumer that did not opt into place", () => {
    const get = setup();
    act(() => get().handleOpen(() => ({ top: 5 })));
    act(() => get().reposition());
    expect(get().panelPos).toEqual({ top: 5 });
  });

  it("keeps a stable identity across renders", () => {
    const place = jest.fn(() => ({ top: 10 }));
    const get = setup(place);
    const first = get().reposition;
    act(() => get().handleOpen());
    expect(get().reposition).toBe(first);
  });
});

// HEL-1759: a keyboard Tab out of the panel returns focus to the trigger; nothing else does.
function FocusHarness({ withPanelRef = true }: { withPanelRef?: boolean }) {
  const { triggerRef, panelRef, isOpen, handleOpen } = usePortalPopover<HTMLButtonElement>();
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => handleOpen()}>
        trigger
      </button>
      {isOpen && (
        <div
          ref={(el) => {
            if (withPanelRef) panelRef.current = el;
          }}
        >
          <button type="button">inside</button>
        </div>
      )}
      <button type="button">outside</button>
    </div>
  );
}

function openFocusHarness(withPanelRef = true) {
  render(<FocusHarness withPanelRef={withPanelRef} />);
  const trigger = screen.getByRole("button", { name: "trigger" });
  fireEvent.click(trigger);
  const inside = screen.getByRole("button", { name: "inside" });
  const outside = screen.getByRole("button", { name: "outside" });
  return { trigger, inside, outside };
}

describe("usePortalPopover return focus to trigger (HEL-1759)", () => {
  it("returns focus to the trigger when Tab moves focus from inside the panel to outside", async () => {
    const { trigger, inside, outside } = openFocusHarness();
    act(() => inside.focus());
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    await act(async () => outside.focus());
    expect(screen.queryByRole("button", { name: "inside" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("does not refocus the trigger when focus leaves from the trigger itself", async () => {
    const { trigger, outside } = openFocusHarness();
    act(() => trigger.focus());
    fireEvent.keyDown(document.body, { key: "Tab" });
    await act(async () => outside.focus());
    expect(screen.queryByRole("button", { name: "inside" })).toBeNull();
    expect(outside).toHaveFocus();
  });

  it("does not refocus the trigger for a pointer-initiated focus move", async () => {
    const { inside, outside } = openFocusHarness();
    act(() => inside.focus());
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.pointerDown(outside);
    await act(async () => outside.focus());
    expect(outside).toHaveFocus();
  });

  it("does not refocus the trigger when the last key was not Tab", async () => {
    const { inside, outside } = openFocusHarness();
    act(() => inside.focus());
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    await act(async () => outside.focus());
    expect(outside).toHaveFocus();
  });

  it("does not refocus the trigger for a Tab that moved no focus (the flag expires)", async () => {
    const { inside, outside } = openFocusHarness();
    act(() => inside.focus());
    fireEvent.keyDown(document.body, { key: "Tab" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await act(async () => outside.focus());
    expect(outside).toHaveFocus();
  });

  it("leaves a consumer without panelRef untouched", async () => {
    const { inside, outside } = openFocusHarness(false);
    act(() => inside.focus());
    fireEvent.keyDown(document.body, { key: "Tab" });
    await act(async () => outside.focus());
    expect(screen.getByRole("button", { name: "inside" })).toBeInTheDocument();
    expect(outside).toHaveFocus();
  });
});

// HEL-1776: forward Tab out of the panel moves on to the next control after the trigger; Shift+Tab is unchanged.
function ForwardHarness({
  inDialog = false,
  panelButtons = 1,
  onPanelKeyDown,
}: {
  inDialog?: boolean;
  panelButtons?: number;
  onPanelKeyDown?: (event: KeyboardEvent) => void;
}) {
  const { triggerRef, panelRef, isOpen, handleOpen } = usePortalPopover<HTMLButtonElement>();
  const body = (
    <>
      <button type="button">first</button>
      <button ref={triggerRef} type="button" onClick={() => handleOpen()}>
        trigger
      </button>
      <button type="button">next</button>
      {isOpen && (
        <div
          ref={(el) => {
            if (el && onPanelKeyDown) el.addEventListener("keydown", onPanelKeyDown);
            panelRef.current = el;
          }}
        >
          {Array.from({ length: panelButtons }, (_, i) => (
            <button key={i} type="button">{`inside ${i + 1}`}</button>
          ))}
        </div>
      )}
    </>
  );
  return inDialog ? <dialog open>{body}</dialog> : <div>{body}</div>;
}

describe("usePortalPopover forward Tab moves on (HEL-1776)", () => {
  function open(props: Parameters<typeof ForwardHarness>[0] = {}) {
    render(<ForwardHarness {...props} />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    return { trigger, next: screen.getByRole("button", { name: "next" }) };
  }

  it("closes and focuses the next control after the trigger, not the trigger", async () => {
    const { trigger, next } = open();
    const inside = screen.getByRole("button", { name: "inside 1" });
    act(() => inside.focus());
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(inside, { key: "Tab" });
    });
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole("button", { name: "inside 1" })).toBeNull();
    expect(next).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it("wins over a dialog-level Modal-style wrap listener (no double move)", async () => {
    const { trigger, next } = open({ inDialog: true });
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    const moves: Element[] = [];
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || e.shiftKey) return;
      const all = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
      if (document.activeElement === all[all.length - 1]) {
        e.preventDefault();
        all[0].focus();
        moves.push(document.activeElement as Element);
      }
    });
    const inside = screen.getByRole("button", { name: "inside 1" });
    act(() => inside.focus());
    await act(async () => {
      fireEvent.keyDown(inside, { key: "Tab" });
    });
    expect(moves).toEqual([]);
    expect(next).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it("leaves Shift+Tab to the HEL-1759 path: not intercepted, focus returns to the trigger", async () => {
    const { trigger } = open();
    const inside = screen.getByRole("button", { name: "inside 1" });
    act(() => inside.focus());
    let notPrevented = false;
    await act(async () => {
      notPrevented = fireEvent.keyDown(inside, { key: "Tab", shiftKey: true });
      screen.getByRole("button", { name: "first" }).focus();
    });
    expect(notPrevented).toBe(true);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("button", { name: "inside 1" })).toBeNull();
  });

  it("does not intercept a Tab from an element with another tabbable after it in the panel", () => {
    open({ panelButtons: 2 });
    const first = screen.getByRole("button", { name: "inside 1" });
    act(() => first.focus());
    expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
    expect(first).toHaveFocus();
    expect(screen.getByRole("button", { name: "inside 2" })).toBeInTheDocument();
  });

  it("stands down for a Tab a same-panel listener already handled (defaultPrevented)", async () => {
    const { next } = open({ onPanelKeyDown: (e) => e.preventDefault() });
    // The panel's own listener (registered in its ref callback, so before the hook's effect) already handled this Tab.
    const inside = screen.getByRole("button", { name: "inside 1" });
    act(() => inside.focus());
    await act(async () => {
      fireEvent.keyDown(inside, { key: "Tab" });
    });
    expect(screen.getByRole("button", { name: "inside 1" })).toBeInTheDocument();
    expect(inside).toHaveFocus();
    expect(next).not.toHaveFocus();
  });
});
