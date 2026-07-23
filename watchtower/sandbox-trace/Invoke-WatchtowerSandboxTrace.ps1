[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $ApplicationPath,

	[Parameter(Mandatory = $true)]
	[string] $ProcmonPath,

	[Parameter(Mandatory = $true)]
	[string] $EvidencePath,

	[ValidateSet('Smoke', 'Trace')]
	[string] $Mode = 'Smoke',

	[ValidateRange(10, 120)]
	[int] $TraceDurationSeconds = 30,

	[switch] $CloseWhenFinished
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-MappedFolderReadOnly {
	param([Parameter(Mandatory = $true)][string] $Path)

	$probePath = Join-Path $Path ('.watchtower-write-probe-' + [guid]::NewGuid().ToString('N'))
	try {
		[System.IO.File]::WriteAllText($probePath, 'write-probe')
		Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
		return $false
	} catch {
		return $true
	}
}

function Get-ActiveNetworkAdapters {
	if (-not (Get-Command Get-NetAdapter -ErrorAction SilentlyContinue)) {
		return @()
	}
	return @(
		Get-NetAdapter -ErrorAction Stop |
			Where-Object Status -EQ 'Up' |
			ForEach-Object {
				[ordered]@{
					name = $_.Name
					interfaceDescription = $_.InterfaceDescription
				}
			}
	)
}

function Get-ProcessTreeProcessIds {
	param([Parameter(Mandatory = $true)][int] $RootProcessId)

	$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
	$treeProcessIds = [System.Collections.Generic.List[int]]::new()
	$treeProcessIds.Add($RootProcessId)
	do {
		$addedProcess = $false
		foreach ($process in $processes) {
			$processId = [int] $process.ProcessId
			$parentProcessId = [int] $process.ParentProcessId
			if ($treeProcessIds.Contains($parentProcessId) -and -not $treeProcessIds.Contains($processId)) {
				$treeProcessIds.Add($processId)
				$addedProcess = $true
			}
		}
	} while ($addedProcess)
	return @($treeProcessIds)
}

function Invoke-ExactProcessTreeTermination {
	param([Parameter(Mandatory = $true)][int] $ProcessId)

	$terminatedAt = (Get-Date).ToUniversalTime().ToString('o')
	$targetedProcessIds = @(Get-ProcessTreeProcessIds -RootProcessId $ProcessId)
	$output = @(
		& "$env:SystemRoot\System32\taskkill.exe" /pid $ProcessId /f /t 2>&1 |
			ForEach-Object { $_.ToString() }
	)
	$exitCode = $LASTEXITCODE
	$deadline = (Get-Date).AddSeconds(10)
	do {
		$remainingProcessIds = @(
			$targetedProcessIds |
				Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) }
		)
		if ($remainingProcessIds.Count -eq 0) {
			break
		}
		Start-Sleep -Milliseconds 250
	} while ((Get-Date) -lt $deadline)
	return [ordered]@{
		processId = $ProcessId
		method = 'taskkill /pid <exact-pid> /f /t'
		terminatedAt = $terminatedAt
		exitCode = $exitCode
		targetedProcessIds = $targetedProcessIds
		remainingProcessIds = $remainingProcessIds
		output = $output
	}
}

function Stop-ProcmonCapture {
	param([Parameter(Mandatory = $true)][string] $LiteralPath)

	$stoppedAt = (Get-Date).ToUniversalTime().ToString('o')
	$output = @(
		& $LiteralPath -terminate -quiet 2>&1 |
			ForEach-Object { $_.ToString() }
	)
	$exitCode = $LASTEXITCODE
	return [ordered]@{
		method = 'Procmon -terminate -quiet'
		stoppedAt = $stoppedAt
		exitCode = $exitCode
		output = $output
	}
}

function Wait-ForProcessExit {
	param(
		[Parameter(Mandatory = $true)]
		[System.Diagnostics.Process] $Process,

		[ValidateRange(1, 30)]
		[int] $TimeoutSeconds = 10
	)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	do {
		$Process.Refresh()
		if ($Process.HasExited) {
			return $true
		}
		Start-Sleep -Milliseconds 250
	} while ((Get-Date) -lt $deadline)
	return $false
}

$application = (Get-Item -LiteralPath $ApplicationPath -ErrorAction Stop).FullName
$procmon = (Get-Item -LiteralPath $ProcmonPath -ErrorAction Stop).FullName
$evidence = (Get-Item -LiteralPath $EvidencePath -ErrorAction Stop).FullName
$inputRoots = @(
	(Split-Path -Parent $application),
	(Split-Path -Parent $procmon),
	$PSScriptRoot
)
$inputMappingIsReadOnly = @(
	$inputRoots | ForEach-Object { Test-MappedFolderReadOnly -Path $_ }
) -notcontains $false

$evidenceProbe = Join-Path $evidence ('.watchtower-evidence-probe-' + [guid]::NewGuid().ToString('N'))
$evidenceMappingIsWritable = $false
try {
	[System.IO.File]::WriteAllText($evidenceProbe, 'evidence-probe')
	$evidenceMappingIsWritable = $true
} finally {
	Remove-Item -LiteralPath $evidenceProbe -Force -ErrorAction SilentlyContinue
}

$networkAdapters = @(Get-ActiveNetworkAdapters)
$computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem
$operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem
$isSandboxUser = $env:USERNAME -eq 'WDAGUtilityAccount'
$networkingDisabled = $networkAdapters.Count -eq 0
$containmentPassed = (
	$isSandboxUser -and
	$inputMappingIsReadOnly -and
	$evidenceMappingIsWritable -and
	$networkingDisabled
)

$tracePassed = $Mode -eq 'Smoke'
$traceFailure = $null
$traceResult = $null
$applicationProcess = $null
$procmonProcess = $null
$applicationTermination = $null
$procmonStop = $null
$procmonStartedAt = $null
$applicationStartedAt = $null
$applicationWasRunningBeforeTermination = $false
$observationRoot = 'C:\WatchtowerObservation'
$profileRoot = Join-Path $observationRoot 'profile'
$pmlFileName = 'clean-startup.pml'
$pmlPath = Join-Path $evidence $pmlFileName

if ($Mode -eq 'Trace') {
	try {
		if (-not $containmentPassed) {
			throw 'Containment checks failed before Trace mode could start'
		}
		if (Test-Path -LiteralPath $pmlPath) {
			throw "EvidencePath already contains $pmlFileName"
		}

		New-Item -ItemType Directory -Path $profileRoot -Force -ErrorAction Stop | Out-Null
		$procmonStartedAt = (Get-Date).ToUniversalTime()
		$procmonProcess = Start-Process `
			-FilePath $procmon `
			-ArgumentList @(
				'-accepteula',
				'-backingfile',
				('"' + $pmlPath + '"'),
				'-quiet',
				'-minimized'
			) `
			-PassThru
		Start-Sleep -Seconds 2
		$procmonProcess.Refresh()
		if ($procmonProcess.HasExited) {
			throw 'Procmon exited before the packaged application started'
		}

		$applicationStartedAt = (Get-Date).ToUniversalTime()
		$applicationProcess = Start-Process `
			-FilePath $application `
			-ArgumentList @('--profile', ('"' + $profileRoot + '"'), '--no-welcome') `
			-PassThru
		Start-Sleep -Seconds $TraceDurationSeconds
		$applicationProcess.Refresh()
		$applicationWasRunningBeforeTermination = -not $applicationProcess.HasExited
		if (-not $applicationWasRunningBeforeTermination) {
			throw 'Packaged application exited before the bounded trace duration elapsed'
		}

		$applicationTermination = Invoke-ExactProcessTreeTermination -ProcessId $applicationProcess.Id
		if (
			$applicationTermination.exitCode -ne 0 -or
			$applicationTermination.remainingProcessIds.Count -ne 0
		) {
			throw "Exact application process-tree termination failed or left processes running (exit code $($applicationTermination.exitCode))"
		}

		$procmonStop = Stop-ProcmonCapture -LiteralPath $procmon
		if ($procmonStop.exitCode -ne 0) {
			throw "Procmon termination failed with exit code $($procmonStop.exitCode)"
		}
		if (-not (Wait-ForProcessExit -Process $procmonProcess)) {
			throw 'Procmon did not exit after the capture was terminated'
		}
		if (-not (Test-Path -LiteralPath $pmlPath)) {
			throw "Procmon did not produce $pmlFileName"
		}

		$pmlItem = Get-Item -LiteralPath $pmlPath -ErrorAction Stop
		if ($pmlItem.Length -le 0) {
			throw "Procmon produced an empty $pmlFileName"
		}
		$tracePassed = $procmonStartedAt -lt $applicationStartedAt
	} catch {
		$traceFailure = $_.Exception.Message
	} finally {
		if ($null -ne $applicationProcess) {
			$applicationProcess.Refresh()
			if (-not $applicationProcess.HasExited -and $null -eq $applicationTermination) {
				$applicationTermination = Invoke-ExactProcessTreeTermination -ProcessId $applicationProcess.Id
			}
		}
		if ($null -ne $procmonProcess) {
			$procmonProcess.Refresh()
			if (-not $procmonProcess.HasExited) {
				if ($null -eq $procmonStop) {
					$procmonStop = Stop-ProcmonCapture -LiteralPath $procmon
				}
				if (-not (Wait-ForProcessExit -Process $procmonProcess)) {
					Stop-Process -Id $procmonProcess.Id -Force -ErrorAction SilentlyContinue
				}
			}
		}
	}

	$pmlEvidence = $null
	if (Test-Path -LiteralPath $pmlPath) {
		$pmlItem = Get-Item -LiteralPath $pmlPath
		$pmlEvidence = [ordered]@{
			fileName = $pmlFileName
			sizeBytes = $pmlItem.Length
			sha256 = (Get-FileHash -LiteralPath $pmlPath -Algorithm SHA256).Hash.ToLowerInvariant()
		}
	}
	$traceResult = [ordered]@{
		scenarioId = 'clean-startup'
		requestedDurationSeconds = $TraceDurationSeconds
		procmonStartedAt = if ($null -ne $procmonStartedAt) { $procmonStartedAt.ToString('o') } else { $null }
		applicationStartedAt = if ($null -ne $applicationStartedAt) { $applicationStartedAt.ToString('o') } else { $null }
		procmonStartedBeforeApplication = (
			$null -ne $procmonStartedAt -and
			$null -ne $applicationStartedAt -and
			$procmonStartedAt -lt $applicationStartedAt
		)
		applicationProcessId = if ($null -ne $applicationProcess) { $applicationProcess.Id } else { $null }
		applicationWasRunningBeforeTermination = $applicationWasRunningBeforeTermination
		applicationTermination = $applicationTermination
		procmonStop = $procmonStop
		observationRoot = $observationRoot
		profileRoot = $profileRoot
		pml = $pmlEvidence
		failure = $traceFailure
	}
}

$passed = $containmentPassed -and $tracePassed
$result = [ordered]@{
	schemaVersion = 2
	status = if ($passed) { 'passed' } else { 'failed' }
	mode = $Mode
	capturedAt = (Get-Date).ToUniversalTime().ToString('o')
	userName = $env:USERNAME
	computerName = $env:COMPUTERNAME
	isSandboxUser = $isSandboxUser
	inputMappingIsReadOnly = $inputMappingIsReadOnly
	evidenceMappingIsWritable = $evidenceMappingIsWritable
	activeNetworkAdapters = $networkAdapters
	networkingDisabled = $networkingDisabled
	totalMemoryGB = [math]::Round($computerSystem.TotalPhysicalMemory / 1GB, 1)
	freeMemoryGB = [math]::Round($operatingSystem.FreePhysicalMemory / 1MB, 1)
	modeSupported = $true
	application = [ordered]@{
		path = $application
		sha256 = (Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash.ToLowerInvariant()
	}
	procmon = [ordered]@{
		path = $procmon
		sha256 = (Get-FileHash -LiteralPath $procmon -Algorithm SHA256).Hash.ToLowerInvariant()
	}
	trace = $traceResult
}

$resultPath = Join-Path $evidence 'sandbox-result.json'
[System.IO.File]::WriteAllText(
	$resultPath,
	(($result | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
	[System.Text.UTF8Encoding]::new($false)
)

if ($passed -and $CloseWhenFinished) {
	Start-Process -FilePath "$env:SystemRoot\System32\shutdown.exe" -ArgumentList '/s', '/t', '0' | Out-Null
}

if (-not $passed) {
	throw "Sandbox $Mode verification failed; inspect $resultPath"
}
