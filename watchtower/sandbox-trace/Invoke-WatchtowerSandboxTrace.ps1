[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $ApplicationPath,

	[Parameter(Mandatory = $true)]
	[string] $ProcmonPath,

	[Parameter(Mandatory = $true)]
	[string] $EvidencePath,

	[ValidateSet('Smoke')]
	[string] $Mode = 'Smoke',

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
$passed = (
	$isSandboxUser -and
	$inputMappingIsReadOnly -and
	$evidenceMappingIsWritable -and
	$networkingDisabled
)

$result = [ordered]@{
	schemaVersion = 1
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
}

$resultPath = Join-Path $evidence 'sandbox-result.json'
[System.IO.File]::WriteAllText(
	$resultPath,
	(($result | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
	[System.Text.UTF8Encoding]::new($false)
)

if ($passed -and $CloseWhenFinished) {
	Start-Process -FilePath "$env:SystemRoot\System32\shutdown.exe" -ArgumentList '/s', '/t', '0' | Out-Null
}

if (-not $passed) {
	throw "Sandbox $Mode verification failed; inspect $resultPath"
}
