# HEL-1585: Pipeline detail page scrolls the whole app shell out of view at 1440px wide

## Description

On prod (2026-10-13), on a pipeline detail page at a 1440x900 viewport, scrolling the wheel over the steps area scrolled the whole document: the top bar, sidebar, steps and footer all scrolled away. `document.documentElement.scrollHeight` measured 2518px against a 900px viewport, so something inside the shell was taller than the viewport and the document, not an inner region, was the scroll container.

Caveat: this was seen in an emulated browser pane (1440x900 scaled into a smaller pane). It may be an emulation artifact. First step: reproduce in a normal desktop browser at 1440x900.

The ticket was filed before the pipeline detail v2 rewrite (HEL-1579) and the HEL-1570 rail + tabs shell. Everything is re-derived from the current tree (see premise-validation evidence).

## Expected

The app shell (top bar, rail, context list, page header/footer) stays fixed, and only the page's own content regions scroll. The document itself does not scroll on app routes.

## Acceptance criteria

- [ ] Reproduced (or ruled out as an emulation artifact, with evidence: scrollHeight/innerHeight per route) in a non-emulated Playwright Chromium at 1440x900 and 1280x800, on the local lane dev server, with a short and a long step list and a 30+ item context-list pipeline list.
- [ ] On every authenticated route, `document.documentElement.scrollHeight <= innerHeight` at 1440x900 and 1280x800, enforced by a Playwright guard (one parametrised spec; its CI cost measured and stated).
- [ ] Wheel-scrolling over the pipeline steps area scrolls only the intended inner region (the document's scrollY stays 0).
- [ ] If the guard finds other routes that scroll the document, they are listed; they are fixed here only when the cause is the same shell-level cause, otherwise raised as follow-up triage.
