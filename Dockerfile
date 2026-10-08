# bluetardigrade detection engine — production container
#
# ARG GOLANG_VERSION (audit 5.10): the builder base is parametrized so
# the pinned toolchain travels with go.mod (go.mod's `go 1.26` line is
# the source of truth). Floating `golang:1.27-alpine` could silently
# build with a different toolchain than CI certified; pinning the ARG
# to the CI-certified version keeps the container inside the same
# verifiable chain as the release binaries.
ARG GOLANG_VERSION=1.26.6
FROM golang:${GOLANG_VERSION}-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/engine ./cmd/engine

FROM alpine:3.24
RUN adduser -D -H -g "bluetardigrade engine" sensor
COPY --from=builder /out/engine /usr/local/bin/engine
COPY rules/ /opt/bluetardigrade/rules/
COPY sequences/ /opt/bluetardigrade/sequences/
COPY beacons.yaml thresholds.yaml /opt/bluetardigrade/
# Writable state home: the engine's relative default paths (./respond-audit.jsonl,
# ./alert-lifecycle.json, ./respond-operators.yaml, ./suppressions.yaml) resolve
# against the CWD — with the default / they would land in a root the non-root
# USER cannot write and the triage/audit surfaces would degrade silently.
RUN mkdir -p /var/lib/bluetardigrade && chown sensor:sensor /var/lib/bluetardigrade
WORKDIR /var/lib/bluetardigrade
USER sensor
EXPOSE 7777 7778
# Liveness against the engine's own probe route (the same one CI smoke uses).
# wget comes from busybox, already present in alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7778/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/engine"]
# Tokens are delivered through the environment (SF_API_TOKEN /
# SF_INGEST_TOKEN — the engine reads both as flag fallbacks), NOT baked
# into the command line: process arguments are world-readable metadata
# (docker inspect, /proc) and a token there is a leak by construction.
# A container started without SF_API_TOKEN still binds its API to
# 0.0.0.0 (container isolation gates exposure) exactly like before;
# publishing the port to the host without a token is on the operator.
CMD ["-addr", ":7777", "-rules", "/opt/bluetardigrade/rules", "-sequences", "/opt/bluetardigrade/sequences", "-beacons", "/opt/bluetardigrade/beacons.yaml", "-thresholds", "/opt/bluetardigrade/thresholds.yaml", "-api", "0.0.0.0:7778", "-respond-audit", "/var/lib/bluetardigrade/respond-audit.jsonl", "-lifecycle", "/var/lib/bluetardigrade/alert-lifecycle.json"]
