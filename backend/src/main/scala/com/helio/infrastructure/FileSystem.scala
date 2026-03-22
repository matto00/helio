package com.helio.infrastructure

import scala.concurrent.Future

trait FileSystem {
  def write(path: String, bytes: Array[Byte]): Future[Unit]
  def read(path: String): Future[Array[Byte]]
  def delete(path: String): Future[Unit]
  def exists(path: String): Future[Boolean]
  def list(prefix: String): Future[Seq[String]]
}
