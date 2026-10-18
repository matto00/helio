import { useEffect, useState } from "react";

// useTopModalDialog -- HEL-1668 D2: the most recently OPENED modal <dialog>, or null. A modal dialog's top layer covers
// (and makes inert) everything outside it, so UI that must stay visible and operable above one (the toast viewport)
// portals into it, the same pattern ActionsMenu, Select and OutputSchemaDisclosure use for their panels.

/** An open modal dialog. jsdom has no `:modal`, so there any open dialog counts. */
function isOpenModal(dialog: HTMLDialogElement): boolean {
  if (!dialog.open) return false;
  try {
    return dialog.matches(":modal");
  } catch {
    return true;
  }
}

function touchesDialog(node: Node): boolean {
  return (
    node.nodeName === "DIALOG" || (node instanceof Element && node.querySelector("dialog") !== null)
  );
}

export function useTopModalDialog(): HTMLDialogElement | null {
  const [top, setTop] = useState<HTMLDialogElement | null>(null);

  useEffect(() => {
    // Open order: dialogs still open keep their place, newly opened ones (in document order) go on top.
    let stack: HTMLDialogElement[] = [];
    function sync() {
      const open = Array.from(document.querySelectorAll("dialog")).filter(isOpenModal);
      const kept = stack.filter((d) => open.includes(d));
      stack = [...kept, ...open.filter((d) => !kept.includes(d))];
      setTop(stack.at(-1) ?? null);
    }
    sync();
    const observer = new MutationObserver((records) => {
      // Attribute records are filtered to `open`; child-list records only matter when a dialog came or went.
      const relevant = records.some(
        (r) =>
          r.type === "attributes" ||
          Array.from(r.addedNodes).some(touchesDialog) ||
          Array.from(r.removedNodes).some(touchesDialog),
      );
      if (relevant) sync();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);

  return top;
}
