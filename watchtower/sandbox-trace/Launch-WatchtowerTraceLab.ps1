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

	[ValidateSet('Smoke', 'Trace')]
	[string] $Mode = 'Smoke',

	[ValidateSet('CleanStartup', 'NoteResourcePlugin')]
	[string] $Scenario = 'CleanStartup',

	[ValidateRange(10, 120)]
	[int] $TraceDurationSeconds = 30,

	[ValidatePattern('^[0-9a-fA-F]{64}$')]
	[string] $ExpectedApplicationSha256,

	[ValidatePattern('^[0-9a-fA-F]{64}$')]
	[string] $ExpectedProcmonSha256,

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

function Write-LaunchRecord {
	param(
		[Parameter(Mandatory = $true)]
		[object] $Record,

		[Parameter(Mandatory = $true)]
		[string] $EvidenceDirectory
	)

	$json = $Record | ConvertTo-Json -Depth 8
	[System.IO.File]::WriteAllText(
		(Join-Path $EvidenceDirectory 'sandbox-launch.json'),
		($json + [Environment]::NewLine),
		[System.Text.UTF8Encoding]::new($false)
	)
	return $json
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

function Get-DirectoryEvidence {
	param([Parameter(Mandatory = $true)][string] $LiteralPath)

	$root = Resolve-DirectoryPath -LiteralPath $LiteralPath -Description 'Scenario fixture'
	$files = @(
		Get-ChildItem -LiteralPath $root -File -Recurse |
			Sort-Object FullName |
			ForEach-Object {
				[ordered]@{
					path = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
					sizeBytes = $_.Length
					sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
				}
			}
	)
	$directoryRecord = @(
		$files | ForEach-Object { "$($_.path)`n$($_.sizeBytes)`n$($_.sha256)" }
	) -join "`n"
	$sha256 = [System.Security.Cryptography.SHA256]::Create()
	try {
		$directoryHash = [System.BitConverter]::ToString(
			$sha256.ComputeHash([System.Text.UTF8Encoding]::new($false).GetBytes($directoryRecord))
		).Replace('-', '').ToLowerInvariant()
	} finally {
		$sha256.Dispose()
	}

	return [ordered]@{
		path = $root
		directorySha256 = $directoryHash
		files = $files
	}
}

function Get-TrustedProcmonMetadata {
	param([Parameter(Mandatory = $true)][string] $LiteralPath)

	$item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
	$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
	$signer = $signature.SignerCertificate
	$version = $item.VersionInfo
	$trusted = (
		$signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and
		$null -ne $signer -and
		$signer.Subject -match '(^|, )O=Microsoft Corporation(,|$)' -and
		$version.ProductName -eq 'Sysinternals Procmon' -and
		$version.CompanyName -eq 'Sysinternals - www.sysinternals.com' -and
		-not [string]::IsNullOrWhiteSpace($version.FileVersion)
	)
	if (-not $trusted) {
		throw 'Trace mode requires an Authenticode-valid Microsoft Sysinternals Procmon executable'
	}

	return [ordered]@{
		verified = $true
		signatureStatus = $signature.Status.ToString()
		signerSubject = $signer.Subject
		signerThumbprint = $signer.Thumbprint
		productName = $version.ProductName
		companyName = $version.CompanyName
		fileVersion = $version.FileVersion
	}
}

function Get-WindowsSandboxClientProcesses {
	$processNames = @(
		'WindowsSandbox',
		'WindowsSandboxClient',
		'WindowsSandboxRemoteSession'
	)
	return @(
		Get-Process -Name $processNames -ErrorAction SilentlyContinue
	)
}

function Wait-ForProcessIdsExit {
	param(
		[Parameter(Mandatory = $true)]
		[int[]] $ProcessIds,

		[ValidateRange(1, 30)]
		[int] $TimeoutSeconds = 10
	)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	do {
		$remainingProcessIds = @(
			$ProcessIds |
				Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) }
		)
		if ($remainingProcessIds.Count -eq 0) {
			break
		}
		Start-Sleep -Milliseconds 250
	} while ((Get-Date) -lt $deadline)
	return @($remainingProcessIds)
}

$resolvedApplication = Resolve-LeafPath -LiteralPath $ApplicationPath -Description 'ApplicationPath'
$resolvedProcmon = Resolve-LeafPath -LiteralPath $ProcmonPath -Description 'ProcmonPath'
$resolvedEvidence = Resolve-DirectoryPath -LiteralPath $EvidencePath -Description 'EvidencePath'
$applicationSha256 = (Get-FileHash -LiteralPath $resolvedApplication -Algorithm SHA256).Hash.ToLowerInvariant()
$procmonSha256 = (Get-FileHash -LiteralPath $resolvedProcmon -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Mode -eq 'Trace') {
	if ([string]::IsNullOrWhiteSpace($ExpectedApplicationSha256)) {
		throw 'ExpectedApplicationSha256 is required in Trace mode'
	}
	if ([string]::IsNullOrWhiteSpace($ExpectedProcmonSha256)) {
		throw 'ExpectedProcmonSha256 is required in Trace mode'
	}
	if ($applicationSha256 -ne $ExpectedApplicationSha256.ToLowerInvariant()) {
		throw "ApplicationPath SHA-256 does not match ExpectedApplicationSha256: $applicationSha256"
	}
	if ($procmonSha256 -ne $ExpectedProcmonSha256.ToLowerInvariant()) {
		throw "ProcmonPath SHA-256 does not match ExpectedProcmonSha256: $procmonSha256"
	}
}
$procmonTrust = $null
if ($Mode -eq 'Trace' -and -not $PrepareOnly) {
	$procmonTrust = Get-TrustedProcmonMetadata -LiteralPath $resolvedProcmon
}
if ($Mode -eq 'Trace' -and -not $KeepOpen -and $ResultTimeoutSeconds -le ($TraceDurationSeconds + 60)) {
	throw 'ResultTimeoutSeconds must allow more than 60 seconds beyond TraceDurationSeconds'
}
$guestRunnerPath = Resolve-LeafPath `
	-LiteralPath (Join-Path $PSScriptRoot 'Invoke-WatchtowerSandboxTrace.ps1') `
	-Description 'Sandbox guest runner'
$artifactScannerPath = Resolve-LeafPath `
	-LiteralPath (Join-Path $PSScriptRoot 'Get-WatchtowerSandboxArtifactManifest.ps1') `
	-Description 'Sandbox artifact scanner'
$scenarioId = if ($Scenario -eq 'NoteResourcePlugin') { 'note-resource-plugin' } else { 'clean-startup' }
$fixture = $null
if ($Scenario -eq 'NoteResourcePlugin') {
	$fixture = Get-DirectoryEvidence `
		-LiteralPath (Join-Path $PSScriptRoot 'fixtures\content-canary-plugin')
}

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
	'-Scenario ' + (Quote-WindowsCommandArgument $Scenario)
	'-TraceDurationSeconds ' + $TraceDurationSeconds
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
	schemaVersion = 2
	mode = $Mode
	scenarioId = $scenarioId
	traceDurationSeconds = $TraceDurationSeconds
	launched = $false
	resultObserved = $false
	sandboxClientClosed = $false
	remainingSandboxClientProcessIds = @()
	observedSandboxClientProcessIds = @()
	sandboxLaunchProcessId = $null
	guestHashAgreement = $null
	traceEvidence = $null
	configurationPath = $configurationPath
	evidencePath = $resolvedEvidence
	application = [ordered]@{
		path = $resolvedApplication
		sha256 = $applicationSha256
		verifiedAgainstExpectedHash = $Mode -eq 'Trace'
	}
	procmon = [ordered]@{
		path = $resolvedProcmon
		sha256 = $procmonSha256
		verifiedAgainstExpectedHash = $Mode -eq 'Trace'
		publisherTrust = $procmonTrust
	}
	harness = [ordered]@{
		path = $PSScriptRoot
		runnerSha256 = (Get-FileHash -LiteralPath $guestRunnerPath -Algorithm SHA256).Hash.ToLowerInvariant()
		artifactScannerSha256 = (
			Get-FileHash -LiteralPath $artifactScannerPath -Algorithm SHA256
		).Hash.ToLowerInvariant()
	}
	fixture = $fixture
}

$resultPath = Join-Path $resolvedEvidence 'sandbox-result.json'
if (-not $PrepareOnly -and (Test-Path -LiteralPath $resultPath)) {
	throw "EvidencePath already contains sandbox-result.json: $resolvedEvidence"
}

if (-not $PrepareOnly) {
	$existingSandboxClientIds = @(
		Get-WindowsSandboxClientProcesses |
			ForEach-Object Id
	)
	$sandboxLaunchProcess = Start-Process -FilePath $configurationPath -PassThru
	$launchRecord.sandboxLaunchProcessId = $sandboxLaunchProcess.Id
	$launchRecord.launched = $true
	Write-LaunchRecord -Record $launchRecord -EvidenceDirectory $resolvedEvidence | Out-Null

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
		$launchRecord.guestHashAgreement = [ordered]@{
			application = $guestResult.application.sha256 -eq $launchRecord.application.sha256
			procmon = $guestResult.procmon.sha256 -eq $launchRecord.procmon.sha256
			harnessRunner = $guestResult.harness.runnerSha256 -eq $launchRecord.harness.runnerSha256
			artifactScanner = (
				$guestResult.harness.artifactScannerSha256 -eq
				$launchRecord.harness.artifactScannerSha256
			)
			fixture = (
				$Scenario -eq 'CleanStartup' -or
				$guestResult.trace.fixture.directorySha256 -eq $launchRecord.fixture.directorySha256
			)
		}
		$guestContractValid = (
			$guestResult.schemaVersion -eq 2 -and
			$guestResult.mode -eq $Mode -and
			($Mode -eq 'Smoke' -or $guestResult.trace.scenarioId -eq $scenarioId) -and
			$launchRecord.guestHashAgreement.application -and
			$launchRecord.guestHashAgreement.procmon -and
			$launchRecord.guestHashAgreement.harnessRunner -and
			$launchRecord.guestHashAgreement.artifactScanner -and
			$launchRecord.guestHashAgreement.fixture
		)
		if (-not $guestContractValid) {
			Write-LaunchRecord -Record $launchRecord -EvidenceDirectory $resolvedEvidence | Out-Null
			throw 'Sandbox result contract or host/guest input hash agreement failed; the client remains open for diagnosis'
		}
		if ($guestResult.status -ne 'passed') {
			Write-LaunchRecord -Record $launchRecord -EvidenceDirectory $resolvedEvidence | Out-Null
			throw "Sandbox reported status '$($guestResult.status)'; the client remains open for diagnosis"
		}

		if ($Mode -eq 'Trace') {
			$pmlFileName = [string] $guestResult.trace.pml.fileName
			if (
				[string]::IsNullOrWhiteSpace($pmlFileName) -or
				[System.IO.Path]::GetFileName($pmlFileName) -ne $pmlFileName
			) {
				throw 'Sandbox Trace result did not provide a safe PML file name'
			}
			$hostPmlPath = Join-Path $resolvedEvidence $pmlFileName
			$hostPml = Get-Item -LiteralPath $hostPmlPath -ErrorAction Stop
			$hostPmlSha256 = (Get-FileHash -LiteralPath $hostPml.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
			$launchRecord.traceEvidence = [ordered]@{
				pmlPath = $hostPml.FullName
				sizeBytes = $hostPml.Length
				sha256 = $hostPmlSha256
				guestHashAgreement = (
					$hostPmlSha256 -eq $guestResult.trace.pml.sha256 -and
					$hostPml.Length -eq $guestResult.trace.pml.sizeBytes
				)
			}
			if (-not $launchRecord.traceEvidence.guestHashAgreement) {
				throw 'Host and guest PML evidence hashes or sizes do not agree'
			}

			if ($Scenario -eq 'NoteResourcePlugin') {
				$artifactManifestFileName = [string] $guestResult.trace.artifactManifest.fileName
				if (
					[string]::IsNullOrWhiteSpace($artifactManifestFileName) -or
					[System.IO.Path]::GetFileName($artifactManifestFileName) -ne $artifactManifestFileName
				) {
					throw 'Sandbox Trace result did not provide a safe artifact manifest file name'
				}
				$hostArtifactManifestPath = Join-Path $resolvedEvidence $artifactManifestFileName
				$hostArtifactManifest = Get-Item -LiteralPath $hostArtifactManifestPath -ErrorAction Stop
				$hostArtifactManifestSha256 = (
					Get-FileHash -LiteralPath $hostArtifactManifest.FullName -Algorithm SHA256
				).Hash.ToLowerInvariant()
				$artifactManifestAgreement = (
					$hostArtifactManifestSha256 -eq $guestResult.trace.artifactManifest.sha256 -and
					$hostArtifactManifest.Length -eq $guestResult.trace.artifactManifest.sizeBytes
				)
				$launchRecord.traceEvidence['artifactManifest'] = [ordered]@{
					path = $hostArtifactManifest.FullName
					sizeBytes = $hostArtifactManifest.Length
					sha256 = $hostArtifactManifestSha256
					guestHashAgreement = $artifactManifestAgreement
				}
				if (-not $artifactManifestAgreement) {
					throw 'Host and guest artifact manifest hashes or sizes do not agree'
				}
			}
		}

		$newSandboxClients = @(
			Get-WindowsSandboxClientProcesses |
				Where-Object { $_.Id -notin $existingSandboxClientIds }
		)
		$newSandboxClientIds = @(
			@($newSandboxClients | ForEach-Object Id) +
			@($sandboxLaunchProcess.Id | Where-Object { $_ -notin $existingSandboxClientIds }) |
				Sort-Object -Unique
		)
		$launchRecord.observedSandboxClientProcessIds = $newSandboxClientIds
		foreach ($sandboxClientId in $newSandboxClientIds) {
			if ($null -ne (Get-Process -Id $sandboxClientId -ErrorAction SilentlyContinue)) {
				Stop-Process -Id $sandboxClientId -Force -ErrorAction Stop
			}
		}
		$remainingSandboxClientProcessIds = if ($newSandboxClientIds.Count -gt 0) {
			Wait-ForProcessIdsExit -ProcessIds $newSandboxClientIds
		} else {
			$null
		}
		$lateSandboxClientProcessIds = @(
			Get-WindowsSandboxClientProcesses |
				Where-Object { $_.Id -notin $existingSandboxClientIds } |
				ForEach-Object Id
		)
		$launchRecord.remainingSandboxClientProcessIds = @(
			@($remainingSandboxClientProcessIds) + $lateSandboxClientProcessIds |
				Sort-Object -Unique
		)
		$launchRecord.sandboxClientClosed = $launchRecord.remainingSandboxClientProcessIds.Count -eq 0
		if (-not $launchRecord.sandboxClientClosed) {
			Write-LaunchRecord -Record $launchRecord -EvidenceDirectory $resolvedEvidence | Out-Null
			throw 'One or more Sandbox client processes remained after exact session cleanup'
		}
	}
}

$launchJson = Write-LaunchRecord -Record $launchRecord -EvidenceDirectory $resolvedEvidence
$launchJson
