import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Theme } from "../theme/theme";
import type { User } from "../types/models";
import "./UserMenu.css";

interface UserMenuProps {
  currentUser: User;
  theme: Theme;
  toggleTheme: () => void;
  onLogout: () => void;
}

export function UserMenu({ currentUser, theme, toggleTheme, onLogout }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      firstItemRef.current?.focus();
    }
  }, [isOpen]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  const initial = (currentUser.displayName || currentUser.email).charAt(0).toUpperCase();

  return (
    <div className="user-menu" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu__trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="User menu"
      >
        {currentUser.avatarUrl ? (
          <img src={currentUser.avatarUrl} alt="User avatar" className="user-menu__avatar" />
        ) : (
          <span className="user-menu__initials" aria-hidden="true">
            {initial}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="user-menu__popover" role="menu">
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
            className="user-menu__item"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-menu__item user-menu__item--signout"
            onClick={onLogout}
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
