# bluetardigrade — build automation
# Targets:
#   make run-engine       start the detection engine (:7777)
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
MODULE  := github.com/Ruby570bocadito/bluetardigrade

.PHONY: all run-engine build test tidy fmt vet build-sensor build-sensor-windows docker-build console-install console-service console console-dom console-browser ci dist clean

all: build

run-engine:
	$(GO) run ./cmd/engine -addr :7777 -rules ./rules -v

build:
	$(GO) build -o $(BIN_DIR)/engine ./cmd/engine
	$(GO) build -o $(BIN_DIR)/collector ./cmd/collector

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
	docker build -t bluetardigrade-engine .

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
	npm install --prefix tools/console-tests --no-audit --no-fund --ignore-scripts --no-save --no-package-lock esbuild@0.25.11 jsdom@26.1.0
	node scripts/dev-tests/check_console_dom.mjs

# Real Chromium checks of the production console with isolated REST/SSE fixtures.
# Build the console first; CONSOLE_BROWSER_URL can select a running loopback app.
console-browser:
	npm install --prefix tools/console-tests --no-audit --no-fund --ignore-scripts --no-save --no-package-lock playwright@1.63.0
	node tools/console-tests/node_modules/playwright/cli.js install chromium
	node scripts/dev-tests/check_console_browser.mjs

# Same suite the GitHub Actions workflow (.github/workflows/ci.yml)
# runs on every push. Needs: Go 1.26+, staticcheck 2026.2.1
# (go install honnef.co/go/tools/cmd/staticcheck@2026.2.1 — the exact
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
	mkdir -p bin
	$(GO) build -o bin/engine-file-smoke ./cmd/engine
	python3 scripts/dev-tests/smoke_file_forensics.py --engine ./bin/engine-file-smoke
	$(GO) build -o bin/collector-smoke ./cmd/collector
	python3 scripts/dev-tests/smoke_soc_pipeline.py --engine ./bin/engine-file-smoke --collector ./bin/collector-smoke
	GOOS=windows $(GO) build ./...
	GOOS=windows $(GO) vet ./...
	python3 scripts/dev-tests/check_openapi.py
	python3 scripts/dev-tests/check_openapi.py --self-test
	python3 scripts/dev-tests/check_rule_inventory.py
	python3 scripts/dev-tests/check_package_lifecycle.py --self-test
	python3 scripts/dev-tests/check_package_lifecycle.py
	python3 scripts/dev-tests/check_workflows.py --self-test
	python3 scripts/dev-tests/check_workflows.py
	python3 scripts/dev-tests/check_console_theme.py
	@if command -v pwsh >/dev/null 2>&1; then pwsh -NoProfile -File scripts/dev-tests/check_powershell_syntax.ps1; else echo "powershell syntax guard SKIPPED (no pwsh on PATH; CI runs it on ubuntu and windows runners)"; fi
	python3 scripts/dev-tests/check_installer_native_stderr.py
	cd web/console-service && $(BUN) install --frozen-lockfile && $(BUN) test && bunx tsc --noEmit
	cd web/console && $(BUN) install --frozen-lockfile && $(BUN) test && bunx tsc --noEmit && $(BUN) run build
	npm install --prefix tools/console-tests --no-audit --no-fund --ignore-scripts --no-save --no-package-lock esbuild@0.25.11 jsdom@26.1.0
	node scripts/dev-tests/check_console_dom.mjs
	npm install --prefix tools/console-tests --no-audit --no-fund --ignore-scripts --no-save --no-package-lock playwright@1.63.0
	node tools/console-tests/node_modules/playwright/cli.js install chromium
	node scripts/dev-tests/check_console_browser.mjs
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
	GOOS=windows CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w -X main.engineVersion=$(VERSION)" -o $(DIST_DIR)/engine-$(VERSION)-windows-amd64.exe ./cmd/engine
	GOOS=linux CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w" -o $(DIST_DIR)/collector-$(VERSION)-linux-amd64 ./cmd/collector
	GOOS=windows CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w" -o $(DIST_DIR)/collector-$(VERSION)-windows-amd64.exe ./cmd/collector
	./$(DIST_DIR)/engine-$(VERSION)-linux-amd64 version | grep -qF "$(VERSION)" || { echo "version injection failed for $(VERSION)"; exit 1; }
	@echo "dist ready in $(DIST_DIR)/ (version $(VERSION))"

clean:
	rm -rf $(BIN_DIR)
	cargo clean --manifest-path sensor/Cargo.toml 2>/dev/null || true
