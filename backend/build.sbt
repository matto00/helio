ThisBuild / scalaVersion := "2.13.15"

lazy val root = (project in file("."))
  .settings(
    name := "helio-backend",
    libraryDependencies ++= Seq(
      "com.typesafe.akka" %% "akka-actor-typed" % "2.8.8",
      "com.typesafe.akka" %% "akka-http" % "10.5.3",
      "com.typesafe.akka" %% "akka-http-spray-json" % "10.5.3",
      "com.typesafe.akka" %% "akka-slf4j" % "2.8.8",
      "com.typesafe.akka" %% "akka-stream" % "2.8.8",
      "ch.qos.logback" % "logback-classic" % "1.2.12",
      "com.typesafe.akka" %% "akka-testkit" % "2.8.8" % Test,
      "com.typesafe.akka" %% "akka-http-testkit" % "10.5.3" % Test,
      "org.scalatest" %% "scalatest" % "3.2.19" % Test
    )
  )
