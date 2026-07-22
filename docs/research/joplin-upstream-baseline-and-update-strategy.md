# Joplin upstream baseline and update strategy

**Research date:** 2026-07-22

**Wayfinder ticket:** [Select the Joplin upstream baseline and downstream update strategy](https://github.com/campbellmcgregor/watchtower-one/issues/29)

**Scope:** Select the source revision from which Watchtower One should begin, and define a thin downstream workflow that can absorb Joplin fixes without turning Watchtower One into an independent hard fork.

## Recommendation

Import Joplin **`v3.6.15` at commit `c61572660382863595c6b51ccf2263e3d2c4bfce`** as the initial Watchtower One baseline. It is the newest non-draft, non-prerelease Joplin release as of the research date; GitHub records it as published on 2026-06-20, and the tag resolves directly to that commit. Pin both the human-readable tag and full commit SHA in Watchtower's provenance record rather than following a moving branch. [Release](https://github.com/laurent22/joplin/releases/tag/v3.6.15) · [commit](https://github.com/laurent22/joplin/commit/c61572660382863595c6b51ccf2263e3d2c4bfce) · [release API record](https://api.github.com/repos/laurent22/joplin/releases/tags/v3.6.15)

Do **not** start production work from `dev`, `master`, or a prerelease tag. Joplin's repository declares `dev` as its default branch, while its current preview line is `v3.7`; the latest preview found was `v3.7.9`, explicitly marked as a prerelease and published on 2026-07-14. The protected `master` branch points to a 2022 commit and is not the release-tracking branch. [Repository API record](https://api.github.com/repos/laurent22/joplin) · [`dev`](https://github.com/laurent22/joplin/tree/dev) · [`master`](https://github.com/laurent22/joplin/tree/master) · [`v3.7.9`](https://github.com/laurent22/joplin/releases/tag/v3.7.9)

Track upstream through an `upstream` remote and absorb each new **stable tag** through a short-lived synchronization branch merged into a protected, append-only downstream `main`. Keep Watchtower-only changes as a small, ordered set of focused commits/modules. Rebase only unpublished feature branches; never rebase or force-push a published Watchtower release. This preserves auditability while still exposing conflicts before each release.

## Why this is the right baseline now

Joplin publishes three major versions per year and describes a release, freeze, and publishing phase. Its published schedule places Joplin 3.7's freeze on 2026-08-16 and publishing between 2026-08-30 and 2026-09-05. On 2026-07-22, the `v3.7.x` artifacts are therefore preview builds, not a suitable security-product foundation. [Official release-cycle policy](https://joplinapp.org/help/about/release_cycle/)

The initial import should nevertheless happen now at `v3.6.15`, not wait for 3.7. Before Watchtower's first public release candidate, repeat the stable-release check and upgrade the baseline if Joplin has published a newer stable version. This matters because Joplin's security policy says **only the latest version** receives security updates. [Joplin security policy](https://github.com/laurent22/joplin/blob/dev/SECURITY.md)

Joplin's recent advisory history demonstrates why the stable baseline cannot be frozen indefinitely. For example, the high-severity OneNote-import path-traversal advisory published in May 2026 identifies Joplin 3.5.7 as the patched desktop version and links the fixing commit. The current recommended baseline is newer than that patched version, but the process signal is the important part: published GitHub security advisories must be monitored alongside releases. [GHSA-gcmj-c9gg-9vh6](https://github.com/laurent22/joplin/security/advisories/GHSA-gcmj-c9gg-9vh6) · [Joplin advisories](https://github.com/laurent22/joplin/security/advisories)

## Source and remote topology

Use these Git identities:

| Name | Purpose | Rule |
|---|---|---|
| `origin` | `campbellmcgregor/watchtower-one` | Watchtower-owned branches, CI, releases, and issues |
| `upstream` | `https://github.com/laurent22/joplin.git` | Fetch-only source of Joplin branches and tags |
| `main` | Current reviewed Watchtower source | Protected and append-only; no direct pushes or history rewrites |
| `sync/joplin-vX.Y.Z` | One temporary upstream-integration branch | Branch from `main`, merge the exact stable upstream tag, resolve and test, then PR to `main` |
| `feature/<name>` | One Watchtower concern | Rebase onto the synchronized `main` only while unpublished |
| `watchtower-vA.B.C` | Immutable Watchtower release tag | Record the exact Joplin base SHA in release notes and machine-readable provenance |

Joplin's official contribution guide confirms that the applications share a common backend and asks contributors to keep changes focused, add automated tests, and consider effects across the applications. Those properties make small cross-platform topic patches materially easier to carry than a large Watchtower-specific rewrite. [Joplin contribution guide](https://github.com/laurent22/joplin/blob/dev/readme/dev/index.md)

### Stable update runbook

1. Fetch `upstream` tags and query the official release record. Accept a candidate only when GitHub marks it neither draft nor prerelease.
2. Resolve the tag to its full commit SHA and record both values. Treat an unexpected tag retarget as a stop condition requiring investigation.
3. Create `sync/joplin-vX.Y.Z` from current `main` and merge the exact tag. Do not merge the moving `dev` branch.
4. Review upstream changes affecting storage, profile/schema migrations, encryption, synchronization formats, import/export, plugins, Electron/React Native, and packaging before resolving conflicts.
5. Run Joplin's relevant upstream test suites plus Watchtower's encryption, recovery, plugin-policy, locking, crash-consistency, and upgrade tests. Joplin's official build guide identifies the monorepo packages and documents desktop, Android, and iOS build paths; this should remain the source of truth for upstream build prerequisites. [Official build guide](https://joplinapp.org/help/dev/BUILD/)
6. Merge the synchronization PR into protected `main`; then rebase only still-unpublished Watchtower feature branches.
7. Build and sign Watchtower artifacts from Watchtower infrastructure, tag the release, and publish provenance containing the Watchtower commit, upstream tag, upstream SHA, dependency lock hash, and artifact hashes.

This merge-based mainline is preferable to repeatedly rebasing the public downstream branch: it retains the exact history users audited and binaries were built from. A disposable replay branch may be used to estimate patch conflicts, but it is evidence, not release history.

## Keeping the downstream patch set thin

Apply these boundaries to every Watchtower-only change:

- Keep local-at-rest encryption, vault lifecycle/recovery, plugin trust policy, branding, and updater ownership in narrow modules with explicit host-facing interfaces.
- Avoid broad formatting, generated-file, dependency, or UI churn in the same commit as behavior changes.
- Make each Watchtower topic independently reviewable and testable; maintain a patch ledger naming its owner, upstream touchpoints, tests, and whether it is a candidate for upstream contribution.
- Submit generally useful bug fixes to Joplin's `dev` branch under Joplin's contribution process, then drop the downstream patch once its upstream release is adopted. Joplin requires an accepted concrete problem, focused pull requests, and tests. [Joplin contribution guide](https://github.com/laurent22/joplin/blob/dev/readme/dev/index.md)
- Treat growth in recurring merge conflicts, modifications spread across unrelated packages, or Watchtower patches that cannot be tested independently as architecture warnings.

## Security-update signals and proposed response policy

Joplin documents a predictable major-release schedule, but it does not publish a guaranteed security-patch service-level agreement. It supports only the latest release and directs vulnerability reports through GitHub private vulnerability reporting. [Release-cycle policy](https://joplinapp.org/help/about/release_cycle/) · [security policy](https://github.com/laurent22/joplin/blob/dev/SECURITY.md)

Watchtower should therefore own the monitoring and response promise:

- Poll/watch Joplin's [stable releases](https://github.com/laurent22/joplin/releases) and [published advisories](https://github.com/laurent22/joplin/security/advisories) at least daily.
- Open an upstream-sync issue automatically for every new stable tag and security advisory; do not rely on the three-major-releases-per-year schedule to catch patch releases.
- Triage critical/high advisories affecting shipped Watchtower code the same business day and start an emergency upstream-sync branch immediately.
- Review medium/low advisories and ordinary stable releases within two business days.
- Re-evaluate the latest stable tag at every Watchtower release-candidate cut, even if no notification was observed.
- Maintain Watchtower's own dependency and Electron advisories because inherited dependencies may require a downstream response before Joplin publishes a release.

The time targets above are a proposed Watchtower policy, not an upstream guarantee.

## Versioning, branding, and updater implications

At `v3.6.15`, the desktop package embeds Joplin's version `3.6.15`, Electron `appId` `net.cozic.joplin-desktop`, product name `Joplin`, icons, URL scheme, repository URLs, maintainer identity, and artifact names. Its updater code reads Joplin-owned release metadata from `https://objects.joplinusercontent.com/r/releases` and downloads assets referenced there. [Tagged desktop package](https://github.com/laurent22/joplin/blob/v3.6.15/packages/app-desktop/package.json) · [manual update check](https://github.com/laurent22/joplin/blob/v3.6.15/packages/app-desktop/checkForUpdates.ts) · [automatic updater](https://github.com/laurent22/joplin/blob/v3.6.15/packages/app-desktop/services/autoUpdater/AutoUpdaterService.ts)

Consequently, rebranding cannot stop at visible strings and icons. Before distributing a Watchtower build:

- assign Watchtower-owned desktop/mobile application identifiers, executable/artifact names, URL schemes, icons, publisher metadata, and code-signing identities;
- replace every Joplin-owned update/check/changelog endpoint with a Watchtower-owned, signed release channel, so a Watchtower install cannot offer or install an incompatible stock-Joplin binary;
- use an independent monotonic Watchtower SemVer for packages and updater comparison, for example `1.0.0`; expose the upstream base separately as `Joplin base 3.6.15 (c615726...)` rather than pretending it is Watchtower's product version;
- preserve both values in About, diagnostic reports, release metadata, and security advisories.

Joplin's package-info generator copies the desktop product name and application identifier from package metadata into generated runtime information and adds the Git revision, confirming that these are build/runtime inputs rather than cosmetic documentation only. [Package-info generator](https://github.com/laurent22/joplin/blob/v3.6.15/packages/tools/compilePackageInfo.js)

Trademark clearance and the exact attribution text are intentionally not decided here; they belong to the separate licensing/trademark review. The engineering requirement is to eliminate accidental Joplin identity and update-channel reuse while retaining required source and license notices.

## Release gate and unresolved points

Proceed with the source import at `v3.6.15`/`c61572660382863595c6b51ccf2263e3d2c4bfce`, subject to these gates:

1. Re-check the official latest stable release immediately before the import commit and again before the first public release candidate.
2. Do not publish until the branded updater and signing chain are Watchtower-owned.
3. Do not publish until the licensing/trademark ticket confirms naming, attribution, source-offer, and distribution obligations.
4. Do not claim compatibility merely from a successful desktop build; the shared Joplin backend means the cross-platform build/test matrix must remain visible even for a Windows-first release. [Contribution guide](https://github.com/laurent22/joplin/blob/dev/readme/dev/index.md) · [build guide](https://joplinapp.org/help/dev/BUILD/)

Open uncertainties that implementation planning must resolve:

- Joplin does not state a guaranteed security-fix turnaround, so Watchtower needs its own risk-acceptance and emergency-release authority.
- The first public Watchtower release may occur after Joplin 3.7 becomes stable; the release-candidate baseline check decides whether 3.7 must be absorbed before launch.
- Exact mobile package identifiers, store records, and signing arrangements are deferred because the first release is Windows-first.
- The mechanics for preserving or archiving the existing pre-Joplin Watchtower repository history are a repository-migration decision, not a reason to change the selected Joplin source baseline.

## Decision statement

**Adopt Joplin `v3.6.15` at full SHA `c61572660382863595c6b51ccf2263e3d2c4bfce` as Watchtower One's initial source baseline. Track official stable tags from an `upstream` remote; integrate them through tested merge PRs; keep public Watchtower history immutable; and treat release/advisory monitoring, independent versioning, branding, signing, and update infrastructure as mandatory release controls.**
