# Watchtower provenance records

Reviewed upstream synchronization branches write `upstream-integration.json` here. It records the exact Joplin tag and commit, downstream revision and commit set, maintained logical patch metadata from `watchtower/patches.json`, and dependency lock hash.

An integration ledger may deliberately contain an empty `artifacts` array because no release binaries exist yet. It is not release provenance. Release pipelines must upload one complete artifact bundle and call `.github/workflows/watchtower-release-provenance.yml`. The reusable workflow downloads the bundle and runs `watchtower/tools/release-ledger.mjs` with the complete artifact directory. For an equivalent local invocation, pass that directory with `--artifact-directory`.

Committed provenance records are immutable evidence. Replace `upstream-integration.json` only in the reviewed synchronization pull request that advances the pinned Upstream Baseline.
