## 1. Infrastructure

- [x] 1.1 Add `-XX:+UseContainerSupport`, `-XX:MaxRAMPercentage=75.0`, and `-XX:InitialRAMPercentage=50.0` to the `ENTRYPOINT` in `Dockerfile`
- [x] 1.2 Verify the flags are correct by inspecting the updated ENTRYPOINT line

## 2. Verification

- [x] 2.1 Build the Docker image locally: `docker build -t helio-test .`
- [x] 2.2 Run with a 512m memory limit and confirm heap is ~384m: `docker run --rm -m 512m helio-test java -XX:+PrintFlagsFinal -version 2>&1 | grep -E "MaxHeapSize|InitialHeapSize"`
