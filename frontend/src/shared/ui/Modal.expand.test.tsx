import { render } from "@testing-library/react";

import { Modal } from "./Modal";

// HEL-1584 D8: a Modal opened with an origin rectangle grows out of it under Full. The class that keeps `ui-modal-in` from
// starting is present on the first render, and the Web Animation is requested only once the dialog is open (a native
// <dialog> has no box before showModal()).

const mockMotion = { level: "full" };
jest.mock("../../theme/ThemeProvider", () => ({
  ...jest.requireActual("../../theme/ThemeProvider"),
  useMotion: () => mockMotion.level,
}));
const mockExpandFrom = jest.fn();
jest.mock("../motion/expandFrom", () => ({
  expandFrom: (...args: unknown[]) => mockExpandFrom(...args),
}));

const ORIGIN = { left: 10, top: 20, width: 300, height: 200 } as DOMRectReadOnly;

beforeEach(() => {
  mockMotion.level = "full";
  mockExpandFrom.mockReset();
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const dialog = () => document.querySelector("dialog") as HTMLDialogElement;
const modal = (props: { open?: boolean; expandFrom?: DOMRectReadOnly | null }) => (
  <Modal
    open={props.open ?? true}
    title="T"
    onClose={() => undefined}
    expandFrom={props.expandFrom}
  >
    body
  </Modal>
);

describe("Modal expandFrom (HEL-1584)", () => {
  it("under Full with an origin: the expanding class is on the first render and expandFrom runs once, after the dialog is open", () => {
    mockExpandFrom.mockImplementation((el: HTMLDialogElement) => {
      expect(el.hasAttribute("open")).toBe(true);
    });
    let classAtFirstRender = "";
    const { container } = render(modal({ expandFrom: ORIGIN }));
    classAtFirstRender = container.querySelector("dialog")!.className;
    expect(classAtFirstRender).toContain("ui-modal--expanding");
    expect(mockExpandFrom).toHaveBeenCalledTimes(1);
    expect(mockExpandFrom).toHaveBeenCalledWith(dialog(), ORIGIN);
  });

  it("never requests the expansion while the dialog is closed", () => {
    render(modal({ open: false, expandFrom: ORIGIN }));
    expect(mockExpandFrom).not.toHaveBeenCalled();
  });

  it("requests it when the dialog opens later, with the origin of that render", () => {
    const view = render(modal({ open: false, expandFrom: ORIGIN }));
    view.rerender(modal({ open: true, expandFrom: ORIGIN }));
    expect(mockExpandFrom).toHaveBeenCalledTimes(1);
    expect(mockExpandFrom).toHaveBeenCalledWith(dialog(), ORIGIN);
  });

  it.each(["subtle", "off"])(
    "under %s: no expanding class and no origin handed to expandFrom",
    (level) => {
      mockMotion.level = level;
      render(modal({ expandFrom: ORIGIN }));
      expect(dialog().className).not.toContain("ui-modal--expanding");
      expect(mockExpandFrom).toHaveBeenCalledWith(dialog(), null);
    },
  );

  it("without an origin: no expanding class and the ordinary entrance applies", () => {
    render(modal({ expandFrom: null }));
    expect(dialog().className).not.toContain("ui-modal--expanding");
    expect(mockExpandFrom).toHaveBeenCalledWith(dialog(), null);
  });
});
