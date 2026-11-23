# Toasts

Global toast notifications: `state/` (`toastsSlice.ts` and
`toastListeners.ts`, which surfaces thunk rejections as toasts) and
`hooks/useToast.ts`.

**Belongs here:** the toast queue and the dispatch hook/listener that feed
it.
**Does not belong here:** the toast's visual rendering, which is a shared
primitive in `shared/ui`.

A toast may carry `items` (HEL-1172): ordered rows, each a link (`linkTo`), its reason text and an
optional per-row `action`. `consumeToastItemAction` removes one row's action and dismisses the toast
once none is left. `message` stays the aggregate coalescing key and live-region text.
