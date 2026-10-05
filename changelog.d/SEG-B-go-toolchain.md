# Toolchain Go 1.26.6: corrige 5 vulnerabilidades de stdlib alcanzadas por el motor

Fecha: 2026-10-05. Carril: Seguridad B (SEC-5).

El primer ciclo real de `deps-audit` (el primero desde que el push dejó
de filtrarse a main) señala 5 vulnerabilidades de la librería estándar
de go1.26.0 con rastros de llamada desde el motor: GO-2026-6218
(net/url), GO-2026-6090 (crypto/tls), GO-2026-6089 (net/http),
GO-2026-5972 (encoding/asn1) y GO-2026-5856 (crypto/tls) — justo las
superficies de ingesta TLS y API. Corregido elevando la directiva `go`
de go.mod a **1.26.6** (setup-go instala el toolchain desde ese
fichero); batería completa local en verde con 1.26.8.
