# Onboarding

First-run product-tour state and UI: `state/` (`onboardingSlice.ts`,
`onboardingSteps.ts`, `onboardingStorage.ts` for persistence),
`hooks/useOnboardingHost.ts`, and `ui/` (`OnboardingChecklist`,
`OnboardingStep`).

**Belongs here:** the onboarding checklist/step sequencing and its local
storage persistence.
**Does not belong here:** the actual creation actions a step launches (e.g.
"create your first dashboard"), which live in the owning feature
(`dashboards`, `panels`, etc.) and are only referenced from here.
