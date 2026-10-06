- intel: a threat-intel list saved twice (BOM upon BOM — or a UTF-16 file
  whose payload starts with a U+FEFF of its own) no longer serves its first
  indicator glued to a BOM character; `decodeText` keeps stripping encodings
  until no byte-order mark remains, so the first entry of every re-saved
  Windows list matches again. Found by live fuzzing (2026-10-06): the seed
  now in `internal/intel/testdata/fuzz/FuzzDecodeText/` failed before, passes
  after.
