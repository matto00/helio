import { PanelLeftClose } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "../../shared/ui/IconButton";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import { takeListFocus } from "./contextListLayout";
import { ContextListSeparator } from "./ContextListSeparator";
import type { ContextListLayout } from "./useContextListLayout";
import "./ContextList.css";

interface ContextListProps {
  layout: ContextListLayout;
  /** The section's name, e.g. "Dashboards". */
  heading: string;
  /** Singular noun for the separator's accessible name, e.g. "dashboard". */
  noun: string;
  children: ReactNode;
}

export const CONTEXT_LIST_ID = "context-list";

/** The resizable, collapsible list beside the rail (DESIGN.md §9). Rendered only when the current section has a list
 *  and the list is not collapsed; the shell grid gives it `--context-list-width`. */
export function ContextList({ layout, heading, noun, children }: ContextListProps) {
  return (
    <aside id={CONTEXT_LIST_ID} className="context-list" aria-label={`${heading} list`}>
      <header className="context-list__header">
        <h2 className="context-list__title">{heading}</h2>
        <IconButton
          icon={<PanelLeftClose size={ICON_SIZE.md} />}
          variant="secondary"
          size="sm"
          aria-label="Collapse list"
          aria-expanded={true}
          aria-controls={CONTEXT_LIST_ID}
          ref={(element) => {
            if (element !== null && takeListFocus("collapse-button")) element.focus();
          }}
          title="Collapse list"
          onClick={layout.toggleCollapsed}
        />
      </header>
      <div className="context-list__body">{children}</div>
      <ContextListSeparator
        layout={layout}
        label={`Resize ${noun} list`}
        controlsId={CONTEXT_LIST_ID}
      />
    </aside>
  );
}
