package com.helio.domain.util

import java.util.Locale

/** HEL-1852: the ONE email normal form -- trimmed and lower-cased -- applied at every auth entry
 *  point (password register, password login, Google sign-in) before an address is looked up, stored
 *  or compared with the owner allowlist.
 *
 *  Trim is Java `String.trim` (strips every leading/trailing char in U+0000..U+0020); migration V148
 *  implements the same class in SQL. `Locale.ROOT` avoids locale traps such as the Turkish dotless i. */
object EmailNormalizer {
  def normalize(raw: String): String = raw.trim.toLowerCase(Locale.ROOT)

  /** True when `email` still holds whitespace or a control character (an address that must not be stored). */
  def hasWhitespaceOrControl(email: String): Boolean = email.exists(c => Character.isWhitespace(c) || Character.isISOControl(c))
}
