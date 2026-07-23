# ADR-0002: Automate candidates but require reviewed upstream synchronization

- Status: Accepted
- Date: 2026-07-23
- Scope: Upstream release/advisory monitoring, integration branches, and provenance

## Context

Watchtower One must absorb stable Joplin security and compatibility updates without turning `main` into a moving upstream branch or rebasing published downstream history. Release polling alone is insufficient because a published advisory can require action before the next routine release. Automatic merging would conceal conflicts in Watchtower's profile-storage, plugin, identity, and packaging boundaries.

Every distributed binary also needs an auditable relationship to exact source: the upstream tag and commit, the ordered downstream commit set, the dependency lock, and the released artifacts.

## Decision

Watchtower will:

1. Poll GitHub every four hours for non-draft, non-prerelease Joplin releases newer than the pinned Upstream Baseline and for published, non-withdrawn repository advisories after monitoring began.
2. Resolve each release tag to a full commit SHA, then reconcile each candidate to one downstream GitHub issue using a deterministic marker and the pinned SHA. Monitoring is idempotent across open and closed issues.
3. Start synchronization only through a manually dispatched workflow tied to a candidate issue.
4. Validate the requested issue marker, tag, and pinned SHA against the official published release record. A tag retarget is a hard stop. Fetch only the exact tag and merge it into `sync/joplin-vX.Y.Z` from protected `main`.
5. Stop on merge conflict. Automation may prepare and push a clean synchronization branch and open a pull request, but it never resolves conflicts, approves, or merges the pull request.
6. Advance `watchtower/upstream-policy.json` and generate a machine-readable integration ledger in the same reviewed synchronization branch.
7. Require every release workflow to call `.github/workflows/watchtower-release-provenance.yml` with the complete build-artifact bundle. The reusable workflow regenerates the ledger with SHA-256 hashes for every regular file and refuses an empty bundle. An integration ledger with an empty artifact list is explicitly not release provenance.

Public upstream release and published-advisory reads do not receive the downstream repository token. The token is used only for Watchtower issue, branch, and pull-request operations with workflow-scoped permissions.

## Consequences

- Published Watchtower history remains immutable and upstream integration conflicts remain visible to reviewers.
- Critical/high advisories become actionable tasks on the next four-hour poll, but same-business-day human triage remains an operational responsibility.
- GitHub Actions must be enabled for the fork and workflow token settings must permit the declared issue, branch, and pull-request writes.
- The scheduled workflow cannot observe private draft advisories; it monitors only published public records.
- A release is incomplete until the release ledger contains actual artifact hashes and matches the exact tested source revision.
- Every logical Downstream Patch needs a registry entry naming its owner, commits, upstream touchpoints, tests, and upstream-contribution candidacy.

## Evidence

- `watchtower/tools/upstream-control.mjs`
- `watchtower/tools/release-ledger.mjs`
- `.github/workflows/watchtower-upstream-monitor.yml`
- `.github/workflows/watchtower-prepare-upstream-sync.yml`
- `.github/workflows/watchtower-release-provenance.yml`
- `docs/operations/upstream-synchronization.md`
