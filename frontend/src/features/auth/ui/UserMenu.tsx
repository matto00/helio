import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faGear,
  faArrowRightFromBracket,
  faCircleQuestion,
} from "@fortawesome/free-solid-svg-icons";

import { usePortalPopover } from "../../../hooks/usePortalPopover";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { reopenOnboarding } from "../../onboarding/state/onboardingSlice";
import type { User } from "../types/user";
import "../../../shared/chrome/Popover.css";
import "./UserMenu.css";

/** Render the user's avatar image, falling back to their initial and then to a
 * person icon when the URL fails to load (broken/missing). The previous
 * implementation displayed the alt text "User avatar" when an img tag failed,
 * which read as raw text in the chrome — this provides a graceful default. */
function AvatarOrFallback({ avatarUrl, initial }: { avatarUrl: string | null; initial: string }) {
  const [loadError, setLoadError] = useState(false);
  // F-086: spray-json omits an absent Option field from the wire entirely
  // rather than serializing `null` (see project pipeline-only-bindings
  // notes), so a real `/api/auth/me` response with no avatar arrives as
  // `avatarUrl: undefined`, not `null`, even though the `User` type claims
  // `string | null`. A strict `!== null` check let `undefined` through and
  // rendered `<img src={undefined}>` — a permanently empty ring instead of
  // the initials fallback. A truthiness check catches `undefined`, `null`,
  // and `""` alike.
  if (avatarUrl && !loadError) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="user-menu__avatar"
        onError={() => setLoadError(true)}
      />
    );
  }
  if (initial.length > 0) {
    return (
      <span className="user-menu__initials" aria-hidden="true">
        {initial}
      </span>
    );
  }
  return (
    <span className="user-menu__initials" aria-hidden="true">
      <FontAwesomeIcon icon={faUser} />
    </span>
  );
}

interface UserMenuProps {
  currentUser: User;
  onNavigateToSettings: () => void;
  onLogout: () => void;
}

export function UserMenu({ currentUser, onNavigateToSettings, onLogout }: UserMenuProps) {
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
  const panelRef = useRef<HTMLDivElement>(null);
  // HEL-554 D9 — `UserMenu` is prop-driven and rendered only at
  // `CommandBar.tsx:254`; that file's line 160 is HEL-773's fenced
  // sheet-opening control, so a callback prop here would mean editing it.
  // Calling `useAppDispatch`/`useNavigate` directly instead is the ordinary
  // pattern this component already avoids only because it happened to need
  // no store/router access until now.
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  // Move focus into the menu when it opens. F-082 removed the dropdown's own
  // theme-toggle row and HEL-728 removed its accent-color section; HEL-745
  // then also removed the standalone top-bar theme-toggle icon that F-082
  // had left as the single canonical control. The theme toggle and accent
  // picker both now live on the Settings page's Appearance section (see
  // SettingsPage.tsx), so the first real menuitem varies with nothing
  // hardcoded here; grab whichever button renders first instead of pointing
  // a ref at a specific item.
  useEffect(() => {
    if (isOpen) {
      panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [isOpen]);

  // Restore focus to the trigger on Escape. The hook's document-level listener
  // closes the panel; this companion effect restores focus to the trigger so
  // keyboard navigation continues from the right element.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, triggerRef]);

  const initial = (currentUser.displayName || currentUser.email).charAt(0).toUpperCase();

  // F-189: role="menu" had no arrow-key navigation — Up/Down did nothing,
  // leaving keyboard users to Tab through every item one at a time. This
  // moves real focus among every focusable button currently rendered in the
  // popover (Settings, Sign out), wrapping at both ends. Tab order is left
  // untouched (nothing gets `tabIndex={-1}`) so existing keyboard/screen-reader
  // flows keep working exactly as before; this only adds a faster path.
  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    if (focusable.length === 0) return;
    event.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + delta + focusable.length) % focusable.length;
    focusable[nextIndex]?.focus();
  }

  // HEL-554 D2/D7/D9 — DISPATCHES rather than writing `localStorage` itself
  // (the persisted dismissal has exactly one owner: `useOnboardingHost`'s
  // effect). `reopenOnboarding` clears the stored dismissal and sets the
  // sticky `active` flag; navigating to `/` afterward is what actually
  // presents the checklist, since `PanelList` is the only surface that
  // renders it.
  function handleGettingStarted() {
    close();
    dispatch(reopenOnboarding());
    navigate("/");
  }

  function handleToggle() {
    if (isOpen) {
      close();
    } else {
      handleOpen((rect) => ({ top: rect.bottom + 8, right: window.innerWidth - rect.right }));
    }
  }

  const panel =
    isOpen && panelPos
      ? createPortal(
          <>
            {/* F-189: was a plain, unnamed <button> sitting in the tab order
                between the trigger and the menu's first item — a keyboard
                user landed on a focusable control with no accessible name
                before ever reaching a real menu item. It's purely a
                click-outside-to-close target, so it's pulled out of both the
                tab order and the accessibility tree (matches OpDropdown's
                scrim, the other portalled popover this package owns). */}
            <button
              type="button"
              className="popover__scrim"
              tabIndex={-1}
              aria-hidden="true"
              onClick={close}
            />
            <div
              ref={panelRef}
              className="user-menu__popover"
              role="menu"
              onKeyDown={handleMenuKeyDown}
              style={{
                position: "fixed",
                top: panelPos.top,
                right: panelPos.right,
                left: "auto",
              }}
            >
              <div className="user-menu__header">
                <span className="user-menu__display-name">
                  {currentUser.displayName ?? currentUser.email}
                </span>
                {currentUser.displayName !== null && (
                  <span className="user-menu__email">{currentUser.email}</span>
                )}
              </div>
              {/* F-082: the dropdown used to carry its own "Light mode" /
                  "Dark mode" row, wired to the exact same `toggleTheme` as
                  the then-always-visible top-bar icon — a duplicate control
                  one click away from a control already one click away. This
                  popover has rendered no theme-toggle control since F-082.
                  HEL-728: the same reasoning applied to the "Accent color"
                  section that used to render here. HEL-745: the top-bar icon
                  itself (CommandBar.tsx) is now also gone — both the theme
                  toggle and the accent picker live exclusively on the
                  Settings page (SettingsPage.tsx) now, not in the command
                  bar and not in this popover. */}
              <button
                type="button"
                role="menuitem"
                className="user-menu__item user-menu__item--settings"
                onClick={() => {
                  close();
                  onNavigateToSettings();
                }}
                aria-label="Settings"
              >
                <FontAwesomeIcon icon={faGear} />
                Settings
              </button>
              {/* HEL-554 D9 — the re-open affordance every onboarding scenario
                  needs: reachable regardless of whether the account currently
                  has content (`workspace-create-actions`' own requirement —
                  "an affordance that mutates stored state but presents
                  nothing... SHALL NOT be shipped"). Reuses `.user-menu__item`,
                  which already carries the 44px floor at <=768px
                  (`UserMenu.css:138-140`). */}
              <button
                type="button"
                role="menuitem"
                className="user-menu__item user-menu__item--getting-started"
                onClick={handleGettingStarted}
                aria-label="Getting started"
              >
                <FontAwesomeIcon icon={faCircleQuestion} />
                Getting started
              </button>
              <div className="user-menu__divider" />
              <button
                type="button"
                role="menuitem"
                className="user-menu__item user-menu__item--signout"
                onClick={onLogout}
                aria-label="Sign out"
              >
                <FontAwesomeIcon icon={faArrowRightFromBracket} />
                Sign out
              </button>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="user-menu">
      <button
        ref={triggerRef}
        type="button"
        className="user-menu__trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="User menu"
      >
        <AvatarOrFallback avatarUrl={currentUser.avatarUrl} initial={initial} />
      </button>
      {panel}
    </div>
  );
}
