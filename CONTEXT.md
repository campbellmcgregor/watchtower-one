# Watchtower One domain context

<!-- cspell:ignore campbellmcgregor handoff HKDF -->

Watchtower One is a security-focused, Windows-first downstream distribution of Joplin. It retains Joplin's mature note-taking, mobile-capable shared backend, plugin APIs, and end-to-end encrypted synchronization while adding an always-encrypted local profile, independent local recovery, Watchtower-owned identity, and a curated plugin trust boundary.

The first release has no Watchtower account, Watchtower Sync, Instant Response, analytics transport, or proprietary server dependency.

## Ubiquitous language

- **Upstream Baseline**: the exact stable Joplin tag and commit from which the current Watchtower release line descends.
- **Downstream Patch**: a focused Watchtower-only commit or module carried on top of the Upstream Baseline.
- **Downstream Patch Registry**: the maintained mapping from each logical Downstream Patch to its owner, commits, upstream touchpoints, tests, and upstream-contribution candidacy.
- **Synchronization Candidate**: a published stable Joplin release or published advisory represented by one idempotent Watchtower triage issue.
- **Patch Ledger**: a machine-readable record of the exact Upstream Baseline, downstream revision and commits, dependency lock hash, and—at release time—distributed artifact hashes.
- **Watchtower Profile Vault**: the logical encrypted boundary containing app-managed notes, metadata, histories, search data, attachments, sensitive settings, credentials, Curated Plugin user data, and automatic backups. It is implemented through encrypted modules rather than a mounted root-profile container.
- **Vault Session**: the capability-scoped, unlocked lifetime of the content-bearing application process tree. Decrypted user data may exist in trusted process memory during this lifetime, but application-managed persistence remains encrypted. Joplin profile initialization cannot precede it.
- **Local Vault Key**: the random key material protecting the Watchtower Profile Vault. It is independent of all Joplin sync E2EE keys.
- **Vault Key Schedule**: the versioned HKDF-SHA-256 derivation boundary that turns the Local Vault Key into separate SQLCipher, resource-content, private-profile-data, and metadata-authentication keys.
- **Vault Key Envelope**: Public Bootstrap State containing one authenticated passphrase wrapper and one authenticated Recovery Secret wrapper for the Local Vault Key, together with bounded algorithm, parameter, nonce, and generation metadata.
- **Vault Passphrase Policy**: the local-only creation boundary that normalises and checks a proposed passphrase against the pinned compromised-password blocklist, then calibrates bounded Argon2id parameters without processing the proposed passphrase during calibration.
- **Vault Credential Lifecycle**: the trusted pre-profile command boundary that
  composes policy, independently wrapped credentials, confirmation, monotonic
  wrapper generations, and atomic persistence. Restart selects only a complete
  committed generation and never falls back to plaintext.
- **Credential-to-profile handoff**: the trusted desktop bootstrap operation
  that opens SQLCipher from a live Vault Session key ring and makes the
  resulting encrypted storage available to the profile host without exposing
  a raw key or permitting stock profile fallback.
- **Main-to-renderer profile transport**: the trusted Electron bridge path that
  publishes the vault-scoped Joplin database, resource-store, profile
  configuration, private settings, and session-scoped log sink after vault
  unlock. Renderer startup fails closed when that binding is absent; no Local
  Vault Key or derived key crosses this seam. This transport is not a renderer
  sandbox or a replacement for Joplin's existing Node filesystem authority.
- **Canonical Encrypted Store**: the SQLCipher database that owns persistent user-derived data unless an accepted ADR assigns a specific artifact to Public Bootstrap State, a reconstructible non-content cache, or Explicit Plaintext Egress.
- **Public Bootstrap State**: the minimal reviewed, non-content state required to locate and identify a vault before unlock. It contains no note, resource, credential, sensitive setting, profile name, or Curated Plugin user data.
- **Reviewed Public Runtime State**: a dedicated Watchtower runtime directory
  structurally outside the profile vault. For the first release it contains
  only the empty, timestamp-only `vault.lock` needed for single-vault
  coordination. Profile paths, window geometry, logs, and user-derived content
  are not permitted there.
- **Resource Content module**: the deep module whose interface imports, reads or streams, exports, and deletes attachment bytes by resource identifier without exposing a persistent plaintext path or its SQL implementation.
- **Ephemeral Runtime module**: the deep module that configures content-bearing Electron sessions, renderer caches, plugin executable source, preview material, and temporary working state so they remain memory-only or reconstructible and non-content-bearing.
- **Sync E2EE**: Joplin's existing item-level encryption used while synchronizing through Joplin Cloud, WebDAV, Dropbox, OneDrive, or filesystem targets. It does not provide local-at-rest protection.
- **Recovery Secret**: a user-held credential that can independently recover the Local Vault Key without a Watchtower account.
- **Curated Plugin**: a plugin admitted by Watchtower's signing, review, update, and revocation policy. Signing proves admission; it does not sandbox the plugin.
- **Public Plugin Code Store**: the structurally separate public directory that
  may contain only admitted plugin packages and their deterministic executable
  extraction cache. It contains no plugin settings, user data, logs, or
  temporary working content and is not part of Reviewed Public Runtime State.
- **Encrypted Plugin Data Filesystem**: the host-authenticated, plugin-scoped
  virtual filesystem exposed to a Curated Plugin for persistent user data. It
  is backed by the Canonical Encrypted Store and never supplies a persistent
  operating-system path. It preserves useful asynchronous `fs-extra`
  operations but is not a plugin sandbox.
- **Explicit Plaintext Egress**: a user-initiated export, external edit, open-with action, or similar operation that necessarily creates plaintext outside the Watchtower Profile Vault and is disclosed before execution.
- **Legacy Notebook**: the retired standalone custom Electron/SQLCipher application preserved in `campbellmcgregor/watchtower-one-legacy`; it is evidence and history, not the production codebase.

## Invariants

1. Before a Local Vault Key is validated, Watchtower reads only Public Bootstrap State. During `Unlocking`, the Vault Lifecycle module may perform bounded keyed format, configuration, and integrity checks against the Canonical Encrypted Store, but Joplin initialization and user-data queries cannot begin until the Vault Session capability is issued.
2. During a Vault Session, decrypted user data and raw local key material remain memory-only. Application-managed persistent user data, SQLite sidecars, automatic backups, and sensitive runtime state remain encrypted.
3. Watchtower never reports a successful lock until new profile work is gated, content-bearing processes are closed, encrypted stores are closed, ephemeral application state is discarded, and session authority is revoked. A failed transition remains visibly failed closed.
4. When the Vault Session is closed, user-derived data is not persistently recoverable as plaintext from Watchtower-managed profile paths, caches, logs, backups, crash artifacts, or temporary files.
5. The Local Vault Key and Joplin sync E2EE keys are generated, wrapped, rotated, recovered, and erased as separate key domains.
6. Local encryption failure is fail-closed. Watchtower One never silently opens or creates an unencrypted profile.
7. Explicit Plaintext Egress requires a bounded user action and clear warning; background backup, diagnostics, crash reporting, clipboard behavior, or plugin behavior cannot create an undisclosed plaintext copy.
8. Only Curated Plugins load in Watchtower One. Plugin admission does not weaken the logical user-data encryption guarantee.
9. Stock Joplin sync formats and supported sync targets remain compatible unless an accepted ADR explicitly changes them.
10. Watchtower client modifications and bundled client plugins comply with AGPL-3.0-or-later source and notice obligations.

## Context boundaries

- **Pre-unlock host**: presents vault creation/unlock/recovery and owns no open Joplin profile.
- **Vault lifecycle**: creates, unlocks, wraps, recovers, rotates, locks, and closes the Watchtower Profile Vault.
- **Joplin application**: runs substantially upstream behavior inside an established Vault Session.
- **Profile storage**: uses SQLCipher as the Canonical Encrypted Store and routes resources, settings, plugin data, caches, logs, backups, crash artifacts, and temporary/editor artifacts through encrypted deep modules, reviewed public state, or Explicit Plaintext Egress.
- **Ephemeral runtime**: permits decrypted user data only in the content-bearing process tree and configures Electron/Chromium state so it does not become application-managed persistent plaintext.
- **Sync boundary**: uses Joplin-native E2EE and sync targets; it is independent from local profile encryption.
- **Plugin trust boundary**: admits only reviewed signed code and treats every admitted plugin as profile-capable code requiring audit and runtime tracing.
- **User-selected external locations**: may receive Explicit Plaintext Egress or encrypted recovery artifacts, never silent background plaintext.

## Open architectural terms

ADR-0003 selects the SQLCipher-led logical profile vault. ADR-0004 defines the
unlocked Vault Session at-rest contract. ADR-0005 defines the independently
wrapped Local Vault Key, domain-separated key schedule, mandatory user-held
recovery, credential rotation, and minimal envelope portion of Public Bootstrap
State. The Windows adapter now has a packaged create, close, plaintext-canary
scan, and reopen proof for the ordinary shutdown path. Forced termination,
recovery, the complete release allowlist, and macOS/Linux adapters remain
release gates. Remaining decisions must not be guessed in feature code.
