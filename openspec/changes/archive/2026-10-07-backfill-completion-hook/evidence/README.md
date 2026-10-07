Mutation evidence (HEL-1356). All mutations reverted before commit.
- 01-baseline-green.log: committed change, spec green (99/99).
- 02-mutation-late-backfill.log: `false` arm of backfillOutputNode delayed 1s then evaluates+persists. New test RED at the `materialized shouldBe false` assertion ("true was not equal to false"); OLDSHAPE sleep-200 twin (same seeded fixture, temp-only) GREEN.
- 03-reverted-green.log: mutation + twin reverted, 99/99 green.
- 04-mutation-skip-observer.log: triggerBackfill skips observer -> new test fails on "no backfill Future recorded" guard.
