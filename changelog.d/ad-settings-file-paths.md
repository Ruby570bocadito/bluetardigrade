- **Security (AD settings):** `ca_file` and `password_file` can no longer be changed through the
  API (`PUT /api/settings/ad`, `POST /api/ad/test`); they are set in the `-ad` file on the
  engine host. Before, whoever held the API credential could make the engine overwrite any
  file it can write (the credential envelope of a PUT), or read any file and send it as the
  LDAP bind password of a probe to a server of their choosing. Sending the current paths back
  unchanged still works. The «Probar conexión» probe now needs `-ad` (501 without it).
