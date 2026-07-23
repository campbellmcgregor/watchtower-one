# ADR-0004: Keep persistence encrypted throughout an unlocked Vault Session

<!-- cspell:ignore cleanup Crashpad handoff handoffs hiberfil IndexedDB minidumps pagefile screenshots sidecars sqlcipher -->

- Status: Accepted
- Date: 2026-07-23
- Scope: Unlocked Vault Session persistence and operating-system assumptions
- Extends: ADR-0003's SQLCipher-led logical profile vault

## Context

ADR-0003 selects SQLCipher as Watchtower One's Canonical Encrypted Store. That
decision does not by itself define what “unlocked” permits. Stock Joplin writes
user data to SQLite, attachment files, JSON settings, logs, plugin directories,
Electron/Chromium state, temporary editor files, automatic backups, and crash
artifacts. Some of those writes happen before the database opens.

An unlocked application must display and process plaintext. SQLCipher decrypts
database pages for the running process, and Joplin renderers, editors, search,
OCR, sync, and curated plugins may hold decrypted user data in memory. The
operating system can copy process memory into pagefile, hibernation, or crash
artifacts. External applications, clipboard history, printing, screen capture,
and user-selected exports can create further copies.

Watchtower therefore needs a precise contract that distinguishes:

- application-managed persistence that Watchtower can and must encrypt;
- decrypted data that is deliberately memory-only during an authorised session;
- minimal reviewed state that is safe to persist publicly;
- user-authorised plaintext leaving Watchtower's control; and
- operating-system or already-compromised-session artifacts that the application
  cannot honestly claim to protect by itself.

## Decision

An unlocked Vault Session is **not** an unencrypted profile. Application-managed
persistence remains encrypted for the complete session. Unlock grants a
non-serialisable, in-memory capability to a content-bearing process tree; it
does not mount, create, or expose a plaintext profile directory.

The first-release states are:

| State | Permitted behavior |
|---|---|
| `Locked` | Only the pre-unlock host runs. The closed Canonical Encrypted Store and other encrypted vault artifacts persist but are unreadable; Public Bootstrap State is the only Watchtower state readable without a Local Vault Key. Joplin, sync, backup, indexing, OCR, and curated plugins do not run. |
| `Unlocking` | The Vault Lifecycle module derives or unwraps key material in memory, opens and keys the encrypted store before its first schema read, validates version and integrity, configures the Ephemeral Runtime module, and only then issues a Vault Session capability. Failure returns to a visibly failed-closed state. |
| `Unlocked` | Trusted Watchtower/Joplin processes may hold decrypted user data in memory. Persistent user data continues through encrypted modules; no routine plaintext profile exists. |
| `Locking` | New profile work is rejected; sync, plugin, editor, preview, OCR, backup, and egress work is drained or cancelled; encrypted stores are closed; the content-bearing process tree exits; ephemeral application state and key buffers are discarded. The pre-unlock host then reports either fully protected `Locked` or the explicit `LockedWithEgressResidue` result. |
| `LockedWithEgressResidue` | The encrypted vault is closed and session authority is revoked, but Watchtower could not confirm deletion of one or more temporary Explicit Plaintext Egress paths. The pre-unlock host identifies the paths, explains the residual risk, and does not present the ordinary fully protected `Locked` state until deletion is confirmed. User acknowledgement may dismiss the immediate warning but cannot upgrade the security state. |
| `FailedClosed` | Watchtower does not report a successful unlock or lock, does not fall back to stock plaintext storage, and does not resume profile work. Recovery may relaunch only the pre-unlock host after reporting the failure. |

### Required encrypted persistence

The following remain encrypted even while the Vault Session is unlocked:

- the Canonical Encrypted Store and every journal, WAL, backup, or recovery
  sidecar containing its pages;
- notes, metadata, history, search projections, OCR text, embeddings, conflicts,
  sync state, and sensitive database settings;
- attachment content managed through the Resource Content module;
- sensitive application settings, credentials, and curated-plugin user data;
- automatic backups and staged restore data; and
- any durable queue or checkpoint whose payload contains user-derived content.

The Encrypted Profile Database adapter applies the key before the first database
read, verifies the required SQLCipher and SQLite configuration, keeps the
SQLCipher plaintext-header size at zero, enables SQLCipher's extended memory
sanitisation, and rejects extensions or configuration that can create plaintext
database artifacts. The production binding is compiled with
`SQLITE_TEMP_STORE=2` or `3`; the adapter asserts that compile option, sets and
verifies `PRAGMA temp_store=MEMORY` before Joplin can query, and prevents later
changes. Key, version, integrity, or encryption-configuration errors fail
closed. Any relaxation of those settings requires a later accepted ADR plus new
performance and plaintext trace evidence. Runtime and forced-termination
evidence must verify the database, journal, WAL, SHM, temporary, backup, and
recovery paths rather than relying on configuration alone.

### Memory-only material

The following may exist only in trusted process memory during an unlocked Vault
Session:

- unwrapped Local Vault Key material, passphrases, Recovery Secrets, and derived
  unlock keys;
- decrypted database pages and query results;
- note bodies, attachment bytes, rendered HTML, previews, thumbnails, editor
  buffers, OCR inputs, and search/sort working data;
- decrypted sensitive settings, credentials, and curated-plugin values; and
- content-bearing Electron session, renderer, GPU, network, spell-check, and
  temporary working state.

“Memory-only” means Watchtower does not deliberately create a file-backed copy.
It is not a claim that the operating system cannot page, hibernate, dump, inspect,
or capture that memory.

Raw Local Vault Key material must not cross into renderer JavaScript, plugin
interfaces, logs, diagnostics, command lines, environment variables, or
serialised IPC. The exact key hierarchy and native memory ownership belong to
the key-lifecycle decision, but they must satisfy this session contract. The
unwrapped key is held in a bounded native buffer, page-locked where the platform
supports it, and overwritten before release.

### Reviewed public persistence

Public persistent state is an allowlist, not everything that happens to fall
outside SQLCipher. It may contain only:

- Watchtower binaries, signed curated-plugin packages, code/model assets, and
  verified update payloads;
- opaque vault format/version and locator data required before unlock;
- opaque process locks, update markers, and migration markers;
- reconstructible caches proven not to contain user-derived data; and
- allowlisted operational diagnostics containing error codes and timings, but
  no note/resource content, profile names, credentials, URLs, user-selected
  paths, or stable content identifiers.

The exact Public Bootstrap State and key-envelope metadata remain separate
decisions. Adding any field to public persistence requires explicit review and
runtime canary evidence.

### Ephemeral Runtime module

The Ephemeral Runtime module is a deep module at the process/session seam. Its
interface establishes content-bearing runtime state only after it receives an
active Vault Session capability and disposes that state before the capability is
revoked.

Its implementation must:

- use a fresh non-`persist:` Electron/Chromium partition for every unlock,
  disable its cache, and verify `Session.storagePath` is `null`;
- keep content-bearing cookies, storage, caches, dictionaries, and network state
  inside that in-memory session;
- prevent decrypted preview, renderer, OCR, spell-check, and temporary content
  from spilling to application-managed files;
- expose no general-purpose plaintext temporary directory to Joplin or curated
  plugins;
- keep reconstructible public caches structurally separate from content-bearing
  state; and
- support a test adapter that reports every attempted persistent artifact so the
  interface is also the runtime-trace test surface.

The module hides platform-specific temp, session, and cleanup behavior. Windows,
macOS, and Linux adapters must satisfy the same interface before Watchtower
claims support on those platforms.

### Hard lock boundary

Watchtower v1 does not implement a cosmetic in-process “soft lock.” A successful
lock ends the content-bearing process lifetime. Watchtower may relaunch or
retain a minimal pre-unlock host, but that host receives neither the Vault
Session capability nor decrypted profile state.

The Vault Lifecycle module owns this ordering:

1. atomically reject new work requiring the Vault Session capability;
2. drain or cancel active storage, sync, backup, plugin, preview, OCR, and egress
   operations within a bounded interval;
3. close the SQLCipher adapter and encrypted resource/settings modules;
4. dispose the Ephemeral Runtime module and terminate all content-bearing
   renderer, utility, plugin, and GPU processes;
5. best-effort zeroise owned native key buffers and revoke the capability; and
6. report fully protected `Locked` only after the preceding outcomes and
   temporary-egress cleanup are observed; otherwise report
   `LockedWithEgressResidue`.

If the ordered transition cannot complete, the application reports a failed
lock and terminates content-bearing processes. It never leaves the ordinary
Joplin UI visible behind a lock screen and never reports protection it has not
observed.

Closing Watchtower ends the Vault Session. Background sync, backup, plugins, OCR,
or tray-resident profile access do not continue while locked. System session
lock, user switch, suspend, and configured idle timeout request the same hard
lock. Operating systems do not guarantee enough time to complete work before
power-state transitions, so hibernation of an already-unlocked process remains
an explicit limitation rather than a successful Watchtower lock. Resume and
screen unlock never reuse the prior Vault Session capability or key.

### Explicit Plaintext Egress

Final plaintext exports, external editing, open-with, printing, clipboard
transfer, drag-and-drop, and similar actions cross the at-rest protection seam.
They are allowed only through the Plaintext Egress module after a bounded user
action and clear disclosure.

The module distinguishes:

- a final user-selected destination, whose lifetime becomes the user's
  responsibility; and
- a temporary handoff to another application, which uses a private,
  per-operation location and a finite lease deadline recorded without content.

A temporary handoff is closed and deletion is attempted on operation
completion, cancellation, explicit lock, application close, and lease expiry.
Recovery startup retries every unfinished handoff before permitting another
unlock. Cleanup retries are bounded; implementation must define and test a
finite deadline rather than retaining plaintext indefinitely while another
application keeps it open. If Watchtower cannot confirm deletion, it enters
`LockedWithEgressResidue`, shows the surviving path and remediation, and never
describes that state as fully protected.

Watchtower cannot claim deletion of copies created by another editor, clipboard
history or cloud clipboard, print spooler, screenshot tool, backup product,
indexer, antivirus product, or user-selected destination. The disclosure must
say so. Background features and curated plugins cannot invoke an equivalent
plaintext write without the same user-facing egress flow.

### Operating-system and attacker assumptions

The application-managed encryption guarantee does not depend on BitLocker or
another mounted encrypted container. A locked or cleanly closed Watchtower
profile remains encrypted on an otherwise unencrypted filesystem.

Full-volume operating-system encryption remains strongly recommended because it
protects OS-owned pagefile, hibernation, crash-dump, thumbnail, indexing,
antivirus-quarantine, and filesystem metadata that Watchtower cannot reliably
encrypt or erase. Watchtower does not install, configure, or claim to replace
that platform control.

The following are outside the standalone at-rest guarantee:

- an attacker controlling the user's unlocked desktop session;
- malware, an administrator, kernel compromise, debuggers, or live memory
  acquisition while the Vault Session is unlocked;
- plaintext deliberately sent through Explicit Plaintext Egress;
- screen pixels, accessibility interfaces, screenshots, and screen recording
  while content is displayed; and
- OS-owned memory artifacts created while the session was unlocked.

Application-owned logs, crash JSON, Crashpad/Sentry attachments, Electron disk
state, backups, and temporary files are not OS exceptions. They remain subject
to the encrypted-or-non-content contract and must be disabled, replaced, or
routed through the selected deep modules.

### User-visible security disclosure

The distinction between Watchtower-controlled persistence and OS-controlled live
memory artifacts is part of the product interface, not developer-only
documentation. First-run onboarding and an always-available Security screen
must state:

- what Watchtower encrypts while locked and while unlocked;
- that pagefile, hibernation, administrator-enabled dumps, screen capture, and a
  compromised unlocked session can expose live plaintext;
- that full-volume operating-system encryption is recommended defence in depth
  but is not a Watchtower dependency; and
- that Explicit Plaintext Egress transfers protection responsibility to the
  selected destination or application.

Where Windows posture can be detected without elevation, the Security screen
reports volume-encryption, hibernation, and WER-dump status as protected,
unprotected, or unknown. Unknown is never represented as protected, and
Watchtower does not silently change machine-wide policy. Packaged acceptance
evidence verifies both the disclosure and its posture reporting.

## Verification contract

Implementation and release evidence must exercise the public seams, not private
helpers:

- an unlock test proves that no Joplin profile access occurs before the Vault
  Session capability is issued and that wrong-key, corrupt, unsupported, and
  configuration failures remain closed;
- a live-session trace proves ordinary note, resource, search, OCR, sync,
  curated-plugin, preview, and backup use creates no app-managed plaintext;
- lock, close, forced-termination, suspend, and recovery tests prove no silent
  plaintext fallback and never infer cleanup merely from a later successful
  startup;
- Plaintext Egress tests distinguish final user destinations from temporary
  handoffs, exercise completion/cancel/lock/close/expiry/recovery cleanup, and
  verify `LockedWithEgressResidue` when deletion cannot be confirmed;
- product-flow tests verify the first-run and Security-screen disclosure,
  including honest protected/unprotected/unknown Windows posture; and
- every packaged Windows evidence record states pagefile, hibernation, WER,
  crash-dump, indexing, antivirus, and full-volume-encryption posture.

## Consequences

- Watchtower retains SQLCipher's encrypted-at-rest property while open instead
  of creating a plaintext mounted profile.
- Locking is more expensive than hiding a window because it ends the
  content-bearing process lifetime and stops background activity.
- Stock Joplin file-backed resources, settings, plugin data, automatic Backup,
  logs, crash reporting, external editing, Electron state, and temp behavior
  remain disabled until adapted to the selected modules.
- JavaScript data cannot be reliably zeroised. Process termination and native
  ownership of raw key material provide the enforceable v1 seam.
- OS full-volume encryption improves protection of memory artifacts but is not a
  Watchtower dependency and cannot replace the logical profile vault.
- Cross-platform support requires platform adapters and evidence for the same
  contract; no Windows-only storage mechanism enters the core interface.

## Rejected alternatives

- **Decrypt or mount the profile while unlocked** — creates a broad plaintext
  persistence surface and contradicts ADR-0003.
- **Soft lock over a live Joplin process tree** — cannot revoke renderer/plugin
  memory or prove that background work has stopped.
- **Treat every OS artifact as Watchtower-managed** — promises control the
  application does not possess over pagefile, hibernation, kernel dumps, other
  applications, or an already-compromised session.
- **Treat every file outside SQLCipher as an OS exception** — would excuse
  application-owned logs, backups, caches, crash reports, and temporary files
  that Watchtower can and must redesign.
- **Require a Windows-only encryption feature** — weakens portability and is
  unnecessary for protecting application-managed persistence.

## Evidence

- `docs/research/watchtower-unlocked-vault-session-at-rest-contract.md`
- `docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md`
- `docs/evidence/issue-8-sqlcipher-joplin-architecture-proof.md`
- `docs/adr/0003-sqlcipher-logical-profile-vault.md`
