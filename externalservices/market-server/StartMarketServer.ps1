param(
    [ValidateSet("serve-release", "serve-debug", "doctor", "build-release")]
    [string]$Mode = "serve-release"
)

$ErrorActionPreference = "Stop"

$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$script:MarketServerDir = $PSScriptRoot
$script:ConfigPath = Join-Path $script:MarketServerDir "config\market-server.local.toml"
$script:ShutdownRequested = $false
$script:ShutdownMessageShown = $false

function Resolve-CargoPath {
    $preferred = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    if (Test-Path $preferred) {
        return $preferred
    }

    $resolved = Get-Command cargo.exe -ErrorAction SilentlyContinue
    if ($resolved -and $resolved.Source) {
        return $resolved.Source
    }

    throw "Rust cargo.exe was not found. Install Rust with: winget install -e --id Rustlang.Rustup"
}

function Get-ModeInfo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SelectedMode
    )

    switch ($SelectedMode) {
        "serve-release" {
            return @{
                Label = "release serve"
                Description = "Starting standalone market server in release mode"
                Arguments = @("run", "--release", "--", "--config", "config/market-server.local.toml", "serve")
                LongRunning = $true
            }
        }
        "serve-debug" {
            return @{
                Label = "debug serve"
                Description = "Starting standalone market server in debug mode"
                Arguments = @("run", "--", "--config", "config/market-server.local.toml", "serve")
                LongRunning = $true
            }
        }
        "doctor" {
            return @{
                Label = "doctor"
                Description = "Running market server doctor"
                Arguments = @("run", "--release", "--", "--config", "config/market-server.local.toml", "doctor")
                LongRunning = $false
            }
        }
        "build-release" {
            return @{
                Label = "build release"
                Description = "Building market server release binary"
                Arguments = @("build", "--release")
                LongRunning = $false
            }
        }
    }
}

function Join-ProcessArguments {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $escapedArguments = foreach ($argument in $Arguments) {
        if ($argument -match '[\s"]') {
            '"' + ($argument -replace '"', '\"') + '"'
        } else {
            $argument
        }
    }

    return ($escapedArguments -join " ")
}

function Format-ExitCode {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ExitCode
    )

    $unsigned = [uint32]$ExitCode
    return ("{0} (0x{1})" -f $ExitCode, $unsigned.ToString("X8"))
}

function Invoke-MarketCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoPath,

        [Parameter(Mandatory = $true)]
        [hashtable]$ModeInfo
    )

    $argumentList = [string[]]$ModeInfo.Arguments
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $CargoPath
    $psi.WorkingDirectory = $script:MarketServerDir
    $psi.UseShellExecute = $false
    $psi.Arguments = Join-ProcessArguments -Arguments $argumentList

    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor DarkCyan
    Write-Host "    EvEJS Market Server Launcher" -ForegroundColor Cyan
    Write-Host "  ============================================================" -ForegroundColor DarkCyan
    Write-Host ""
    Write-Host ("    Mode   : {0}" -f $ModeInfo.Label)
    Write-Host ("    Config : {0}" -f $script:ConfigPath)
    Write-Host ("    Workdir: {0}" -f $script:MarketServerDir)
    if ($ModeInfo.LongRunning) {
        Write-Host "    Stop   : Press Ctrl+C once for a clean shutdown"
    }
    Write-Host ""
    Write-Host ("  {0}..." -f $ModeInfo.Description)
    Write-Host ""

    $process = [System.Diagnostics.Process]::Start($psi)
    if (-not $process) {
        throw "Failed to start cargo process."
    }

    try {
        while (-not $process.HasExited) {
            $null = $process.WaitForExit(200)
        }
    } finally {
        if (-not $process.HasExited) {
            $process.WaitForExit()
        }
    }

    return $process.ExitCode
}

$cancelHandler = [ConsoleCancelEventHandler]{
    param($sender, $eventArgs)

    $script:ShutdownRequested = $true
    $eventArgs.Cancel = $true

    if (-not $script:ShutdownMessageShown) {
        $script:ShutdownMessageShown = $true
        Write-Host ""
        Write-Host "  Shutdown requested. Waiting for the market server to stop cleanly..." -ForegroundColor Yellow
    }
}

[Console]::add_CancelKeyPress($cancelHandler)

try {
    if (-not (Test-Path $script:ConfigPath)) {
        throw "Market server config not found at $script:ConfigPath"
    }

    $cargoPath = Resolve-CargoPath
    $modeInfo = Get-ModeInfo -SelectedMode $Mode
    $exitCode = Invoke-MarketCommand -CargoPath $cargoPath -ModeInfo $modeInfo

    $ctrlCExitCodes = @(-1073741510, 3221225786)
    if ($ctrlCExitCodes -contains $exitCode) {
        Write-Host ""
        Write-Host "  Market server stopped cleanly after Ctrl+C." -ForegroundColor Green
        exit 0
    }

    if ($ModeInfo.LongRunning -and $exitCode -eq 0) {
        Write-Host ""
        Write-Host "  Market server stopped cleanly." -ForegroundColor Green
        exit 0
    }

    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host ("  Market command exited with code {0}." -f (Format-ExitCode -ExitCode $exitCode)) -ForegroundColor Red
    } else {
        Write-Host ""
        Write-Host "  Market command completed successfully." -ForegroundColor Green
    }

    exit $exitCode
} catch {
    Write-Host ""
    Write-Host "  [!] Market launcher failed." -ForegroundColor Red
    Write-Host ("      {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    [Console]::remove_CancelKeyPress($cancelHandler)
}
