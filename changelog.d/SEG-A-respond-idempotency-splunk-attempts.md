- respond: a kill request whose idempotency key another request already
  committed is now denied (409) at commit, inside the single-flight span.
  Before, two requests carrying the same key could both pass the cheap
  pre-check while the first was still in flight and land two SIGKILLs on
  different targets; the per-(host,pid) cooldown only covered the same one.
- siem: the Splunk delivery log names the attempts that actually ran
  ("failed after 1 attempt(s)"); before, a permanent 4xx on the first post
  was logged as "failed after 3 attempts", sending the operator to look for
  retries that never happened.
