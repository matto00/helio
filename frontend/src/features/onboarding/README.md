# Onboarding

First-run product-tour state and UI: `state/` (`onboardingSlice.ts`,
`onboardingSteps.ts`, `onboardingStorage.ts` for persistence, plus the
first-run drop zone's `firstRunErrors.ts`, `firstRunNaming.ts` and
`firstRunDraft.ts`), `hooks/` (`useOnboardingHost.ts`, `useFirstRunBuild.ts`, `useFirstRunTemplate.ts`),
`services/firstRunService.ts` (`POST /api/first-run/dashboard` and
`/api/first-run/template`), the persona list `state/personaTemplates.ts`, and `ui/`
(`FirstRunDropZone`, `FirstRunTemplateChips`, `FirstRunRefineBar`, `OnboardingChecklist`,
`OnboardingStep`).

The zero-dashboard landing is the drop zone (HEL-1209); the checklist is the
"Set up step by step" path.

**Belongs here:** the first-run drop-zone flow, the onboarding checklist/step
sequencing and its local storage persistence.
**Does not belong here:** the actual creation actions a step launches (e.g.
"create your first dashboard"), which live in the owning feature
(`dashboards`, `panels`, etc.) and are only referenced from here.
