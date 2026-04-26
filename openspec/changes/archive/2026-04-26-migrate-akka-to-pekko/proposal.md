## Why

Akka moved to the Business Source License (BSL) in 2022; commercial production use requires a paid license. Apache Pekko is a community-maintained, Apache-licensed fork of Akka that is a near drop-in replacement, eliminating the licensing concern at zero behavioral cost.

## What Changes

- **build.sbt**: Replace all 7 `com.typesafe.akka` dependencies with `org.apache.pekko` equivalents at Pekko 1.1.x versions; remove `loadAkkaLicenseKeyOptions()` and all `AKKA_LICENSE_KEY` plumbing.
- **Scala sources** (21 files): Rewrite `import akka.` → `import org.apache.pekko.` — no logic changes.
- **application.conf**: Rename `akka {}` block to `pekko {}`; remove license-key entries.
- **.env.example** and any other env-var docs: Remove `AKKA_LICENSE_KEY` references.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change touches implementation dependencies only; no spec-level behavior changes.

## Non-goals

- No behavioral changes to any API endpoint or frontend interaction.
- No Scala logic refactoring beyond mechanical import renaming.
- No changes to the Pekko configuration surface beyond renaming the root config key.

## Impact

- **Backend build**: `build.sbt` and resolved dependency JARs change; requires `sbt reload`.
- **All backend `.scala` files**: Import paths updated; no logic changes.
- **`application.conf`**: Root config key renamed; Pekko runtime reads from `pekko {}` instead of `akka {}`.
- **Dev environment**: `AKKA_LICENSE_KEY` no longer needed in `.env`; existing `.env` files with the key are harmless but can be cleaned up.
