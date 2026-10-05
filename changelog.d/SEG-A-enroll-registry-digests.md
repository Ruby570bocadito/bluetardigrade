- engine: the enrollment registry file (`hosts.json`) refuses to load when
  two token records share one digest; before, the file loaded and the
  credential resolved to whichever record came last, so a revoke shown in
  the console could leave the sensor's credential alive.
