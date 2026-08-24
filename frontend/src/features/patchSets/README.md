# Patch Sets

Conversational-refinement patch review: `state/patchSetsSlice.ts`, the API
client (`services/patchSetService.ts`), wire types (`types/patchSet.ts`), and
the review UI (`ui/PatchSetReview`, `PatchSetReviewPage`).

**Belongs here:** reviewing/applying/undoing a proposed patch set.
**Does not belong here:** the chat flow that generates a patch set, which
lives in `dashboards` (`RefinementChatDrawer`) and `assistant`.
