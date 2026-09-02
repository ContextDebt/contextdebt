# Address classification cases. Marker detection is unchanged here: every line
# below is already a marker under the pre-0.1.10 rules. What is under test is
# whether the note left an address anyone can come back for.

# matched — a keyword in front of the number makes it a tracker reference
# quick hack for Issue #436
# Hack to fix Issue #2013
# hacky shim for gh #77
# workaround, tracked in owner/repo#123

# matched — a date is an address too
# temporary fix until 2027-01-01
# kludge, revisit 2027-01
# hotfix added in 2019 for the old parser

# deliberately unmatched — a bare number with no keyword is not an address
# HACK: don't touch
# hack: the placeholder colour is #fff
# workaround for the #[Route(...)] attribute shape
# kludge - see step #1 in the runbook

# not a marker at all: 0.1.9 drops the quoted example before classification runs
# "workaround for issue #99" is the shape we look for
