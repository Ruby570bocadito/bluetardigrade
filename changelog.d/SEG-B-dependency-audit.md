Dependency auditing lands in CI (SEC-5, SEC-6): a new `deps-audit`
workflow runs govulncheck (call-graph aware), osv-scanner over the
console, hub and website lockfiles and cargo audit against the RustSec
advisory database, on every push and pull request plus a weekly
schedule so new advisories against unchanged dependencies still
surface. A stdlib guard (`scripts/dev-tests/check_package_lifecycle.py`,
wired into `make ci`) keeps the JS tree free of package lifecycle
scripts and trustedDependencies declarations. `golang.org/x/text` is
raised to v0.39.0, clearing GO-2026-5970 (infinite loop on invalid
UTF-8 in `unicode/norm`) from the module graph; nothing called the
affected symbols, but a SOC ingest tool should not carry the class.
