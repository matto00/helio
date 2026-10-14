import { focusOnMount, noteDeleteActivation } from "./rowDeleteFocus";

describe("focusOnMount (HEL-1604)", () => {
  function makeConfirm() {
    const element = document.createElement("div");
    element.tabIndex = -1;
    document.body.appendChild(element);
    element.scrollIntoView = jest.fn();
    return element;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses without scrolling, and does not scroll into view after a pointer activation", () => {
    const element = makeConfirm();
    const focus = jest.spyOn(element, "focus");
    noteDeleteActivation(1);
    focusOnMount(element);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll on the second click of a double-click either", () => {
    const element = makeConfirm();
    noteDeleteActivation(2);
    focusOnMount(element);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals the confirm immediately after a keyboard activation (click detail 0)", () => {
    const element = makeConfirm();
    noteDeleteActivation(0);
    focusOnMount(element);
    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
