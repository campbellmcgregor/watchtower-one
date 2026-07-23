[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $RootPath,

	[Parameter(Mandatory = $true)]
	[string] $OutputPath,

	[Parameter(Mandatory = $true)]
	[ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
	[string] $ScenarioId,

	[switch] $RequireContentPersistence,

	[ValidatePattern('^[a-fA-F0-9]{32}$')]
	[string] $ExpectedResourceId,

	[Parameter(Mandatory = $true)]
	[ValidateNotNullOrEmpty()]
	[string] $NoteCanary,

	[Parameter(Mandatory = $true)]
	[ValidateNotNullOrEmpty()]
	[string] $ResourceCanary,

	[Parameter(Mandatory = $true)]
	[ValidateNotNullOrEmpty()]
	[string] $PluginCanary
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not ('WatchtowerSandboxByteSearch' -as [type])) {
	Add-Type -TypeDefinition @'
public static class WatchtowerSandboxByteSearch
{
	public static bool Contains(byte[] bytes, byte[] pattern)
	{
		if (pattern.Length == 0) return true;
		if (pattern.Length > bytes.Length) return false;

		var skip = new int[256];
		for (var index = 0; index < skip.Length; index++) skip[index] = pattern.Length;
		for (var index = 0; index < pattern.Length - 1; index++) {
			skip[pattern[index]] = pattern.Length - index - 1;
		}

		var offset = 0;
		while (offset <= bytes.Length - pattern.Length) {
			var patternOffset = pattern.Length - 1;
			while (patternOffset >= 0 && bytes[offset + patternOffset] == pattern[patternOffset]) {
				patternOffset--;
			}
			if (patternOffset < 0) return true;
			offset += skip[bytes[offset + pattern.Length - 1]];
		}
		return false;
	}
}
'@
}

function Test-BytePattern {
	param(
		[Parameter(Mandatory = $true)]
		[AllowEmptyCollection()]
		[byte[]] $Bytes,

		[Parameter(Mandatory = $true)]
		[byte[]] $Pattern
	)

	return [WatchtowerSandboxByteSearch]::Contains($Bytes, $Pattern)
}

function Get-RelativeManifestPath {
	param(
		[Parameter(Mandatory = $true)]
		[string] $Root,

		[Parameter(Mandatory = $true)]
		[string] $Path
	)

	return $Path.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
}

$root = (Get-Item -LiteralPath $RootPath -ErrorAction Stop).FullName.TrimEnd('\', '/')
$output = [System.IO.Path]::GetFullPath($OutputPath)
if ($RequireContentPersistence -and [string]::IsNullOrWhiteSpace($ExpectedResourceId)) {
	throw 'ExpectedResourceId is required with RequireContentPersistence'
}
$outputDirectory = Split-Path -Parent $output
if (-not (Test-Path -LiteralPath $outputDirectory)) {
	New-Item -ItemType Directory -Path $outputDirectory -Force -ErrorAction Stop | Out-Null
}

$canaries = @(
	[ordered]@{ id = 'note'; value = $NoteCanary },
	[ordered]@{ id = 'plugin'; value = $PluginCanary },
	[ordered]@{ id = 'resource'; value = $ResourceCanary }
)
$patterns = @(
	foreach ($canary in $canaries) {
		[ordered]@{
			id = $canary.id
			encodings = @(
				[ordered]@{
					id = 'utf8'
					bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($canary.value)
				},
				[ordered]@{
					id = 'utf16le'
					bytes = [System.Text.UnicodeEncoding]::new($false, $false).GetBytes($canary.value)
				}
			)
		}
	}
)

$files = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[object]]::new()
$fileItems = @(
	Get-ChildItem -LiteralPath $root -File -Force -Recurse -ErrorAction Stop |
		Sort-Object FullName
)
foreach ($fileItem in $fileItems) {
	$relativePath = Get-RelativeManifestPath -Root $root -Path $fileItem.FullName
	try {
		if (($fileItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
			throw 'Reparse points are not scanned'
		}
		$bytes = [System.IO.File]::ReadAllBytes($fileItem.FullName)
		$fileCanaries = @(
			foreach ($pattern in $patterns) {
				$encodings = @(
					foreach ($encoding in $pattern.encodings) {
						if (Test-BytePattern -Bytes $bytes -Pattern $encoding.bytes) {
							$encoding.id
						}
					}
				)
				if ($encodings.Count -gt 0) {
					[ordered]@{
						id = $pattern.id
						encodings = $encodings
					}
				}
			}
		)
		$files.Add([ordered]@{
			path = $relativePath
			sizeBytes = $fileItem.Length
			sha256 = (Get-FileHash -LiteralPath $fileItem.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
			canaries = $fileCanaries
		})
	} catch {
		$errors.Add([ordered]@{
			path = $relativePath
			error = $_.Exception.Message
		})
	}
}

$requiredPersistence = $null
if ($RequireContentPersistence) {
	$canaryPaths = [ordered]@{}
	foreach ($canaryId in @('note', 'resource', 'plugin')) {
		$canaryPaths[$canaryId] = @(
			$files |
				Where-Object { @($_.canaries | ForEach-Object id) -contains $canaryId } |
				ForEach-Object path
		)
	}
	$requiredPersistence = [ordered]@{
		noteDatabase = $canaryPaths.note -contains 'profile/database.sqlite'
		resourceStore = @(
			$canaryPaths.resource |
				Where-Object { $_ -like "profile/resources/$ExpectedResourceId.*" }
		).Count -gt 0
		pluginSetting = $canaryPaths.plugin -contains 'profile/settings.json'
		pluginData = (
			$canaryPaths.plugin -contains
			'profile/plugin-data/com.watchtower.packaged-content-trace/plugin-data.txt'
		)
	}
	$requiredPersistence['allPassed'] = @(
		$requiredPersistence.noteDatabase,
		$requiredPersistence.resourceStore,
		$requiredPersistence.pluginSetting,
		$requiredPersistence.pluginData
	) -notcontains $false
}

$manifest = [ordered]@{
	schemaVersion = 1
	scenarioId = $ScenarioId
	capturedAt = (Get-Date).ToUniversalTime().ToString('o')
	rootId = 'observation'
	canaryIds = @($canaries | ForEach-Object id)
	files = @($files)
	errors = @($errors)
	requiredPersistence = $requiredPersistence
}
[System.IO.File]::WriteAllText(
	$output,
	(($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
	[System.Text.UTF8Encoding]::new($false)
)
if ($RequireContentPersistence -and -not $requiredPersistence.allPassed) {
	throw 'Artifact manifest is missing one or more required content persistence locations'
}
$output
