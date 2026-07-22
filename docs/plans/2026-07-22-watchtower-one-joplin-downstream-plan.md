---
title: "Watchtower One Joplin downstream implementation plan"
status: active
date: 2026-07-22
baseline: "Joplin v3.6.15 / c61572660382863595c6b51ccf2263e3d2c4bfce"
platform: Windows-first, cross-platform-compatible
---

# Watchtower One Joplin downstream implementation plan

## Destination

Ship a Windows-first Watchtower One desktop application based on stable Joplin. It must preserve Joplin's mature note-taking and E2EE sync while ensuring that the complete local user-data profile is encrypted when locked, independently recoverable, restricted to curated plugins, fully rebranded, and maintainable as a thin downstream.

## Delivery rule

Implementation proceeds in vertical slices. No storage feature may claim completion from unit encryption alone: each slice must include its public behavior test, persistent-artifact inspection, forced-termination case where relevant, and upstream compatibility evidence.

Product code does not begin until the public seams below are confirmed and the whole-profile prototype selects a feasible primitive.

## Public test seams

1. **Application bootstrap seam**: given locked, valid, corrupt, absent, and recoverable vault states, observe whether the application reaches Joplin profile initialization.
2. **Profile storage seam**: through ordinary Joplin note/resource/settings operations, observe persistence before lock, after lock, after restart, and after forced termination without inspecting private helpers.
3. **Recovery seam**: through create, unlock, passphrase-change, recovery, rotation, and close commands, observe preservation or typed failure without exposing raw keys.
4. **Plugin admission seam**: install/start/update/revoke a plugin package and observe allow, deny, quarantine, disclosure, and audit outcomes.
5. **Release identity seam**: inspect built artifacts and update metadata for Watchtower identity, source provenance, signing, and absence of Joplin-owned update endpoints.

## Milestones and tickets

### Milestone 0 — Clean downstream foundation

- **Bootstrap the Watchtower One downstream repository**
  - Pin `main` to the selected stable Joplin commit.
  - Configure `origin` and `upstream` and publish provenance.
  - Add Watchtower domain context, foundation ADR, research, and issue map.
  - Build and test unmodified baseline desktop code on Windows.
- **Establish upstream synchronization and patch-ledger automation**
  - Detect stable releases and published advisories.
  - Open a synchronization task for each candidate.
  - Record upstream base SHA, downstream commits, lockfile hash, and artifact hashes.

### Milestone 1 — Whole-profile boundary proof

- **Trace the stable baseline's complete plaintext footprint**
  - Re-run the source inventory against `v3.6.15`, not only upstream `dev`.
  - Capture clean-run, note/resource/plugin, backup, external-edit, crash, update, and forced-kill traces.
  - Produce a reviewed allowed-egress list and zero-undisclosed-plaintext assertion.
- **Choose and prototype the Windows whole-profile encryption architecture**
  - Compare a mounted encrypted filesystem/container, an application-owned encrypted virtual filesystem, and hybrid SQLCipher/object-store approaches.
  - Prove that unlock occurs before root settings, logging, Electron session, lock-file, and database initialization.
  - Measure startup, note/resource I/O, crash consistency, repair, upgrades, antivirus interaction, and packaging.
  - Define the cross-platform adapter contract without claiming unbuilt platform support.
- **Define the unlocked-session at-rest contract**
  - Decide which persisted bytes, pagefile/crash artifacts, and temporary files are permitted while unlocked.
  - State OS assumptions and user-visible limitations precisely.

### Milestone 2 — Vault lifecycle and encrypted persistence

- **Implement pre-profile vault bootstrap**
  - Fail closed before any Joplin profile initialization.
  - Support create, unlock, lock, close, corrupt, and unsupported-version outcomes.
- **Implement the selected profile storage adapter**
  - Protect SQLite, resources, settings, plugins, caches, logs, Electron state, and temporary artifacts.
  - Preserve Joplin schema migration and normal app behavior.
- **Replace plaintext backup, crash, diagnostic, and external-edit paths**
  - Disable stock plaintext backup defaults until an encrypted replacement exists.
  - Remove content-bearing automatic crash reports and uncontrolled log attachments.
  - Make unavoidable plaintext egress explicit, bounded, and disclosed.
- **Prove crash consistency and zero silent fallback**
  - Kill the process at every durable transition.
  - Verify recovery never opens an unencrypted profile or reports false success.

### Milestone 3 — Key hierarchy and recovery

- **Define and implement the local key hierarchy**
  - Generate a random Local Vault Key.
  - Wrap it independently with passphrase and user-held Recovery Secret credentials.
  - Keep local and sync E2EE keys domain-separated.
- **Implement passphrase change, recovery, rotation, and deletion**
  - Rewrap rather than rewrite content where the selected primitive permits.
  - Make interrupted transitions recoverable and monotonic.
  - Avoid physical secure-erasure claims on SSDs.
- **Implement encrypted backup and restore for the profile vault**
  - Verify before reporting success.
  - Stage and validate restore before replacing active state.

### Milestone 4 — Curated plugin trust

- **Define the curated plugin policy**
  - Specify admission review, signatures, provenance, capabilities, disclosure, updates, revocation, and emergency disablement.
- **Enforce curated plugins in desktop distribution**
  - Remove arbitrary marketplace/manual install paths from Watchtower builds.
  - Reject unsigned, unknown, downgraded, revoked, or tampered plugins before execution.
- **Trace admitted plugins for plaintext egress**
  - Treat signing as trust admission rather than sandboxing.
  - Require runtime canaries and filesystem/network tracing for every bundled plugin release.

### Milestone 5 — Product identity and distribution

- **Replace Joplin application identity and update authority**
  - Change product names, application IDs, protocols, icons, artifact names, publisher metadata, and signing identities.
  - Remove Joplin-owned update and changelog endpoints from Watchtower builds.
  - Expose Watchtower version and upstream base separately.
- **Automate AGPL corresponding-source publication**
  - Publish exact source, build instructions, notices, dependency lock, and provenance for every binary.
- **Build the Windows installer and rollback path**
  - Sign artifacts with Watchtower-controlled credentials.
  - Prevent updates while vault mutations are active.

### Milestone 6 — Release qualification

- **Run compatibility and upgrade qualification**
  - Validate Joplin sync targets and sync E2EE behavior.
  - Test profile migration across Watchtower releases and upstream stable synchronization.
  - Keep shared backend changes buildable for desktop and visible to mobile CI.
- **Run security qualification**
  - Threat model the final boundaries.
  - Complete runtime artifact tracing, forced-kill matrix, recovery drills, dependency review, and plugin review.
- **Pass first-release acceptance criteria**
  - No undisclosed persistent plaintext.
  - No unencrypted fallback.
  - Successful independent recovery.
  - Curated-plugin enforcement.
  - Watchtower-owned identity/update chain.
  - Exact source and provenance published.

## Dependency order

```text
Repository bootstrap
  -> Stable-baseline plaintext trace
  -> Encryption architecture prototype
  -> Unlocked-session contract
  -> Vault bootstrap and profile storage
  -> Key lifecycle and encrypted recovery
  -> Plaintext-path replacements
  -> Curated plugin enforcement
  -> Branding, updater, packaging, and source publication
  -> Compatibility and security qualification
  -> First release
```

Plugin-policy design may proceed in parallel with the encryption prototype, but plugin enforcement cannot be accepted until the profile boundary and runtime tracing harness exist.

## Explicit non-goals for the first release

- Watchtower Sync server or managed service.
- Watchtower accounts or organization recovery.
- Instant Response or other online Watchtower integrations.
- An unencrypted Watchtower One mode.
- Arbitrary community plugins.
- Commercial modification or deployment of Joplin Server.
- Importing vaults from the retired custom prototype.
- Shipping macOS, Linux, iOS, or Android binaries.
- Broad redesign of Joplin's note-taking interface.

## Legacy evidence

The retired custom implementation and its detailed issues, ADRs, tests, release evidence, and source remain at `https://github.com/campbellmcgregor/watchtower-one-legacy`. They may inform security acceptance criteria but are not code to be merged into this downstream.
