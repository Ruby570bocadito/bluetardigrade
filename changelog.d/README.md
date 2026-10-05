# Change fragments

Every change that a user or operator would notice leaves one fragment here,
named `<lane>-<topic>.md`: a short paragraph in English, written like an
entry of `CHANGELOG.md`. Separate files keep parallel branches from colliding
in the changelog. When a round is merged, the fragments are consolidated into
the `[Unreleased]` section of `CHANGELOG.md` and deleted from this folder.
