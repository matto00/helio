package com.helio.infrastructure

import com.helio.domain.UserId
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}

/** Redemption persistence for HEL-704 beta-access invite codes (design.md D3) -- the ONLY writer
 *  of `invite_codes.redeemed_at` and (per this ticket's own overlap-minimizing constraint) of
 *  `users.tier`. [[redeemAndUpgrade]] runs the code-consumption UPDATE and the tier-upgrade
 *  UPDATE as ONE atomic `.transactionally` action under `ctx.withUserContext(userId)` -- mirrors
 *  `AssistantDailyUsageRepository`'s conditional-update-returning idiom: the
 *  `WHERE redeemed_at IS NULL` guard makes concurrent redemption of the SAME code race-free (at
 *  most one of two racing UPDATEs can ever see `redeemed_at IS NULL` and return a row).
 *
 *  Deliberately writes `users.tier` here via raw SQL rather than calling
 *  `UserRepository.updateTier` -- HEL-702 (TOTP MFA, in flight on its own branch) touches
 *  `UserRepository.scala` directly, so this ticket keeps that file untouched entirely (design.md
 *  D3, ticket.md's stated file-overlap hazard). The `tier = 'free'` guard on the `users` UPDATE
 *  is defense-in-depth against ever downgrading a `beta`/`owner` account -- `BetaAccessService`
 *  already pre-checks the caller's tier is `free` before ever calling this method. */
class InviteCodeRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /** `true` iff an unredeemed code hashing to `codeHash`, issued for `userId`, existed and was
   *  just marked redeemed -- in which case `userId`'s tier is also (guarded, best-effort) set to
   *  `beta` in the SAME transaction. `false` means no matching row was found -- unknown code,
   *  foreign-user code, or already-redeemed code are all indistinguishable here (no validity
   *  oracle, per the invite-code-redemption spec) -- and NOTHING was written. */
  def redeemAndUpgrade(userId: UserId, codeHash: String): Future[Boolean] = {
    val consumeCode =
      sqlu"""UPDATE invite_codes SET redeemed_at = now()
             WHERE code_hash = $codeHash
               AND user_id = ${userId.value}::uuid
               AND redeemed_at IS NULL"""

    val action = consumeCode.flatMap { consumedRows =>
      if (consumedRows > 0) {
        sqlu"""UPDATE users SET tier = 'beta'
               WHERE id = ${userId.value}::uuid AND tier = 'free'"""
          .map(_ => true)
      } else {
        DBIO.successful(false)
      }
    }

    ctx.withUserContext(userId.value)(action.transactionally)
  }
}
