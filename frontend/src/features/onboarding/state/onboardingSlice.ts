import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";

interface OnboardingState {
  /** Sticky session flag — set by auto-activation or an explicit re-open,
   *  cleared ONLY by explicit dismiss (design.md D2). Creating a resource
   *  must never clear it, and neither may reaching all-four-complete
   *  (`recordOnboardingComplete` never touches this field). */
  active: boolean;
  /** Per-user persisted dismissal, mirrored to `localStorage` by
   *  `useOnboardingHost` (design.md D7) — the ONLY writer of storage.
   *  `UserMenu`'s re-open affordance and the checklist's own dismiss control
   *  both dispatch here; neither ever touches storage directly.
   *
   *  `null` means "not yet hydrated for the signed-in user", distinct from a
   *  known `false`. Every consumer (`autoActivate`'s derivation, the
   *  persistence effect) must treat `null` as "don't act yet" rather than
   *  falling back to `!dismissed`-style truthiness — a round-4 design-gate
   *  finding: a user who mounts `PanelList` for the first time on a LATER
   *  navigation (after `dashboards` has already resolved elsewhere in the
   *  session) would otherwise get one un-hydrated render that can't tell
   *  "no stored dismissal" apart from "haven't checked yet", painting the
   *  checklist for an account that had already dismissed it. */
  dismissed: boolean | null;
}

const initialState: OnboardingState = {
  active: false,
  dismissed: null,
};

const onboardingSlice = createSlice({
  name: "onboarding",
  initialState,
  reducers: {
    /** Dispatched once per signed-in user id by `useOnboardingHost`'s
     *  hydration effect, with whatever `onboardingStorage.readStoredDismissed`
     *  read for that user (`false` if nothing was stored, or storage
     *  raised). */
    hydrateDismissed(state, action: PayloadAction<boolean>) {
      state.dismissed = action.payload;
    },
    /** The sticky auto-activation effect: fires once `autoActivate` (a pure
     *  derivation off the dashboards collection) is true, so `active` alone
     *  carries visibility forward even after `autoActivate` itself goes
     *  false (design.md D2). */
    activateOnboarding(state) {
      state.active = true;
    },
    /** The "Getting started" affordance (`UserMenu`) — activates regardless
     *  of whether the account currently has content, and clears any stored
     *  dismissal so re-dismissing immediately afterward is a genuine second
     *  write, not a no-op against an already-`true` value (design.md D7 /
     *  the round-3 single-owner defect). */
    reopenOnboarding(state) {
      state.active = true;
      state.dismissed = false;
    },
    /** The checklist's own close control, and its "Done" button once every
     *  step reads complete. */
    dismissOnboarding(state) {
      state.active = false;
      state.dismissed = true;
    },
    /** All four steps read complete: persist the dismissal so a later load
     *  doesn't auto-activate, but deliberately leave `active` untouched —
     *  removing it here would mean the completion is never actually seen,
     *  and would leave a re-opening user with everything already built
     *  looking at nothing (design.md D2, task 1.12). */
    recordOnboardingComplete(state) {
      state.dismissed = true;
    },
  },
  extraReducers: (builder) => {
    // A same-browser user switch clears only the auth slice today (no root
    // reset in store.ts) — without this, a second user signing in without a
    // reload would inherit the first user's sticky `active` flag. Resetting
    // the WHOLE slice back to its defaults also clears `dismissed` to `null`,
    // so the next `useOnboardingHost` mount re-hydrates the new user's own
    // stored value instead of reusing the previous user's in-memory one.
    builder.addCase(clearAuth, () => initialState);
  },
});

export const {
  hydrateDismissed,
  activateOnboarding,
  reopenOnboarding,
  dismissOnboarding,
  recordOnboardingComplete,
} = onboardingSlice.actions;
export const onboardingReducer = onboardingSlice.reducer;
