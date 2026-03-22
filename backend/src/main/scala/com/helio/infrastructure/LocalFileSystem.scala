package com.helio.infrastructure

import java.nio.file.{Files, Path, Paths}
import java.nio.file.attribute.BasicFileAttributes
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.jdk.CollectionConverters._

class LocalFileSystem(baseDir: Path)(implicit ec: ExecutionContext) extends FileSystem {

  Files.createDirectories(baseDir)

  def write(path: String, bytes: Array[Byte]): Future[Unit] = Future {
    blocking {
      val target = resolve(path)
      Files.createDirectories(target.getParent)
      Files.write(target, bytes)
      ()
    }
  }

  def read(path: String): Future[Array[Byte]] = Future {
    blocking {
      Files.readAllBytes(resolve(path))
    }
  }

  def delete(path: String): Future[Unit] = Future {
    blocking {
      Files.deleteIfExists(resolve(path))
      ()
    }
  }

  def exists(path: String): Future[Boolean] = Future {
    blocking {
      Files.exists(resolve(path))
    }
  }

  def list(prefix: String): Future[Seq[String]] = Future {
    blocking {
      val root = resolve(prefix)
      if (!Files.exists(root)) {
        Seq.empty
      } else if (Files.isDirectory(root)) {
        Files
          .walk(root)
          .filter(p => !Files.isDirectory(p))
          .iterator()
          .asScala
          .map(p => baseDir.relativize(p).toString)
          .toSeq
      } else {
        // prefix points to a file directly
        Seq(baseDir.relativize(root).toString)
      }
    }
  }

  private def resolve(path: String): Path =
    baseDir.resolve(path).normalize()
}

object LocalFileSystem {
  def fromEnv()(implicit ec: ExecutionContext): LocalFileSystem = {
    val dir = sys.env.getOrElse("HELIO_UPLOADS_DIR", "./data/uploads")
    new LocalFileSystem(Paths.get(dir).toAbsolutePath)
  }
}
