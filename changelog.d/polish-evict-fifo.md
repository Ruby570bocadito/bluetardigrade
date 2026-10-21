The forensic bundle directory cap is now enforced with an in-memory
FIFO of bundles written by this process instead of a full directory
rescan on every capture. The first real nightly profile showed
`evictOldFiles` taking ~29% of the hot alert path CPU (a ReadDir plus
one stat per file plus a sort on each bundle write once the directory
sits at the cap); the steady-state cost is now a single unlink per
alert. The disk is still scanned exactly once per recorder lifetime
to seed the queue from bundles left by previous runs, and the cap
(256 bundles, oldest evicted first) and its best-effort contract are
unchanged.
