import {
  getTopOpenModal,
  registerOpenModal,
  resetModalDialogRegistryForTests,
  subscribeOpenModals,
  unregisterOpenModal,
} from "./modalDialogRegistry";

function openDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  return dialog;
}

afterEach(() => resetModalDialogRegistryForTests());

describe("modalDialogRegistry", () => {
  it("returns the most recently registered dialog, and the previous one after it closes", () => {
    const a = openDialog();
    const b = openDialog();
    registerOpenModal(a);
    registerOpenModal(b);
    expect(getTopOpenModal()).toBe(b);
    unregisterOpenModal(b);
    expect(getTopOpenModal()).toBe(a);
    unregisterOpenModal(a);
    expect(getTopOpenModal()).toBeNull();
  });

  it("keeps a dialog's place when it is registered again", () => {
    const a = openDialog();
    const b = openDialog();
    registerOpenModal(a);
    registerOpenModal(b);
    registerOpenModal(a);
    expect(getTopOpenModal()).toBe(b);
  });

  it("ignores a dialog that is not open", () => {
    registerOpenModal(document.createElement("dialog"));
    expect(getTopOpenModal()).toBeNull();
  });

  it("treats unregistering an unknown dialog as a no-op that notifies nobody", () => {
    const listener = jest.fn();
    subscribeOpenModals(listener);
    unregisterOpenModal(openDialog());
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies subscribers only when the top changes, and stops after unsubscribe", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeOpenModals(listener);
    const a = openDialog();
    const b = openDialog();
    registerOpenModal(a);
    registerOpenModal(a);
    expect(listener).toHaveBeenCalledTimes(1);
    registerOpenModal(b);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    unregisterOpenModal(b);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
