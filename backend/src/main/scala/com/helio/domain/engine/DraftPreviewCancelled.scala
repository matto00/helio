package com.helio.domain.engine

/** HEL-1630: raised by [[InProcessPipelineEngine.executeTree]] when its `shouldContinue` hook turns false before a node
 *  starts (the draft-preview client went away). It fails the whole walk; it is never routed through `onNodeError`. */
final class DraftPreviewCancelled extends RuntimeException("Draft preview cancelled before the next step started")
