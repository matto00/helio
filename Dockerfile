# Stage 1: Build fat JAR
FROM eclipse-temurin:21-jdk-jammy AS builder

RUN apt-get update && apt-get install -y curl gnupg && \
    echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | tee /etc/apt/sources.list.d/sbt.list && \
    curl -sL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | apt-key add - && \
    apt-get update && apt-get install -y sbt && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependency resolution before copying full source
COPY backend/project/build.properties backend/project/
COPY backend/project/plugins.sbt backend/project/
COPY backend/build.sbt backend/
RUN cd backend && sbt update

COPY backend/ backend/
RUN cd backend && sbt assembly

# Stage 2: Minimal runtime image
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S helio && adduser -S helio -G helio

WORKDIR /app
COPY --from=builder /build/backend/target/scala-2.13/helio-backend.jar helio-backend.jar
RUN mkdir -p data && chown -R helio:helio /app

USER helio

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-XX:InitialRAMPercentage=50.0", "-Dconfig.resource=application.conf", "-jar", "helio-backend.jar"]
