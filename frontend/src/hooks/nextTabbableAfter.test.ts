import { nextTabbableAfter } from "./nextTabbableAfter";

// HEL-1776: the control a forward Tab should reach from a portalled panel, as if the panel sat right after its trigger.
function setup(html: string) {
  document.body.innerHTML = html;
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  return { trigger: el("trigger"), panel: document.getElementById("panel"), el };
}

describe("nextTabbableAfter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the first tabbable control after the trigger, skipping the panel's own contents", () => {
    const { trigger, panel, el } = setup(
      `<button id="before"></button><button id="trigger"></button><button id="next"></button>
       <ul id="panel"><button id="item"></button></ul>`,
    );
    expect(nextTabbableAfter(trigger, panel)).toBe(el("next"));
  });

  it("skips disabled, tabindex=-1, hidden, inert and display:none controls", () => {
    const { trigger, panel, el } = setup(
      `<button id="trigger"></button><button disabled></button><button tabindex="-1"></button>
       <button hidden></button><div inert><button></button></div><div style="display:none"><button></button></div>
       <div style="visibility:hidden"><button></button></div><a id="good" href="#x">x</a><div id="panel"></div>`,
    );
    expect(nextTabbableAfter(trigger, panel)).toBe(el("good"));
  });

  it("never returns the trigger or something inside it, even when it contains tabbables", () => {
    const { trigger, panel, el } = setup(
      `<div id="trigger"><button id="inner"></button></div><button id="next"></button><div id="panel"></div>`,
    );
    expect(nextTabbableAfter(trigger, panel)).toBe(el("next"));
  });

  it("falls back to the trigger when nothing follows it outside a dialog (never the body)", () => {
    const { trigger, panel } = setup(
      `<button id="first"></button><button id="trigger"></button><div id="panel"><button></button></div>`,
    );
    expect(nextTabbableAfter(trigger, panel)).toBe(trigger);
  });

  it("scopes to the enclosing open dialog and wraps to its first tabbable when nothing follows the trigger", () => {
    const { trigger, panel, el } = setup(
      `<button id="page"></button>
       <dialog open id="dlg"><button id="first"></button><button id="trigger"></button>
         <div id="panel"><button></button></div></dialog><button id="after-dialog"></button>`,
    );
    expect(nextTabbableAfter(trigger, panel)).toBe(el("first"));
  });

  it("stays inside the dialog when a control follows the trigger there", () => {
    const { trigger, panel, el } = setup(
      `<dialog open><button id="trigger"></button><button id="close"></button><div id="panel"></div></dialog>
       <button id="page"></button>`,
    );
    expect(nextTabbableAfter(trigger, panel)).toBe(el("close"));
  });
});
