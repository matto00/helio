// One-time backup-codes display (HEL-702, design.md D6) — shared by
// `MfaEnrollModal`'s final step and `MfaSecuritySection`'s regenerate flow,
// since both reveal a fresh code set exactly once and never again.

import { faCopy } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import "./MfaBackupCodesList.css";

interface MfaBackupCodesListProps {
  codes: string[];
  onCopyAll: () => void;
}

export function MfaBackupCodesList({ codes, onCopyAll }: MfaBackupCodesListProps) {
  return (
    <div className="mfa-backup-codes">
      <p className="mfa-backup-codes__hint">
        Save these backup codes now — each works once, and they won&rsquo;t be shown again.
      </p>
      <ul className="mfa-backup-codes__list">
        {codes.map((code) => (
          <li key={code} className="mfa-backup-codes__code">
            {code}
          </li>
        ))}
      </ul>
      <button type="button" className="mfa-backup-codes__copy-btn" onClick={onCopyAll}>
        <FontAwesomeIcon icon={faCopy} aria-hidden="true" />
        Copy all
      </button>
    </div>
  );
}
