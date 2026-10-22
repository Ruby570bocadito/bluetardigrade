# The process baseline card joins the bilingual console

baseline-card was the last Spanish-only island of the host page: every
title, status sentence, filter placeholder and error came hardcoded.
The card now reads a new baseline section in the typed ES/EN
dictionaries and passes the console language to its dates. The status
sentence keeps living in lib/intel (baselineStatus) but takes typed
words with the shipped ES copy as default — the same discipline as
enrollmentPlan/runModeText — so existing call sites and tests keep
their exact output and a new test pins the English wording. Suite:
604 tests, tsc, next build, theme, DOM, browser, a11y and motion
green.
