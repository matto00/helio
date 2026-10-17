import { Link, useLocation } from "react-router-dom";

import "../../features/dashboards/ui/DashboardChipRow.css";
import { useIsPhoneShell } from "../../app/shell/useIsPhoneShell";
import { dataSectionLinks } from "./navDestinations";

/** Phone-only "Sources | Connectors" link row on `/sources` and `/connectors` (HEL-1583). The phone nav has one Data tab;
 *  this is what makes Connectors reachable from it. Real links, so the current page carries `aria-current="page"`.
 *  Reuses the dashboard chip pill styling (`DashboardChipRow.css`) rather than restyling it. Not rendered above 768px,
 *  where the rail lists Connectors itself. */
export function DataSectionTabs() {
  return useIsPhoneShell() ? <DataSectionLinks /> : null;
}

function DataSectionLinks() {
  const { pathname } = useLocation();
  return (
    <nav className="data-section-tabs" aria-label="Data sections">
      {dataSectionLinks.map((link) => {
        const active = pathname === link.to || pathname.startsWith(`${link.to}/`);
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`dashboard-chip data-section-tabs__link${active ? " dashboard-chip--active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
