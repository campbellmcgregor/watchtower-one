# Watchtower One repository instructions

Watchtower One is a thin downstream distribution of Joplin. Preserve upstream compatibility and keep Watchtower-only changes isolated, reviewable, and cross-platform unless an accepted ADR says otherwise.

## Product boundary

- The first release is Windows-first and remains useful without a Watchtower account or Watchtower service.
- Watchtower One always protects its complete local user-data profile at rest. An unencrypted mode belongs in stock Joplin, not this distribution.
- Joplin sync E2EE remains the remote-sync protection layer. Local vault keys and sync keys are separate domains.
- Keep Joplin's existing sync targets. Watchtower Sync, Instant Response, accounts, and other online integrations are out of the first-release scope.
- Load only signed, curated plugins. Do not add arbitrary community-plugin loading to the Watchtower distribution.
- Do not commercially reuse or modify Joplin Server or JPL-licensed packages without explicit permission and review.

## Downstream discipline

- `origin` is `campbellmcgregor/watchtower-one`; `upstream` is `laurent22/joplin`.
- Base production work on the pinned stable baseline recorded in `docs/adr/0001-joplin-downstream-foundation.md`.
- Keep each Watchtower concern in a focused commit and avoid unrelated formatting or generated-file churn.
- Rebase only unpublished feature branches. Integrate future stable upstream tags through reviewed synchronization branches.
- Preserve AGPL notices and publish exact Corresponding Source for every distributed client binary.

## Implementation workflow

- GitHub Issues hold the implementation plan and dependency graph.
- Use red-green TDD at the public seams named in `docs/plans/2026-07-22-watchtower-one-joplin-downstream-plan.md`.
- Run the narrowest relevant test during each slice, then the affected package suite, typechecking, and the full required verification before merging.
- Treat runtime plaintext tracing, forced-termination tests, recovery tests, and upstream-upgrade tests as release evidence, not optional diagnostics.
- Update `CONTEXT.md` and ADRs when domain language or an architectural boundary changes.
