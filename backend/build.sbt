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

def loadAkkaLicenseKeyOptions(baseDir: File): Seq[String] =
  loadDotEnv(baseDir)
    .get("AKKA_LICENSE_KEY")
    .toSeq
    .map(key => s"-Dakka.license-key=$key")

lazy val root = (project in file("."))
  .settings(
    name := "helio-backend",
    Compile / run / fork := true,
    Test / fork := true,
    Compile / run / envVars ++= loadDotEnv(baseDirectory.value),
    Test / envVars ++= loadDotEnv(baseDirectory.value),
    Compile / run / javaOptions ++= loadAkkaLicenseKeyOptions(baseDirectory.value),
    Test / javaOptions ++= loadAkkaLicenseKeyOptions(baseDirectory.value),
    libraryDependencies ++= Seq(
      "com.typesafe.akka" %% "akka-actor-typed" % "2.8.8",
      "com.typesafe.akka" %% "akka-http" % "10.5.3",
      "com.typesafe.akka" %% "akka-http-spray-json" % "10.5.3",
      "com.typesafe.akka" %% "akka-slf4j" % "2.8.8",
      "com.typesafe.akka" %% "akka-stream" % "2.8.8",
      "ch.qos.logback" % "logback-classic" % "1.2.12",
      "com.typesafe.slick" %% "slick" % "3.5.2",
      "com.typesafe.slick" %% "slick-hikaricp" % "3.5.2",
      "org.postgresql" % "postgresql" % "42.7.4",
      "org.flywaydb" % "flyway-core" % "10.20.1",
      "org.flywaydb" % "flyway-database-postgresql" % "10.20.1",
      "com.typesafe.akka" %% "akka-testkit" % "2.8.8" % Test,
      "com.typesafe.akka" %% "akka-http-testkit" % "10.5.3" % Test,
      "org.scalatest" %% "scalatest" % "3.2.19" % Test,
      "io.zonky.test" % "embedded-postgres" % "2.0.7" % Test
    )
  )
