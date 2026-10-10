# Registry prefix for Docker Hub base images. Every Docker Hub FROM must use it: CI overrides it to
# mirror.gcr.io/library (HEL-1452, avoids Docker Hub 429s); CD builds with this default.
ARG BASE_REGISTRY=docker.io/library

# Stage 1: Build fat JAR
FROM ${BASE_REGISTRY}/eclipse-temurin:21-jdk-jammy AS builder

RUN apt-get update && apt-get install -y curl gnupg && \
    echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | tee /etc/apt/sources.list.d/sbt.list && \
    curl -sL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | apt-key add - && \
    apt-get update && apt-get install -y sbt && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependency resolution before copying full source
COPY backend/project/build.properties backend/project/
COPY backend/project/plugins.sbt backend/project/
# sbt meta-build sources: build.sbt references objects defined here, so sbt cannot load the build without them
COPY backend/project/*.scala backend/project/
COPY backend/build.sbt backend/
RUN cd backend && sbt update

COPY backend/ backend/
RUN cd backend && sbt assembly

# Stage 2: Minimal runtime image
FROM ${BASE_REGISTRY}/eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S helio && adduser -S helio -G helio

WORKDIR /app
COPY --chown=helio:helio --from=builder /build/backend/target/scala-2.13/helio-backend.jar helio-backend.jar
RUN mkdir -p data && chown helio:helio /app /app/data

USER helio

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:8080/health || exit 1

# JPMS --add-opens flags mirror backend/build.sbt — required for Spark 3.5.x on Java 17+
ENTRYPOINT ["java", \
  "-XX:+UseContainerSupport", \
  "-XX:MaxRAMPercentage=75.0", \
  "-XX:InitialRAMPercentage=50.0", \
  "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED", \
  "--add-opens=java.base/java.lang=ALL-UNNAMED", \
  "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED", \
  "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED", \
  "--add-opens=java.base/java.io=ALL-UNNAMED", \
  "--add-opens=java.base/java.net=ALL-UNNAMED", \
  "--add-opens=java.base/java.nio=ALL-UNNAMED", \
  "--add-opens=java.base/java.util=ALL-UNNAMED", \
  "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED", \
  "--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED", \
  "--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED", \
  "--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED", \
  "--add-opens=java.nio.channels.spi/sun.nio.ch=ALL-UNNAMED", \
  "-Dconfig.resource=application.conf", \
  "-jar", "helio-backend.jar"]
