- **Read-only Active Directory connector (`-ad`)**: the engine periodically reads users,
  groups, computers and OUs over LDAPS (or plain LDAP explicitly upgraded with StartTLS),
  always validating the domain controller's certificate against a configured CA and always
  binding as a least-privilege service account whose password lives in its own file — it is
  never logged, served or interpolated into errors. Objects are paged per RFC 2696 under a
  hard object cap, include/exclude OU filters prune the subtree, and every sync replaces the
  SQLite snapshot in one transaction. Requires `-store`; a shipped `ad.example.yaml` shows
  the shape.
- **Domain posture analysis (AD-2)**: after every sync the engine recomputes the classical
  defensive-audit findings — effective members of privileged groups (nested membership
  included), stale `krbtgt` password age, unconstrained delegation, accounts without
  Kerberos pre-authentication, SPN user accounts still allowing RC4, past-end-of-support
  operating systems, inactive accounts, passwords that never expire, domain computers
  without a sensor and orphaned `adminCount` — each with severity, affected objects and
  plain-language remediation, plus a 0-100 score with one history point per sync.
- **New read-only API surface** (behind the usual bearer gate, `501` with an arming hint
  while `-ad` is off): `GET /api/ad/status`, `GET /api/ad/objects/{kind}`,
  `GET /api/ad/posture` and `GET /api/ad/posture/history`. The connector also reports a
  warning when its own bind account turns out to be effectively privileged.
