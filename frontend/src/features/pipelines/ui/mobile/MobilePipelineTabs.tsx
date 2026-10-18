// MobilePipelineTabs -- HEL-1582 (design.md D3): the Steps / Preview / Runs tab strip. The ARIA tabs pattern (roving
// tabindex, Left/Right/Home/End), tabs 44px tall, and an accent underline that slides between tabs through the shared
// indicator-slide primitive (an active indicator is one of the accent's places, DESIGN.md §0).

import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { useIndicatorSlide } from "../../../../shared/motion/useIndicatorSlide";

export type MobileTab = "steps" | "preview" | "runs";

const TABS: Array<{ id: MobileTab; label: string }> = [
  { id: "steps", label: "Steps" },
  { id: "preview", label: "Preview" },
  { id: "runs", label: "Runs" },
];

export const tabId = (tab: MobileTab) => `pipeline-mobile-tab-${tab}`;
export const tabPanelId = (tab: MobileTab) => `pipeline-mobile-tabpanel-${tab}`;

export function MobilePipelineTabs({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  const stripRef = useIndicatorSlide<HTMLDivElement>();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    onChange(TABS[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="mobile-tabs" role="tablist" aria-label="Pipeline sections" ref={stripRef}>
      <span className="motion-indicator mobile-tabs__indicator" aria-hidden="true" />
      {TABS.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            data-indicator-active={selected ? "" : undefined}
            className={`mobile-tabs__tab${selected ? " mobile-tabs__tab--active" : ""}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
