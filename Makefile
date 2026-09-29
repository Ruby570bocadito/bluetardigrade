# security-framework — build automation
# Targets:
#   make run-engine       start the detection engine (:7777)
#   make run-devsensor    replay the simulated TTP scenario
#   make build            build all Go binaries into bin/
#   make test             run unit tests
#   make build-sensor     build the Rust sensor (native target)
#   make build-sensor-windows   cross-build the sensor for Windows
#   make docker-build     build the engine container image
#   make console-install  install web console deps (bun)
#   make console-service  run the realtime telemetry hub (:3003)
#   make console          run the web console (Next.js, :3000)

GO      ?= go
CARGO   ?= cargo
BUN     ?= bun
BIN_DIR ?= bin
MODULE  := github.com/Ruby570bocadito/security-framework

.PHONY: all run-engine run-devsensor build test tidy fmt vet build-sensor build-sensor-windows docker-build console-install console-service console ci clean

all: build

run-engine:
	$(GO) run ./cmd/engine -addr :7777 -rules ./rules -v

run-devsensor:
	$(GO) run ./cmd/devsensor -addr 127.0.0.1:7777

build:
	$(GO) build -o $(BIN_DIR)/engine ./cmd/engine
	$(GO) build -o $(BIN_DIR)/devsensor ./cmd/devsensor

test:
	$(GO) test ./...

tidy:
	$(GO) mod tidy

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

build-sensor:
	$(CARGO) build --release
	@echo "sensor binary: sensor/target/release/security-sensor"

# Native Windows build (run on a Windows host or use the gnu target
# with mingw-w64 for cross compilation from Linux/macOS).
build-sensor-windows:
	$(CARGO) build --release --target x86_64-pc-windows-msvc
	@echo "sensor binary: sensor/target/x86_64-pc-windows-msvc/release/security-sensor.exe"

docker-build:
	docker build -t security-framework-engine .

console-install:
	cd web/console && $(BUN) install
	cd web/console-service && $(BUN) install

console-service:
	cd web/console-service && $(BUN) run dev

console:
	cd web/console && $(BUN) run dev

# Same suite the GitHub Actions workflow (.github/workflows/ci.yml)
# runs on every push. Needs: Go 1.22+, bun, cargo, python3 + PyYAML.
ci:
	@out="$$(gofmt -l .)"; if [ -n "$$out" ]; then echo "gofmt needed on:"; echo "$$out"; exit 1; fi
	$(GO) build ./...
	$(GO) vet ./...
	$(GO) test -count=1 ./...
	python3 scripts/dev-tests/check_openapi.py
	cd web/console-service && $(BUN) install --frozen-lockfile && $(BUN) test && bunx tsc --noEmit
	cd web/console && $(BUN) install --frozen-lockfile && bunx tsc --noEmit && $(BUN) run build
	$(CARGO) check --locked --manifest-path sensor/Cargo.toml

clean:
	rm -rf $(BIN_DIR)
	cargo clean --manifest-path sensor/Cargo.toml 2>/dev/null || true
