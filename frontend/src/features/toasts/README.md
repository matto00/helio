# Toasts

Global toast notifications: `state/` (`toastsSlice.ts` and
`toastListeners.ts`, which surfaces thunk rejections as toasts) and
`hooks/useToast.ts`.

**Belongs here:** the toast queue and the dispatch hook/listener that feed
it.
**Does not belong here:** the toast's visual rendering, which is a shared
primitive in `shared/ui`.
