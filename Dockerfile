# security-framework detection engine — production container
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/engine ./cmd/engine

FROM alpine:3.20
RUN adduser -D -H sensor
COPY --from=builder /out/engine /usr/local/bin/engine
COPY rules/ /opt/security-framework/rules/
COPY sequences/ /opt/security-framework/sequences/
USER sensor
EXPOSE 7777
ENTRYPOINT ["/usr/local/bin/engine"]
CMD ["-addr", ":7777", "-rules", "/opt/security-framework/rules", "-sequences", "/opt/security-framework/sequences"]
