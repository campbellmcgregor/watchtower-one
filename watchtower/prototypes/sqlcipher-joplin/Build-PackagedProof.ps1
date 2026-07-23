[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $CompatibilityArtifactRoot,

	[string] $OutputParent = [System.IO.Path]::GetTempPath()
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$electronDist = Join-Path $repositoryRoot 'packages\app-desktop\node_modules\electron\dist'
$signalPackage = Join-Path $repositoryRoot 'packages\app-desktop\node_modules\@signalapp\sqlcipher'
$nodeGypBuildPackage = Join-Path $repositoryRoot 'packages\app-desktop\node_modules\node-gyp-build'
$artifactRoot = (Resolve-Path -LiteralPath $CompatibilityArtifactRoot).Path
$artifactBinary = Join-Path $artifactRoot 'prebuilds\win32-x64\@signalapp+sqlcipher.node'
$packagedSource = Join-Path $PSScriptRoot 'packaged'

foreach ($requiredPath in @(
	$electronDist,
	$signalPackage,
	$nodeGypBuildPackage,
	$artifactBinary,
	(Join-Path $packagedSource 'package.json'),
	(Join-Path $packagedSource 'main.cjs')
)) {
	if (-not (Test-Path -LiteralPath $requiredPath)) {
		throw "Required packaged-proof input is missing: $requiredPath"
	}
}

$outputParentPath = (Resolve-Path -LiteralPath $OutputParent).Path
$outputRoot = Join-Path $outputParentPath "WatchtowerOne-SQLCipher-PACKAGED-PROTOTYPE-WIPE-ME-$([Guid]::NewGuid().ToString('N'))"
$resourcesRoot = Join-Path $outputRoot 'resources'
$appRoot = Join-Path $resourcesRoot 'app'
$appNodeModules = Join-Path $appRoot 'node_modules'
$signalTarget = Join-Path $appNodeModules '@signalapp\sqlcipher'
$nodeGypBuildTarget = Join-Path $appNodeModules 'node-gyp-build'
$prebuildTarget = Join-Path $resourcesRoot 'sqlcipher-prebuild\prebuilds\win32-x64'

New-Item -ItemType Directory -Path $outputRoot | Out-Null
Copy-Item -Path (Join-Path $electronDist '*') -Destination $outputRoot -Recurse
New-Item -ItemType Directory -Path $signalTarget -Force | Out-Null
New-Item -ItemType Directory -Path $nodeGypBuildTarget -Force | Out-Null
New-Item -ItemType Directory -Path $prebuildTarget -Force | Out-Null

Copy-Item -Path (Join-Path $signalPackage '*') -Destination $signalTarget -Recurse
Copy-Item -Path (Join-Path $nodeGypBuildPackage '*') -Destination $nodeGypBuildTarget -Recurse
Copy-Item -LiteralPath $artifactBinary -Destination $prebuildTarget
Copy-Item -LiteralPath (Join-Path $packagedSource 'package.json') -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $packagedSource 'main.cjs') -Destination $appRoot

$packagedExecutable = Join-Path $outputRoot 'WatchtowerOneSqlCipherProof.exe'
Move-Item -LiteralPath (Join-Path $outputRoot 'electron.exe') -Destination $packagedExecutable

Get-Item -LiteralPath $packagedExecutable
