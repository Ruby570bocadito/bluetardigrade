- make: the console test targets (`console-dom`, `console-browser`) now
  install their tooling with `npm --ignore-scripts`, matching the supply-chain
  decision already converged in ci.yml (Pulimiento A, round 12) and in
  Seguridad B's Makefile: esbuild resolves through its `@esbuild/*` platform
  optional dependencies (no postinstall needed), jsdom is pure JS, and
  Playwright's Chromium is downloaded by the target's explicit
  `playwright/cli.js install chromium` step, which keeps working. Verified
  end-to-end: `make console-install && make console-dom` passes with the flag
  (DOM fixture, esbuild bundling and every report/store check green).
