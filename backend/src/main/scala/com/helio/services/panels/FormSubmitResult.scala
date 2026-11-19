package com.helio.services.panels

import com.helio.services.sources.RowWriteResult

/** A successful form submit. `writerIsFormOwner` decides whether the response may carry each row's `seq`: only the
 *  form's owner is entitled to the dataset's row ordering (HEL-1784 design.md D4). */
final case class FormSubmitResult(write: RowWriteResult, writerIsFormOwner: Boolean)
