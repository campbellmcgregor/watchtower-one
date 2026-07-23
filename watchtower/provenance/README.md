# Watchtower provenance records

Reviewed upstream synchronization branches write `upstream-integration.json` here. It records the exact Joplin tag and commit, downstream revision and commit set, and dependency lock hash.

An integration ledger may deliberately contain an empty `artifacts` array because no release binaries exist yet. It is not release provenance. Release packaging must run `watchtower/tools/release-ledger.mjs` again with every distributed artifact supplied through a separate `--artifact` argument.

Committed provenance records are immutable evidence. Replace `upstream-integration.json` only in the reviewed synchronization pull request that advances the pinned Upstream Baseline.
