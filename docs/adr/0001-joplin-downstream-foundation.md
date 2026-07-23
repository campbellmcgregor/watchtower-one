# ADR-0001: Build Watchtower One as a thin downstream of stable Joplin

<!-- cspell:ignore campbellmcgregor -->

- Status: Accepted
- Date: 2026-07-22
- Scope: Repository foundation and first-release product boundary
- Superseded in part by: ADR-0003's SQLCipher-led logical profile vault

## Context

The retired Watchtower One prototype implemented a standalone Electron notebook, encrypted SQLCipher workspace, recovery, attachments, search, history, portability, backups, updates, and diagnostics. That work proved useful security boundaries, but continuing to build a general-purpose note-taking application independently would duplicate mature behavior already maintained by Joplin.

Joplin supplies the required note-taking applications, shared backend, plugin system, mobile clients, synchronization targets, and item-level sync E2EE. Research also established that sync E2EE does not encrypt Joplin's live local profile: user-derived plaintext spans SQLite, resources, settings, plugin data, Electron state, logs, temporary files, backups, and crash artifacts.

The Joplin client is viable as an AGPL downstream when modified client source, notices, and exact Corresponding Source are supplied. Joplin Server and some packages use the Joplin Server Personal Use License and are outside the commercial first-release boundary.

## Decision

Watchtower One will be developed in an official fork of `laurent22/joplin` with:

- `origin`: `https://github.com/campbellmcgregor/watchtower-one.git`
- `upstream`: `https://github.com/laurent22/joplin.git`
- initial Upstream Baseline: Joplin `v3.6.15` at `c61572660382863595c6b51ccf2263e3d2c4bfce`
- production default branch: `main`, initially pointing exactly at the baseline commit

The downstream will track stable Joplin releases through reviewed synchronization branches. Published Watchtower history is immutable; only unpublished feature branches may be rebased.

Watchtower One will reuse Joplin's note model, applications, sync formats, supported sync targets, and sync E2EE. It will add a separate whole-profile local-at-rest layer around the Joplin root profile. The root profile is the vault unit because global settings, multi-profile metadata, plugins, logs, backups, and Electron state cross individual Joplin profile boundaries.

The first release is a Windows-first, securely rebranded Joplin distribution with:

- mandatory whole-profile local encryption;
- passphrase unlock and independent user-held recovery;
- curated signed plugins only;
- Joplin-native E2EE and existing sync targets;
- Watchtower-owned package identity, signing, versioning, and update channel.

The first release excludes Watchtower accounts, Watchtower Sync, Instant Response, arbitrary community plugins, proprietary JPL plugins, commercial Joplin Server reuse, migration from the custom prototype, and broad note-taking UI redesign.

The previous codebase is preserved as `campbellmcgregor/watchtower-one-legacy`. Its implementation ADRs are historical evidence, not constraints on the Joplin downstream. Security lessons and research may be carried forward selectively.

## Consequences

- Watchtower inherits mature note-taking behavior and must continuously absorb upstream security fixes.
- Whole-profile encryption is the main downstream architectural risk; encrypting only `database.sqlite` is explicitly insufficient.
- The pre-unlock boundary must move earlier than Joplin's current settings, Electron-session, logging, lock-file, and database initialization.
- Plugins are trusted profile-capable code, even when signed. Admission, revocation, and runtime plaintext tracing are required.
- Stock plaintext backup and crash-reporting behavior must be disabled or replaced before release.
- Every distributed modified client must have exact corresponding source and required notices available under AGPL-3.0-or-later.
- Generally useful fixes should be proposed upstream; Watchtower-specific security policy remains in narrow downstream modules.

## Follow-up decisions

- Select and prove the Windows whole-profile encryption primitive.
- Define the Vault Session's at-rest contract while unlocked.
- Define the local key hierarchy, recovery, rotation, and deletion lifecycle.
- Define curated-plugin admission, signing, capability disclosure, update, and revocation.
- Define measurable release criteria, including forced-termination and runtime filesystem traces.

## Evidence

- `docs/research/joplin-upstream-baseline-and-update-strategy.md`
- `docs/research/joplin-local-plaintext-profile-and-storage-paths.md`
- `docs/research/joplin-downstream-licensing-and-distribution-obligations.md`
