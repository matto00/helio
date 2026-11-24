# HEL-1852 release checklist (source for the PR body's "Before release")

Do these in order, as the owner. Nothing here was run by the delivery lane (no gcloud, no prod access).

1. **Create the secret** `helio-owner-emails` in Secret Manager (project `helio-493120`). Enter the
   comma-separated allowlist interactively so it never lands in shell history:

   ```bash
   read -rs LIST && printf '%s' "$LIST" | gcloud secrets create helio-owner-emails \
     --data-file=- --project=helio-493120 && unset LIST
   ```

2. **Grant access**: `roles/secretmanager.secretAccessor` on that secret to
   `helio-backend-sa@helio-493120.iam.gserviceaccount.com`.

3. **Duplicate check on prod** (read-only). It uses the SAME normal form as V148's `DO` block, so an
   empty result guarantees V148 will not raise. It returns the normal form and a count only:

   ```sql
   SELECT lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g')) AS normal_form, count(*)
   FROM users
   GROUP BY 1
   HAVING count(*) > 1;
   ```

   **STOP: if this query returns ANY row, do not tag.** V148 would refuse to migrate and the new
   revision would not start. Resolve each group by hand (decide which account keeps the address;
   rename or delete the others), then re-run the query until it returns no rows.

   **Re-run it immediately before tagging (step 6).** The old code still running in prod accepts
   case-variant signups until V148 is live, so an earlier clean result can go stale.

4. **Owner-tier listing on prod** (read-only). Confirm every row is expected. A password-only owner
   row (`has_google = false`, `has_password = true`) is the attack's signature: confirm it or demote
   it by hand (this change never demotes):

   ```sql
   SELECT id, email, created_at,
          google_id IS NOT NULL AS has_google,
          password_hash IS NOT NULL AS has_password
   FROM users
   WHERE tier = 'owner'
   ORDER BY created_at;
   ```

5. **One-time literal-to-secret switch** (UNVERIFIED, not run by the lane). Cloud Run refuses to turn
   an existing plain variable into a secret reference in one update. Preferred, atomic:

   ```bash
   gcloud run services update helio-backend --region=us-west1 --project=helio-493120 \
     --remove-env-vars=HELIO_OWNER_EMAILS \
     --update-secrets=HELIO_OWNER_EMAILS=helio-owner-emails:latest
   ```

   Fallback: two updates, remove then add. In the gap the allowlist is unset: tiers are unaffected
   (promote-only) but beta-access notifications return `503`.

6. **Tag only after step 3 returned no rows on its final run** (the re-run immediately before tagging).

## Notes

- **HEL-1856**: this change covers only its "unverified Google email can match the owner allowlist"
  bullet (no unverified email can be granted or promoted to owner). It leaves refusing unverified
  Google sign-in for non-owner accounts, and the account-linking rule (a Google first sign-in whose
  email collides with an existing password account still ends in the generic `500`).
- Git history still contains the old allowlist value; rewriting history is out of scope. The tracked
  `openspec` archive files also still hold the address; that cleanup is filed as HEL-1878 (owner
  decision: merge without the archive scrub).
- A Google first sign-in for an address that already has a password account still ends in the
  generic 500; that is HEL-1856's linking rule.
- `infra/.env.deploy.example` is handled by the driver with the owner, not by this change.
- V148 aborts the migration step loudly if step 3 would have returned rows.
