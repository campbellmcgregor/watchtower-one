[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $ApplicationPath,

	[Parameter(Mandatory = $true)]
	[string] $ProcmonPath,

	[Parameter(Mandatory = $true)]
	[string] $EvidencePath,

	[Parameter(Mandatory = $true)]
	[string] $LabPath,

	[ValidateSet('Smoke')]
	[string] $Mode = 'Smoke',

	[ValidateRange(10, 600)]
	[int] $ResultTimeoutSeconds = 120,

	[switch] $KeepOpen,

	[switch] $PrepareOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-LeafPath {
	param(
		[Parameter(Mandatory = $true)]
		[string] $LiteralPath,

		[Parameter(Mandatory = $true)]
		[string] $Description
	)

	$item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
	if ($item.PSIsContainer) {
		throw "$Description must be a file: $LiteralPath"
	}
	return $item.FullName
}

function Resolve-DirectoryPath {
	param(
		[Parameter(Mandatory = $true)]
		[string] $LiteralPath,

		[Parameter(Mandatory = $true)]
		[string] $Description
	)

	$item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
	if (-not $item.PSIsContainer) {
		throw "$Description must be a directory: $LiteralPath"
	}
	return $item.FullName
}

function Escape-Xml {
	param([Parameter(Mandatory = $true)][string] $Value)
	return [System.Security.SecurityElement]::Escape($Value)
}

function Quote-WindowsCommandArgument {
	param([Parameter(Mandatory = $true)][string] $Value)
	if ($Value.Contains('"')) {
		throw 'Windows command arguments must not contain a double quote'
	}
	return '"' + $Value + '"'
}

function Test-PathOverlap {
	param(
		[Parameter(Mandatory = $true)]
		[string] $Left,

		[Parameter(Mandatory = $true)]
		[string] $Right
	)

	$leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd('\', '/')
	$rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd('\', '/')
	$comparison = [System.StringComparison]::OrdinalIgnoreCase
	return (
		$leftPath.Equals($rightPath, $comparison) -or
		$leftPath.StartsWith($rightPath + '\', $comparison) -or
		$rightPath.StartsWith($leftPath + '\', $comparison)
	)
}

$resolvedApplication = Resolve-LeafPath -LiteralPath $ApplicationPath -Description 'ApplicationPath'
$resolvedProcmon = Resolve-LeafPath -LiteralPath $ProcmonPath -Description 'ProcmonPath'
$resolvedEvidence = Resolve-DirectoryPath -LiteralPath $EvidencePath -Description 'EvidencePath'
$guestRunnerPath = Resolve-LeafPath `
	-LiteralPath (Join-Path $PSScriptRoot 'Invoke-WatchtowerSandboxTrace.ps1') `
	-Description 'Sandbox guest runner'

$applicationDirectory = Split-Path -Parent $resolvedApplication
$procmonDirectory = Split-Path -Parent $resolvedProcmon
$prospectiveLab = [System.IO.Path]::GetFullPath($LabPath)
foreach ($readOnlyInput in @($applicationDirectory, $procmonDirectory, $PSScriptRoot)) {
	if (Test-PathOverlap -Left $resolvedEvidence -Right $readOnlyInput) {
		throw "EvidencePath must not overlap a read-only input: $readOnlyInput"
	}
	if (Test-PathOverlap -Left $prospectiveLab -Right $readOnlyInput) {
		throw "LabPath must not overlap a read-only input: $readOnlyInput"
	}
}
if (Test-PathOverlap -Left $prospectiveLab -Right $resolvedEvidence) {
	throw "LabPath must not overlap EvidencePath: $resolvedEvidence"
}

if (Test-Path -LiteralPath $LabPath) {
	$resolvedLab = Resolve-DirectoryPath -LiteralPath $LabPath -Description 'LabPath'
	if (Get-ChildItem -LiteralPath $resolvedLab -Force | Select-Object -First 1) {
		throw "LabPath must be empty: $resolvedLab"
	}
} else {
	$resolvedLab = (New-Item -ItemType Directory -Path $LabPath -ErrorAction Stop).FullName
}

$applicationSandboxPath = 'C:\WatchtowerInput\Application\' + (Split-Path -Leaf $resolvedApplication)
$procmonSandboxPath = 'C:\WatchtowerInput\Tools\' + (Split-Path -Leaf $resolvedProcmon)
$guestRunnerSandboxPath = 'C:\WatchtowerInput\Harness\Invoke-WatchtowerSandboxTrace.ps1'

$guestCommand = @(
	'powershell.exe'
	'-NoProfile'
	'-ExecutionPolicy Bypass'
	'-File ' + (Quote-WindowsCommandArgument $guestRunnerSandboxPath)
	'-ApplicationPath ' + (Quote-WindowsCommandArgument $applicationSandboxPath)
	'-ProcmonPath ' + (Quote-WindowsCommandArgument $procmonSandboxPath)
	'-EvidencePath ' + (Quote-WindowsCommandArgument 'C:\WatchtowerEvidence')
	'-Mode ' + (Quote-WindowsCommandArgument $Mode)
) -join ' '
if (-not $KeepOpen) {
	$guestCommand += ' -CloseWhenFinished'
}

$configuration = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$(Escape-Xml $applicationDirectory)</HostFolder>
      <SandboxFolder>C:\WatchtowerInput\Application</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$(Escape-Xml $procmonDirectory)</HostFolder>
      <SandboxFolder>C:\WatchtowerInput\Tools</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$(Escape-Xml $PSScriptRoot)</HostFolder>
      <SandboxFolder>C:\WatchtowerInput\Harness</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$(Escape-Xml $resolvedEvidence)</HostFolder>
      <SandboxFolder>C:\WatchtowerEvidence</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <ProtectedClient>Enable</ProtectedClient>
  <MemoryInMB>3072</MemoryInMB>
  <LogonCommand>
    <Command>$(Escape-Xml $guestCommand)</Command>
  </LogonCommand>
</Configuration>
"@

$configurationPath = Join-Path $resolvedLab 'WatchtowerTraceLab.wsb'
[System.IO.File]::WriteAllText(
	$configurationPath,
	$configuration,
	[System.Text.UTF8Encoding]::new($false)
)

$launchRecord = [ordered]@{
	schemaVersion = 1
	mode = $Mode
	launched = $false
	resultObserved = $false
	sandboxClientClosed = $false
	configurationPath = $configurationPath
	evidencePath = $resolvedEvidence
	application = [ordered]@{
		path = $resolvedApplication
		sha256 = (Get-FileHash -LiteralPath $resolvedApplication -Algorithm SHA256).Hash.ToLowerInvariant()
	}
	procmon = [ordered]@{
		path = $resolvedProcmon
		sha256 = (Get-FileHash -LiteralPath $resolvedProcmon -Algorithm SHA256).Hash.ToLowerInvariant()
	}
	harness = [ordered]@{
		path = $PSScriptRoot
		sha256 = (Get-FileHash -LiteralPath $guestRunnerPath -Algorithm SHA256).Hash.ToLowerInvariant()
	}
}

$resultPath = Join-Path $resolvedEvidence 'sandbox-result.json'
if (-not $PrepareOnly -and (Test-Path -LiteralPath $resultPath)) {
	throw "EvidencePath already contains sandbox-result.json: $resolvedEvidence"
}

if (-not $PrepareOnly) {
	$existingSandboxClientIds = @(
		Get-Process -Name 'WindowsSandboxRemoteSession' -ErrorAction SilentlyContinue |
			ForEach-Object Id
	)
	Start-Process -FilePath $configurationPath | Out-Null
	$launchRecord.launched = $true
	$startedLaunchJson = $launchRecord | ConvertTo-Json -Depth 4
	[System.IO.File]::WriteAllText(
		(Join-Path $resolvedEvidence 'sandbox-launch.json'),
		($startedLaunchJson + [Environment]::NewLine),
		[System.Text.UTF8Encoding]::new($false)
	)

	if (-not $KeepOpen) {
		$deadline = (Get-Date).AddSeconds($ResultTimeoutSeconds)
		while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $resultPath)) {
			Start-Sleep -Seconds 1
		}
		if (-not (Test-Path -LiteralPath $resultPath)) {
			throw "Sandbox did not return a result within $ResultTimeoutSeconds seconds: $resultPath"
		}

		$guestResult = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
		$launchRecord.resultObserved = $true
		if ($guestResult.status -ne 'passed') {
			$failedLaunchJson = $launchRecord | ConvertTo-Json -Depth 4
			[System.IO.File]::WriteAllText(
				(Join-Path $resolvedEvidence 'sandbox-launch.json'),
				($failedLaunchJson + [Environment]::NewLine),
				[System.Text.UTF8Encoding]::new($false)
			)
			throw "Sandbox reported status '$($guestResult.status)'; the client remains open for diagnosis"
		}

		$newSandboxClients = @(
			Get-Process -Name 'WindowsSandboxRemoteSession' -ErrorAction SilentlyContinue |
				Where-Object { $_.Id -notin $existingSandboxClientIds }
		)
		foreach ($sandboxClient in $newSandboxClients) {
			Stop-Process -Id $sandboxClient.Id -Force -ErrorAction Stop
		}
		$launchRecord.sandboxClientClosed = $true
	}
}

$launchJson = $launchRecord | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
	(Join-Path $resolvedEvidence 'sandbox-launch.json'),
	($launchJson + [Environment]::NewLine),
	[System.Text.UTF8Encoding]::new($false)
)
$launchJson
