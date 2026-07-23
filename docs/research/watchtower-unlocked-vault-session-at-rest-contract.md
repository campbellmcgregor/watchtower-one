# Watchtower One unlocked Vault Session at-rest contract

<!-- cspell:ignore cleanup Crashpad hiberfil minidump pagefile SQLCipher sqlcipher tempstore Zetetic zeroisation -->

- Research date: 2026-07-23
- Joplin baseline: v3.6.15 at
  `c61572660382863595c6b51ccf2263e3d2c4bfce`
- Issue: [#9](https://github.com/campbellmcgregor/watchtower-one/issues/9)
- Scope: persisted bytes and operating-system artifacts while the local vault is
  unlocked

## Executive conclusion

An unlocked Watchtower One vault does **not** need to become plaintext on disk.
SQLCipher encrypts database pages as they are written, including data pages in
rollback journals and WAL files. The accepted Watchtower model can therefore
keep notes, metadata, settings, plugin persistence, attachment BLOBs and
automatic backups encrypted on application-controlled storage for the complete
unlocked session as well as while locked.
([SQLCipher design](https://www.zetetic.net/sqlcipher/design/))

That statement is narrower than “plaintext exists only in RAM.” SQLCipher
decrypts pages for use in process memory. Windows may copy pageable process
memory to `pagefile.sys`, writes memory to the hibernation file during
hibernation, and can create crash dumps containing stack, data or full process
memory. A process with the required Windows process access rights can also read
another process's memory. Those are operating-system or compromised-session
surfaces, not files Watchtower's Resource Content or Encrypted Profile Database
modules can cryptographically control.
([Windows paging](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/introduction-to-the-page-file),
[hibernation](https://learn.microsoft.com/en-us/windows/win32/power/system-power-states),
[minidump contents](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ne-minidumpapiset-minidump_type),
[process memory access](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory))

The recommended issue #9 contract is consequently:

> During an unlocked Vault Session, every application-controlled durable copy
> of user content remains encrypted. Plaintext is permitted in process memory
> and in a disclosed, user-authorised Explicit Plaintext Egress operation.
> Pagefile, hibernation, administrator-configured crash dumps, hostile code in
> the logged-in user context and third-party egress residue are stated limits,
> not hidden exceptions to the application-controlled storage guarantee.

## Terms and ownership boundary

### Vault Session

A **Vault Session** begins only after the Local Vault Key has been applied to a
new SQLCipher connection and a key-validation read plus required
format/configuration checks have succeeded. It ends only after Watchtower has:

1. stopped new vault work;
2. closed content renderers, curated-plugin workers, sync/resource streams and
   egress watchers;
3. committed or rolled back active transactions;
4. closed every SQLCipher handle;
5. cleared session-owned browser storage and content buffers; and
6. zeroised and released the in-process Local Vault Key.

A hidden window or an operating-system screen lock is not itself a closed Vault
Session. Watchtower must explicitly perform the lifecycle above.

### Application-controlled artifact

An artifact is **application-controlled** when Watchtower or code it chooses to
run determines whether, where and in what representation the artifact is
written. This includes the SQLCipher database and its sidecars, Joplin resource
and plugin paths, Electron session data, Watchtower logs, automatic backups,
application temp files and Watchtower's own crash reporter.

The contract is normative for these artifacts: content-bearing plaintext is a
release failure unless it is Explicit Plaintext Egress.

### Operating-system-controlled memory artifact

An artifact is **operating-system-controlled** when Windows can persist process
memory independently of Watchtower's normal file-writing paths. The pagefile,
hibernation file and administrator-enabled Windows Error Reporting dumps are
the central Windows examples. Watchtower can reduce their exposure, react to
system events and document platform hardening, but cannot truthfully guarantee
that they contain no unlocked plaintext on an otherwise untrusted host.

### Explicit Plaintext Egress

**Explicit Plaintext Egress** is a user-initiated export, print, external-edit or
open-with operation whose purpose requires another process or destination to
receive plaintext. It must be:

- initiated by an immediate user action, never by background behavior;
- described before materialisation, including the destination and loss of the
  Watchtower at-rest guarantee;
- created through the Plaintext Egress module only;
- bounded to the minimum data and lifetime needed; and
- cleaned up on normal completion, Vault lock and recovery startup.

Cleanup is hygiene, not a secure-erasure claim. Once a third-party application
or filesystem has received plaintext, Watchtower cannot revoke editor recovery
files, recent-file records, search indexes, snapshots or remapped storage
blocks.

## SQLCipher behavior while the database is open

SQLCipher encrypts and decrypts individual pages at the pager boundary. The
main database therefore remains ciphertext while open; opening the database
does not decrypt it in place. SQLCipher's documented storage behavior is:

| Artifact | On-disk content while open | Watchtower classification |
| --- | --- | --- |
| Main database | Every data page is encrypted and authenticated. The default design uses a per-page IV and HMAC. | Canonical Encrypted Store; required. |
| Rollback journal | Database pages are encrypted with the database key. Its header is plaintext but contains no database data. A vacuum journal is treated the same way. | Encrypted content plus public transaction metadata; allowed. |
| WAL | WAL page data is encrypted with the database key. | Encrypted content plus public WAL/frame metadata; allowed. |
| Statement journal | SQLCipher encrypts it; it remains in memory when file-based temporary stores are disabled. | Must be memory-only under the release build configuration. |
| Super/master journal | Contains participating rollback-journal pathnames rather than original database pages. | Public operational metadata only; must not contain user-selected names or content. |
| WAL `-shm` | SQLite describes it as a reconstructible WAL index with no persistent database content. It is not an encrypted content store. | Reconstructible, untrusted operational metadata; can exist beside the encrypted database but must pass canary tracing. |
| Other SQLite transient files | SQLCipher explicitly says other transient files are not encrypted. SQLite can otherwise use disk for TEMP databases, materialised views, transient indexes and `VACUUM` staging. | Disk-backed use is forbidden; the release binding must force these stores to memory. |

Sources:
[SQLCipher database and journal design](https://www.zetetic.net/sqlcipher/design/#database-encryption-and-temporary-files)
and
[SQLite temporary-file behavior](https://www.sqlite.org/tempfiles.html).

The implication is a production configuration requirement, not an optional
performance choice:

- assert `PRAGMA cipher_plaintext_header_size=0`; SQLCipher's opt-in plaintext
  header mode can expose a chosen header prefix and moves salt management into
  the application, so Watchtower must not enable it without a later
  platform-specific ADR;
- build the native binding with SQLCipher's required in-memory temporary-store
  setting (`SQLITE_TEMP_STORE=2` or `3`);
- assert the required compile option from `PRAGMA compile_options` on every
  supported binary;
- set and verify `PRAGMA temp_store=MEMORY` before Joplin queries can run;
- prevent plugins or migrations from changing the setting;
- pin the selected journal mode and test its actual sidecars rather than
  assuming WAL or rollback-journal use; and
- fail closed if any required SQLCipher, temporary-store, FTS or compatibility
  option is absent.

By default SQLCipher stores a random 16-byte salt at the start of the file and
encrypts the database header. `cipher_plaintext_header_size` exists for special
platform cases and must be set on every open when used; Watchtower's selected
Windows contract keeps it at zero.
([SQLCipher key and salt](https://www.zetetic.net/sqlcipher/sqlcipher-api/#setting-the-key),
[`cipher_plaintext_header_size`](https://www.zetetic.net/sqlcipher/sqlcipher-api/#pragma-cipher_plaintext_header_size))

SQLCipher's own build instructions require `SQLITE_TEMP_STORE=2` or `3`, and its
security design warns that non-journal transient files are not encrypted.
([SQLCipher build instructions](https://github.com/sqlcipher/sqlcipher#compiling),
[temporary-file warning](https://www.zetetic.net/sqlcipher/design/#database-encryption-and-temporary-files))

The issue #8 prototype is positive feasibility evidence, but not the complete
release test. It found zero plaintext canary matches in the controlled
database, WAL, SHM and journal paths after close/reopen, backup, committed
forced termination and in-flight forced termination. It did not claim a
forced, disk-spilling TEMP-table workload, so issue #9 must preserve the build
and runtime assertions above.
([issue #8 proof](../evidence/issue-8-sqlcipher-joplin-architecture-proof.md))

## Memory behavior and key handling

SQLCipher says it locks cryptographic allocations when possible and wipes them
before release. Its `cipher_memory_security` setting extends sanitisation to
all memory allocated by the SQLCipher library, but is disabled by default
because of its performance cost.
([SQLCipher design](https://www.zetetic.net/sqlcipher/design/#security-design),
[`cipher_memory_security`](https://www.zetetic.net/sqlcipher/sqlcipher-api/#pragma-cipher_memory_security))

Watchtower must enable and verify `PRAGMA cipher_memory_security=ON`, but that
setting is not a whole-application memory guarantee. Joplin, Electron,
Chromium, Node buffers, renderer strings, OCR libraries and curated plugins can
hold their own plaintext allocations outside SQLCipher.

The Local Vault Key should therefore:

- enter the native Vault Lifecycle/Database seam as a bounded binary buffer,
  not a JavaScript string or logged SQL statement;
- be applied before the first database operation, as SQLCipher requires;
- be kept out of renderer and plugin IPC;
- use native locked memory where available;
- be overwritten before release; and
- never be retained to make re-unlock convenient after screen lock, suspend or
  explicit lock.

On Windows, `VirtualLock` guarantees that successfully locked pages remain in
physical memory and are not written to the pagefile until unlocked or process
termination. Windows intentionally keeps the lockable working-set allowance
small, so this is suitable for the key and similarly bounded secrets, not the
entire Electron/Joplin plaintext working set.
([`VirtualLock`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtuallock))

## Electron and Chromium session contract

Electron distinguishes persistent and in-memory sessions. A partition prefixed
with `persist:` is persistent; a partition without that prefix is in memory.
`Session.storagePath` is `null` for an in-memory session. Electron's
`sessionData` path can otherwise hold local storage, cookies, disk cache,
downloaded dictionaries, network state and DevTools files.
([Electron sessions](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options),
[Electron application paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname))

Stock Joplin v3.6.15 instead creates a session with
`session.fromPath(<root>/internal, { cache: false })`. `cache: false` disables
the HTTP cache option; it does not turn a path-backed session into an in-memory
session.
([pinned Joplin source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L206-L237),
[`session.fromPath`](https://www.electronjs.org/docs/latest/api/session#sessionfrompathpath-options))

Watchtower's content renderer and any webview used during a Vault Session must
therefore use a fresh, non-`persist:` partition with cache disabled and verify
`storagePath === null`. A new random partition should be used after every
unlock. On lock, Watchtower must destroy the associated WebContents, close
connections and clear cache and storage before discarding references. Electron
lists cookies, filesystem state, IndexedDB, local storage, shader cache,
service workers and CacheStorage among the data that session cleanup may need
to remove.
([Electron session cleanup](https://www.electronjs.org/docs/latest/api/session#sesclearstoragedataoptions))

Prevention is the security boundary: deleting a persistent Chromium directory
after lock is not an acceptable substitute. Packaged runtime tracing must still
verify that Chromium, GPU, spell-check, DevTools and network components do not
write a content canary to `sessionData`, OS temp or another disk cache despite
the in-memory configuration.

## Joplin v3.6.15 paths that the contract changes

The table separates source-confirmed behavior from the checked-in Windows trace
evidence. It is not an instruction to preserve stock paths.

| Stock surface | Primary evidence | Unlocked Watchtower requirement |
| --- | --- | --- |
| `database.sqlite` | Joplin opens it after profile directories and file logging are initialized. ([source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/BaseApplication.ts#L708-L781)) | Replace at the existing driver seam with the keyed SQLCipher adapter. No schema read may precede the key and configuration checks. |
| `resources/<id>.<ext>` | The packaged issue #37 trace found exact resource bytes in the stock resource path and a plugin copy. ([evidence](../evidence/issue-37-packaged-content-trace/note-resource-plugin-summary.json)) | Resource Content stores the canonical bytes as SQLCipher BLOBs. Preview, OCR, sync and import use memory/streams; no stock plaintext sibling is maintained. |
| `settings.json` and `plugin-data/` | The same packaged trace found the plugin canary in both paths after forced termination. ([evidence](../evidence/issue-37-packaged-content-trace/note-resource-plugin-summary.json)) | Sensitive settings and curated-plugin data use encrypted tables/BLOBs. A reviewed Public Bootstrap State may contain no content, credentials, profile names or sensitive plugin values. |
| `log.txt` | The development trace found the note and plugin canaries in the log and retained them after force-kill. ([trace summary](../evidence/issue-7-runtime-plaintext-trace/trace-summary.json), [manifest](../evidence/issue-7-runtime-plaintext-trace/08-forced-termination-closed.json)) | Public logs use a structured allowlist and cannot contain note/resource text, URLs, credentials or user paths. A content-bearing diagnostic export must itself be encrypted or Explicit Plaintext Egress. |
| `<root>/internal/` | Stock source creates the path-backed Electron session; the clean trace observed Electron stores while live. ([source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L206-L237), [live manifest](../evidence/issue-7-runtime-plaintext-trace/01-clean-startup-live.json)) | Replace for content views with the in-memory session contract above. |
| `edit-<note-id>.md` | Stock Joplin serialises the note to Markdown and normally removes it when editing stops. The trace found the complete note copy live, retained it after force-kill and observed recovery-start cleanup. ([source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ExternalEditWatcher.ts#L261-L338), [trace summary](../evidence/issue-7-runtime-plaintext-trace/trace-summary.json)) | Disable by default or expose only through warned Explicit Plaintext Egress. Recovery cleanup remains required but cannot restore the at-rest guarantee for third-party/editor residue. |
| `tmp/edited_resources/<friendly-name>` | Stock Joplin copies the complete resource for another application and removes its own copy on normal stop. ([copy](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ResourceEditWatcher/index.ts#L234-L245), [cleanup](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ResourceEditWatcher/index.ts#L319-L362)) | Same Explicit Plaintext Egress rule. Never treat normal cleanup as secure erasure. |
| Stock Backup/JEX | The development trace found note/resource canaries in the JEX and plugin state in the copied profile. ([trace summary](../evidence/issue-7-runtime-plaintext-trace/trace-summary.json), [backup manifest](../evidence/issue-7-runtime-plaintext-trace/05-backup-live.json)) | Stock automatic Backup remains disabled. Automatic backup uses authenticated SQLCipher export and is wrong-key/integrity tested. User-selected plaintext export is Explicit Plaintext Egress. |
| Joplin crash JSON and Electron Crashpad | Joplin writes a Sentry event and up to 100 KB of the profile log to the OS crash directory before honouring its upload-disabled return path. Electron stores Crashpad reports before upload and says `uploadToServer: false` still collects them. ([Joplin source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/bridge.ts#L70-L158), [Electron crash reporter](https://www.electronjs.org/docs/latest/api/crash-reporter)) | Do not start the stock content-bearing reporters. Watchtower-owned diagnostics are content-free by construction; encrypted/user-authorised diagnostic export is a separate feature. |

Curated plugin signatures do not change this contract. Joplin exposes filesystem
access to plugins and `dataDir()` is a convention, not a sandbox.
([pinned plugin API](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/api/Joplin.ts#L127-L143))
Plugin admission and release tracing must reject undisclosed writes to home,
temp or arbitrary absolute paths.

## Windows operating-system limits

| Surface | What the primary source establishes | Contract and mitigation |
| --- | --- | --- |
| `pagefile.sys` | Windows can remove infrequently accessed modified pages from physical memory and use the pagefile as backing storage. Successfully `VirtualLock`ed pages are not written there while locked. ([paging](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/introduction-to-the-page-file), [`VirtualLock`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtuallock)) | Lock the bounded key buffer, zeroise on lock, minimise plaintext lifetimes, and recommend full-volume protection. Do not claim the complete Joplin/Electron working set is non-pageable. |
| `hiberfil.sys` | During hibernation Windows writes all memory contents to the hibernation file. ([system power states](https://learn.microsoft.com/en-us/windows/win32/power/system-power-states)) | React to screen-lock and suspend by locking immediately; always resume locked. Electron exposes both events. This is best effort because the event is not a cryptographic guarantee that teardown completed before the OS snapshot. Full-volume protection or disabling hibernation is required for a stronger offline guarantee. ([Electron power monitor](https://www.electronjs.org/docs/latest/api/power-monitor)) |
| WER user-mode dumps | An administrator can configure WER independently to collect local dumps after a crash. A full minidump option includes all accessible process memory; even a normal minidump includes stack-trace material. ([WER LocalDumps](https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps), [minidump types](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ne-minidumpapiset-minidump_type)) | Do not modify machine-wide policy silently. Disable Watchtower-owned crash capture by default, publish an enterprise hardening check, and state that administrator-enabled dumps can contain unlocked content or key material. |
| Active user session and local debugging | Windows associates processes with a user's security context. Any process that obtains `PROCESS_VM_READ` can copy readable memory; `SeDebugPrivilege` can enable full process access. ([process security](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights), [`ReadProcessMemory`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory)) | Auto-lock on screen lock and idle, but do not claim protection from malware, injected code, an administrator/debugger or a hostile curated plugin while the Vault Session is active. |

These limits do not permit Watchtower to write an ordinary plaintext temp file
and label it “OS controlled.” Ownership is determined by who chose to
materialise the bytes. Only Windows-managed paging, hibernation and dump
mechanisms belong in this limitation.

## Decision inputs carried into ADR-0004

ADR-0004 carries these research conclusions into the normative issue #9
contract:

1. **Ciphertext on application-controlled storage while unlocked.** The
   SQLCipher database and content-bearing journals/WAL remain encrypted for the
   entire open session. All other canonical user data is stored in SQLCipher or
   held in memory.
2. **No background plaintext.** Settings fallbacks, resource siblings, plugin
   data directories, logs, Chromium persistence, stock Backup, print staging
   and crash attachments may not silently contain user content.
3. **Explicit egress is the only application exception.** External edit,
   open-with, print and plaintext export are immediate, warned user actions
   routed through one module. Cleanup is required but is not represented as
   secure erasure.
4. **Memory is an unlocked-session exposure.** Plaintext and the key can exist
   in process memory. SQLCipher memory sanitisation, bounded native locked key
   memory, renderer/plugin isolation and prompt lifecycle teardown reduce that
   exposure.
5. **Windows memory persistence is a disclosed platform limit.** Pagefile,
   hibernation and independently configured dumps are outside the hard
   application-controlled guarantee. Stronger offline protection depends on
   platform full-volume protection and policy.
6. **A compromised active user context is outside the guarantee.** Watchtower
   does not claim confidentiality from same-session malware, injected code,
   debuggers, administrators or an admitted plugin that violates policy.
7. **System events cause lock, not convenience unlock.** Screen lock, suspend,
   idle timeout and explicit lock initiate the same fail-closed Vault Session
   teardown. Resume and screen unlock never restore the key automatically.
8. **Release evidence tests prevention and crash residue.** Qualification must
   scan while open, after graceful lock, after forced process-tree termination,
   after recovery and across a version upgrade. It must force SQL transient
   workloads, WAL/rollback modes as selected, Electron storage APIs, external
   egress, renderer/main crashes and administrator-enabled WER in separately
   labelled cases.

## Minimum release assertions derived from the contract

- Raw database, WAL, journal, backup and forced-termination scans contain no
  complete content canary; SHM and headers contain only reviewed operational
  metadata.
- The packaged native binding reports the pinned SQLCipher version, required
  DQS/FTS compatibility and in-memory temporary-store compile option.
- A deliberately large sort, TEMP table, FTS migration and `VACUUM` do not
  create plaintext SQLite transient files.
- Wrong key, missing compile option, integrity failure and partial keying all
  fail before Joplin initialisation.
- Content WebContents use a non-persistent partition with
  `storagePath === null`; canary tracing finds no content in `sessionData`,
  cache, GPU cache, dictionaries, DevTools or OS temp.
- Lock waits for database, resource, plugin and renderer barriers, then closes
  every database handle and demonstrates wrong-key rejection before the next
  unlock.
- Screen lock, suspend, idle, crash and force-kill recovery reopen in the locked
  state without reusing a prior Vault Session key.
- Public logs and default diagnostics contain no user-content canary.
- Every enabled curated plugin passes intentional outside-path write tests.
- Platform evidence reports pagefile, hibernation, volume-encryption and WER
  policy separately from application-controlled canary results.

This contract preserves ADR-0003's honest product promise: Watchtower controls
and encrypts its own durable user data even while unlocked, while naming the
places where a general-purpose desktop operating system can persist or inspect
live process memory.
