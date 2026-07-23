# Watchtower One domain context

<!-- cspell:ignore campbellmcgregor -->

Watchtower One is a security-focused, Windows-first downstream distribution of Joplin. It retains Joplin's mature note-taking, mobile-capable shared backend, plugin APIs, and end-to-end encrypted synchronization while adding an always-encrypted local profile, independent local recovery, Watchtower-owned identity, and a curated plugin trust boundary.

The first release has no Watchtower account, Watchtower Sync, Instant Response, analytics transport, or proprietary server dependency.

## Ubiquitous language

- **Upstream Baseline**: the exact stable Joplin tag and commit from which the current Watchtower release line descends.
- **Downstream Patch**: a focused Watchtower-only commit or module carried on top of the Upstream Baseline.
- **Downstream Patch Registry**: the maintained mapping from each logical Downstream Patch to its owner, commits, upstream touchpoints, tests, and upstream-contribution candidacy.
- **Synchronization Candidate**: a published stable Joplin release or published advisory represented by one idempotent Watchtower triage issue.
- **Patch Ledger**: a machine-readable record of the exact Upstream Baseline, downstream revision and commits, dependency lock hash, and—at release time—distributed artifact hashes.
- **Watchtower Profile Vault**: the logical encrypted boundary containing app-managed notes, metadata, histories, search data, attachments, sensitive settings, credentials, Curated Plugin user data, and automatic backups. It is implemented through encrypted modules rather than a mounted root-profile container.
- **Vault Session**: the unlocked application lifetime during which profile storage may be decrypted for Joplin to use. Joplin profile initialization cannot precede it.
- **Local Vault Key**: the random key material protecting the Watchtower Profile Vault. It is independent of all Joplin sync E2EE keys.
- **Canonical Encrypted Store**: the SQLCipher database that owns persistent user-derived data unless an accepted ADR assigns a specific artifact to Public Bootstrap State, a reconstructible non-content cache, or Explicit Plaintext Egress.
- **Public Bootstrap State**: the minimal reviewed, non-content state required to locate and identify a vault before unlock. It contains no note, resource, credential, sensitive setting, profile name, or Curated Plugin user data.
- **Resource Content module**: the deep module whose interface imports, reads or streams, exports, and deletes attachment bytes by resource identifier without exposing a persistent plaintext path or its SQL implementation.
- **Sync E2EE**: Joplin's existing item-level encryption used while synchronizing through Joplin Cloud, WebDAV, Dropbox, OneDrive, or filesystem targets. It does not provide local-at-rest protection.
- **Recovery Secret**: a user-held credential that can independently recover the Local Vault Key without a Watchtower account.
- **Curated Plugin**: a plugin admitted by Watchtower's signing, review, update, and revocation policy. Signing proves admission; it does not sandbox the plugin.
- **Explicit Plaintext Egress**: a user-initiated export, external edit, open-with action, or similar operation that necessarily creates plaintext outside the Watchtower Profile Vault and is disclosed before execution.
- **Legacy Notebook**: the retired standalone custom Electron/SQLCipher application preserved in `campbellmcgregor/watchtower-one-legacy`; it is evidence and history, not the production codebase.

## Invariants

1. Watchtower One does not initialize Joplin's user-data database, resource content, sensitive settings, plugin user data, backups, content-bearing logs, or persistent Electron user state before the Watchtower Profile Vault is unlocked. Only Public Bootstrap State may be read.
2. When the Vault Session is closed, user-derived data is not persistently recoverable as plaintext from Watchtower-managed profile paths, caches, logs, backups, crash artifacts, or temporary files.
3. The Local Vault Key and Joplin sync E2EE keys are generated, wrapped, rotated, recovered, and erased as separate key domains.
4. Local encryption failure is fail-closed. Watchtower One never silently opens or creates an unencrypted profile.
5. Explicit Plaintext Egress requires a bounded user action and clear warning; background backup, diagnostics, crash reporting, or plugin behavior cannot create an undisclosed plaintext copy.
6. Only Curated Plugins load in Watchtower One. Plugin admission does not weaken the logical user-data encryption guarantee.
7. Stock Joplin sync formats and supported sync targets remain compatible unless an accepted ADR explicitly changes them.
8. Watchtower client modifications and bundled client plugins comply with AGPL-3.0-or-later source and notice obligations.

## Context boundaries

- **Pre-unlock host**: presents vault creation/unlock/recovery and owns no open Joplin profile.
- **Vault lifecycle**: creates, unlocks, wraps, recovers, rotates, locks, and closes the Watchtower Profile Vault.
- **Joplin application**: runs substantially upstream behavior inside an established Vault Session.
- **Profile storage**: uses SQLCipher as the Canonical Encrypted Store and routes resources, settings, plugin data, caches, logs, backups, crash artifacts, and temporary/editor artifacts through encrypted deep modules, reviewed public state, or Explicit Plaintext Egress.
- **Sync boundary**: uses Joplin-native E2EE and sync targets; it is independent from local profile encryption.
- **Plugin trust boundary**: admits only reviewed signed code and treats every admitted plugin as profile-capable code requiring audit and runtime tracing.
- **User-selected external locations**: may receive Explicit Plaintext Egress or encrypted recovery artifacts, never silent background plaintext.

## Open architectural terms

ADR-0003 selects the SQLCipher-led logical profile vault. The implementation
must still decide the Local Vault Key hierarchy and recovery interface, the
protected/unprotected state while a Vault Session is open, the exact Public
Bootstrap State, and macOS/Linux qualification. Those decisions must not be
guessed in feature code.
