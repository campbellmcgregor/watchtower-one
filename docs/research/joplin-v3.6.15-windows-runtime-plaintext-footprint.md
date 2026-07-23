<!-- cspell:ignore accepteula APPDATA asar backingfile blockmap checkpointing Crashpad CrashDumps handoff minidumps NONCONTENT preexisting Procmon Sentry subprofile Sysinternals taskkill updater USERPROFILE WER WerFault -->

# Joplin v3.6.15 Windows runtime plaintext footprint

Status: partial exact-source development and packaged traces; complete Windows qualification remains

Issue: [#7 — Re-trace the v3.6.15 plaintext footprint at runtime](https://github.com/campbellmcgregor/watchtower-one/issues/7)

Research date: 2026-07-23

## Question and present answer

What persistent plaintext does the pinned Joplin v3.6.15 desktop baseline produce during clean startup, note and resource use, plugins, backup, external editing, crash, update, and forced termination on Windows?

The answer is broader than `database.sqlite`. The controlled runtime trace found note content in SQLite and `log.txt`, exact resource bytes in `resources`, plugin state in settings and logs, a complete external-edit Markdown copy, and a stock Backup JEX containing both note and resource canaries. The forced process-tree kill preserved every one of those copies. Recovery restored the note, removed the external-edit and unpacked test-plugin temporary files, and retained the database, resource, settings, log and Backup copies.

The trace found no unexpected content canary outside the selected profile within its controlled observation root. That is not a complete answer to issue #7 or a Windows-wide zero-plaintext claim: the run used the exact v3.6.15 source in the development Electron harness, redirected the selected profile and Electron session/temp paths, and did not scan the host account's existing home/app-data trees. Stable source still proves that normal installed Backup and crash paths can leave the selected profile. Those paths must be brought inside the Watchtower Profile Vault, replaced with encrypted equivalents, or treated as disclosed Explicit Plaintext Egress.

A later packaged x64 Windows Sandbox slice exercised the pinned v3.6.15
directory artifact through an auto-start test plugin. After the plugin's
durable completion barrier, an exact process-tree kill, and Procmon shutdown,
the closed-profile scanner found the note canary in `database.sqlite`, the
resource canary in both `resources\<resource-id>.txt` and the plugin's input
file, and the plugin canary in `settings.json` and its `plugin-data` file.
There were no scan errors or canary hits outside the selected profile within
the disposable observation root. The
[sanitized issue #37 summary](../evidence/issue-37-packaged-content-trace/note-resource-plugin-summary.json)
records the exact binary, fixture, harness, PML, and manifest hashes. Raw PML
and canary-bearing manifests remain outside source control.

## Evidence language

- **Confirmed by stable source** means the pinned source constructs, reads or writes the named path.
- **Expected at runtime** means source or a pinned dependency predicts an artifact, but its actual Windows filename, content or lifetime still needs observation.
- **Runtime observed** means the checked-in ten-checkpoint manifest set produced by the development harness described below.
- **Candidate allowed egress** is a proposed Watchtower policy classification, not an accepted exception.

Absence of a raw canary in a compressed file, encrypted file, sparse region or deleted filesystem record is not proof that the file contains no user data.

## Source and dependency pins

The accepted Upstream Baseline is Joplin `v3.6.15` at `c61572660382863595c6b51ccf2263e3d2c4bfce`, as recorded in [ADR-0001](../adr/0001-joplin-downstream-foundation.md). The local tag resolves to that commit. All Joplin source links in this report are pinned to that SHA.

The [accepted downstream plan](../plans/2026-07-22-watchtower-one-joplin-downstream-plan.md) requires clean-run, note/resource/plugin, backup, external-edit, crash, update and forced-kill traces at this stable pin. It also makes persistent-artifact inspection and forced termination release evidence rather than optional diagnostics.

The earlier [local plaintext inventory](joplin-local-plaintext-profile-and-storage-paths.md) inspected a later `dev` commit. It is useful for breadth, but later schema claims cannot be projected backwards. In particular, the stable migration index ends at migration 49 ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/database/migrations/index.ts#L1-L24)). This report therefore does not attribute the later embedding or conflict-state tables to v3.6.15.

The default Backup plugin is an independently versioned part of the baseline. Joplin pins it to commit `2c3da7056e7ac39c86c2051a4fdb99d9534dd0a1` ([Joplin repository pin](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/default-plugins/pluginRepositories.json#L1-L7)); Backup citations use that commit, not the newer plugin checkout used by the earlier inventory.

The desktop package pins `electron-updater` 6.6.8 ([package](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/package.json), [lockfile](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/yarn.lock)). Its immutable published JavaScript is cited where it owns update-cache behavior.

## Runtime evidence

The repeatable harness in [`watchtower/runtime-trace`](../../watchtower/runtime-trace/) launched the desktop bundle built from the pinned baseline on Windows x64. It assigned an empty explicit profile, Electron `userData`, session, temp, log and Crashpad directories below one observation root. A literal scanner captured regular-file paths, sizes, SHA-256 hashes, and UTF-8/UTF-16LE canary hits at ten checkpoints. The [environment record](../evidence/issue-7-runtime-plaintext-trace/environment.json), [summary](../evidence/issue-7-runtime-plaintext-trace/trace-summary.json), and all manifests are checked in.

The live snapshots report two expected read errors: Chromium held both LevelDB `LOCK` files open. The closed snapshots have no scan errors. A scan error is evidence of an unread artifact, not evidence that the artifact contains no content.

| Checkpoint | Runtime-observed result |
| --- | --- |
| Clean startup, live and closed | 100 allocated regular files while live and 110 after graceful close; no scenario canary. Joplin created the profile database, logs, internal Electron stores, window state, caches and temporary files before user content existed. |
| Note, resource and plugin | The note canary appeared in `database.sqlite` and `log.txt`; exact resource bytes appeared in `resources\<id>.txt`; the plugin canary appeared in `settings.json`, `log.txt`, and the unpacked test-plugin JavaScript below `tmp`. |
| External editing | `edit-<note-id>.md` contained the complete note canary while editing. |
| Stock Backup | `JoplinBackup\default-dev\<timestamp>\all_notebooks.jex` contained note and resource canaries. Its copied `profile\settings.json` contained the plugin canary. |
| Update check | Only `log.txt` changed in the allocated-file manifest. No updater-cache file or new content-canary location appeared. This development run did not prove the installed-build download/handoff path. |
| Renderer crash | The forced renderer crash created no allocated-file change between checkpoints. This does not negate the source-confirmed content-bearing Joplin crash JSON path for other crash classes. |
| Forced termination | `taskkill /pid <main-pid> /f /t` stopped the complete Electron tree. The immediate closed snapshot retained all four note, two resource and four plugin canary-bearing files, including the external-edit file and Backup. |
| Recovery | The normal UI reopened and the note was searchable. Startup removed `edit-<note-id>.md` and the unpacked test-plugin temporary JavaScript, reducing note/plugin hit counts by one each. SQLite created a recovery journal; the database, resource, logs, settings and Backup remained. |

### Packaged note/resource/plugin slice

Issue #37 added `NoteResourcePlugin` to the disposable Sandbox lab. The test
fixture constructs three canary values at runtime, creates the note and
resource through `joplin.data`, persists a plugin setting and `dataDir` file,
and writes a completion barrier last. Procmon was ready before application
launch. The barrier arrived with note and resource IDs, the five-process
Electron tree was force-terminated with no remaining process, and the guest
scanned 72 allocated regular files with zero errors before the Sandbox closed.

| Canary | Closed-profile allocated locations |
| --- | --- |
| Note | `<profile>\database.sqlite` |
| Resource | `<profile>\resources\<resource-id>.txt`; `<profile>\plugin-data\com.watchtower.packaged-content-trace\resource-input.txt` |
| Plugin | `<profile>\settings.json`; `<profile>\plugin-data\com.watchtower.packaged-content-trace\plugin-data.txt` |

This confirms ordinary packaged note, attachment, setting, and plugin-owned
persistence is contained by the proposed complete root-profile boundary in
this scenario. It does not yet cover the fixture's intentional writes to OS
temp/home/arbitrary paths, item `user_data`, plugin update/uninstall, resource
OCR/delete, or deleted/unallocated records.

The canary-bearing immediate post-kill paths were:

```text
<profile>\database.sqlite
<profile>\edit-<note-id>.md
<profile>\JoplinBackup\default-dev\<timestamp>\all_notebooks.jex
<profile>\JoplinBackup\default-dev\<timestamp>\profile\settings.json
<profile>\log.txt
<profile>\resources\<resource-id>.txt
<profile>\settings.json
<profile>\tmp\plugin_com.watchtower.runtime-plaintext-trace.js
```

### Architectural result

The complete Joplin root profile, its `internal` Electron session, logs, temporary/plugin-cache state, and any application-owned user-derived state must resolve inside the Watchtower Profile Vault before Joplin initialization. Protecting only SQLite or only note/resource storage would leave demonstrated plaintext copies.

| Surface | Watchtower classification and required treatment |
| --- | --- |
| Database, resources, settings, logs, internal session, plugin cache/data | `BASELINE_PROFILE_PLAINTEXT`; include in the vault. |
| External note/resource editing | `CANDIDATE_EXPLICIT_EGRESS`; allow only as a bounded, warned user action and clean up on stop/recovery. |
| Stock automatic Backup | Not allowed as background plaintext. Keep the destination inside the vault or replace it with an encrypted export before enabling it. A user-selected plaintext export is separate Explicit Plaintext Egress. |
| Crash reports and diagnostic log attachments | Not allowed to carry user content outside the vault. Disable or replace with a content-free/encrypted Watchtower path. |
| Curated plugins | Trusted profile-capable code, not sandboxed code. Admission must prohibit undisclosed outside writes and require runtime canary tracing. |
| Updater package and metadata | `OPERATIONAL_NONCONTENT` only if installed-build tracing confirms no user-derived content; later Watchtower-owned update work must re-run that trace. |
| Host home/app-data, pagefile, hibernation, indexing, antivirus, thumbnails, WER and deleted/free-space records | `CONTENT_UNKNOWN` in this development run; constrain through architecture and qualify on a disposable packaged-build VM before release. |

Within the controlled observation root, the allowed-egress review found no unclassified canary-bearing artifact. This supports the whole-profile boundary decision. It does **not** support a release claim of zero undisclosed Windows plaintext until packaged-build Procmon, OS-policy, update-download, crash-class and external-application qualification is complete.

## Windows path model

Joplin names the production desktop app `joplin-desktop`. With no override, `determineBaseAppDirs` constructs its root below the Windows user's home directory; portable, alternate-instance and explicit-profile launches use different rules ([desktop selection](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/main.ts#L39-L54), [path rules](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/determineBaseAppDirs.ts#L4-L26)).

| Launch form | Stable-source root expectation |
| --- | --- |
| Normal installed production build | `%USERPROFILE%\.config\joplin-desktop` |
| `--alt-instance-id <id>` | `%USERPROFILE%\.config\joplin-desktop-<id>` |
| Portable build | `%PORTABLE_EXECUTABLE_DIR%\JoplinProfile` |
| `--profile <absolute-path>` | The supplied path |

The default active profile is the root. Additional profiles are `<root>\profile-<id>` ([profile selection](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/profileConfig/initProfile.ts#L4-L15), [profile path rule](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/profileConfig/index.ts#L66-L80)).

Use these placeholders throughout the trace:

```text
<home>       = the test account's %USERPROFILE%
<root>       = the selected root profile
<profile>    = the active profile; equal to <root> for the default profile
<local>      = %LOCALAPPDATA%
<roaming>    = %APPDATA%
<temp>       = the process-resolved Windows temporary directory
<evidence>   = a directory on a separate evidence volume
<fixture>    = a read-only directory containing declared test inputs
```

An explicit `--profile` makes most test runs reproducible, but it is not a complete sandbox. The IPC secret is intentionally derived from the **default** profile even when another profile is selected ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L825-L840)). The legacy Electron `userData` dictionary, crash directories, Backup destination, editor state and update cache also sit outside the override.

## Stable-source artifact expectations

### Selected root and active profile

| Path or pattern | Static expectation and sensitive content | Lifecycle to measure |
| --- | --- | --- |
| `<root>\settings.json`; `<subprofile>\settings.json` | Global/local settings. Malformed JSON is moved to a timestamped `settings.json-*-invalid.bak`, duplicating its prior bytes ([settings paths](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/models/Setting.ts#L331-L383), [invalid backup](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/models/settings/FileHandler.ts#L20-L44)). | Creation, atomicity, invalid backups and forced-kill partial files. |
| `<root>\profiles.json`; `<root>\profile-<id>\` | Profile IDs and user-visible names. The default in-memory config does not require `profiles.json` to exist, so clean-start creation is a runtime question ([load/default](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/profileConfig/index.ts#L34-L67), [default config](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/profileConfig/types.ts#L15-L28)). | Default run, profile creation/switch and stale profile metadata. |
| `<profile>\database.sqlite` plus SQLite sidecars | Notes, folders, tags, resources, settings, history, search indexes and plugin values. It is opened directly after logs and directories are initialized ([startup](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/BaseApplication.ts#L708-L781)). | Exact journal/WAL/SHM/temp names, allocation, checkpointing and recovery after kill. |
| `<profile>\resources\<id>.<ext>` | Exact attachment bytes under an ID-derived name ([name/path construction](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/models/utils/resourceUtils.ts#L8-L23)). | Copy, OCR, external edit, deletion and kill residues. |
| `<profile>\resources\<id>.crypted` | Sync representation may coexist with the normal plaintext resource ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/models/Resource.ts#L237-L272)). | Do not count it as protection for the plaintext sibling. |
| `<profile>\tmp\` | Deleted and recreated during startup; subsequently available to imports, exports, OCR, plugin and rendering code ([startup lifecycle](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/BaseApplication.ts#L712-L751)). | Inspect immediately after kill and before recovery startup erases evidence. |
| `<profile>\cache\` | Created at startup; `.jpl` packages are unpacked beneath it and their manifests gain a package hash ([directory setup](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/BaseApplication.ts#L712-L748), [plugin unpack](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/PluginService.ts#L290-L321)). | Package/update/uninstall residue and plugin-controlled content. |
| `<profile>\plugin-data\<plugin-id>\` | Persistent plugin-controlled data directory ([allocation](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/PluginService.ts#L392-L398), [API contract](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/api/JoplinPlugins.ts#L65-L82)). | Install/start/update/disable/uninstall and forced kill. |
| `<root>\plugins\<plugin-id>.jpl` | Shared installed package copied at the root ([root constant](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/BaseApplication.ts#L718-L724), [copy](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/PluginService.ts#L629-L643)). | Package bytes and incomplete copy/update residue. |
| `<root>\internal\` | Persistent Electron session created by absolute path with HTTP cache disabled ([Joplin source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L206-L237), [Electron session contract](https://www.electronjs.org/docs/latest/api/session#sessionfrompathpath-options)). | Enumerate actual cookies, network state, dictionaries, local storage and related files. |
| `<root>\log-main-process.txt`; `<profile>\log.txt`; rotated logs | Main-process logging is configured in the wrapper constructor. Profile logging is configured before the database opens ([main log](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L81-L99), [profile log](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/BaseApplication.ts#L756-L781)). | Paths, plugin/error messages, content canaries and kill-time truncation. |
| `<root>\lock` | Locker is constructed before the Electron window and acquired before session/window creation ([construction](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L81-L98), [acquire/order](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L825-L866)). | Stale lock after kill and delay before successful recovery. |
| Default-root `ipc_secret_key.txt` | IPC authentication material may be outside a selected alternate/explicit profile ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L825-L840)). | Creation path, reuse, permissions and alternate/portable behavior. |
| `<root>\window-state-<env>.json` | Window geometry and state ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L240-L256)). | Clean exit versus kill. |
| `<root>\spell-checker-migration-done`; Electron `userData\Custom Dictionary.txt` | Joplin reads the legacy Electron dictionary and writes a migration marker without deleting the legacy file ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/ElectronAppWrapper.ts#L206-L235)). Electron says Windows `userData` defaults below `%APPDATA%` using the application name ([Electron paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname)). | Resolve the exact baseline path and pre-existing residue on a clean account. |

Within `database.sqlite`, v3.6.15 can duplicate a canary across canonical note title/body fields, `item_changes.before_change_item`, revisions and normalized/FTS search tables ([stable schema](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/database/types.ts#L476-L485), [notes and search projections](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/database/types.ts#L564-L640), [FTS migration](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/database/migrations/45.ts#L7-L71)). A hit count is therefore not a file count.

### Known paths beyond the selected profile

| Path or pattern | Static expectation and sensitive content | Runtime question |
| --- | --- | --- |
| `%LOCALAPPDATA%\CrashDumps\joplin_crash_dump_<time>.json` | Joplin writes a Sentry event plus up to the last 100 KB of `log.txt`; disabling upload returns `null` only **after** the local JSON write ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/bridge.ts#L70-L158)). Joplin's official Windows crash path agrees ([official documentation](https://joplinapp.org/help/apps/home_directory/#crash-report-directory)). | Exact JSON contents, native minidumps, Crashpad/Sentry support files and WER behavior with upload off/on. |
| `<home>\JoplinBackup\<profile>\...` by stock default | Joplin enables Backup on non-portable desktop, supplies `homeDir`, retains seven backups and enables per-profile folders ([stable Joplin defaults](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/defaultPlugins/desktopDefaultPluginsInfo.ts#L5-L18)). The pinned plugin appends `JoplinBackup` and the profile name ([plugin source](https://github.com/JackGruber/joplin-plugin-backup/blob/2c3da7056e7ac39c86c2051a4fdb99d9534dd0a1/src/Backup.ts#L318-L370)). | Final/partial JEX, profile copies, logs, retention moves and archive/password behavior. |
| Backup `joplin_active_backup_job\` | The pinned plugin stages in a configured export path, profile `tmp`, or destination depending on settings ([plugin source](https://github.com/JackGruber/joplin-plugin-backup/blob/2c3da7056e7ac39c86c2051a4fdb99d9534dd0a1/src/Backup.ts#L483-L510)); it exports note/resource data and copies profile configuration ([JEX stage](https://github.com/JackGruber/joplin-plugin-backup/blob/2c3da7056e7ac39c86c2051a4fdb99d9534dd0a1/src/Backup.ts#L827-L874), [profile copies](https://github.com/JackGruber/joplin-plugin-backup/blob/2c3da7056e7ac39c86c2051a4fdb99d9534dd0a1/src/Backup.ts#L1061-L1100)). | Which partial artifacts survive each kill point and whether archives are actually password-protected. |
| `<profile>\edit-<note-id>.md` and third-party editor state | Joplin serializes the complete note to Markdown, watches it and removes it on normal stop ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ExternalEditWatcher.ts#L261-L305), [write](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ExternalEditWatcher.ts#L329-L338)). | Crash residue plus editor autosave, recovery, recent-file, indexing and temporary paths. |
| `<profile>\tmp\edited_resources\<friendly-name>` and third-party application state | Joplin copies the exact resource to a friendly name and removes it on normal stop ([copy](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ResourceEditWatcher/index.ts#L234-L245), [cleanup](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/ResourceEditWatcher/index.ts#L319-L362)). | Same external-process surfaces and kill residue. |
| `%LOCALAPPDATA%\<updaterCacheDirName>\pending\` | `electron-updater` 6.6.8 derives its Windows base cache from `%LOCALAPPDATA%` ([published package](https://unpkg.com/electron-updater@6.6.8/out/AppAdapter.js)), then uses the built `app-update.yml` name and a `pending` directory ([cache construction](https://unpkg.com/electron-updater@6.6.8/out/AppUpdater.js), [pending/update-info](https://unpkg.com/electron-updater@6.6.8/out/DownloadedUpdateHelper.js)). Joplin downloads automatically and awaits the download before prompting ([stable source](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/app-desktop/services/autoUpdater/AutoUpdaterService.ts#L129-L179)). | Read `updaterCacheDirName` from the tested build; record temporary installer/package/blockmap and `update-info.json` paths rather than guessing the leaf name. |
| Windows Error Reporting and native dump paths | Windows documents `%LOCALAPPDATA%\CrashDumps` as the default `LocalDumps\DumpFolder`, but local-dump collection is policy-dependent ([Microsoft WER settings](https://learn.microsoft.com/en-us/windows/win32/wer/wer-settings#wer-settings)). | Capture the unmodified VM policy first. A separately marked WER-enabled diagnostic run is not stock-baseline behavior. |

### Plugin authority outside the profile

The trace plugin must deliberately exercise outside writes. Joplin exposes `fs-extra` to plugins ([stable API](https://github.com/laurent22/joplin/blob/c61572660382863595c6b51ccf2263e3d2c4bfce/packages/lib/services/plugins/api/Joplin.ts#L127-L143)), while `dataDir()` is a persistence convention, not a filesystem sandbox. A signed or curated plugin can therefore still create plaintext in home, temp or an arbitrary absolute path.

## Canary corpus

The checked-in development harness uses stable, non-secret issue-specific canaries so its assertions are repeatable. For disposable packaged-build qualification, use a new random run identifier for every clean VM restore as described below.

Use a new random run identifier for every clean VM restore. Use long ASCII values as the primary leak oracle because their byte representation is predictable across SQLite, logs and ordinary files. Optional Unicode companions test encoding behavior but do not replace the ASCII oracle.

```text
WT1_<RUN>_NOTE_TITLE_<RANDOM>
WT1_<RUN>_NOTE_BODY_INITIAL_<RANDOM>
WT1_<RUN>_NOTE_BODY_REPLACED_<RANDOM>
WT1_<RUN>_NOTE_BODY_DELETED_<RANDOM>
WT1_<RUN>_SOURCE_URL_<RANDOM>
WT1_<RUN>_RESOURCE_FILENAME_<RANDOM>
WT1_<RUN>_RESOURCE_BYTES_HEAD_<RANDOM>
WT1_<RUN>_RESOURCE_BYTES_TAIL_<RANDOM>
WT1_<RUN>_RESOURCE_OCR_<RANDOM>
WT1_<RUN>_PLUGIN_SETTING_<RANDOM>
WT1_<RUN>_PLUGIN_ITEM_DATA_<RANDOM>
WT1_<RUN>_PLUGIN_DATA_DIR_<RANDOM>
WT1_<RUN>_PLUGIN_INSTALL_DIR_<RANDOM>
WT1_<RUN>_PLUGIN_OS_TEMP_<RANDOM>
WT1_<RUN>_PLUGIN_HOME_<RANDOM>
WT1_<RUN>_PLUGIN_ABSOLUTE_<RANDOM>
WT1_<RUN>_CRASH_MESSAGE_<RANDOM>
```

Do not use one token for every field. Distinct values let a hit distinguish canonical content, old versions, search/history projections and actual boundary escape.

Keep source fixtures in `<fixture>\<run>\`, declare their hashes before launch and classify those pre-existing hits separately. A resource's original input file is not Joplin-created egress. For large-resource kill tests, put head and tail canaries in an otherwise deterministic file so a partial copy can be recognized.

## Trace and inspection protocol

### Environment

1. Use a disposable Windows VM and a dedicated local test account. Record Windows edition/build, filesystem, VM snapshot ID, locale, time zone, pagefile/hibernation policy, antivirus/indexing state and WER policy.
2. Install or build the exact v3.6.15 desktop artifact. Record the executable, installer and `app.asar` SHA-256 hashes, version UI, process architecture, upstream SHA and build command.
3. Before each scenario, restore the clean snapshot, create a new run ID and record manifests/hashes for every declared observation root.
4. Keep `<evidence>` outside observation roots. Procmon logs and scan results themselves contain canaries and must not be mistaken for application egress.

### Filesystem/process capture

Capture all events to a Procmon backing file, then filter during analysis by the complete Joplin process tree and any descendants such as an updater, installer, editor or crash handler. Microsoft documents that Process Monitor records filesystem, registry and process/thread activity, supports process-tree analysis and preserves all events in its native format ([Process Monitor](https://learn.microsoft.com/en-us/sysinternals/downloads/procmon), [backing-file procedure](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/troubleshoot-apps-start-failure-use-process-monitor#store-and-save-events)).

```powershell
Procmon64.exe -accepteula -backingfile <evidence>\<scenario>.pml -quiet -minimized
# Reproduce exactly one scenario.
Procmon64.exe -terminate -quiet
```

For each checkpoint:

1. Save the unfiltered PML and an exported filtered event list.
2. Save the process tree with image path, command line, parent PID, start/end time and user.
3. Snapshot created/modified paths with size, timestamps, attributes, reparse information and SHA-256 for readable regular files.
4. Scan allocated files recursively for every scenario canary. Microsoft Sysinternals Strings scans ASCII and Unicode strings, can recurse and can print file offsets ([official documentation](https://learn.microsoft.com/en-us/sysinternals/downloads/strings)).
5. Copy SQLite and any sidecars only after the process is stopped; query canonical, history and search tables in addition to raw byte scanning.
6. Record deleted/renamed operations from Procmon. If forensic free-space or NTFS-journal inspection is performed, label it separately from allocated-file results.

### Forced termination

Use the main process PID from the trace, never a broad image-name kill. `taskkill /pid <pid> /f /t` forcefully ends the selected process and its children; `/t` is the documented process-tree option ([Microsoft taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill)).

Also run targeted main-, renderer- and plugin-process kills where the scenario calls for them. Record the exact PID, process role, UTC timestamp and preceding trace event. Inspect artifacts **immediately after termination and before restart**. Only then restart and collect a second recovery snapshot; startup normally deletes `<profile>\tmp` and `edit-*`, so recovery-only inspection would erase decisive evidence.

## Extended packaged-build qualification matrix

The development trace above partially answers issue #7 at the public profile-storage seam. The following broader Procmon/VM matrix is required to complete the issue and remains the release-qualification protocol for a packaged binary; its `PENDING` rows are not claims about the completed development run.

| ID | Scenario and action | Required termination/checkpoints | Primary expected locations | Runtime status |
| --- | --- | --- | --- | --- |
| `S0` | Baseline manifest with Joplin never launched. | None. | All observation roots; fixture/evidence exclusions. | `PENDING` |
| `S1` | Fresh normal installed launch; wait for usable UI; graceful quit without user content. | UI-ready and post-quit. | Default root, Electron `userData`, local/roaming app data, temp, crash and updater roots. | `PENDING` |
| `S2` | Fresh explicit `--profile` launch. | Kill once after root/main log/IPC/lock activity but before UI; repeat after UI. Recover each clone. | Explicit root **and** default-root IPC path. | `PENDING` |
| `S3` | Fresh portable and alternate-instance launches. | Graceful quit plus one post-UI tree kill for each form. | Portable/alternate root, default IPC path, Electron app data. | `PENDING` |
| `N1` | Create a note with distinct title/body/source URL; replace the body; wait for revision collection; exact and fuzzy search; delete note. | Snapshot after create, replace, history/search and delete; kill during repeated large-body saves; recover. | Database and sidecars, logs, temp, internal session. | `PARTIAL` — issue #37 proved packaged create/barrier/forced-kill persistence; replace/history/search/delete/recovery remain. |
| `R1` | Attach deterministic text, image and OCR-able document fixtures with unique filenames/content; view, OCR and delete them. | Snapshot after attach/OCR/delete; kill during repeated large-resource import and OCR; recover. | Database, resources, temp, cache, logs. | `PARTIAL` — issue #37 proved one packaged text resource create/barrier/forced-kill persistence; image/OCR/delete/recovery remain. |
| `P1` | Install/start a purpose-built trace plugin. Write separate canaries to a plugin setting, item `user_data`, `dataDir`, installation dir, OS temp, home and a declared arbitrary path. | Kill after a plugin barrier before/after each durable write; recover. | Root plugins, profile cache/plugin-data/database plus every intentional outside target. | `PARTIAL` — issue #37 proved packaged auto-start, setting, `dataDir`, barrier, and forced-kill persistence; `user_data`, outside writes, per-transition kills, and recovery remain. |
| `P2` | Update, disable and uninstall the trace plugin. | Snapshot after each state; kill during package update/copy. | Root plugins, cache, plugin-data, database and logs. | `PENDING` |
| `B1` | Invoke the bundled Backup manually with stock defaults. | Snapshot while `joplin_active_backup_job` exists, after completion and after graceful exit; kill during JEX export and final move; recover. | Home `JoplinBackup`, active-job stage, profile temp, plugin/database settings and logs. | `PENDING` |
| `B2` | Repeat Backup with password/archive enabled and a declared custom export path. | Kill during staging, archive creation and final rename/move; recover; verify archive listing/content with and without the password. | Custom stage/destination, profile temp, partial/final 7z and logs. | `PENDING` |
| `E1` | Start external editing for a canary note, save from the editor, then stop cleanly. | While open, after clean stop and after both processes exit. | Profile `edit-*`, editor temp/recovery/recent paths, database and logs. | `PENDING` |
| `E2` | Open/edit a canary attachment externally. | While open, clean stop, kill Joplin only, kill editor only and tree kill on separate clones; recover. | `tmp\edited_resources`, resources, editor/OS state. | `PENDING` |
| `C1` | Controlled renderer exception containing the crash canary with crash upload disabled, while a canary note/resource is open. | After crash handling and exit. | Joplin logs/JSON, Electron/Sentry/Crashpad and WER paths. | `PENDING` |
| `C2` | Controlled main-process crash with upload disabled, then a separate consented run with upload enabled. | Capture local files and network destinations/payload metadata; do not include credentials in evidence. | Same as `C1`, plus network trace. | `PENDING` |
| `U1` | From installed v3.6.15, trigger official update check/download in a disposable VM; record target version/assets and decline installation on the first clone. | Kill during partial download and after download-ready prompt on separate clones. | Resolved updater cache, temp, logs and process descendants. | `PENDING` |
| `U2` | Allow the recorded official update to hand off/install and launch the target once with the populated canary profile. | Kill during installer handoff and first post-update profile migration on separate disposable clones; recover. | Updater cache, installer temp/logs, install tree and complete profile. | `PENDING` |

If no official update is available, record `BLOCKED_BY_CHANNEL_STATE`; do not silently substitute a modified binary. A controlled mirror or test-channel build may supplement the result, but must be labeled non-baseline evidence.

## Packaged-build scenario evidence record

Copy this record under each extended qualification scenario when evidence is collected:

```yaml
scenario_id: PENDING
run_id: PENDING
vm_snapshot_before: PENDING
windows_build_and_policy: PENDING
joplin_version_ui: PENDING
upstream_sha: c61572660382863595c6b51ccf2263e3d2c4bfce
binary_and_asar_sha256: PENDING
plugin_or_update_fixture_sha: PENDING_OR_NOT_APPLICABLE
launch_command: PENDING
termination:
  kind: graceful_or_forced_or_crash
  process_role_and_pid: PENDING
  checkpoint_and_utc_time: PENDING
evidence:
  procmon_pml: PENDING
  process_tree: PENDING
  before_manifest: PENDING
  immediate_after_manifest: PENDING
  recovery_after_manifest: PENDING
  allocated_file_canary_scan: PENDING
  sqlite_query_results: PENDING
  network_capture_or_not_applicable: PENDING
observed_created_or_modified_paths: PENDING
canary_hits:
  fixture_or_preexisting: PENDING
  selected_profile: PENDING
  outside_selected_profile: PENDING
  deleted_or_renamed_only: PENDING
unexpected_hits: PENDING
recovery_outcome_and_database_integrity: PENDING
proposed_egress_classification: PENDING
limitations: PENDING
reviewer_and_date: PENDING
```

## Egress classification to apply to every hit

| Classification | Meaning | Static candidates |
| --- | --- | --- |
| `FIXTURE_OR_PREEXISTING` | Declared input or bytes present before Joplin launched. | Original attachment and plugin fixtures. |
| `BASELINE_PROFILE_PLAINTEXT` | Stock Joplin persistent plaintext inside `<root>`/`<profile>`. It proves the footprint but is intended to fall inside the future Watchtower Profile Vault. | Database, resources, settings, logs, internal session, plugin data, temp residue. |
| `CANDIDATE_EXPLICIT_EGRESS` | A bounded, user-initiated copy whose future Watchtower UI can disclose and authorize. | External note/resource editing and user-selected exports. |
| `OPERATIONAL_NONCONTENT` | Required operational artifact that contains no user-derived content canary. | Lock, updater installer/package, update metadata. |
| `UNDISCLOSED_EXTERNAL_PLAINTEXT` | Background or failure-path content outside the protected root; not an acceptable v1 exception. | Stock Backup, crash/log attachments, plugin outside writes, unexpected updater/editor/OS copies. |
| `CONTENT_UNKNOWN` | Raw scan is insufficient or content could not be read/decoded. | Minidumps, compressed archives, locked files and deleted records. |

Candidate explicit egress is not automatically allowed. [CONTEXT.md](../../CONTEXT.md) requires a bounded user action and clear warning. Background Backup, crash reporting and plugin behavior do not meet that definition.

## Packaged-build release gate

Watchtower One should not make a release-level zero-undisclosed-plaintext claim until all of the following are true:

- Each matrix row is completed, explicitly blocked with evidence, or removed by an accepted scope decision.
- Every observed create/write/rename/delete beyond `<root>` has an owner and classification.
- Every canary hit is tied to an artifact, lifecycle, scenario and immediate-versus-recovery snapshot.
- Normal exit and forced termination results are compared; recovery startup is not used to hide kill residue.
- Backup archives and crash/update artifacts are inspected beyond filename extensions.
- The allowed-egress list is reviewed against Watchtower's invariants.
- The report states tool blind spots, VM/OS policy assumptions and whether deleted/free-space, pagefile, hibernation, antivirus, indexing, thumbnails and editor recovery were examined.

Only then can packaged-build evidence support a Windows-wide zero-**undisclosed**-persistent-plaintext assertion. The checked-in partial development trace already constrains the whole-profile encryption prototype, but it does not replace this release gate.
