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
#   make ci               the same suite CI runs on every push (gofmt,
#                         build, vet, staticcheck, test -race, Go+Rust
#                         Windows cross-checks, bun, OpenAPI guard +
#                         self-test)

GO      ?= go
CARGO   ?= cargo
BUN     ?= bun
BIN_DIR ?= bin
MODULE  := github.com/Ruby570bocadito/security-framework

.PHONY: all run-engine run-devsensor build test tidy fmt vet build-sensor build-sensor-windows docker-build console-install console-service console console-dom ci dist clean

all: build

run-engine:
	$(GO) run ./cmd/engine -addr :7777 -rules ./rules -v

run-devsensor:
	$(GO) run ./cmd/devsensor -addr 127.0.0.1:7777

build:
	$(GO) build -o $(BIN_DIR)/engine ./cmd/engine
	$(GO) build -o $(BIN_DIR)/devsensor ./cmd/devsensor

test:
	$(GO) test -count=1 ./...

tidy:
	$(GO) mod tidy

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

build-sensor:
	$(CARGO) build --release --manifest-path sensor/Cargo.toml
	@echo "sensor binary: sensor/target/release/security-sensor"

# Native Windows build (run on a Windows host or use the gnu target
# with mingw-w64 for cross compilation from Linux/macOS).
build-sensor-windows:
	$(CARGO) build --release --manifest-path sensor/Cargo.toml --target x86_64-pc-windows-msvc
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

# Functional DOM regression of the real client provider and dashboard
# (esbuild + jsdom fixture; the optional tooling lives in the ignored
# tools/ directory). Same commands the console job of ci.yml runs.
console-dom:
	npm install --prefix tools/console-tests --no-audit --no-fund esbuild@0.25.11 jsdom@26.1.0
	node scripts/dev-tests/check_console_dom.mjs

# Same suite the GitHub Actions workflow (.github/workflows/ci.yml)
# runs on every push. Needs: Go 1.22+, staticcheck 2024.1.1
# (go install honnef.co/go/tools/cmd/staticcheck@2024.1.1 — the exact
# version CI installs), bun, cargo via rustup, python3 + PyYAML.
# The engine Windows cross-check mirrors the ci.yml engine job; the
# Windows-only real-kills smoke stays runner-side (engine-windows job).
ci:
	@out="$$(gofmt -l .)"; if [ -n "$$out" ]; then echo "gofmt needed on:"; echo "$$out"; exit 1; fi
	$(GO) build ./...
	$(GO) vet ./...
	staticcheck -checks "all,-ST1000" ./...
	staticcheck -checks "ST1000,ST1020,ST1021,ST1022" ./...
	$(GO) test -race -count=1 ./...
	GOOS=windows $(GO) build ./...
	GOOS=windows $(GO) vet ./internal/respond/ ./internal/api/ ./cmd/engine/
	python3 scripts/dev-tests/check_openapi.py
	python3 scripts/dev-tests/check_openapi.py --self-test
	cd web/console-service && $(BUN) install --frozen-lockfile && $(BUN) test && bunx tsc --noEmit
	cd web/console && $(BUN) install --frozen-lockfile && $(BUN) test && bunx tsc --noEmit && $(BUN) run build
	npm install --prefix tools/console-tests --no-audit --no-fund esbuild@0.25.11 jsdom@26.1.0
	node scripts/dev-tests/check_console_dom.mjs
	$(CARGO) check --locked --manifest-path sensor/Cargo.toml
	rustup target add x86_64-pc-windows-msvc
	$(CARGO) check --locked --target x86_64-pc-windows-msvc --manifest-path sensor/Cargo.toml

# Release build parity (see .github/workflows/release.yml): the exact
# recipe the release workflow runs, available locally. VERSION defaults
# to the newest tag (or "v0.0.0-dev" with no tags). Example:
#   make dist VERSION=v0.1.0
VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0-dev)
DIST_DIR ?= dist

.PHONY: dist
dist:
	@mkdir -p $(DIST_DIR)
	GOOS=linux   CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w -X main.engineVersion=$(VERSION)" -o $(DIST_DIR)/engine-$(VERSION)-linux-amd64 ./cmd/engine
	GOOS=linux   CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w" -o $(DIST_DIR)/devsensor-$(VERSION)-linux-amd64 ./cmd/devsensor
	GOOS=windows CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w -X main.engineVersion=$(VERSION)" -o $(DIST_DIR)/engine-$(VERSION)-windows-amd64.exe ./cmd/engine
	GOOS=windows CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w" -o $(DIST_DIR)/devsensor-$(VERSION)-windows-amd64.exe ./cmd/devsensor
	./$(DIST_DIR)/engine-$(VERSION)-linux-amd64 version | grep -qF "$(VERSION)" || { echo "version injection failed for $(VERSION)"; exit 1; }
	@echo "dist ready in $(DIST_DIR)/ (version $(VERSION))"

clean:
	rm -rf $(BIN_DIR)
	cargo clean --manifest-path sensor/Cargo.toml 2>/dev/null || true
