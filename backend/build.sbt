ThisBuild / scalaVersion := "2.13.15"

def loadDotEnv(baseDir: File): Map[String, String] = {
  val envFile = baseDir / ".env"
  if (!envFile.exists()) {
    Map.empty
  } else {
    IO.readLines(envFile)
      .map(_.trim)
      .filter(line => line.nonEmpty && !line.startsWith("#"))
      .flatMap { line =>
        line.split("=", 2) match {
          case Array(key, value) if key.trim.nonEmpty =>
            Some(key.trim -> value.trim)
          case _ =>
            None
        }
      }
      .toMap
  }
}

lazy val root = (project in file("."))
  .settings(
    name := "helio-backend",
    assembly / mainClass := Some("com.helio.app.Main"),
    assembly / assemblyJarName := "helio-backend.jar",
    assembly / assemblyMergeStrategy := {
      case "reference.conf"                        => MergeStrategy.concat
      case "application.conf"                      => MergeStrategy.concat
      case PathList("META-INF", "services", _*)    => MergeStrategy.concat
      case PathList("META-INF", "MANIFEST.MF")     => MergeStrategy.discard
      case PathList("META-INF", _*)                => MergeStrategy.discard
      case "module-info.class"                     => MergeStrategy.discard
      case x                                       => MergeStrategy.first
    },
    Compile / run / fork := true,
    Test / fork := true,
    Compile / run / envVars ++= loadDotEnv(baseDirectory.value),
    Test / envVars ++= loadDotEnv(baseDirectory.value),
    libraryDependencies ++= Seq(
      "org.apache.pekko" %% "pekko-actor-typed" % "1.1.3",
      "org.apache.pekko" %% "pekko-http" % "1.1.0",
      "org.apache.pekko" %% "pekko-http-spray-json" % "1.1.0",
      "org.apache.pekko" %% "pekko-slf4j" % "1.1.3",
      "org.apache.pekko" %% "pekko-stream" % "1.1.3",
      "ch.qos.logback" % "logback-classic" % "1.5.18",
      "com.typesafe.slick" %% "slick" % "3.5.2",
      "com.typesafe.slick" %% "slick-hikaricp" % "3.5.2",
      "org.postgresql" % "postgresql" % "42.7.4",
      "org.flywaydb" % "flyway-core" % "10.20.1",
      "org.flywaydb" % "flyway-database-postgresql" % "10.20.1",
      "org.apache.pekko" %% "pekko-testkit" % "1.1.3" % Test,
      "org.apache.pekko" %% "pekko-http-testkit" % "1.1.0" % Test,
      "org.scalatest" %% "scalatest" % "3.2.19" % Test,
      "io.zonky.test" % "embedded-postgres" % "2.0.7" % Test,
      "org.apache.pekko" %% "pekko-http-cors" % "1.1.0",
      "com.github.t3hnar" %% "scala-bcrypt" % "4.3.0",
      "com.mysql" % "mysql-connector-j" % "8.3.0",
      "com.google.cloud.sql" % "postgres-socket-factory" % "1.21.0"
    )
  )
