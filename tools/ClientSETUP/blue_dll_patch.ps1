Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ClientSetupDir = Split-Path -Parent $PSCommandPath
$script:DefaultRecipePath = Join-Path $script:ClientSetupDir "blue_patch_recipe.json"

class PatchError : System.Exception {
    PatchError([string]$Message) : base($Message) {}
}

class PatchValidationError : PatchError {
    PatchValidationError([string]$Message) : base($Message) {}
}

class AlreadyPatchedError : PatchValidationError {
    AlreadyPatchedError([string]$Message) : base($Message) {}
}

function Convert-HexToBytes {
    param([string]$Hex)

    if ([string]::IsNullOrWhiteSpace($Hex)) {
        return ,([byte[]]::new(0))
    }
    if (($Hex.Length % 2) -ne 0) {
        throw [PatchError]::new("Invalid hex string length.")
    }
    $bytes = [byte[]]::new($Hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = [Convert]::ToByte($Hex.Substring($i * 2, 2), 16)
    }
    return ,$bytes
}

function Compare-ByteArrays {
    param([byte[]]$Left, [byte[]]$Right)

    if ($null -eq $Left -or $null -eq $Right -or $Left.Length -ne $Right.Length) {
        return $false
    }
    for ($i = 0; $i -lt $Left.Length; $i++) {
        if ($Left[$i] -ne $Right[$i]) {
            return $false
        }
    }
    return $true
}

function Get-ByteSlice {
    param([byte[]]$Bytes, [int]$Offset, [int]$Count)

    if ($Offset -lt 0 -or $Count -lt 0 -or ($Offset + $Count) -gt $Bytes.Length) {
        throw [PatchValidationError]::new("Patch offset is outside the file.")
    }
    $slice = [byte[]]::new($Count)
    [System.Array]::Copy($Bytes, $Offset, $slice, 0, $Count)
    return ,$slice
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-FileSha256Hex {
    param([string]$Path)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }
}

function Get-JsonValueOrDefault {
    param([object]$Object, [string]$Name, [object]$Default = $null)

    if ($null -eq $Object) {
        return $Default
    }
    if ($Object.PSObject.Properties.Match($Name).Count -eq 0) {
        return $Default
    }
    $value = $Object.$Name
    if ($null -eq $value) {
        return $Default
    }
    return $value
}

function Read-FileBytes {
    param([string]$Path)

    try {
        return ,([System.IO.File]::ReadAllBytes($Path))
    } catch {
        throw [PatchError]::new("Failed to read ${Path}: $($_.Exception.Message)")
    }
}

function Write-FileBytes {
    param([string]$Path, [byte[]]$Bytes)

    try {
        [System.IO.File]::WriteAllBytes($Path, $Bytes)
    } catch {
        throw [PatchError]::new("Failed to write ${Path}: $($_.Exception.Message)")
    }
}

function Load-BlueDllPatchRecipe {
    param([string]$RecipePath = $script:DefaultRecipePath)

    $fullPath = [System.IO.Path]::GetFullPath($RecipePath)
    if (-not (Test-Path -LiteralPath $fullPath)) {
        throw [PatchError]::new("Patch recipe not found: $fullPath")
    }
    $rawText = Get-Content -LiteralPath $fullPath -Raw -Encoding UTF8
    if ($rawText -match ("data" + "Base64")) {
        throw [PatchValidationError]::new("Patch recipe contains a forbidden binary payload field.")
    }
    $raw = $rawText | ConvertFrom-Json

    $recipeDescription = [string](Get-JsonValueOrDefault -Object $raw -Name "description" -Default "")

    $patches = @()
    foreach ($patch in @(Get-JsonValueOrDefault -Object $raw -Name "patches" -Default @())) {
        if ($null -eq $patch) {
            continue
        }
        $patchDescription = [string](Get-JsonValueOrDefault -Object $patch -Name "description" -Default "")
        $patchOffset = [int](Get-JsonValueOrDefault -Object $patch -Name "offset" -Default -1)
        $patchOffsetHex = [string](Get-JsonValueOrDefault -Object $patch -Name "offsetHex" -Default ("0x{0:x8}" -f $patchOffset))
        $patches += [pscustomobject]@{
            Offset      = $patchOffset
            OffsetHex   = $patchOffsetHex
            Description = $patchDescription
            Before      = [byte[]](Convert-HexToBytes ([string]$patch.beforeHex))
            After       = [byte[]](Convert-HexToBytes ([string]$patch.afterHex))
        }
    }

    $knownPatched = @()
    foreach ($variant in @(Get-JsonValueOrDefault -Object $raw -Name "knownPatchedVariants" -Default @())) {
        if ($null -eq $variant) {
            continue
        }
        $knownPatched += [pscustomobject]@{
            Name   = [string]$variant.name
            Size   = [int64]$variant.size
            Sha256 = ([string]$variant.sha256).ToLowerInvariant()
        }
    }

    return [pscustomobject]@{
        Name        = [string](Get-JsonValueOrDefault -Object $raw -Name "name" -Default "blue.dll")
        Description = $recipeDescription
        Build       = [int]$raw.supportedBuild
        Source      = [pscustomobject]@{
            Filename = [string](Get-JsonValueOrDefault -Object $raw.source -Name "filename" -Default "blue.dll")
            Size     = [int64]$raw.source.size
            Sha256   = ([string]$raw.source.sha256).ToLowerInvariant()
        }
        Patches     = $patches
        PeRules     = $raw.peRules
        KnownPatchedVariants = $knownPatched
        Path        = $fullPath
    }
}

function Read-UInt16LE {
    param([byte[]]$Bytes, [int]$Offset)
    return [System.BitConverter]::ToUInt16($Bytes, $Offset)
}

function Read-UInt32LE {
    param([byte[]]$Bytes, [int]$Offset)
    return [System.BitConverter]::ToUInt32($Bytes, $Offset)
}

function Write-UInt32LE {
    param([byte[]]$Bytes, [int]$Offset, [uint32]$Value)
    $valueBytes = [System.BitConverter]::GetBytes($Value)
    [System.Array]::Copy($valueBytes, 0, $Bytes, $Offset, 4)
}

function Get-PeInfo {
    param([byte[]]$Bytes)

    if ($Bytes.Length -lt 0x100) {
        throw [PatchValidationError]::new("File is too small to be a PE image.")
    }
    if ($Bytes[0] -ne 0x4D -or $Bytes[1] -ne 0x5A) {
        throw [PatchValidationError]::new("File is not an MZ/PE image.")
    }
    $peOffset = [System.BitConverter]::ToInt32($Bytes, 0x3C)
    if ($peOffset -le 0 -or ($peOffset + 0x18) -ge $Bytes.Length) {
        throw [PatchValidationError]::new("PE header offset is invalid.")
    }
    if ($Bytes[$peOffset] -ne 0x50 -or $Bytes[$peOffset + 1] -ne 0x45 -or $Bytes[$peOffset + 2] -ne 0 -or $Bytes[$peOffset + 3] -ne 0) {
        throw [PatchValidationError]::new("PE signature is invalid.")
    }

    $fileHeaderOffset = $peOffset + 4
    $optionalHeaderOffset = $fileHeaderOffset + 20
    $magic = Read-UInt16LE -Bytes $Bytes -Offset $optionalHeaderOffset
    if ($magic -eq 0x20B) {
        $dataDirectoryOffset = $optionalHeaderOffset + 112
        $format = "PE32+"
    } elseif ($magic -eq 0x10B) {
        $dataDirectoryOffset = $optionalHeaderOffset + 96
        $format = "PE32"
    } else {
        throw [PatchValidationError]::new("Unsupported PE optional header magic.")
    }

    $checksumOffset = $optionalHeaderOffset + 64
    $securityDirectoryOffset = $dataDirectoryOffset + (4 * 8)
    if (($securityDirectoryOffset + 8) -gt $Bytes.Length) {
        throw [PatchValidationError]::new("PE security directory is outside the file.")
    }

    return [pscustomobject]@{
        Format = $format
        PeOffset = $peOffset
        OptionalHeaderOffset = $optionalHeaderOffset
        CheckSumOffset = $checksumOffset
        SecurityDirectoryOffset = $securityDirectoryOffset
        SecurityFileOffset = [int64](Read-UInt32LE -Bytes $Bytes -Offset $securityDirectoryOffset)
        SecuritySize = [int64](Read-UInt32LE -Bytes $Bytes -Offset ($securityDirectoryOffset + 4))
    }
}

function Get-PeChecksum {
    param([byte[]]$Bytes, [int]$CheckSumOffset)

    [uint64]$sum = 0
    for ($i = 0; $i -lt $Bytes.Length; $i += 2) {
        if ($i -ge $CheckSumOffset -and $i -lt ($CheckSumOffset + 4)) {
            continue
        }
        [uint32]$word = [uint32]$Bytes[$i]
        if (($i + 1) -lt $Bytes.Length) {
            $word = $word -bor ([uint32]$Bytes[$i + 1] -shl 8)
        }
        $sum += $word
        $sum = ($sum -band 0xffffffff) + ($sum -shr 32)
    }
    $sum = ($sum -band 0xffff) + ($sum -shr 16)
    $sum = $sum + ($sum -shr 16)
    $sum = ($sum -band 0xffff) + [uint32]$Bytes.Length
    return [uint32]$sum
}

function Set-PeChecksum {
    param([byte[]]$Bytes)

    $peInfo = Get-PeInfo -Bytes $Bytes
    Write-UInt32LE -Bytes $Bytes -Offset $peInfo.CheckSumOffset -Value 0
    $checksum = Get-PeChecksum -Bytes $Bytes -CheckSumOffset $peInfo.CheckSumOffset
    Write-UInt32LE -Bytes $Bytes -Offset $peInfo.CheckSumOffset -Value $checksum
    return $checksum
}

function Remove-PeSecurityDirectory {
    param([byte[]]$Bytes)

    $peInfo = Get-PeInfo -Bytes $Bytes
    $output = $Bytes
    if ($peInfo.SecurityFileOffset -gt 0 -and $peInfo.SecuritySize -gt 0) {
        if ($peInfo.SecurityFileOffset -lt 0 -or $peInfo.SecurityFileOffset -gt $Bytes.Length) {
            throw [PatchValidationError]::new("PE security directory points outside the file.")
        }
        $newLength = [int]$peInfo.SecurityFileOffset
        $output = [byte[]]::new($newLength)
        [System.Array]::Copy($Bytes, 0, $output, 0, $newLength)
    }

    $peInfo = Get-PeInfo -Bytes $output
    Write-UInt32LE -Bytes $output -Offset $peInfo.SecurityDirectoryOffset -Value 0
    Write-UInt32LE -Bytes $output -Offset ($peInfo.SecurityDirectoryOffset + 4) -Value 0
    return ,$output
}

function Test-RecipePatchBytes {
    param([byte[]]$Bytes, [object]$Recipe, [string]$Kind)

    foreach ($patch in $Recipe.Patches) {
        [byte[]]$expected = if ($Kind -eq "after") { @($patch.After) } else { @($patch.Before) }
        $current = Get-ByteSlice -Bytes $Bytes -Offset $patch.Offset -Count $expected.Count
        if (-not (Compare-ByteArrays -Left $current -Right $expected)) {
            return $false
        }
    }
    return $true
}

function Test-KnownPatchedVariant {
    param([byte[]]$Bytes, [object]$Recipe)

    $hash = Get-Sha256Hex $Bytes
    foreach ($variant in $Recipe.KnownPatchedVariants) {
        if ($Bytes.Length -eq $variant.Size -and $hash -eq $variant.Sha256) {
            return $true
        }
    }
    return $false
}

function Test-StrippedSecurityDirectory {
    param([byte[]]$Bytes)

    try {
        $peInfo = Get-PeInfo -Bytes $Bytes
        return ($peInfo.SecurityFileOffset -eq 0 -and $peInfo.SecuritySize -eq 0)
    } catch {
        return $false
    }
}

function Get-BlueDllPatchStatus {
    param([string]$InputPath, [object]$Recipe)

    if (-not (Test-Path -LiteralPath $InputPath)) {
        return [pscustomobject]@{ State = "missing_file"; Message = "blue.dll was not found." }
    }

    $bytes = Read-FileBytes $InputPath
    $hash = Get-Sha256Hex $bytes
    if (Test-KnownPatchedVariant -Bytes $bytes -Recipe $Recipe) {
        return [pscustomobject]@{ State = "already_patched"; Message = "blue.dll matches a known EvEJS patched variant." }
    }
    if ((Test-RecipePatchBytes -Bytes $bytes -Recipe $Recipe -Kind "after") -and (Test-StrippedSecurityDirectory -Bytes $bytes)) {
        return [pscustomobject]@{ State = "already_patched"; Message = "blue.dll is patched and has a local stripped security directory." }
    }
    if ($bytes.Length -eq $Recipe.Source.Size -and $hash -eq $Recipe.Source.Sha256) {
        return [pscustomobject]@{ State = "patchable_original"; Message = "Exact original blue.dll detected and ready to patch." }
    }
    if (Test-RecipePatchBytes -Bytes $bytes -Recipe $Recipe -Kind "before") {
        return [pscustomobject]@{ State = "patchable_variant"; Message = "Patch byte matches but the file hash is not the exact supported source." }
    }
    return [pscustomobject]@{ State = "unsupported"; Message = "This blue.dll does not match the supported build or a known patched form." }
}

function Apply-BlueDllPatchBytes {
    param([byte[]]$SourceBytes, [object]$Recipe, [switch]$AllowRelaxedVariant)

    if (Test-KnownPatchedVariant -Bytes $SourceBytes -Recipe $Recipe) {
        throw [AlreadyPatchedError]::new("This blue.dll is already patched.")
    }
    if ((Test-RecipePatchBytes -Bytes $SourceBytes -Recipe $Recipe -Kind "after") -and (Test-StrippedSecurityDirectory -Bytes $SourceBytes)) {
        throw [AlreadyPatchedError]::new("This blue.dll is already patched.")
    }

    $sourceHash = Get-Sha256Hex $SourceBytes
    $exactSource = ($SourceBytes.Length -eq $Recipe.Source.Size -and $sourceHash -eq $Recipe.Source.Sha256)
    if (-not $exactSource -and -not $AllowRelaxedVariant.IsPresent) {
        throw [PatchValidationError]::new("This blue.dll does not match the exact supported original build.")
    }

    $patched = [byte[]]::new($SourceBytes.Length)
    [System.Array]::Copy($SourceBytes, $patched, $SourceBytes.Length)

    foreach ($patch in $Recipe.Patches) {
        [byte[]]$beforeBytes = @($patch.Before)
        [byte[]]$afterBytes = @($patch.After)
        $current = Get-ByteSlice -Bytes $patched -Offset $patch.Offset -Count $beforeBytes.Count
        if (Compare-ByteArrays -Left $current -Right $afterBytes) {
            continue
        }
        if (-not (Compare-ByteArrays -Left $current -Right $beforeBytes)) {
            throw [PatchValidationError]::new("Patch precondition failed at $($patch.OffsetHex): $($patch.Description)")
        }
        [System.Array]::Copy($afterBytes, 0, $patched, $patch.Offset, $afterBytes.Count)
    }

    $patched = Remove-PeSecurityDirectory -Bytes $patched
    [void](Set-PeChecksum -Bytes $patched)

    if (-not (Test-RecipePatchBytes -Bytes $patched -Recipe $Recipe -Kind "after")) {
        throw [PatchError]::new("Patched output failed branch-byte verification.")
    }
    if (-not (Test-StrippedSecurityDirectory -Bytes $patched)) {
        throw [PatchError]::new("Patched output still has a PE security directory.")
    }

    return ,$patched
}

function Apply-BlueDllPatch {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [switch]$InPlace,
        [string]$BackupSuffix = ".original",
        [object]$Recipe,
        [switch]$AllowRelaxedVariant,
        [switch]$Force
    )

    $inputFullPath = [System.IO.Path]::GetFullPath($InputPath)
    if (-not (Test-Path -LiteralPath $inputFullPath)) {
        throw [PatchValidationError]::new("Input file does not exist: $inputFullPath")
    }
    $sourceBytes = Read-FileBytes $inputFullPath
    $patchedBytes = Apply-BlueDllPatchBytes -SourceBytes $sourceBytes -Recipe $Recipe -AllowRelaxedVariant:$AllowRelaxedVariant

    $resolvedOutput = if ($InPlace.IsPresent) { $inputFullPath } else { [System.IO.Path]::GetFullPath($OutputPath) }
    if (-not $InPlace.IsPresent -and (Test-Path -LiteralPath $resolvedOutput) -and -not $Force.IsPresent) {
        throw [PatchValidationError]::new("Output file already exists. Use --force to overwrite it.")
    }

    $backupPath = $null
    if ($InPlace.IsPresent) {
        $backupPath = "${inputFullPath}${BackupSuffix}"
        if (-not (Test-Path -LiteralPath $backupPath)) {
            Copy-Item -LiteralPath $inputFullPath -Destination $backupPath -Force:$false
        }
    } else {
        $parent = Split-Path -Parent $resolvedOutput
        if ($parent -and -not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Path $parent | Out-Null
        }
    }

    Write-FileBytes -Path $resolvedOutput -Bytes $patchedBytes
    return [pscustomobject]@{
        InputPath = $inputFullPath
        OutputPath = $resolvedOutput
        BackupPath = $backupPath
        SourceSize = $sourceBytes.Length
        SourceSha256 = Get-Sha256Hex $sourceBytes
        PatchedSize = $patchedBytes.Length
        PatchedSha256 = Get-Sha256Hex $patchedBytes
        Build = $Recipe.Build
    }
}

function Format-BlueDllPatchResult {
    param([object]$Result)

    return @(
        "blue.dll patch complete",
        "input=$($Result.InputPath)",
        "output=$($Result.OutputPath)",
        "backup=$($Result.BackupPath)",
        "sourceSize=$($Result.SourceSize)",
        "patchedSize=$($Result.PatchedSize)",
        "patchedSha256=$($Result.PatchedSha256)"
    ) -join [Environment]::NewLine
}

function Parse-BlueDllPatchArgs {
    param([string[]]$Arguments)

    $argumentList = @($Arguments)
    $options = @{
        Input = $null
        Output = $null
        InPlace = $false
        BackupSuffix = ".original"
        Recipe = $script:DefaultRecipePath
        Force = $false
        AttemptAnyway = $false
        Gui = $false
        Status = $false
        Help = $false
    }
    for ($i = 0; $i -lt $argumentList.Count; $i++) {
        switch ($argumentList[$i]) {
            "--input" { $options.Input = $argumentList[++$i] }
            "--output" { $options.Output = $argumentList[++$i] }
            "--in-place" { $options.InPlace = $true }
            "--backup-suffix" { $options.BackupSuffix = $argumentList[++$i] }
            "--manifest" { $options.Recipe = $argumentList[++$i] }
            "--recipe" { $options.Recipe = $argumentList[++$i] }
            "--force" { $options.Force = $true }
            "--attempt-anyway" { $options.AttemptAnyway = $true }
            "--gui" { $options.Gui = $true }
            "--status" { $options.Status = $true }
            "--help" { $options.Help = $true }
            "-h" { $options.Help = $true }
            default { throw [PatchValidationError]::new("Unknown argument: $($argumentList[$i])") }
        }
    }
    return [pscustomobject]$options
}

function Show-Usage {
    @"
Usage:
  powershell -File blue_dll_patch.ps1 --input <blue.dll> --in-place
  powershell -File blue_dll_patch.ps1 --input <blue.dll> --output <patched.dll>
  powershell -File blue_dll_patch.ps1 --status --input <blue.dll>

The recipe defaults to tools\ClientSETUP\blue_patch_recipe.json.
"@
}

function Start-BlueDllPatchGui {
    param([string]$InitialPath, [string]$RecipePath)

    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select blue.dll to patch"
    $dialog.Filter = "blue.dll|blue.dll|DLL files (*.dll)|*.dll|All files (*.*)|*.*"
    if ($InitialPath) {
        $dialog.FileName = $InitialPath
    }
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return 0
    }
    $recipe = Load-BlueDllPatchRecipe $RecipePath
    $status = Get-BlueDllPatchStatus -InputPath $dialog.FileName -Recipe $recipe
    if ($status.State -eq "already_patched") {
        [System.Windows.Forms.MessageBox]::Show($status.Message, "EvEJS blue.dll patcher") | Out-Null
        return 0
    }
    if ($status.State -ne "patchable_original" -and $status.State -ne "patchable_variant") {
        [System.Windows.Forms.MessageBox]::Show($status.Message, "EvEJS blue.dll patcher") | Out-Null
        return 2
    }
    $result = Apply-BlueDllPatch -InputPath $dialog.FileName -InPlace -Recipe $recipe -AllowRelaxedVariant:($status.State -eq "patchable_variant")
    [System.Windows.Forms.MessageBox]::Show((Format-BlueDllPatchResult $result), "EvEJS blue.dll patcher") | Out-Null
    return 0
}

function Invoke-BlueDllPatchMain {
    param([string[]]$Arguments)

    try {
        $options = Parse-BlueDllPatchArgs -Arguments $Arguments
        if ($options.Help) {
            [Console]::Out.WriteLine((Show-Usage))
            return 0
        }
        if ($options.Gui) {
            return Start-BlueDllPatchGui -InitialPath $options.Input -RecipePath $options.Recipe
        }
        if (-not $options.Input) {
            throw [PatchValidationError]::new("--input is required.")
        }
        $recipe = Load-BlueDllPatchRecipe $options.Recipe
        if ($options.Status) {
            $status = Get-BlueDllPatchStatus -InputPath $options.Input -Recipe $recipe
            [Console]::Out.WriteLine("state=$($status.State)")
            [Console]::Out.WriteLine("message=$($status.Message)")
            return 0
        }
        if (-not $options.InPlace -and -not $options.Output) {
            throw [PatchValidationError]::new("Either --in-place or --output is required.")
        }
        $result = Apply-BlueDllPatch `
            -InputPath $options.Input `
            -OutputPath $options.Output `
            -InPlace:([bool]$options.InPlace) `
            -BackupSuffix $options.BackupSuffix `
            -Recipe $recipe `
            -AllowRelaxedVariant:([bool]$options.AttemptAnyway) `
            -Force:([bool]$options.Force)
        [Console]::Out.WriteLine((Format-BlueDllPatchResult $result))
        return 0
    } catch [AlreadyPatchedError] {
        [Console]::Out.WriteLine("blue.dll is already patched.")
        return 0
    } catch [PatchValidationError] {
        [Console]::Error.WriteLine($_.Exception.Message)
        return 2
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        return 1
    }
}

$scriptExitCode = Invoke-BlueDllPatchMain -Arguments $args
exit $scriptExitCode
