import { Link, useLocation, useNavigate } from "react-router-dom";

import "./BottomNav.css";
import { logout } from "../../features/auth/state/authSlice";
import { UserMenu } from "../../features/auth/ui/UserMenu";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { isDestinationActive, phoneNavTabs, type PhoneNavTab } from "./navDestinations";
import { ICON_SIZE } from "../ui/iconSize";

/**
 * Bottom tab bar for section navigation. Breakpoint-gated entirely in
 * `BottomNav.css` (hidden >=768px) so it is a real, always-mounted shared
 * component rather than a phone-only hack — promoting it to desktop later is
 * a stylesheet change, not a rewrite. See `notes/mobile-pwa-handoff.md` §W3.1.
 *
 * HEL-1583: five tabs (`phoneNavTabs`: Home, Dashboards, Data, Pipelines, Me). The ACTIVE tab shows its label beside
 * its icon; inactive tabs are icon-only. Every tab's `aria-label` is its entire accessible name — the label span is
 * `aria-hidden` and collapsed on inactive tabs, so it never adds to the name.
 */
export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {phoneNavTabs.map((tab) =>
        tab.kind === "menu" ? (
          <MeTab key={tab.label} tab={tab} active={isDestinationActive(tab, pathname)} />
        ) : (
          <RouteTab key={tab.to} tab={tab} active={isDestinationActive(tab, pathname)} />
        ),
      )}
    </nav>
  );
}

type RouteTabData = Extract<PhoneNavTab, { kind: "route" }>;
type MenuTabData = Extract<PhoneNavTab, { kind: "menu" }>;

function tabClassName(active: boolean): string {
  return active ? "bottom-nav__tab bottom-nav__tab--active" : "bottom-nav__tab";
}

/** Dedicated carrier for the active-state lozenge (D6) — never style the <svg> directly. Lucide emits
 *  width="22"/height="22" as presentation attributes, and the global `* { box-sizing: border-box }` then resolves
 *  padding+border inward from that 22px, clamping the icon's content box to 0px if the lozenge styling lands on the
 *  <svg> itself. */
function TabFace({ tab, active }: { tab: PhoneNavTab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <span className="bottom-nav__lozenge">
      <Icon className="bottom-nav__icon" size={ICON_SIZE.lg} aria-hidden="true" />
      <span
        className="bottom-nav__label"
        aria-hidden="true"
        data-active={active ? "true" : "false"}
      >
        {tab.label}
      </span>
    </span>
  );
}

function RouteTab({ tab, active }: { tab: RouteTabData; active: boolean }) {
  return (
    <Link
      to={tab.to}
      aria-label={tab.label}
      aria-current={active ? "page" : undefined}
      className={tabClassName(active)}
    >
      <TabFace tab={tab} active={active} />
    </Link>
  );
}

/** The Me tab: a menu button (not a route), so its current state is `aria-current="true"`, never `"page"`. It reuses
 *  `UserMenu` through its trigger slot so the menu items, keyboard handling and owner gating stay in one component. */
function MeTab({ tab, active }: { tab: MenuTabData; active: boolean }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  if (currentUser === null) return null;
  async function handleLogout() {
    await dispatch(logout());
    void navigate("/login");
  }
  return (
    <UserMenu
      currentUser={currentUser}
      onNavigateToSettings={() => navigate("/settings")}
      onLogout={() => void handleLogout()}
      placement="nav"
      tabTrigger={{
        className: tabClassName(active),
        label: tab.label,
        active,
        children: <TabFace tab={tab} active={active} />,
      }}
    />
  );
}
