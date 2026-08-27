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

// HEL-459: generates a CycloneDX 1.4 SBOM directly from the resolved compile-scope
// classpath's attached `ModuleID`s (Coursier's own resolution result), rather than
// text-parsing `sbt dependencyTree` output the way the archived HEL-452 `osv-scan.py`
// evidence tool did. Reading `ModuleID` off `externalDependencyClasspath` means there is
// no glyph-capture, eviction-row, relocated-coordinate, or version-regex defect class to
// guard against (design.md D2) — every entry here is a coordinate Coursier actually put on
// the classpath. `osv-scanner` (backend/osv-scanner.toml) consumes this file's output.
val generateSbom = taskKey[File]("Generate a CycloneDX 1.4 SBOM from the resolved compile-scope classpath")

generateSbom := {
  val log = streams.value.log
  val classpath = (Compile / externalDependencyClasspath).value
  val modules = classpath
    .flatMap(_.get(moduleID.key))
    .distinct
    .sortBy(m => (m.organization, m.name, m.revision))

  def escape(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"")

  val components = modules.map { m =>
    val purl = s"pkg:maven/${escape(m.organization)}/${escape(m.name)}@${escape(m.revision)}"
    s"""    {
       |      "type": "library",
       |      "group": "${escape(m.organization)}",
       |      "name": "${escape(m.name)}",
       |      "version": "${escape(m.revision)}",
       |      "purl": "$purl",
       |      "bom-ref": "$purl"
       |    }""".stripMargin
  }

  val json =
    s"""{
       |  "bomFormat": "CycloneDX",
       |  "specVersion": "1.4",
       |  "version": 1,
       |  "components": [
       |${components.mkString(",\n")}
       |  ]
       |}
       |""".stripMargin

  val outFile = target.value / "sbom.cdx.json"
  IO.write(outFile, json)
  log.info(s"HEL-459: wrote SBOM with ${modules.size} components to $outFile")
  outFile
}

lazy val root = (project in file("."))
  .settings(
    name := "helio-backend",
    // HEL-536: RewrapConnectorCredentialsJob adds a second top-level `def main` (invoked only via
    // `sbt runMain com.helio.maintenance.RewrapConnectorCredentialsJob`, per docs/secrets-inventory.md's
    // rotation runbook), which makes `sbt run`/`bgRun` ambiguous between it and Main and forces an
    // interactive "Enter number:" prompt — fatal in non-interactive contexts like CI/e2e (`sbt run`
    // hangs/fails with "No main class detected"). Pin `run`'s main class explicitly so `sbt run` keeps
    // launching the server unattended; `runMain <fqcn>` is unaffected and still reaches the job directly.
    Compile / run / mainClass := Some("com.helio.app.Main"),
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
    // Spark 3.5.x on Java 17+ requires these JVM flags to access restricted sun.* APIs
    javaOptions ++= Seq(
      "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
      "--add-opens=java.base/java.lang=ALL-UNNAMED",
      "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
      "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
      "--add-opens=java.base/java.io=ALL-UNNAMED",
      "--add-opens=java.base/java.net=ALL-UNNAMED",
      "--add-opens=java.base/java.nio=ALL-UNNAMED",
      "--add-opens=java.base/java.util=ALL-UNNAMED",
      "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED",
      "--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED",
      "--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED",
      "--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED",
      "--add-opens=java.nio.channels.spi/sun.nio.ch=ALL-UNNAMED"
    ),
    Compile / run / envVars ++= loadDotEnv(baseDirectory.value),
    Test / envVars ++= loadDotEnv(baseDirectory.value),
    // Required for Spark to access internal JDK classes under Java 9+ module system
    Test / javaOptions ++= Seq(
      "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
      "--add-opens=java.base/java.lang=ALL-UNNAMED",
      "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
      "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
      "--add-opens=java.base/java.io=ALL-UNNAMED",
      "--add-opens=java.base/java.net=ALL-UNNAMED",
      "--add-opens=java.base/java.nio=ALL-UNNAMED",
      "--add-opens=java.base/java.util=ALL-UNNAMED",
      "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED",
      "--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED",
      "--add-opens=java.base/sun.util.calendar=ALL-UNNAMED"
    ),
    Compile / run / javaOptions ++= Seq(
      "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
      "--add-opens=java.base/java.lang=ALL-UNNAMED",
      "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
      "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
      "--add-opens=java.base/java.io=ALL-UNNAMED",
      "--add-opens=java.base/java.net=ALL-UNNAMED",
      "--add-opens=java.base/java.nio=ALL-UNNAMED",
      "--add-opens=java.base/java.util=ALL-UNNAMED",
      "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED",
      "--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED",
      "--add-opens=java.base/sun.util.calendar=ALL-UNNAMED"
    ),
    libraryDependencies ++= Seq(
      "org.apache.pekko" %% "pekko-actor-typed" % "1.1.3",
      "org.apache.pekko" %% "pekko-http" % "1.1.0",
      "org.apache.pekko" %% "pekko-http-spray-json" % "1.1.0",
      "org.apache.pekko" %% "pekko-slf4j" % "1.1.3",
      "org.apache.pekko" %% "pekko-stream" % "1.1.3",
      // HEL-452: 1.5.38 clears the logback-core advisories (GHSA-25qh-j22f-pwp8,
      // GHSA-jhq6-gfmj-v8fx, GHSA-p47f-322f-whfh, GHSA-qqpg-mvqg-649v).
      "ch.qos.logback" % "logback-classic" % "1.5.38",
      // Structured JSON log encoder for Cloud Logging (HEL-115). 7.4 declares
      // Jackson 2.15.2; the Jackson dependencyOverrides pin below forces 2.18.9.
      "net.logstash.logback" % "logstash-logback-encoder" % "7.4",
      // Enables logback <if>/<then>/<else> conditional config in logback.xml
      // (self-contained, no transitive deps).
      "org.codehaus.janino" % "janino" % "3.1.12",
      "com.typesafe.slick" %% "slick" % "3.5.2",
      "com.typesafe.slick" %% "slick-hikaricp" % "3.5.2",
      // HEL-452: 42.7.13 clears GHSA-98qh-xjc8-98pq, GHSA-hq9p-pm7w-8p54, GHSA-j92g-9f8w-j867.
      "org.postgresql" % "postgresql" % "42.7.13",
      "org.flywaydb" % "flyway-core" % "10.20.1",
      "org.flywaydb" % "flyway-database-postgresql" % "10.20.1",
      "org.apache.pekko" %% "pekko-testkit" % "1.1.3" % Test,
      "org.apache.pekko" %% "pekko-http-testkit" % "1.1.0" % Test,
      "org.scalatest" %% "scalatest" % "3.2.19" % Test,
      "org.mockito" % "mockito-core" % "5.12.0" % Test,
      "io.zonky.test" % "embedded-postgres" % "2.0.7" % Test,
      // HEL-371 cycle-2: real JSON Schema (2020-12) validation of a live
      // GET /api/workspace/context response body against
      // schemas/workspace/workspace-context.schema.json — Jackson is already on the
      // classpath (pinned below), this adds only the schema-validation
      // engine itself.
      "com.networknt" % "json-schema-validator" % "1.0.87" % Test,
      "org.apache.pekko" %% "pekko-http-cors" % "1.1.0",
      "com.github.t3hnar" %% "scala-bcrypt" % "4.3.0",
      // HEL-702: RFC 6238 TOTP MFA. java-otp does the one crypto-sensitive
      // piece (HMAC-based code generation) with zero transitive deps;
      // commons-codec supplies RFC 4648 Base32 (the JDK only ships Base64).
      "com.eatthepath" % "java-otp" % "0.4.0",
      "commons-codec" % "commons-codec" % "1.17.1",
      "com.mysql" % "mysql-connector-j" % "8.3.0",
      "com.google.cloud.sql" % "postgres-socket-factory" % "1.21.0",
      // HEL-452: deliberately left at 2.40.1 -- no GCS release in a safe range was
      // established to pull grpc-netty-shaded >= 1.75.0, so those advisories (and
      // protobuf-java's) are cleared by the dependencyOverrides pins below instead
      // (design D2.4a fallback).
      "com.google.cloud" % "google-cloud-storage" % "2.40.1",
      "org.apache.pdfbox" % "pdfbox" % "3.0.3",
      "com.knuddels" % "jtokkit" % "1.1.0",
      // Spark -- compile scope (driver runs in this JVM); exclude Akka/Pekko and logging conflicts
      // HEL-452: 3.5.9 clears GHSA-jwp6-cvj8-fw65 (Spark History Server RCE)
      "org.apache.spark" %% "spark-core" % "3.5.9"
        exclude("org.apache.pekko", "*")
        exclude("com.typesafe.akka", "akka-actor_2.13")
        exclude("com.typesafe.akka", "akka-stream_2.13")
        exclude("com.typesafe.akka", "akka-slf4j_2.13")
        exclude("org.slf4j", "slf4j-log4j12")
        exclude("org.apache.logging.log4j", "log4j-slf4j2-impl"),
      "org.apache.spark" %% "spark-sql" % "3.5.9"
        exclude("org.apache.pekko", "*")
        exclude("com.typesafe.akka", "akka-actor_2.13")
        exclude("com.typesafe.akka", "akka-stream_2.13")
        exclude("com.typesafe.akka", "akka-slf4j_2.13")
        exclude("org.slf4j", "slf4j-log4j12")
        exclude("org.apache.logging.log4j", "log4j-slf4j2-impl")
    ),
    // HEL-452: Pin Jackson to a single patched version across all artifacts on the
    // classpath (Spark 3.5.x and logstash-logback-encoder 7.4 both link Jackson).
    // 2.18.9 is the lowest version clearing every advisory in the set — GHSA-5jmj-h7xm-6q6v
    // is fixed only at 2.18.9; the other six (GHSA-r7wm-3cxj-wff9, GHSA-j3rv-43j4-c7qm,
    // GHSA-rmj7-2vxq-3g9f, GHSA-72hv-8253-57qq, GHSA-3pjw-73gf-8qr5, GHSA-hgj6-7826-r7m5)
    // are fixed by 2.18.8. jackson-datatype-jsr310 (pulled in transitively at 2.15.2 via
    // flyway-core) is included here so no Jackson artifact is left outside the pin.
    dependencyOverrides ++= Seq(
      "com.fasterxml.jackson.core"     % "jackson-core"           % "2.18.9",
      "com.fasterxml.jackson.core"     % "jackson-databind"       % "2.18.9",
      "com.fasterxml.jackson.core"     % "jackson-annotations"    % "2.18.9",
      "com.fasterxml.jackson.module"   %% "jackson-module-scala"  % "2.18.9",
      "com.fasterxml.jackson.datatype" % "jackson-datatype-jsr310" % "2.18.9",
      "com.fasterxml.jackson.dataformat" % "jackson-dataformat-toml" % "2.18.9",
      // HEL-452: netty family pinned to one consistent version (design D2 worked
      // example — 4.1.137.Final is required by GHSA-8c42-7qj2-3j46 on
      // netty-codec-http; it also clears every other netty advisory in the set).
      "io.netty" % "netty-codec"                  % "4.1.137.Final",
      "io.netty" % "netty-codec-http"              % "4.1.137.Final",
      "io.netty" % "netty-codec-http2"             % "4.1.137.Final",
      "io.netty" % "netty-common"                  % "4.1.137.Final",
      "io.netty" % "netty-handler"                 % "4.1.137.Final",
      "io.netty" % "netty-handler-proxy"           % "4.1.137.Final",
      "io.netty" % "netty-transport"               % "4.1.137.Final",
      "io.netty" % "netty-transport-native-epoll"  % "4.1.137.Final",
      "io.netty" % "netty-transport-native-kqueue" % "4.1.137.Final",
      "io.netty" % "netty-transport-native-unix-common" % "4.1.137.Final",
      "io.netty" % "netty-buffer"                  % "4.1.137.Final",
      "io.netty" % "netty-resolver"                % "4.1.137.Final",
      // HEL-452: clears GHSA-prj3-ccx8-p6x4 (MadeYouReset HTTP/2 DDoS) on grpc-netty-shaded's
      // shaded Netty; grpc-netty-shaded itself has no separate advisory once its Netty is
      // patched, so no direct override on the artifact itself is needed.
      "io.grpc" % "grpc-netty-shaded" % "1.75.0",
      // HEL-452: clears GHSA-735f-pc8j-v9w8 (DoS)
      "com.google.protobuf" % "protobuf-java" % "3.25.5",
      // HEL-452: clears GHSA-2jc4-r94c-rp7h (External Entity Reference)
      "org.apache.ivy" % "ivy" % "2.5.2",
      // HEL-452: clears GHSA-j288-q9x7-2f5v (Uncontrolled Recursion)
      "org.apache.commons" % "commons-lang3" % "3.18.0",
      // HEL-452: log4j 2.x pinned to one consistent version. 2.25.5 is required by
      // log4j-api's GHSA-qv9r-c865-cp47; log4j-core and log4j-1.2-api's own advisories
      // are already cleared at 2.25.4, so the family target is the max, 2.25.5.
      "org.apache.logging.log4j" % "log4j-api"      % "2.25.5",
      "org.apache.logging.log4j" % "log4j-core"     % "2.25.5",
      "org.apache.logging.log4j" % "log4j-1.2-api"  % "2.25.5",
      // HEL-452: clears GHSA-vqf4-7m7x-wgfc (out-of-bounds memory / DoS). The other two
      // lz4-java advisories on this artifact (GHSA-cmp6-m4wj-q63q, GHSA-xx22-p4ch-683r) have
      // no published fix anywhere and are deferred — see design.md D5.
      "org.lz4" % "lz4-java" % "1.8.1"
    )
  )
