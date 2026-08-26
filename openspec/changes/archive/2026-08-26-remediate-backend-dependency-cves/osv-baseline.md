# HEL-452 baseline OSV scan — backend Maven advisories

Regenerated after design-gate round 2. `osv-scan.py` has had **three** real defects, all found before use and
all now guarded in the tool. Each produced a confidently wrong number, so treat any future count as suspect
until the resolved-coordinate count is also checked:

1. **groupId regex** captured the tree's `+-` glyph, so every lookup queried a nonexistent package and the tool
   silently reported **0** advisories.
2. **Evicted coordinates were counted.** `sbt dependencyTree` prints conflict losers as `(evicted by: X)`; they
   are not on the resolved classpath and do not ship. Counting them overstated the result by 32%.
3. **Truncated input.** `sbt dependencyTree` truncates rows to terminal width, ending them `..`, which destroys
   the `(evicted by:)` marker on deep rows and fabricates versions (`listenablefuture:9999.0-empty-to-avoid-co..`).
   Filtering on the substring `(evicted` is NOT sufficient — some rows truncate before that word begins. The dump
   must raise the graph width, and the tool now **aborts** on any truncated coordinate row.

Reproduce with:

```
cd backend
sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree" > /tmp/compile.txt
sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Test/dependencyTree"    > /tmp/test.txt
python3 osv-scan.py compile=/tmp/compile.txt test=/tmp/test.txt
```

Sanity check the dump before trusting a scan: `grep -c evicted` must equal `grep -c '(evicted by:'`.

Scanned on the pre-change tree at base commit b7f9681a. Raw output: `osv-baseline-raw.txt`.

## Totals

| scope | resolved coords | evicted rows excluded | advisories | vulnerable artifacts |
|---|---|---|---|---|
| **compile (SHIPS IN PRODUCTION)** | 250 | 692 | **70** | **23** |
| test-only delta | 33 | 0 | 1 | 1 |

**Test scope adds NO new advisory.** The single test-only row is `commons-lang3 3.14.0` / GHSA-j288-q9x7-2f5v —
the *same* advisory already counted at compile scope, where it resolves to `3.12.0`. That is why compile and test
scope both total 70. The version that actually ships is **3.12.0**.

Compile-scope severity split:

| severity | count |
|---|---|
| CRITICAL | 1 |
| HIGH | 30 |
| MODERATE | 34 |
| LOW | 5 |

## Compile scope — ships in the production image

| artifact | resolved | severity | advisory | fixed in | summary |
|---|---|---|---|---|---|
| `org.apache.zookeeper:zookeeper` | 3.6.3 | CRITICAL | GHSA-7286-pgfv-vxvh | 3.7.2,3.8.3,3.9.1 | Authorization Bypass Through User-Controlled Key vulnerability in Apache ZooKeep |
| `com.fasterxml.jackson.core:jackson-core` | 2.15.4 | HIGH | GHSA-r7wm-3cxj-wff9 | 2.18.8,2.21.4 | jackson-core: Async parser maxNumberLength bypass via chunked digit accumulation |
| `com.fasterxml.jackson.core:jackson-databind` | 2.15.4 | HIGH | GHSA-j3rv-43j4-c7qm | 2.18.8,2.21.4,3.1.4 | jackson-databind has a PolymorphicTypeValidator bypass via generic type paramete |
| `com.fasterxml.jackson.core:jackson-databind` | 2.15.4 | HIGH | GHSA-rmj7-2vxq-3g9f | 2.18.8,2.21.4,3.1.4 | jackson-databind has an array subtype allowlist bypass in BasicPolymorphicTypeVa |
| `com.google.protobuf:protobuf-java` | 3.25.3 | HIGH | GHSA-735f-pc8j-v9w8 | 3.25.5,4.27.5,4.28.2 | protobuf-java has potential Denial of Service issue |
| `io.airlift:aircompressor` | 0.27 | HIGH | GHSA-vx9q-rhv9-3jvg | 2.0.3 | aircompressor Snappy and LZ4 Java-based decompressor implementation can leak inf |
| `io.grpc:grpc-netty-shaded` | 1.62.2 | HIGH | GHSA-prj3-ccx8-p6x4 | 1.75.0 | Netty affected by MadeYouReset HTTP/2 DDoS vulnerability |
| `io.netty:netty-codec` | 4.1.96.Final | HIGH | GHSA-558v-64gr-wgg4 | 4.1.136.Final | Netty: [Bzip2Decoder] Infinite Loop in RLE State Machine Leads to Event-Loop Thr |
| `io.netty:netty-codec` | 4.1.96.Final | HIGH | GHSA-mj4r-2hfc-f8p6 | 4.1.133.Final | Netty Lz4FrameDecoder is vulnerable to resource exhaustion  |
| `io.netty:netty-codec-http` | 4.1.96.Final | HIGH | GHSA-57rv-r2g8-2cj3 | 4.1.133.Final,4.2.13.Final | Netty has HttpClientCodec response desynchronization |
| `io.netty:netty-codec-http` | 4.1.96.Final | HIGH | GHSA-6jqx-86gh-f27w | 4.1.136.Final,4.2.16.Final | Netty SPDY SETTINGS frame count materializes unbounded settings map |
| `io.netty:netty-codec-http` | 4.1.96.Final | HIGH | GHSA-f6hv-jmp6-3vwv | 4.1.133.Final,4.2.13.Final | Netty: HttpContentDecompressor maxAllocation bypass when Content-Encoding set to |
| `io.netty:netty-codec-http` | 4.1.96.Final | HIGH | GHSA-jppx-w49h-x2qq | 4.1.136.Final,4.2.16.Final | Netty: [SpdyHttpDecoder] ByteBuf Reference Leak on RST_STREAM Leads to Native Me |
| `io.netty:netty-codec-http` | 4.1.96.Final | HIGH | GHSA-mvh2-crg5-v77c | 4.1.136.Final,4.2.16.Final | Netty SPDY zlib header block continues decoded expansion after maxHeaderSize tru |
| `io.netty:netty-codec-http` | 4.1.96.Final | HIGH | GHSA-pwqr-wmgm-9rr8 | 4.1.132.Final,4.2.10.Final | Netty: HTTP Request Smuggling via Chunked Extension Quoted-String Parsing |
| `io.netty:netty-codec-http2` | 4.1.96.Final | HIGH | GHSA-93wv-jw9v-4972 | 4.1.136.Final,4.2.16.Final | Netty: HTTP/2 decompression leaks ByteBuf reference count when the decompressor  |
| `io.netty:netty-codec-http2` | 4.1.96.Final | HIGH | GHSA-f6hv-jmp6-3vwv | 4.1.133.Final,4.2.13.Final | Netty: HttpContentDecompressor maxAllocation bypass when Content-Encoding set to |
| `io.netty:netty-codec-http2` | 4.1.96.Final | HIGH | GHSA-prj3-ccx8-p6x4 | 4.1.124.Final,4.2.4.Final | Netty affected by MadeYouReset HTTP/2 DDoS vulnerability |
| `io.netty:netty-codec-http2` | 4.1.96.Final | HIGH | GHSA-w9fj-cfpg-grvv | 4.1.132.Final,4.2.11.Final | Netty HTTP/2 CONTINUATION Frame Flood DoS via Zero-Byte Frame Bypass |
| `io.netty:netty-codec-http2` | 4.1.96.Final | HIGH | GHSA-xpw8-rcwv-8f8p | 4.1.100.Final | io.netty:netty-codec-http2 vulnerable to HTTP/2 Rapid Reset Attack |
| `io.netty:netty-handler` | 4.1.96.Final | HIGH | GHSA-3qp7-7mw8-wx86 | 4.1.135.Final,4.2.15.Final | Netty has an IPv6 Subnet Filter Bypass via Incorrect Comparator Masking |
| `io.netty:netty-handler` | 4.1.96.Final | HIGH | GHSA-4g8c-wm8x-jfhw | 4.1.118.Final | SslHandler doesn't correctly validate packets which can lead to native crash whe |
| `io.netty:netty-handler` | 4.1.96.Final | HIGH | GHSA-c653-97m9-rcg9 | 4.1.135.Final,4.2.15.Final | Netty: Wrapping plain trust manager silently disables hostname verification |
| `io.netty:netty-handler` | 4.1.96.Final | HIGH | GHSA-x4gw-5cx5-pgmh | 4.1.135.Final,4.2.15.Final | Netty: SNI handler pre-allocates up to 16 MiB from nine attacker bytes |
| `org.apache.ivy:ivy` | 2.5.1 | HIGH | GHSA-2jc4-r94c-rp7h | 2.5.2 | Apache Ivy External Entity Reference vulnerability |
| `org.apache.spark:spark-core_2.13` | 3.5.5 | HIGH | GHSA-jwp6-cvj8-fw65 | 3.5.7,4.0.1 | Apache Spark: Spark History Server Code Execution Vulnerability |
| `org.lz4:lz4-java` | 1.8.0 | HIGH | GHSA-cmp6-m4wj-q63q | - | yawkat LZ4 Java has a possible information leak in Java safe decompressor |
| `org.lz4:lz4-java` | 1.8.0 | HIGH | GHSA-vqf4-7m7x-wgfc | 1.8.1 | LZ4 Java Compression has Out-of-bounds memory operations which can cause DoS |
| `org.postgresql:postgresql` | 42.7.4 | HIGH | GHSA-98qh-xjc8-98pq | 42.7.11 | pgjdbc: Unbounded PBKDF2 iterations in SCRAM authentication allows CPU exhaustio |
| `org.postgresql:postgresql` | 42.7.4 | HIGH | GHSA-hq9p-pm7w-8p54 | 42.7.7 | pgjdbc Client Allows Fallback to Insecure Authentication Despite channelBinding= |
| `org.postgresql:postgresql` | 42.7.4 | HIGH | GHSA-j92g-9f8w-j867 | 42.7.12 | PostgreSQL JDBC Driver: Silent channel-binding authentication downgrade via unsu |
| `ch.qos.logback:logback-core` | 1.5.18 | MODERATE | GHSA-25qh-j22f-pwp8 | 1.3.16,1.5.19 | QOS.CH logback-core is vulnerable to Arbitrary Code Execution through file proce |
| `com.fasterxml.jackson.core:jackson-core` | 2.15.4 | MODERATE | GHSA-72hv-8253-57qq | 2.18.6,2.21.1 | jackson-core: Number Length Constraint Bypass in Async Parser Leads to Potential |
| `com.fasterxml.jackson.core:jackson-databind` | 2.15.4 | MODERATE | GHSA-3pjw-73gf-8qr5 | 2.18.8,2.21.4 | jackson-databind: @JsonIgnore on a Record property is bypassed with a PropertyNa |
| `com.fasterxml.jackson.core:jackson-databind` | 2.15.4 | MODERATE | GHSA-5jmj-h7xm-6q6v | 2.18.9,2.21.5,2.22.1,3.1.4 | jackson-databind has case-insensitive deserialization bypasses per-property @Jso |
| `com.fasterxml.jackson.core:jackson-databind` | 2.15.4 | MODERATE | GHSA-hgj6-7826-r7m5 | 2.18.8,2.21.4,3.1.4 | jackson-databind: InetSocketAddress deserialization triggers eager DNS resolutio |
| `io.netty:netty-codec` | 4.1.96.Final | MODERATE | GHSA-3p8m-j85q-pgmj | 4.1.125.Final | Netty's decoders vulnerable to DoS via zip bomb style attack |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-38f8-5428-x5cv | 4.1.133.Final,4.2.13.Final | Netty vulnerable to HTTP Request Smuggling due to malformed Transfer-Encoding |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-4mp9-239f-g9hg | 4.1.136.Final,4.2.16.Final | Netty: WebSockets V07/V08 handshaker missing Connection/Upgrade validation |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-5jpm-x58v-624v | 4.1.108.Final | Netty's HttpPostRequestDecoder can OOM |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-6cqp-g7gg-8hr5 | 4.1.136.Final,4.2.16.Final | Netty: Security Control Bypass via CORS Short-Circuit Failure |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-84h7-rjj3-6jx4 | 4.1.129.Final,4.2.8.Final | Netty has a CRLF Injection vulnerability in io.netty.handler.codec.http.HttpRequ |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-8c42-7qj2-3j46 | 4.1.137.Final,4.2.17.Final | Netty Vulnerable to Cache Poisoning and Information Disclosure via CORS Vary Hea |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-gcjf-9mgh-3p7g | 4.1.136.Final,4.2.16.Final | Netty: CRLF Injection via Multipart Filename in Netty HttpPostRequestEncoder |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-hvcg-qmg6-jm4c | 4.1.135.Final,4.2.15.Final | Netty: HttpObjectDecoder skips arbitrary initial control characters when only in |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-m4cv-j2px-7723 | 4.1.133.Final,4.2.13.Final | Netty vulnerable to HTTP Request Smuggling due to incorrect chunk size parsing |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-q4f6-jm68-57ww | 4.1.136.Final,4.2.16.Final | Netty: [HttpContentEncoder] Unbounded Per-Connection Queue Growth via HTTP/1.1 P |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-v8h7-rr48-vmmv | 4.1.133.Final,4.2.13.Final | Netty: Start-Line Injection in DefaultHttpRequest.setUri() Allows HTTP Request S |
| `io.netty:netty-codec-http` | 4.1.96.Final | MODERATE | GHSA-xxqh-mfjm-7mv9 | 4.1.133.Final,4.2.13.Final | Netty HTTP/1.0 TE+CL Coexistence Bypasses Smuggling Sanitization |
| `io.netty:netty-codec-http2` | 4.1.96.Final | MODERATE | GHSA-563q-j3cm-6jxm | 4.1.135.Final,4.2.15.Final | Netty susceptible to HTTP/2 Reset Attack with different on-the-wire signature |
| `io.netty:netty-codec-http2` | 4.1.96.Final | MODERATE | GHSA-5x3r-wrvg-rp6q | 4.1.135.Final,4.2.15.Final | Netty HTTP/2: Advertised MAX_CONCURRENT_STREAMS are not enforced |
| `io.netty:netty-codec-http2` | 4.1.96.Final | MODERATE | GHSA-c2gf-v879-257j | 4.1.135.Final,4.2.15.Final | netty-codec-http2: ByteBuf Reference-Count Leak in DelegatingDecompressorFrameLi |
| `io.netty:netty-codec-http2` | 4.1.96.Final | MODERATE | GHSA-c69g-56f8-xwqj | 4.1.136.Final,4.2.16.Final | Netty: [codec-http2] Lack of Host Header Deduplication in HTTP/2→HTTP/1.x Transl |
| `io.netty:netty-common` | 4.1.96.Final | MODERATE | GHSA-389x-839f-4rhx | 4.1.118.Final | Denial of Service attack on windows app using Netty |
| `io.netty:netty-common` | 4.1.96.Final | MODERATE | GHSA-xq3w-v528-46rv | 4.1.115.Final | Denial of Service attack on windows app using netty |
| `io.netty:netty-transport-native-epoll` | 4.1.96.Final | MODERATE | GHSA-w573-9ffj-6ff9 | 4.1.135.Final,4.2.15.Final | Netty: Unix-socket fd receive leaks descriptors when peer sends two at once |
| `io.netty:netty-transport-native-kqueue` | 4.1.96.Final | MODERATE | GHSA-w573-9ffj-6ff9 | 4.1.135.Final,4.2.15.Final | Netty: Unix-socket fd receive leaks descriptors when peer sends two at once |
| `org.apache.commons:commons-lang3` | 3.12.0 | MODERATE | GHSA-j288-q9x7-2f5v | 3.18.0 | Apache Commons Lang is vulnerable to Uncontrolled Recursion when processing long |
| `org.apache.logging.log4j:log4j-1.2-api` | 2.20.0 | MODERATE | GHSA-h383-gmxw-35v2 | 2.25.4 | Apache Log4j 1 to Log4j 2 bridge: silent log event loss in Log4j1XmlLayout due t |
| `org.apache.logging.log4j:log4j-api` | 2.20.0 | MODERATE | GHSA-qv9r-c865-cp47 | 2.25.5,2.26.1 | Apache Log4j API: Improper encoding of non-finite floating-point values during M |
| `org.apache.logging.log4j:log4j-core` | 2.20.0 | MODERATE | GHSA-3pxv-7cmr-fjr4 | 2.25.4 | Apache Log4j Core: Silent log event loss in XmlLayout due to unescaped XML 1.0 f |
| `org.apache.logging.log4j:log4j-core` | 2.20.0 | MODERATE | GHSA-6hg6-v5c8-fphq | 2.25.4 | Apache Log4j Core: `verifyHostName` attribute silently ignored in TLS configurat |
| `org.apache.logging.log4j:log4j-core` | 2.20.0 | MODERATE | GHSA-vc5p-v9hr-52mj | 2.25.3 | Apache Log4j does not verify the TLS hostname in its Socket Appender |
| `org.apache.zookeeper:zookeeper` | 3.6.3 | MODERATE | GHSA-r978-9m6m-6gm6 | 3.8.4,3.9.2 | Apache ZooKeeper vulnerable to information disclosure in persistent watchers han |
| `org.lz4:lz4-java` | 1.8.0 | MODERATE | GHSA-xx22-p4ch-683r | - | LZ4 Java: Native XXHash implementations can crash the JVM when passed invalid by |
| `ch.qos.logback:logback-core` | 1.5.18 | LOW | GHSA-jhq6-gfmj-v8fx | 1.5.34 | Logback vulnerable to Object Injection through HardenedObjectInputStream modules |
| `ch.qos.logback:logback-core` | 1.5.18 | LOW | GHSA-p47f-322f-whfh | 1.5.33 | QOS.CH Sarl logback logback-core has a deserialization of untrusted data vulnera |
| `ch.qos.logback:logback-core` | 1.5.18 | LOW | GHSA-qqpg-mvqg-649v | 1.5.25 | Logback allows an attacker to instantiate classes already present on the class p |
| `io.netty:netty-codec-http` | 4.1.96.Final | LOW | GHSA-fghv-69vj-qj49 | 4.1.125.Final,4.2.5.Final | Netty vulnerable to request smuggling due to incorrect parsing of chunk extensio |
| `io.netty:netty-handler-proxy` | 4.1.96.Final | LOW | GHSA-45q3-82m4-75jr | 4.1.133.Final,4.2.13.Final | Netty has HTTP Header Injection via HttpProxyHandler Disabled Validation (Incomp |

## Test-only delta — does NOT ship (same advisory as compile, different version)

| artifact | resolved | severity | advisory | fixed in | summary |
|---|---|---|---|---|---|
| `org.apache.commons:commons-lang3` | 3.14.0 | MODERATE | GHSA-j288-q9x7-2f5v | 3.18.0 | Apache Commons Lang is vulnerable to Uncontrolled Recursion when processing long |
