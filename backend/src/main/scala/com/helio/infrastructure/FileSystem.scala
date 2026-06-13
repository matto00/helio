package com.helio.infrastructure

import scala.concurrent.Future

case class ListPage(names: Seq[String], nextCursor: Option[String])

trait FileSystem {
  def write(path: String, bytes: Array[Byte]): Future[Unit]
  def read(path: String): Future[Array[Byte]]
  def delete(path: String): Future[Unit]
  def exists(path: String): Future[Boolean]
  def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]
}
