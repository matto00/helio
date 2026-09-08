## Context

`shared/chrome/shortcuts.ts` (HEL-496) already holds a static `ShortcutDeclaration[]` with `matchesCombo`
and `isTypingTarget`, and the `keyboard-shortcut-declarations` spec forbids any global binding living outside
it. **Three** global keydown listeners exist today (round-2 skeptic corrected the round-1 claim of two):
`GlobalCommandShortcuts.tsx` (palette + quick-launcher, declaration-driven), `useLayoutUndoRedo.ts`
(undo/redo, inline key tests plus a private copy of the typing guard), and `shared/chrome/OverlayProvider.tsx:24`
(an Escape-only listener backing a single-active-overlay registry). See Decision 4a for why the third is
NOT folded into this change.
`shared/ui/Modal.tsx` is a native `<dialog>` + `showModal()` primitive with its own focus trap and focus
restore. See proposal.md for motivation.

This is the foundation for three downstream tickets in the same epic (HEL-516 global search, HEL-519,
HEL-503), so the registry's shape is the primary deliverable — the overlay is its first consumer.

## Goals / Non-Goals

**Goals.** One enumerable declaration that is simultaneously the display source and the dispatch source; a
combo shape covering modifier-free and Shift-bearing keys; a `when`-gated handler mechanism usable from
React components; a modal-open guard; undo/redo migrated with zero behavior change.

**Non-Goals (design-level).** No global-listener consolidation into a single physical listener across every
feature — see Decision 3. No sequence/chord bindings (`g` then `d`). No per-route scoping beyond `when`.

## Decisions

### Decision 1 — Split the registry into a static *declaration* and a runtime *binding*, rather than putting `handler` in the declaration array

The ticket sketches `{ combo, description, group, handler, when }` as one record. A single module-level array
cannot hold `handler`/`when`: real handlers close over Redux dispatch, router, and component state, and
`useLayoutUndoRedo`'s handler depends on `dashboardId` and history availability. Putting handlers in the
array would force it to become mutable module state, which is untestable in isolation, order-dependent, and
breaks the "enumerate the app's shortcuts" property under code-splitting (an unmounted feature's binding would
vanish from the help overlay — precisely the discoverability bug this ticket exists to fix).

So: `shortcuts.ts` stays **static data** — `{ id, label, description, group, combo }` — always complete,
always enumerable, renderable by the overlay with no provider mounted. Handlers attach at runtime by id:

```ts
useShortcut("layout-undo", handler, { when: canUndo });
```

`useShortcut` registers into a `Map<shortcutId, handler>`. **As shipped** (skeptic-final-1.md non-blocking
CR — corrected here to match the implementation rather than the other way around) this map is a
module-level singleton in `shared/chrome/useShortcut.ts`, not a React-context-held provider: the physical
`window` keydown listener attaches lazily on the first registration and detaches when the last one
unregisters, so `useShortcut` works correctly even in a test that renders a consuming hook with no wrapping
provider component at all (this is what keeps `useLayoutUndoRedo.test.ts` passing unmodified — see Decision
3). Behaviorally this is identical to a provider-held map from every caller's point of view: an id absent
from the declaration is still a developer error thrown in dev — this is the mechanism that enforces the
spec's "no binding outside the declaration" rule, and it is what HEL-516/519/503 will use to contribute
their own bindings.

**The option set is settled here, now, and is the reviewed API surface of this ticket** (skeptic CR3 —
round 1's `{ when? }` could not express the palette's typing exemption that task 3.1 promises to preserve,
which would have forced a signature change after HEL-516/519/503 had already consumed it):

```ts
interface ShortcutOptions {
  /** Binding is inert while false. Registration still happens, so the overlay still lists it. */
  when?: boolean;
  /** Bypass the shared typing guard. `true` = always; a predicate = per-target (the palette passes
   *  `(t) => t instanceof HTMLElement && t.closest(".command-palette") !== null`). Default false. */
  allowWhileTyping?: boolean | ((target: EventTarget | null) => boolean);
  /** Apply the overlay-open guard (Decision 4). Default false — i.e. NOT guarded — because that
   *  preserves the current behavior of all four existing bindings; only `help-overlay` opts in. */
  guardWhileOverlayOpen?: boolean;
}
```

Both guard options default to **preserving today's behavior**, so the migration in tasks 3.1/3.2 is a pure
refactor and any behavior change has to be opted into explicitly and visibly at the call site.

*Alternative rejected:* a mutable `registerShortcut()` module singleton. Same enumeration hole, plus it makes
the overlay's contents depend on mount order and on React StrictMode double-invocation.

*Consequence, as a permanent accepted trade-off — not a deferral* (skeptic CR8): the declaration can list a
binding whose handler is not currently mounted, so the overlay may show a shortcut that is inert on the
current route. This is **the intended design, accepted permanently**, and no follow-up ticket is owed for
it: the overlay's purpose is to teach the user the application's full shortcut vocabulary, and hiding a
shortcut because the user is not currently on the route that implements it would defeat that purpose. The
round-1 wording called this "deferred ... no ticket owns it", which was an unowned hand-wave; it is
withdrawn.

### Decision 2 — Explicit modifier set, with `shift` enforced only when the combo declares it

`ShortcutCombo` becomes `{ key, mod?: boolean, shift?: boolean }`. `mod` means Cmd-on-macOS /
Ctrl-elsewhere (unchanged semantics), and is **exactly matched**: an event holding the platform modifier
never matches a combo that omits `mod`, extending the behavior `matchesCombo` already has today.

`shift` is **tri-state, and this is deliberate** (skeptic CR4 — the round-1 design was self-contradictory
here, claiming layout independence via `event.key` while also requiring `shift: true`):

| declaration | meaning |
| --- | --- |
| `shift: true` | Shift MUST be held |
| `shift: false` | Shift must NOT be held |
| `shift` omitted | don't-care |

This resolves the contradiction rather than papering over it. `?` is declared `{ key: "?" }` — Shift
don't-care — so it matches on any layout that produces the `?` character, including layouts where `?` is
not Shift+`/`. Matching on `event.key === "?"` is what buys layout independence, and leaving `shift`
unstated is what preserves it; declaring `shift: true` would have thrown that away, which is exactly what
CR4 caught.

Where Shift genuinely distinguishes two bindings it is stated explicitly on both sides: undo is
`{ key: "z", mod: true, shift: false }` and redo is `{ key: "z", mod: true, shift: true }`. Writing
`shift: false` on undo is load-bearing, not decoration — omitting it would make undo don't-care and let it
swallow redo.

**Rule for downstream tickets (HEL-516/519/503):** for a printable-symbol key whose `key` value already
encodes Shift (`?`, `+`, `:`), omit `shift`. State it only when two bindings on the same `key` must be told
apart.

### Decision 3 — Exactly one physical listener, owned by the shortcuts runtime

**End state, unambiguously (skeptic CR5 — the round-1 heading said "keep two listeners" while the tasks
left one):** after this change there is **exactly one** `window` keydown listener for global shortcuts.

**As shipped** (skeptic-final-1.md non-blocking CR): this listener is owned by a module-level singleton
registry in `shared/chrome/useShortcut.ts`, not by a mounted React provider component — it attaches lazily
on the first `useShortcut` registration and detaches when the last one unregisters. This is a deliberate
refinement over the originally-sketched "provider" framing, not a deviation from it: a context-held provider
would require every consumer to render inside it, which `useLayoutUndoRedo.test.ts` and
`CommandPalette.test.tsx` do not (neither wraps its hook under any such component), so the singleton is what
actually lets those tests pass unmodified while still guaranteeing the single-listener invariant.
`GlobalCommandShortcuts.tsx` **loses its own `window.addEventListener`** and becomes a pure `useShortcut`
consumer (it collapsed to two `useShortcut` calls rather than being deleted). `useLayoutUndoRedo` likewise
becomes a pure consumer and keeps no listener of its own.

The concern that motivated the round-1 "two listeners" framing — that the shell must not import layout/Redux
state — is preserved by the by-id registration indirection, not by a second listener: `useLayoutUndoRedo`
still owns its own handler and its own Redux wiring, and the registry only ever sees an opaque callback.

### Decision 4 — An "overlay-open" guard that covers portalled surfaces, with a per-binding, declarative policy

**The round-1 assumption was false and is withdrawn** (skeptic CR1). Not every modal surface in this app is
a native `<dialog>`: `shared/chrome/MobileNavSheet.tsx:58-62` states in-file that it is a **portalled div**
(for the drag-to-dismiss gesture), and `features/dashboards/ui/RefinementChatDrawer.tsx:231` is a second
such surface. `document.querySelector("dialog[open]")` misses both, so `?` would have stacked the help
overlay on top of an open mobile nav sheet — a direct miss of the acceptance criterion.

The fix is not a documented limitation but a correct selector. Both portalled surfaces already set
`aria-modal="true"` (verified: those are the only two occurrences in the tree), and `Modal`'s native
`<dialog>` is matched by `dialog[open]`. So:

```ts
isOverlayOpen() === document.querySelector('dialog[open], [aria-modal="true"]') !== null
```

This keys off the **accessibility contract** every modal surface must satisfy anyway, which is a more
durable invariant than "is it a `<dialog>`". A future portalled surface that forgets `aria-modal` is an
a11y bug in its own right, and the guard's comment must say so.

**Guard policy is per-binding and declarative** (skeptic CR2 — as scoped in round 1, applying the guard to
"surface-opening bindings" would have killed Cmd/Ctrl+K while the palette was open, because
`CommandPalette.tsx:131-138` renders the palette *as* a `Modal`). Policy is set at the `useShortcut` call
site, and the full table is:

| binding | typing guard | overlay guard | why |
| --- | --- | --- | --- |
| `command-palette` | exempt when focus is inside the palette | **not applied** | preserves today's exemption (`GlobalCommandShortcuts.tsx:24-28`) and keeps Cmd/Ctrl+K working while the palette is open |
| `quick-launcher` | applied | **not applied** | preserves today's behavior exactly; it has no guard now |
| `help-overlay` | applied | **applied** | this is the acceptance criterion — `?` must not fire while a modal is open |
| `layout-undo` / `layout-redo` | applied (shared guard) | **not applied** | preserves today's behavior exactly; adding a guard here would be an unrequested behavior change (task 3.2 requires none) |

Esc is unaffected throughout: `Modal` routes Esc through the dialog's own `cancel` event, never the global
listener.

### Decision 4a — `OverlayProvider` is acknowledged, and deliberately NOT used as the guard source

Round-2 skeptic CR3 correctly found that `shared/chrome/OverlayProvider.tsx` exists — a single-active-overlay
registry (`useOverlay()`) with its own Escape listener — and correctly found that round 1 wrongly claimed only
two global listeners exist. Both corrections are accepted and applied above.

Its further suggestion, that `isOverlayOpen()` should read `useOverlay`'s `activeId` instead of querying the
DOM, is **rejected on measured evidence.** `useOverlay` is not the app's general answer to "is a modal open":

- **Only 2 of the 20 `<Modal>` consumers in the tree register with it** (`CommandPalette`,
  `QuickLauncherOverlay`). The other 18 — `AddSourceModal`, `PanelDetailModal`, `CreatePipelineModal`,
  `OutputEditorSheet`, `PatchSetReview`, `MfaEnrollModal`, and the rest — do not.
- Every surface that DOES register is **already covered** by the DOM query anyway: the five registrants are
  either native `<dialog>` `Modal`s (caught by `dialog[open]`) or portalled sheets that set `aria-modal`
  (caught by the second selector).

So the DOM query is a strict **superset** of the registry, and switching to `activeId` would make the guard
miss 18 modal surfaces — turning a correct guard into a broken one. `?` would fire and stack the help overlay
on top of, say, an open `AddSourceModal`. That is the same class of defect round-1 CR1 caught, which is
reason to keep the more complete signal rather than adopt the more idiomatic-looking one.

The registry and the guard answer genuinely different questions: `useOverlay` answers "which overlay owns
single-active/Escape semantics", which is about *coordination between overlays*; `isOverlayOpen()` answers
"is any modal surface currently on screen", which is about *suppressing a global key*. The help overlay,
being a `Modal`, SHOULD still call `useOverlay()` like its sibling `CommandPalette` does — that is a
cohesion requirement (task 4.1a), and it is separate from the guard.

*If this reasoning is wrong, it is wrong in a way worth catching:* the counter-argument is that the 18
non-registering modals are themselves the defect and should be migrated. That would be a tree-wide refactor
well outside this ticket, so it is not attempted here and no ticket is claimed to own it.

### Decision 5 — The key cap is a new SHARED `shared/ui/KeyCap` primitive, not an overlay-local recipe

Ground truth (skeptic CR7, independently re-verified): `grep -rn "kbd\|keycap\|key-cap"` over
`frontend/src` returns **zero hits**. Nothing in this app renders a key cap today, so this change *invents*
the dialect — which is exactly the circumstance in which a new visual variant gets created by accident and
has to be reconciled later.

**Decision: a new `shared/ui/KeyCap.tsx` + `KeyCap.css` primitive, rendering a semantic `<kbd>`.** Rejected
alternatives, with reasons:

- *Extend `shared/ui/StatusChip`* — rejected. StatusChip communicates a resource's **state** (semantic
  color: success/warn/error). A key cap communicates a **literal key** and is semantically `<kbd>`, not a
  status. Overloading it would force a color-less variant that fits none of its existing semantics.
- *An overlay-local `.help-overlay__key` class* — rejected explicitly. This is the failure mode CR7 names:
  five files already hand-copy `padding: 2px 7px` (`PipelineDetailPage.css`, `PanelDetailModal.binding.css`,
  `PanelGrid.css`, `DashboardList.css` — the HEL-680 pile), and an overlay-local recipe would pass a
  "no hardcoded values" token check while quietly adding a sixth. **A token check and visual cohesion are
  different claims.**

Shared is the right home regardless of this ticket: HEL-516's search surface will want to show the same
caps, and HEL-519/503 after it. `KeyCap` must draw its padding from the same spacing tokens the existing
chip surfaces use rather than introducing a new literal — and if it turns out the honest cohesive answer is
to *fix* the HEL-680 pile, that is out of this ticket's scope: escalate with screenshots, do not silently
widen the diff.

### Decision 6 — Focus rings follow the HEL-1022 contract, which is a correctness detail here

`origin/main` moved to `6b081b86` (HEL-1022) mid-run and this branch was re-baselined onto it. That commit
introduced a binding focus contract (DESIGN.md §8, ~lines 641-664) that lands squarely on a keyboard feature:

- **Always `:focus-visible`, never bare `:focus`, for a ring.** Bare `:focus` flashes a ring at someone who
  opened the surface with a mouse — and an overlay that auto-focuses on open (which it MUST, for a11y) is
  precisely where that misfires.
- **Never hand-roll the ring value.** Use `outline: var(--app-focus-ring)` (`theme.css:294`), the token that
  replaced a literal previously copied across 18 files. `outline-offset` legitimately varies per surface and
  is NOT part of the token.
- `CommandPalette.css` was itself modified by HEL-1022 and now uses `outline: var(--app-focus-ring);
  outline-offset: -2px` at lines 80-82 — the sibling surface this overlay must match.

DESIGN.md's one carve-out (bare `:focus` for a persistent, modality-independent indicator such as a text
input's accent border) does **not** apply to anything in this overlay: every focusable element here is
announcing keyboard navigation, which is the case the rule says must be `:focus-visible`.

### Decision 7 — Platform detection is centralized and injectable

A single `isMacPlatform()` in the shortcuts module, used by both `matchesCombo` (already implicitly, via
accepting either metaKey or ctrlKey) and the keycap renderer. The formatter is a **pure function**
`formatCombo(combo, { mac: boolean }): string[]` returning discrete cap tokens, so both platforms are unit
testable without stubbing `navigator` — the platform read happens once at the component boundary.

## Risks / Trade-offs

- **jsdom-vacuous keyboard/focus assertions** (the central hazard for this ticket, per HEL-1005) → jsdom tests
  are limited to the pure, genuinely-verifiable layer: `matchesCombo` exactness, `formatCombo` on both
  platforms, group derivation, and that the overlay renders one row per declaration. **Every behavioral claim
  about real key dispatch, focus containment, focus restore, Esc, and the modal guard is proved in Playwright
  against the running dev server.** A jsdom assertion about focus or visibility is treated as proving nothing.
- **Undo/redo regression during migration** → the existing `useLayoutUndoRedo.test.ts` must keep passing
  unmodified. Editing that test to accommodate the refactor is a defect symptom, not a fix. The new exact-
  match Shift semantics are the specific regression surface (undo must not fire on `mod+shift+z`); a guard
  test covers it and must be failable by mutation.
- **Overlay may list a route-inert shortcut** (Decision 1) → accepted and documented above.
- **`dialog[open]` also matches a non-modal `<dialog>`** shown with `show()` → none exist in the tree today;
  the guard's comment must state this assumption so a future non-modal dialog does not silently suppress
  shortcuts.
- **Downstream shape churn** → three tickets build on `useShortcut`. Its signature is the reviewed artifact
  here; changing it later is a breaking change across the epic.

## Migration Plan

Additive and frontend-only. `ShortcutCombo.meta` is renamed to `mod` and `matchesCombo` gains Shift
exactness; both call sites (`GlobalCommandShortcuts`, and the new `useShortcut` runtime) are updated in the
same change, and TypeScript makes any missed site a compile error. No wire, schema, or backend impact — but
note this is
not "no downstream impact": the declaration array is a published surface that HEL-516/519/503 consume, and
the layout undo/redo behavior is user-visible. Rollback is a single revert; no data migration.
