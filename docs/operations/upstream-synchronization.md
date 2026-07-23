# Upstream synchronization operations

<!-- cspell:ignore blockmap -->

## Control flow

1. `watchtower-upstream-monitor.yml` runs every four hours and on manual dispatch.
2. The monitor reads official Joplin releases and published repository advisories, then creates one deterministic Watchtower issue per unseen candidate.
3. A maintainer triages the issue. For a stable release selected for integration, dispatch `Prepare reviewed Joplin synchronization` with the exact tag and candidate issue number.
4. The workflow validates the release, fetches only the exact tag, resolves its full commit SHA, and attempts a no-rebase merge on `sync/joplin-vX.Y.Z`.
5. A clean merge advances `watchtower/upstream-policy.json`, writes `watchtower/provenance/upstream-integration.json`, pushes the branch, and opens a pull request. A conflict stops the workflow without inventing a resolution.
6. Reviewers inspect high-risk upstream areas and run the required upstream and Watchtower verification before merging.

The monitor uses GitHub's public [release endpoint](https://docs.github.com/en/rest/releases/releases) and public [repository security-advisory endpoint](https://docs.github.com/en/rest/security-advisories/repository-advisories). It cannot see private draft advisories.

## Local monitor verification

Use a captured API snapshot to inspect filtering without network access or issue writes:

```text
node watchtower/tools/upstream-control.mjs monitor \
  --policy watchtower/upstream-policy.json \
  --snapshot path/to/snapshot.json \
  --dry-run
```

The snapshot contains `releases` and `advisories` arrays in the shapes returned by GitHub. Live reconciliation requires `WATCHTOWER_GITHUB_TOKEN`; scheduled Actions supplies the repository token.

## Integration ledger

The synchronization workflow generates an integration ledger before binaries exist:

```text
node watchtower/tools/release-ledger.mjs generate \
  --repository . \
  --upstream-tag vX.Y.Z \
  --upstream-sha FULL_40_CHARACTER_SHA \
  --revision HEAD \
  --lockfile yarn.lock \
  --output watchtower/provenance/upstream-integration.json \
  --allow-no-artifacts
```

`--allow-no-artifacts` is limited to reviewed source integration. The resulting empty artifact list means the file is not release provenance.

## Release ledger

After building the exact release revision, omit `--allow-no-artifacts` and pass every distributed file separately:

```text
node watchtower/tools/release-ledger.mjs generate \
  --repository . \
  --upstream-tag vX.Y.Z \
  --upstream-sha FULL_40_CHARACTER_SHA \
  --revision WATCHTOWER_RELEASE_COMMIT \
  --lockfile yarn.lock \
  --artifact dist/Watchtower-One-Setup.exe \
  --artifact dist/Watchtower-One-Setup.exe.blockmap \
  --output dist/watchtower-release-ledger.json
```

Generation fails when the tag resolves to a different commit, the upstream commit is not an ancestor of the selected revision, an input escapes the repository, or a release ledger has no artifacts.

## Repository settings

- Keep `main` protected and integrate synchronization branches by reviewed pull request.
- Enable scheduled GitHub Actions for the fork.
- Permit the workflow token to request the explicit permissions declared in each workflow.
- Never enable automatic merging for upstream synchronization pull requests.
- Never rebase or force-push a published Watchtower release.
