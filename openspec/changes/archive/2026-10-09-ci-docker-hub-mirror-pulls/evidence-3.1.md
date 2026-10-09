# Task 3.1 evidence: mirror vs Docker Hub manifest-list digests
Captured 2026-10-09T21:15:22Z via anonymous HEAD requests (Docker-Content-Digest header).

- eclipse-temurin:21-jdk-jammy: hub=sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b mirror=sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b => EQUAL
- eclipse-temurin:21-jre-alpine: hub=sha256:51ab5e3302e7141ce665ca3ea85e8b5cd648eafbc3c0c90dd79d6537684e4555 mirror=sha256:51ab5e3302e7141ce665ca3ea85e8b5cd648eafbc3c0c90dd79d6537684e4555 => EQUAL
- postgres:16: hub=sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d mirror=sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d => EQUAL

# Task 1.2: default expansion (textual substitution of edited FROM lines with BASE_REGISTRY=docker.io/library)
FROM docker.io/library/eclipse-temurin:21-jdk-jammy AS builder
FROM docker.io/library/eclipse-temurin:21-jre-alpine AS runtime
