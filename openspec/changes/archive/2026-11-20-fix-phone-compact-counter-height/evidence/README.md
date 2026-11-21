# HEL-1791 evidence

- probe-ancestors.json: task 1.1 live probe at 390/768/1100 (sidebar open). Ancestor chain from the form card down to
  the compact counter: card `container-type: size`, height 30/30/42; `.crossfade` 0 px; `.panel-content--form` 24 px,
  overflow-y auto, scrollHeight 56. Style override on the card alone (`container-type: inline-size; height: auto`)
  restores it: card 211/211/223 px, `.panel-content--form` scrollHeight == clientHeight (151), no inner scroll.
  Root cause confirmed, design Decision 1 criteria (a) and (b) both met.
- red-run.txt: the new spec on the unfixed tree (4 geometry tests red, value bottom outside the card; per-kind table recorded).
- heights-red.json: per-kind stack card heights on the unfixed tree.
- green-run.txt / heights-green.json: after the fix (spec + hel1088-compact-counter-chrome.spec.ts, 6 passed). The red
  heights were measured as the owner; the green table as an editor grantee (a third principal, because the general /api
  rate limiter is per principal and the geometry tests spend most of one user's window). Non-form kinds are equal to
  the red run at every width (output 166/166/178, text 102.2/102.2/114.2, markdown 149/149/161, image 113.2/113.2/125.2,
  divider 17). Form cards: multi-field 30/30/42 -> 270.2/270.2/282.2; compact counter 30/30/42 -> 226.2/226.2/238.2
  (editor, with the caption; 211.2/211.2/223.2 as owner in the live probe). Seven kinds seeded (output via a real chart
  pipeline output, image via /favicon.svg): no kind skipped.
- mutation-run.txt: dropping the `--form` selector from the intrinsic-height rule turns the 4 geometry tests red again;
  restored.
- Container-query side effect (skeptic note 1): the collapsed form card used to match
  `@container panel-card (max-height: 179px)` (PanelGrid.css title at --text-sm and --space-2 gap; PanelContent.css form
  gap and --text-micro labels). With `inline-size` containment no height query matches, so a form card's title, labels
  and hints return to the normal stack sizes used by text/output cards. That is parity, not drift.
