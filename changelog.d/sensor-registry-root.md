- **Registry writes are named, attributed and carry their data (S-1).** An
  unknown registry root resolves through the keys already opened under that
  base and, failing that, through the writer's user (`HKU\<SID>` from the
  process table); when the root is inferred the event says so in the
  `registry_root_inferred` attribute instead of passing the guess off as
  fact, and without a known SID the `?` stays — the hive is never invented.
  Every `registry.set` now also carries the writer's SID in `user`, and the
  written value travels in `registry.value` (provider capture; a capture of
  zero bytes omits the field rather than sending an empty string). Rules and
  suppressions that need a written value must key on `registry.value`: there
  is no `registry.value_data` field.
