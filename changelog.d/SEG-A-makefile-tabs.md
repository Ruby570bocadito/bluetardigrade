- make: `make` was broken on every tree inheriting `63fa077` — that commit
  converted every recipe TAB of the Makefile to 8 spaces, so any target
  aborted with `missing separator` (`make test` died at line 31). The repair
  restores the 62 recipe lines to TAB indentation (content unchanged, verified
  by normalizing indentation against `63fa077^`; the only real content delta
  since is `63fa077`'s intentional check_workflows wiring). Verified: `make -n`
  succeeds on all 18 targets and the tab guard is green. Outage found and
  verified by Pulimiento A (rounds 11-14); the same repair already converged
  in Pulimiento A and Seguridad B lanes.
