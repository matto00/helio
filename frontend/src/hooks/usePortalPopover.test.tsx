import { act, render } from "@testing-library/react";

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
