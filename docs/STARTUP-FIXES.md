# Startup and integration fixes

The analyst hub checks the browser Origin during both polling and WebSocket
handshakes. `CONSOLE_CORS_ORIGIN` extends the console origin allowlist.
Headerless native clients remain supported; this allowlist is not user
authentication. Keep the hub on loopback unless a separate authenticated
deployment boundary is configured. Analyst calls share the same concurrency
and rolling-minute limits across connections.

The production console CSP allows the HTTP and WebSocket origins derived
from `NEXT_PUBLIC_CONSOLE_URL`. Rebuild the console when changing this URL.
`check_analyst_browser.mjs` verifies an actual production console/hub handshake,
in addition to the isolated UI fixtures.

Windows console, sensor and logon startup use `scripts/windows/runtime.ps1`.
Ingest credentials follow explicit sensor flag, process environment, then
`tools/config/ingest.token`. The same child process gets webhook URL/token
from environment or the persisted configuration. The engine also accepts
`SF_WEBHOOK_URL`, with `-webhook` taking precedence. Secrets are passed in
the child environment and the launcher's environment is restored afterward.
Engine state resolves from the installation directory on every launcher.
AutoStart reads current persisted settings at startup rather than embedding
tokens in its registry command.

Stopping the console checks ownership before acting on saved PIDs, including
system Node/Bun executables with script paths inside this installation. Stale
PID files cannot stop an unrelated process or a neighboring installation.

The Docker runtime includes beacon profiles and volumetric thresholds, with
explicit paths. Local examples publish ports on host loopback. Configure
tokens/TLS and persistent volumes explicitly for a remote deployment.

Windows CI runs the entire Go unit suite and the SOC/file evidence fixtures.
Credential-redaction tests check the stable network cause instead of an
English OS error string. EML fixtures preserve their original CRLF bytes.
