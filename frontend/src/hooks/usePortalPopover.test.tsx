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
