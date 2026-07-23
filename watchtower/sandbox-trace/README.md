<!-- cspell:ignore handoff Procmon Sysinternals WDAG -->

# Disposable Windows Sandbox trace lab

Status: the containment smoke layer is implemented and proven for issue
[#30](https://github.com/campbellmcgregor/watchtower-one/issues/30). The
packaged v3.6.15 Procmon scenario matrix remains open under that issue and
parent issue [#7](https://github.com/campbellmcgregor/watchtower-one/issues/7).

This lab provides a fresh Windows Sandbox without requiring a maintained
Windows VM. It maps the selected application and Procmon folders read-only,
maps one host evidence folder writable, disables networking and host-device
redirection, assigns 3 GB memory, and runs as `WDAGUtilityAccount`.

Smoke mode does not execute the selected application or Procmon binary. It
verifies the containment controls and hashes the exact files that would enter
the later packaged trace. The launcher rejects `Trace` until Procmon lifecycle,
packaged-app scenarios, and evidence sanitisation are implemented and tested.

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

## Outputs

- `<evidence>\sandbox-launch.json`: host-resolved input paths and SHA-256
  hashes, configuration path, mode, and launch state.
- `<evidence>\sandbox-result.json`: guest-observed account, mappings,
  networking, memory, and independently calculated input hashes.
- `<lab>\WatchtowerTraceLab.wsb`: the generated disposable configuration.

Raw Procmon logs and canary-bearing evidence must remain outside source
control. Only reviewed, path-sanitised summaries may be checked in.

## Current evidence boundary

The checked-in smoke result proves Sandbox containment and host evidence
handoff. It does not inspect a packaged application, start Procmon, cover
deleted artifacts, or complete issue #7. Those claims remain blocked until the
full scenario matrix in
[`docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md`](../../docs/research/joplin-v3.6.15-windows-runtime-plaintext-footprint.md)
has run against the pinned packaged baseline.
