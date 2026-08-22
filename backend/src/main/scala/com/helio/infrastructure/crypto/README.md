# Crypto

Cryptographic primitives with no domain of their own: `TokenHashing`
(session/API-token hashing, used across `persistence/auth/`).

Not a domain — this is structural infrastructure. `TotpSupport` (RFC 6238
TOTP secret generation and code verification) is a similar crypto primitive
but lives at `persistence/auth/` instead, because HEL-633's target layout
enumerates this directory's contents as `TokenHashing` only; do not read
that placement as encapsulation, either file is a plain crypto utility.
Does NOT hold: repositories, or anything with a business-logic dependency.
