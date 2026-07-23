<!-- cspell:ignore Authenticode handoff Procmon Sysinternals WDAG -->

# Disposable Windows Sandbox trace lab

Status: the containment smoke layer is proven for issue
[#30](https://github.com/campbellmcgregor/watchtower-one/issues/30), and the
packaged v3.6.15 clean-start Procmon slice is proven for issue
[#33](https://github.com/campbellmcgregor/watchtower-one/issues/33). The
packaged note/resource/plugin persistence slice is proven for issue
[#37](https://github.com/campbellmcgregor/watchtower-one/issues/37). The
remaining packaged scenario matrix stays open under issue
[#30](https://github.com/campbellmcgregor/watchtower-one/issues/30) and parent
issue [#7](https://github.com/campbellmcgregor/watchtower-one/issues/7).

This lab provides a fresh Windows Sandbox without requiring a maintained
Windows VM. It maps the selected application and Procmon folders read-only,
maps one host evidence folder writable, disables networking and host-device
redirection, assigns 3 GB memory, and runs as `WDAGUtilityAccount`.

Smoke mode does not execute the selected application or Procmon binary. It
verifies the containment controls and hashes the exact files that would enter
a packaged trace.

Trace mode additionally requires caller-supplied SHA-256 values for both
inputs and an Authenticode-valid Microsoft Sysinternals Procmon executable.
Procmon starts and must create a non-empty backing capture before the packaged
application launches. The application runs against a disposable explicit
profile for a bounded duration. The `NoteResourcePlugin` scenario installs an
immutable test plugin into that profile; the plugin creates a note, resource,
setting, and plugin-owned file through public Joplin APIs, then writes a
completion barrier. Only the recorded application PID tree is force-terminated.
Procmon then stops through its own CLI. A closed-profile scanner records file
hashes and UTF-8/UTF-16LE canary locations without copying canary values into
the manifest. The host independently verifies the guest input, fixture, PML,
and artifact-manifest hashes before closing the exact new Windows Sandbox
client processes.

## Requirements

- Windows Sandbox enabled on a supported Windows edition.
- Hardware virtualisation available to Windows.
- An explicit packaged application executable.
- An explicit official Sysinternals Procmon executable. The repository does
  not bundle or redistribute Procmon.
- An existing, dedicated host evidence directory outside every mapped input.
- A new or empty host lab directory.

## Run the containment smoke

Run from the repository root in PowerShell:

```powershell
$evidence = New-Item -ItemType Directory -Path 'C:\tmp\watchtower-sandbox-evidence'
.\watchtower\sandbox-trace\Launch-WatchtowerTraceLab.ps1 `
    -ApplicationPath 'C:\path\to\packaged\Joplin.exe' `
    -ProcmonPath 'C:\path\to\Sysinternals\Procmon64.exe' `
    -EvidencePath $evidence.FullName `
    -LabPath 'C:\tmp\watchtower-sandbox-lab' `
    -Mode Smoke
```

The passing Sandbox closes automatically. Use `-KeepOpen` only for diagnosis.
Use `-PrepareOnly` to generate and inspect the `.wsb` without launching it.

## Run the packaged clean-start trace

Build the pinned x64 directory artifact, acquire Procmon from the official
[Microsoft Sysinternals download](https://learn.microsoft.com/sysinternals/downloads/procmon),
and calculate both executable hashes before launch:

```powershell
corepack yarn workspace @joplin/app-desktop dist --win --x64 --dir
$application = Resolve-Path '.\packages\app-desktop\dist\win-unpacked\Joplin.exe'
$procmon = Resolve-Path 'C:\path\to\Sysinternals\Procmon64.exe'
$applicationSha = (Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash
$procmonSha = (Get-FileHash -LiteralPath $procmon -Algorithm SHA256).Hash

.\watchtower\sandbox-trace\Launch-WatchtowerTraceLab.ps1 `
    -ApplicationPath $application `
    -ProcmonPath $procmon `
    -EvidencePath 'C:\path\to\new-evidence-directory' `
    -LabPath 'C:\path\to\new-lab-directory' `
    -Mode Trace `
    -TraceDurationSeconds 30 `
    -ExpectedApplicationSha256 $applicationSha `
    -ExpectedProcmonSha256 $procmonSha `
    -ResultTimeoutSeconds 180
```

For the bounded content-bearing scenario, add:

```powershell
    -Scenario NoteResourcePlugin `
    -TraceDurationSeconds 60
```

`TraceDurationSeconds` is the maximum completion-barrier wait for this
scenario. The guest fails closed if the packaged application exits, the
fixture reports failure, the barrier is absent, any required canary is absent,
or an allocated file cannot be scanned.

Use a new evidence and lab directory for every run. Trace mode refuses a
pre-existing result or PML instead of overwriting evidence.

## Outputs

- `<evidence>\sandbox-launch.json`: host-resolved input paths and SHA-256
  hashes, Procmon publisher verification, host/guest hash agreement,
  configuration path, mode, and launch/closure state.
- `<evidence>\sandbox-result.json`: guest-observed account, mappings,
  networking, memory, independently calculated input hashes, exact process
  termination, Procmon PID/readiness, and capture lifecycle.
- `<evidence>\<scenario>.pml`: raw native Procmon capture in Trace mode.
- `<evidence>\note-resource-plugin-artifact-manifest.json`: allocated regular
  files, sizes, hashes, and canary IDs/encodings for the content scenario.
- `<lab>\WatchtowerTraceLab.wsb`: the generated disposable configuration.

Raw Procmon logs and canary-bearing evidence must remain outside source
control. Only reviewed, path-sanitised summaries may be checked in.

## Current evidence boundary

The checked-in summaries prove Sandbox containment, one bounded packaged
clean-start capture, and one packaged note/resource/plugin capture with a
durable completion barrier, exact process-tree termination, closed-profile
allocated-file canary scanning, and evidence handoff. They do not analyze PML
events, cover deleted/unallocated artifacts, exercise plugin writes outside
the selected profile, or complete issue #7. Those claims remain blocked until
the full scenario matrix in
[`docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md`](../../docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md)
has run against the pinned packaged baseline.
