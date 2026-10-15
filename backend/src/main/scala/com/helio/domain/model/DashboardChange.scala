package com.helio.domain.model

import java.time.Instant

/** HEL-1575: the newest `output_snapshot_history` capture for one Output bound to a dashboard's panels. */
final case class DashboardOutputChange(outputId: String, dataUpdatedAt: Option[Instant])

/** HEL-1575: when a dashboard's content last changed and when its panels' Outputs last received new data.
 *  `dataUpdatedAt` is the latest over `outputs`, or None when none has history. */
final case class DashboardChange(
    dashboardId: String,
    contentUpdatedAt: Instant,
    dataUpdatedAt: Option[Instant],
    outputs: Vector[DashboardOutputChange]
)
