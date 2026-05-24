import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser, faSun, faMoon, faArrowRightFromBracket } from "@fortawesome/free-solid-svg-icons";

import { usePortalPopover } from "../../../hooks/usePortalPopover";
import { AccentPicker } from "../../../shared/chrome/AccentPicker";
import type { Theme } from "../../../theme/theme";
import type { User } from "../types/user";
import "../../../shared/chrome/Popover.css";
import "./UserMenu.css";

/** Render the user's avatar image, falling back to their initial and then to a
 * person icon when the URL fails to load (broken/missing). The previous
 * implementation displayed the alt text "User avatar" when an img tag failed,
 * which read as raw text in the chrome — this provides a graceful default. */
function AvatarOrFallback({ avatarUrl, initial }: { avatarUrl: string | null; initial: string }) {
  const [loadError, setLoadError] = useState(false);
  if (avatarUrl !== null && !loadError) {
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
  theme: Theme;
  toggleTheme: () => void;
  accentColor: string;
  setAccentColor: (hex: string) => void;
  onLogout: () => void;
}

export function UserMenu({
  currentUser,
  theme,
  toggleTheme,
  accentColor,
  setAccentColor,
  onLogout,
}: UserMenuProps) {
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (isOpen) {
      firstItemRef.current?.focus();
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
            <button type="button" className="popover__scrim" onClick={close} />
            <div
              className="user-menu__popover"
              role="menu"
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
              <div className="user-menu__divider" />
              <button
                ref={firstItemRef}
                type="button"
                role="menuitem"
                className="user-menu__item user-menu__item--theme"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <div className="user-menu__divider" />
              <div className="user-menu__section">
                <span className="user-menu__section-label">Accent color</span>
                <AccentPicker accentColor={accentColor} setAccentColor={setAccentColor} />
              </div>
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
