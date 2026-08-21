import { clearAuth } from "../../auth/state/authSlice";
import {
  activateOnboarding,
  dismissOnboarding,
  hydrateDismissed,
  onboardingReducer,
  recordOnboardingComplete,
  reopenOnboarding,
} from "./onboardingSlice";

const initialState: { active: boolean; dismissed: boolean | null } = {
  active: false,
  dismissed: null,
};

describe("onboardingSlice", () => {
  it("starts with `active: false` and `dismissed: null` (not yet hydrated)", () => {
    expect(onboardingReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("hydrateDismissed sets dismissed to whatever was read from storage", () => {
    const next = onboardingReducer(initialState, hydrateDismissed(true));
    expect(next).toEqual({ active: false, dismissed: true });

    const next2 = onboardingReducer(next, hydrateDismissed(false));
    expect(next2).toEqual({ active: false, dismissed: false });
  });

  it("activateOnboarding sets active without touching dismissed", () => {
    const next = onboardingReducer({ active: false, dismissed: false }, activateOnboarding());
    expect(next).toEqual({ active: true, dismissed: false });
  });

  it("reopenOnboarding sets active AND clears any stored dismissal", () => {
    const next = onboardingReducer({ active: false, dismissed: true }, reopenOnboarding());
    expect(next).toEqual({ active: true, dismissed: false });
  });

  it("dismissOnboarding clears active and records the dismissal", () => {
    const next = onboardingReducer({ active: true, dismissed: false }, dismissOnboarding());
    expect(next).toEqual({ active: false, dismissed: true });
  });

  // design.md D2/task 1.12 — the defect this guards: an earlier draft
  // cleared `active` here too, which meant the completed chain vanished the
  // instant its own completion became true instead of staying on screen.
  it("recordOnboardingComplete records the dismissal but leaves `active` untouched", () => {
    const next = onboardingReducer({ active: true, dismissed: false }, recordOnboardingComplete());
    expect(next).toEqual({ active: true, dismissed: true });

    // Also true starting from active: false (a returning user who never
    // engaged with the checklist at all) — the reducer itself never flips
    // `active`; whether this action is dispatched in that case at all is
    // `useOnboardingHost`'s job (gated on `visible`), not this reducer's.
    const next2 = onboardingReducer(
      { active: false, dismissed: false },
      recordOnboardingComplete(),
    );
    expect(next2).toEqual({ active: false, dismissed: true });
  });

  // Finding #9 (round-4 skeptic) — `logout` clears only the auth slice (no
  // root reset in store.ts), so without this a second user signing in
  // without a reload would inherit the first user's sticky `active` flag AND
  // their `dismissed` value.
  describe("clearAuth (finding #9 — same-browser user switch)", () => {
    it("resets the whole slice back to its defaults on clearAuth", () => {
      const dirtyState = { active: true, dismissed: true };
      const next = onboardingReducer(dirtyState, clearAuth());
      expect(next).toEqual(initialState);
    });

    // Prove the guard can fail: a reducer that ignored `clearAuth` entirely
    // (the pre-fix shape) would leave the dirty state untouched — assert
    // against that literal broken variant first, so this test can't be
    // trivially satisfied by a no-op reducer.
    it("(red-before-green) a reducer with no clearAuth case would leak `active` across the switch", () => {
      const reducerWithNoClearAuthCase = (
        state = initialState,
        action: { type: string },
      ): typeof initialState => {
        if (action.type === hydrateDismissed.type) return state;
        return state;
      };
      const dirtyState = { active: true, dismissed: true };
      const leaked = reducerWithNoClearAuthCase(dirtyState, clearAuth());
      expect(leaked).toEqual(dirtyState); // proves the probe CAN detect the leak
      expect(leaked).not.toEqual(initialState);

      // The real reducer does not leak.
      expect(onboardingReducer(dirtyState, clearAuth())).toEqual(initialState);
    });
  });
});
