<#
.SYNOPSIS
    EvEJS Client Setup Wizard
.DESCRIPTION
    A WPF GUI wizard that walks you through every step needed to prepare an
    EVE Online client for EvEJS:

        1. Select your EVE client installation folder
        2. Save the path into EvEJSConfig.bat
        3. Install the EvEJS SSL/TLS certificates
        4. Patch the client's exact original blue.dll in place
        5. Set start.ini to point at the local server

    Run the launcher batch file in tools\ClientSETUP to launch.
#>
param()

# ═══════════════════════════════════════════════════════════════════════════════
# ASSEMBLIES
# ═══════════════════════════════════════════════════════════════════════════════
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

# ═══════════════════════════════════════════════════════════════════════════════
# PATHS  (all relative to the script location - never hard-coded)
# ═══════════════════════════════════════════════════════════════════════════════
$RepoRoot        = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ClientSetupScriptsRoot = Join-Path $PSScriptRoot "scripts"
$ConfigBat       = Join-Path $ClientSetupScriptsRoot "EvEJSConfig.bat"
$InstallCertsBat = Join-Path $ClientSetupScriptsRoot "InstallCerts.bat"
$BlueDllPatchCli = Join-Path $PSScriptRoot "blue_dll_patch.ps1"
$BlueDllPatchRecipePath = Join-Path $PSScriptRoot "blue_patch_recipe.json"
$BlueDllPatchGuiBat = Join-Path $PSScriptRoot "PatchBlueDllGui.bat"
$CanonicalStartIniPath = Join-Path $RepoRoot "client\EVE\tq\start.ini"
$REQUIRED_BUILD  = "3396210"
$WindowsPowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

# ═══════════════════════════════════════════════════════════════════════════════
# COLOUR CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════
$C_GRAY   = "#FF8899AA"
$C_BLUE   = "#FF5DADE2"
$C_AMBER  = "#FFF9A825"
$C_GREEN  = "#FF4ECCA3"
$C_RED    = "#FFE94560"

# ═══════════════════════════════════════════════════════════════════════════════
# MUTABLE STATE
# ═══════════════════════════════════════════════════════════════════════════════
$script:TqPath      = ""
$script:BuildNumber = ""
$script:StepDone    = @{ 1 = $false; 2 = $false; 3 = $false; 4 = $false; 5 = $false }
$script:BrushCache  = @{}
$script:BrushConv   = New-Object System.Windows.Media.BrushConverter
$script:BlueDllPatchRecipe = $null
$script:StartIniPatchSpec = $null

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════
function Get-Brush([string]$Hex) {
    if (-not $script:BrushCache.ContainsKey($Hex)) {
        $script:BrushCache[$Hex] = $script:BrushConv.ConvertFromString($Hex)
    }
    return $script:BrushCache[$Hex]
}

function Ensure-LauncherConfig {
    if (Test-Path $ConfigBat) {
        return
    }

    $examplePath = Join-Path $ClientSetupScriptsRoot "EvEJSConfig.example.bat"
    if (Test-Path $examplePath) {
        Copy-Item -LiteralPath $examplePath -Destination $ConfigBat -Force
        return
    }

    $defaultLines = @(
        "@echo off",
        "for %%I in (`"%~dp0..\..\..`") do set `"EVEJS_REPO_ROOT=%%~fI`"",
        "set `"EVEJS_CLIENT_PATH=%EVEJS_REPO_ROOT%\client\EVE\tq`"",
        "set `"EVEJS_CLIENT_EXE=`"",
        "set `"EVEJS_PROXY_URL=http://127.0.0.1:26002`"",
        "set `"EVEJS_CA_PEM=%EVEJS_REPO_ROOT%\server\certs\xmpp-ca-cert.pem`""
    )
    [System.IO.Directory]::CreateDirectory($ClientSetupScriptsRoot) | Out-Null
    [System.IO.File]::WriteAllLines($ConfigBat, $defaultLines)
}

function Set-Status {
    param(
        [System.Windows.Controls.TextBlock]$Label,
        [string]$Text,
        [string]$Color = $C_GRAY
    )
    $Label.Text       = $Text
    $Label.Foreground = Get-Brush $Color
}

function Flush-UI { [System.Windows.Forms.Application]::DoEvents() }

function Find-TqPath([string]$Dir) {
    # Accept any level the user might select and resolve to the tq folder
    $candidates = @(
        $Dir                                                  # tq itself
        (Join-Path $Dir "tq")                                 # EVE folder
        (Join-Path $Dir "EVE\tq")                             # grandparent
        (Join-Path $Dir "SharedCache\tq")                     # SharedCache layout
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "bin64\exefile.exe")) { return $c }
    }
    # They might have selected bin64 directly
    if (Test-Path (Join-Path $Dir "exefile.exe")) {
        return (Split-Path $Dir -Parent)
    }
    return $null
}

function Get-IniKeyPattern([string[]]$Keys) {
    $escapedKeys = $Keys | ForEach-Object { [regex]::Escape($_) }
    return '^\s*(?:' + ($escapedKeys -join '|') + ')\s*='
}

function Test-IniKeyLine([string]$Line, [string[]]$Keys) {
    return $Line -imatch (Get-IniKeyPattern $Keys)
}

function Read-IniValue([string]$FilePath, [string]$Key) {
    if (-not (Test-Path $FilePath)) { return $null }
    $pattern = Get-IniKeyPattern @($Key)
    foreach ($line in [System.IO.File]::ReadAllLines($FilePath)) {
        if ($line -imatch ($pattern + '\s*(.+)$')) { return $Matches[1].Trim() }
    }
    return $null
}

function Get-IniMatchingLines([string]$FilePath, [string[]]$Keys) {
    if (-not (Test-Path $FilePath)) { return @() }
    $matches = [System.Collections.Generic.List[string]]::new()
    foreach ($line in [System.IO.File]::ReadAllLines($FilePath)) {
        if (Test-IniKeyLine $line $Keys) {
            $matches.Add($line)
        }
    }
    return ,$matches.ToArray()
}

function Read-IniValueAny([string]$FilePath, [string[]]$Keys) {
    foreach ($key in $Keys) {
        $value = Read-IniValue $FilePath $key
        if ($null -ne $value) {
            return $value
        }
    }
    return $null
}

function Get-StartIniPatchSpec {
    if ($script:StartIniPatchSpec) {
        return $script:StartIniPatchSpec
    }

    $cryptoLine = "cryptoPack = Placebo"
    $serverLine = "server = 127.0.0.1"
    $cryptoValue = "Placebo"
    $serverValue = "127.0.0.1"

    $script:StartIniPatchSpec = @{
        TemplatePath = $CanonicalStartIniPath
        CryptoKeys   = @("cryptoPack", "cryptopack")
        ServerKeys   = @("server", "serverip")
        CryptoLine   = $cryptoLine
        ServerLine   = $serverLine
        CryptoValue  = $cryptoValue
        ServerValue  = $serverValue
    }
    return $script:StartIniPatchSpec
}

function Get-StartIniPatchSummary([string]$IniPath) {
    if (-not (Test-Path $IniPath)) {
        return @{
            Exists      = $false
            CryptoValue = $null
            ServerValue = $null
            IsPatched   = $false
            Parts       = @()
            Summary     = "start.ini was not found."
        }
    }

    $spec = Get-StartIniPatchSpec
    $cryptoLines = Get-IniMatchingLines $IniPath $spec.CryptoKeys
    $serverLines = Get-IniMatchingLines $IniPath $spec.ServerKeys
    $crypto = Read-IniValueAny $IniPath $spec.CryptoKeys
    $server = Read-IniValueAny $IniPath $spec.ServerKeys
    $parts = @()
    $cryptoIsPatched = ($cryptoLines.Count -eq 1 -and $cryptoLines[0] -eq $spec.CryptoLine)
    $serverIsPatched = ($serverLines.Count -eq 1 -and $serverLines[0] -eq $spec.ServerLine)

    if ($cryptoIsPatched -and $serverIsPatched) {
        $summary = "start.ini already points to the local EvEJS server."
    } else {
        if ($cryptoLines.Count -eq 0) {
            $parts += "add canonical cryptoPack line"
        } else {
            $needsCryptoNormalization = ($cryptoLines.Count -gt 1) -or (-not $cryptoIsPatched)
            if ($needsCryptoNormalization) {
                $parts += "normalize cryptoPack to '$($spec.CryptoLine)'"
            }
        }

        if ($serverLines.Count -eq 0) {
            $parts += "add canonical server line"
        } else {
            $needsServerNormalization = ($serverLines.Count -gt 1) -or (-not $serverIsPatched)
            if ($needsServerNormalization) {
                $parts += "normalize server to '$($spec.ServerLine)'"
            }
        }

        if ($parts.Count -eq 0) {
            $parts += "normalize start.ini values"
        }
        $summary = $parts -join "; "
    }

    return @{
        Exists      = $true
        CryptoValue = $crypto
        ServerValue = $server
        IsPatched   = ($cryptoIsPatched -and $serverIsPatched)
        Parts       = $parts
        Summary     = $summary
    }
}

function Add-IniLineAfterKey([System.Collections.Generic.List[string]]$Lines, [string[]]$AnchorKeys, [string]$Line) {
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if (Test-IniKeyLine $Lines[$i] $AnchorKeys) {
            $Lines.Insert($i + 1, $Line)
            return
        }
    }
    $Lines.Add($Line)
}

function Set-StartIniPatchValues([string]$IniPath) {
    $spec = Get-StartIniPatchSpec
    $lines = [System.IO.File]::ReadAllLines($IniPath)
    $newLines = [System.Collections.Generic.List[string]]::new()
    $wroteCryptoLine = $false
    $wroteServerLine = $false

    foreach ($line in $lines) {
        if (Test-IniKeyLine $line $spec.CryptoKeys) {
            if (-not $wroteCryptoLine) {
                $newLines.Add($spec.CryptoLine)
                $wroteCryptoLine = $true
            }
            continue
        }

        if (Test-IniKeyLine $line $spec.ServerKeys) {
            if (-not $wroteServerLine) {
                $newLines.Add($spec.ServerLine)
                $wroteServerLine = $true
            }
            continue
        }

        $newLines.Add($line)
    }

    if (-not $wroteCryptoLine) {
        Add-IniLineAfterKey $newLines @("region") $spec.CryptoLine
    }

    if (-not $wroteServerLine) {
        Add-IniLineAfterKey $newLines @("socketIO") $spec.ServerLine
    }

    [System.IO.File]::WriteAllLines($IniPath, $newLines.ToArray())
}

function Get-BlueDllPatchRecipe {
    if ($script:BlueDllPatchRecipe) {
        return $script:BlueDllPatchRecipe
    }
    if (-not (Test-Path $BlueDllPatchRecipePath)) {
        return $null
    }
    $script:BlueDllPatchRecipe = Get-Content -LiteralPath $BlueDllPatchRecipePath -Raw | ConvertFrom-Json
    return $script:BlueDllPatchRecipe
}

function Invoke-BlueDllPatchHelper {
    param(
        [string[]]$Arguments
    )

    $powershellExe = if (Test-Path $WindowsPowerShellExe) { $WindowsPowerShellExe } else { "powershell.exe" }
    $helperArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $BlueDllPatchCli
    ) + $Arguments

    $stdoutPath = Join-Path $env:TEMP ("evejs-blue-patch-stdout-{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $stderrPath = Join-Path $env:TEMP ("evejs-blue-patch-stderr-{0}.log" -f ([guid]::NewGuid().ToString("N")))

    try {
        $process = Start-Process -FilePath $powershellExe `
            -ArgumentList $helperArgs `
            -Wait `
            -PassThru `
            -NoNewWindow `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $lines = New-Object System.Collections.Generic.List[string]
        foreach ($path in @($stdoutPath, $stderrPath)) {
            if (Test-Path $path) {
                foreach ($line in [System.IO.File]::ReadAllLines($path)) {
                    $lines.Add($line)
                }
            }
        }

        return @{
            Output = @($lines.ToArray())
            ExitCode = $process.ExitCode
        }
    } finally {
        foreach ($path in @($stdoutPath, $stderrPath)) {
            if (Test-Path $path) {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Get-BlueDllPatchState([string]$DllPath) {
    if (-not (Test-Path $BlueDllPatchCli)) {
        return @{
            State = "missing_patcher"
            Message = "tools\\ClientSETUP\\blue_dll_patch.ps1 is missing."
        }
    }

    $recipe = Get-BlueDllPatchRecipe
    if (-not $recipe) {
        return @{
            State = "missing_recipe"
            Message = "tools\\ClientSETUP\\blue_patch_recipe.json is missing."
        }
    }

    if (-not (Test-Path $DllPath)) {
        return @{
            State = "missing_file"
            Message = "blue.dll was not found in the client's bin64 folder."
        }
    }

    $statusArgs = @(
        "--status",
        "--input", $DllPath,
        "--recipe", $BlueDllPatchRecipePath
    )
    $statusResult = Invoke-BlueDllPatchHelper -Arguments $statusArgs
    if ([int]$statusResult.ExitCode -ne 0) {
        $detail = ($statusResult.Output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ }) -join " "
        if (-not $detail) { $detail = "The local blue.dll patch helper returned exit code $($statusResult.ExitCode)." }
        return @{
            State = "unsupported"
            Message = $detail
        }
    }

    $state = "unsupported"
    $message = "blue.dll does not match the supported build or a known patched form."
    foreach ($line in @($statusResult.Output)) {
        if ($line -match '^state=(.+)$') { $state = $Matches[1].Trim() }
        if ($line -match '^message=(.+)$') { $message = $Matches[1].Trim() }
    }

    return @{
        State = $state
        Message = $message
    }
}

function Update-Progress {
    $done = @($script:StepDone.Values | Where-Object { $_ }).Count
    $progressBar.Value    = $done
    $lblProgress.Text     = "$done / 5 steps complete"
    $lblProgress.Foreground = Get-Brush $(if ($done -eq 5) { $C_GREEN } else { $C_GRAY })
    $pnlAllDone.Visibility  = if ($done -eq 5) { "Visible" } else { "Collapsed" }
}

function Enable-StepButtons([bool]$On) {
    $btnStep2.IsEnabled  = $On
    $btnStep3.IsEnabled  = $On
    $btnStep4.IsEnabled  = $On
    $btnStep5.IsEnabled  = $On
    $btnRunAll.IsEnabled = $On
}

# ═══════════════════════════════════════════════════════════════════════════════
# XAML   (single-quoted here-string - no PowerShell variable expansion)
# ═══════════════════════════════════════════════════════════════════════════════
[xml]$Xaml = @'
<Window
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    Title="EvEJS Client Setup Wizard"
    Width="780" Height="830"
    MinWidth="620" MinHeight="600"
    WindowStartupLocation="CenterScreen"
    Background="#FF1A1A2E"
    FontFamily="Segoe UI">

    <Window.Resources>
        <!-- Card border -->
        <Style x:Key="Card" TargetType="Border">
            <Setter Property="Background"      Value="#FF16213E"/>
            <Setter Property="CornerRadius"     Value="8"/>
            <Setter Property="Padding"          Value="18"/>
            <Setter Property="Margin"           Value="0,0,0,12"/>
            <Setter Property="BorderBrush"      Value="#FF0F3460"/>
            <Setter Property="BorderThickness"  Value="1"/>
        </Style>

        <!-- Step titles -->
        <Style x:Key="H2" TargetType="TextBlock">
            <Setter Property="FontSize"    Value="15"/>
            <Setter Property="FontWeight"  Value="SemiBold"/>
            <Setter Property="Foreground"  Value="#FFEAEAEA"/>
            <Setter Property="Margin"      Value="0,0,0,4"/>
        </Style>

        <!-- Descriptions -->
        <Style x:Key="Desc" TargetType="TextBlock">
            <Setter Property="FontSize"     Value="12"/>
            <Setter Property="Foreground"   Value="#FF8899AA"/>
            <Setter Property="Margin"       Value="0,0,0,8"/>
            <Setter Property="TextWrapping" Value="Wrap"/>
        </Style>

        <!-- Status labels -->
        <Style x:Key="Status" TargetType="TextBlock">
            <Setter Property="FontSize"     Value="12"/>
            <Setter Property="Foreground"   Value="#FF8899AA"/>
            <Setter Property="Margin"       Value="0,6,0,0"/>
            <Setter Property="TextWrapping" Value="Wrap"/>
        </Style>

        <!-- Generic action button -->
        <Style x:Key="Btn" TargetType="Button">
            <Setter Property="Background"      Value="#FF0F3460"/>
            <Setter Property="Foreground"       Value="#FFEAEAEA"/>
            <Setter Property="BorderBrush"      Value="#FF1A5276"/>
            <Setter Property="BorderThickness"  Value="1"/>
            <Setter Property="Padding"          Value="18,8"/>
            <Setter Property="FontSize"         Value="13"/>
            <Setter Property="Cursor"           Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Name="bd"
                                Background="{TemplateBinding Background}"
                                BorderBrush="{TemplateBinding BorderBrush}"
                                BorderThickness="{TemplateBinding BorderThickness}"
                                CornerRadius="5"
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center"
                                              VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="bd" Property="Background"
                                        Value="#FF1A5276"/>
                            </Trigger>
                            <Trigger Property="IsEnabled" Value="False">
                                <Setter TargetName="bd" Property="Opacity"
                                        Value="0.35"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>

        <!-- Big green "Run All" button -->
        <Style x:Key="GoBig" TargetType="Button">
            <Setter Property="Background"      Value="#FF0A5C36"/>
            <Setter Property="Foreground"       Value="#FFEAEAEA"/>
            <Setter Property="BorderBrush"      Value="#FF4ECCA3"/>
            <Setter Property="BorderThickness"  Value="2"/>
            <Setter Property="Padding"          Value="32,12"/>
            <Setter Property="FontSize"         Value="16"/>
            <Setter Property="FontWeight"       Value="Bold"/>
            <Setter Property="Cursor"           Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Name="bd"
                                Background="{TemplateBinding Background}"
                                BorderBrush="{TemplateBinding BorderBrush}"
                                BorderThickness="{TemplateBinding BorderThickness}"
                                CornerRadius="6"
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center"
                                              VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="bd" Property="Background"
                                        Value="#FF0D7A47"/>
                                <Setter TargetName="bd" Property="BorderBrush"
                                        Value="#FF6EFFC3"/>
                            </Trigger>
                            <Trigger Property="IsEnabled" Value="False">
                                <Setter TargetName="bd" Property="Opacity"
                                        Value="0.35"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>

    <!-- ═══ LAYOUT ═══════════════════════════════════════════════════════ -->
    <Grid Margin="22">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- ── HEADER ─────────────────────────────────────────────────── -->
        <StackPanel Grid.Row="0" Margin="0,0,0,16">
            <TextBlock FontSize="26" FontWeight="Bold" Foreground="#FF4ECCA3"
                       Margin="0,0,0,4">
                &#x26A1; EvEJS Client Setup Wizard
            </TextBlock>
            <TextBlock FontSize="13" Foreground="#FF8899AA"
                       TextWrapping="Wrap">
                Get your EVE Online client ready for EvEJS in just a few clicks!
                Follow each step below, or press "Run All Steps" after selecting your client.
            </TextBlock>
        </StackPanel>

        <!-- ── SCROLLABLE STEPS ───────────────────────────────────────── -->
        <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto"
                      Padding="0,0,6,0">
            <StackPanel>

                <!-- STEP 1  ─ Select Client ──────────────────────────── -->
                <Border Style="{StaticResource Card}">
                    <StackPanel>
                        <TextBlock Style="{StaticResource H2}">
                            STEP 1 &#x2014; Select EVE Client Folder</TextBlock>
                        <TextBlock Style="{StaticResource Desc}">
                            Browse to the folder where your EVE Online client
                            is installed.  You can select the folder that
                            contains "EVE\tq\bin64\exefile.exe", or any parent
                            above it &#x2014; we will auto-detect the right
                            subfolder for you.</TextBlock>
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*"/>
                                <ColumnDefinition Width="Auto"/>
                            </Grid.ColumnDefinitions>
                            <TextBox  Name="txtClientPath" Grid.Column="0"
                                      Background="#FF0D1B2A" Foreground="#FFEAEAEA"
                                      BorderBrush="#FF0F3460" Padding="8,6"
                                      FontSize="12"
                                      VerticalContentAlignment="Center"/>
                            <Button   Name="btnBrowse" Grid.Column="1"
                                      Content="Browse ..." Style="{StaticResource Btn}"
                                      Margin="8,0,0,0"/>
                        </Grid>
                        <TextBlock Name="lblStep1Status" Style="{StaticResource Status}"
                                   Text="&#x25CF;  Waiting &#x2014; select or paste your EVE client folder above."/>
                    </StackPanel>
                </Border>

                <!-- BUILD WARNING (hidden by default) ────────────────── -->
                <Border Name="pnlBuildWarning" Visibility="Collapsed"
                        Background="#33E94560" CornerRadius="8" Padding="18"
                        Margin="0,0,0,12"
                        BorderBrush="#FFE94560" BorderThickness="3">
                    <StackPanel>
                        <TextBlock FontSize="20" FontWeight="Bold"
                                   Foreground="#FFE94560"
                                   HorizontalAlignment="Center"
                                   Margin="0,0,0,6">
                            &#x26A0;  WRONG CLIENT BUILD VERSION  &#x26A0;</TextBlock>
                        <TextBlock Name="lblBuildWarningDetail"
                                   FontSize="14" Foreground="#FFEAEAEA"
                                   TextWrapping="Wrap" TextAlignment="Center"
                                   LineHeight="22"/>
                    </StackPanel>
                </Border>

                <!-- STEP 2 ─ Update Config ───────────────────────────── -->
                <Border Style="{StaticResource Card}">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="Auto"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0">
                            <TextBlock Style="{StaticResource H2}">
                                STEP 2 &#x2014; Update EvEJS Configuration</TextBlock>
                            <TextBlock Style="{StaticResource Desc}">
                                Saves your client path into EvEJSConfig.bat
                                so every other EvEJS script (StartServerOnly,
                                StartClientOnly, etc.) knows where to find
                                your client.</TextBlock>
                            <TextBlock Name="lblStep2Status"
                                       Style="{StaticResource Status}"
                                       Text="&#x25CF;  Select a client first"/>
                        </StackPanel>
                        <Button Name="btnStep2" Grid.Column="1"
                                Content="Run" Style="{StaticResource Btn}"
                                VerticalAlignment="Center" IsEnabled="False"/>
                    </Grid>
                </Border>

                <!-- STEP 3 ─ Install Certificates ────────────────────── -->
                <Border Style="{StaticResource Card}">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="Auto"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0">
                            <TextBlock Style="{StaticResource H2}">
                                STEP 3 &#x2014; Install SSL Certificates</TextBlock>
                            <TextBlock Style="{StaticResource Desc}">
                                Installs the EvEJS SSL certificates so your
                                client can securely connect to the local
                                server.  A new console window will open
                                &#x2014; a Windows security prompt may
                                appear; click Yes to allow it.</TextBlock>
                            <TextBlock Name="lblStep3Status"
                                       Style="{StaticResource Status}"
                                       Text="&#x25CF;  Select a client first"/>
                        </StackPanel>
                        <Button Name="btnStep3" Grid.Column="1"
                                Content="Run" Style="{StaticResource Btn}"
                                VerticalAlignment="Center" IsEnabled="False"/>
                    </Grid>
                </Border>

                <!-- STEP 4 ─ Patch blue.dll ──────────────────────────── -->
                <Border Style="{StaticResource Card}">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="Auto"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0">
                            <TextBlock Style="{StaticResource H2}">
                                STEP 4 &#x2014; Patch blue.dll</TextBlock>
                            <TextBlock Style="{StaticResource Desc}">
                                Verifies that your client's blue.dll is the
                                exact original supported build, then patches
                                it in place.  A backup of the original file
                                will be kept automatically as
                                blue.dll.original.</TextBlock>
                            <TextBlock Name="lblStep4Status"
                                       Style="{StaticResource Status}"
                                       Text="&#x25CF;  Select a client first"/>
                        </StackPanel>
                        <Button Name="btnStep4" Grid.Column="1"
                                Content="Patch" Style="{StaticResource Btn}"
                                VerticalAlignment="Center" IsEnabled="False"/>
                    </Grid>
                </Border>

                <!-- STEP 5 ─ Patch start.ini ─────────────────────────── -->
                <Border Style="{StaticResource Card}">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="Auto"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0">
                            <TextBlock Style="{StaticResource H2}">
                                STEP 5 &#x2014; Patch start.ini</TextBlock>
                            <TextBlock Style="{StaticResource Desc}">
                                Updates start.ini so the client connects to
                                your local EvEJS server instead of CCP's
                                live servers (cryptoPack=Placebo,
                                server=127.0.0.1).  A backup will be saved
                                as start.ini.original.</TextBlock>
                            <TextBlock Name="lblStep5Status"
                                       Style="{StaticResource Status}"
                                       Text="&#x25CF;  Select a client first"/>
                        </StackPanel>
                        <Button Name="btnStep5" Grid.Column="1"
                                Content="Run" Style="{StaticResource Btn}"
                                VerticalAlignment="Center" IsEnabled="False"/>
                    </Grid>
                </Border>

            </StackPanel>
        </ScrollViewer>

        <!-- ── FOOTER ─────────────────────────────────────────────────── -->
        <StackPanel Grid.Row="2" Margin="0,8,0,0">

            <!-- Progress bar -->
            <Grid Margin="0,0,0,12">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <ProgressBar Name="progressBar" Grid.Column="0"
                             Height="10" Background="#FF0D1B2A"
                             Foreground="#FF4ECCA3" BorderThickness="0"
                             Value="0" Maximum="5"/>
                <TextBlock   Name="lblProgress" Grid.Column="1"
                             Foreground="#FF8899AA" FontSize="12"
                             Margin="12,0,0,0"
                             VerticalAlignment="Center"
                             Text="0 / 5 steps complete"/>
            </Grid>

            <!-- All-done banner (hidden) -->
            <Border Name="pnlAllDone" Visibility="Collapsed"
                    Background="#224ECCA3" CornerRadius="8" Padding="16"
                    Margin="0,0,0,12"
                    BorderBrush="#FF4ECCA3" BorderThickness="2">
                <TextBlock Name="lblAllDone" FontSize="14" FontWeight="SemiBold"
                           Foreground="#FF4ECCA3" TextAlignment="Center"
                           TextWrapping="Wrap">
                    All done! Your client is ready.
                    Use StartServerOnly.bat then StartClientOnly.bat to play.
                </TextBlock>
            </Border>

            <!-- Action buttons -->
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Center">
                <Button Name="btnRunAll"
                        Style="{StaticResource GoBig}"
                        IsEnabled="False" Margin="0,0,12,0">
                    &#x25BA;  Run All Steps</Button>
                <Button Name="btnClose"
                        Content="Close" Style="{StaticResource Btn}"
                        Padding="28,12" FontSize="14"/>
            </StackPanel>
        </StackPanel>
    </Grid>
</Window>
'@

# ═══════════════════════════════════════════════════════════════════════════════
# BUILD WINDOW + BIND CONTROLS
# ═══════════════════════════════════════════════════════════════════════════════
$reader = New-Object System.Xml.XmlNodeReader $Xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Named controls
$txtClientPath       = $window.FindName("txtClientPath")
$btnBrowse           = $window.FindName("btnBrowse")
$lblStep1Status      = $window.FindName("lblStep1Status")
$pnlBuildWarning     = $window.FindName("pnlBuildWarning")
$lblBuildWarningDetail = $window.FindName("lblBuildWarningDetail")
$lblStep2Status      = $window.FindName("lblStep2Status")
$btnStep2            = $window.FindName("btnStep2")
$lblStep3Status      = $window.FindName("lblStep3Status")
$btnStep3            = $window.FindName("btnStep3")
$lblStep4Status      = $window.FindName("lblStep4Status")
$btnStep4            = $window.FindName("btnStep4")
$lblStep5Status      = $window.FindName("lblStep5Status")
$btnStep5            = $window.FindName("btnStep5")
$progressBar         = $window.FindName("progressBar")
$lblProgress         = $window.FindName("lblProgress")
$pnlAllDone          = $window.FindName("pnlAllDone")
$lblAllDone          = $window.FindName("lblAllDone")
$btnRunAll           = $window.FindName("btnRunAll")
$btnClose            = $window.FindName("btnClose")

# ═══════════════════════════════════════════════════════════════════════════════
# STEP LOGIC
# ═══════════════════════════════════════════════════════════════════════════════

# ── Evaluate which steps are already satisfied ─────────────────────────────
function Check-StepStatuses {
    # Step 2 - config: parse the actual path the bat file resolves to
    $script:StepDone[2] = $false
    if (Test-Path $ConfigBat) {
        foreach ($cl in [System.IO.File]::ReadAllLines($ConfigBat)) {
            if ($cl -match '^set "EVEJS_CLIENT_PATH=(.+)"') {
                $cfgPath = $Matches[1] -replace '%EVEJS_REPO_ROOT%', $RepoRoot
                if ($cfgPath.TrimEnd('\') -eq $script:TqPath.TrimEnd('\')) {
                    Set-Status $lblStep2Status "Already configured  --  EvEJSConfig.bat points to this client." $C_GREEN
                    $script:StepDone[2] = $true
                } else {
                    Set-Status $lblStep2Status "Ready  --  will update EvEJSConfig.bat with your client path." $C_BLUE
                }
                break
            }
        }
    }

    # Step 3 - certs: check CA in cert store + CA appended to client bundles
    $caCertPem = Join-Path $RepoRoot "server\certs\xmpp-ca-cert.pem"
    $certInStore  = $false
    $certInBundle = $false
    if (Test-Path $caCertPem) {
        try {
            $caCert = Get-PfxCertificate -FilePath $caCertPem -ErrorAction SilentlyContinue
            if ($caCert) {
                $existing = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
                            Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
                if ($existing) { $certInStore = $true }
            }
        } catch {}

        # Check if CA PEM is in at least one client cacert.pem bundle
        $caContent = ([System.IO.File]::ReadAllText($caCertPem)).Trim()
        $bundlePaths = @(
            (Join-Path $script:TqPath "bin64\cacert.pem"),
            (Join-Path $script:TqPath "bin64\packages\certifi\cacert.pem")
        )
        foreach ($bp in $bundlePaths) {
            if ((Test-Path $bp) -and ([System.IO.File]::ReadAllText($bp)).Contains($caContent)) {
                $certInBundle = $true; break
            }
        }
    }

    if ($certInStore -and $certInBundle) {
        Set-Status $lblStep3Status "Already installed  --  CA is trusted and present in client bundles." $C_GREEN
        $script:StepDone[3] = $true
    } elseif ($certInStore) {
        Set-Status $lblStep3Status "Partially done  --  CA is trusted but not yet in client bundles. Run to finish." $C_AMBER
        $script:StepDone[3] = $false
    } elseif ($certInBundle) {
        Set-Status $lblStep3Status "Partially done  --  CA is in client bundles but not yet trusted in Windows. Run to finish." $C_AMBER
        $script:StepDone[3] = $false
    } else {
        Set-Status $lblStep3Status "Ready  --  a console window will open for the certificate install." $C_BLUE
        $script:StepDone[3] = $false
    }

    # Step 4 - blue.dll
    $script:StepDone[4] = $false
    $destDll = Join-Path $script:TqPath "bin64\blue.dll"
    $patchState = Get-BlueDllPatchState $destDll
    switch ($patchState.State) {
        "already_patched" {
            Set-Status $lblStep4Status "Already patched  --  blue.dll matches the EvEJS version." $C_GREEN
            $script:StepDone[4] = $true
        }
        "patchable_original" {
            Set-Status $lblStep4Status "Ready  --  exact original blue.dll detected; Step 4 will patch it in place and keep blue.dll.original." $C_BLUE
        }
        "patchable_variant" {
            Set-Status $lblStep4Status "Ready  --  compatible blue.dll variant detected; Step 4 will validate the final hash before patching and keep blue.dll.original." $C_AMBER
        }
        "unsupported" {
            Set-Status $lblStep4Status "Unsupported  --  $($patchState.Message)" $C_RED
        }
        "missing_file" {
            Set-Status $lblStep4Status "blue.dll was not found in bin64. Restore the client file before running Step 4." $C_RED
        }
        "missing_recipe" {
            Set-Status $lblStep4Status "ERROR: ClientSETUP\\blue_patch_recipe.json is missing." $C_RED
        }
        "missing_patcher" {
            Set-Status $lblStep4Status "ERROR: ClientSETUP\\blue_dll_patch.ps1 is missing." $C_RED
        }
        default {
            Set-Status $lblStep4Status $patchState.Message $C_RED
        }
    }

    # Step 5 - start.ini
    $iniPath = Join-Path $script:TqPath "start.ini"
    $iniSummary = Get-StartIniPatchSummary $iniPath
    if ($iniSummary.Exists) {
        if ($iniSummary.IsPatched) {
            Set-Status $lblStep5Status "Already patched  --  start.ini has correct values." $C_GREEN
            $script:StepDone[5] = $true
        } else {
            Set-Status $lblStep5Status "Ready  --  $($iniSummary.Summary)" $C_BLUE
            $script:StepDone[5] = $false
        }
    } else {
        Set-Status $lblStep5Status "start.ini was not found in the selected client folder." $C_RED
        $script:StepDone[5] = $false
    }

    Update-Progress
}

# ── Step 1: Client selection ──────────────────────────────────────────────
function Invoke-ClientSelection([string]$Path) {
    if (-not $Path -or -not (Test-Path $Path)) {
        Set-Status $lblStep1Status "That folder does not exist. Please check the path and try again." $C_RED
        $script:StepDone[1] = $false
        Enable-StepButtons $false
        $pnlBuildWarning.Visibility = "Collapsed"
        Update-Progress
        return
    }

    $tq = Find-TqPath $Path
    if (-not $tq) {
        Set-Status $lblStep1Status ("Could not find exefile.exe inside that folder.`n" +
            "Tip: select the folder that contains  EVE\tq\bin64\exefile.exe  (or any parent above it).") $C_RED
        $script:StepDone[1] = $false
        Enable-StepButtons $false
        $pnlBuildWarning.Visibility = "Collapsed"
        Update-Progress
        return
    }

    $script:TqPath = $tq
    $txtClientPath.Text = $tq

    # Read build number
    $iniPath = Join-Path $tq "start.ini"
    $script:BuildNumber = Read-IniValue $iniPath "build"

    if (-not $script:BuildNumber) {
        Set-Status $lblStep1Status "Could not read build number from start.ini. The file may be missing or damaged." $C_RED
        $pnlBuildWarning.Visibility = "Collapsed"
        $script:StepDone[1] = $false
        Enable-StepButtons $false
        Update-Progress
        return
    }

    # Build comparison
    if ($script:BuildNumber -eq $REQUIRED_BUILD) {
        Set-Status $lblStep1Status "Client found!  Build $($script:BuildNumber) -- correct version." $C_GREEN
        $pnlBuildWarning.Visibility = "Collapsed"
    } else {
        Set-Status $lblStep1Status "Client found, but build is $($script:BuildNumber) (expected $REQUIRED_BUILD)." $C_AMBER
        try {
            $bInt = [long]$script:BuildNumber
            $rInt = [long]$REQUIRED_BUILD
            if ($bInt -gt $rInt) {
                $lblBuildWarningDetail.Text = (
                    "Your client build ($($script:BuildNumber)) is NEWER than the supported version ($REQUIRED_BUILD).`n`n" +
                    "EvEJS has not been updated to support this client yet.`n" +
                    "You MUST obtain build $REQUIRED_BUILD for things to work correctly.")
            } else {
                $lblBuildWarningDetail.Text = (
                    "Your client build ($($script:BuildNumber)) is TOO OLD and is no longer supported.`n`n" +
                    "You MUST obtain build $REQUIRED_BUILD for things to work correctly.")
            }
        } catch {
            $lblBuildWarningDetail.Text = (
                "Build '$($script:BuildNumber)' could not be compared numerically.`n" +
                "Expected build: $REQUIRED_BUILD")
        }
        $pnlBuildWarning.Visibility = "Visible"
    }

    $script:StepDone[1] = $true
    Enable-StepButtons $true
    Check-StepStatuses
}

# ── Step 2: Update EvEJSConfig.bat ────────────────────────────────────────
function Invoke-Step2 {
    if (-not $script:TqPath) {
        Set-Status $lblStep2Status "Select a client first." $C_RED; return $false }

    Set-Status $lblStep2Status "Updating EvEJSConfig.bat ..." $C_AMBER; Flush-UI

    try {
        Ensure-LauncherConfig
        $lines   = [System.IO.File]::ReadAllLines($ConfigBat)
        $newLines = [System.Collections.Generic.List[string]]::new()
        $hit     = $false

        foreach ($line in $lines) {
            if ($line -match '^set "EVEJS_CLIENT_PATH=') {
                $newLines.Add("set `"EVEJS_CLIENT_PATH=$($script:TqPath)`"")
                $hit = $true
            } else {
                $newLines.Add($line)
            }
        }
        if (-not $hit) { $newLines.Add("set `"EVEJS_CLIENT_PATH=$($script:TqPath)`"") }

        [System.IO.File]::WriteAllLines($ConfigBat, $newLines.ToArray())

        # Verify
        $check = [System.IO.File]::ReadAllText($ConfigBat)
        if ($check.Contains($script:TqPath)) {
            Set-Status $lblStep2Status "Configuration updated!  EvEJSConfig.bat now points to your client." $C_GREEN
            $script:StepDone[2] = $true; Update-Progress; return $true
        } else {
            Set-Status $lblStep2Status "Write appeared to succeed but verification failed." $C_RED
            return $false
        }
    } catch {
        Set-Status $lblStep2Status "Failed: $($_.Exception.Message)" $C_RED
        return $false
    }
}

# ── Step 3: Install certificates ──────────────────────────────────────────
function Invoke-Step3 {
    if (-not $script:TqPath) {
        Set-Status $lblStep3Status "Select a client first." $C_RED; return $false }

    # Config must be written first so InstallCerts.bat picks up the path
    if (-not $script:StepDone[2]) {
        if (-not (Invoke-Step2)) {
            Set-Status $lblStep3Status "Cannot install certs: config update (Step 2) failed." $C_RED
            return $false
        }
        Flush-UI
    }

    if (-not (Test-Path $InstallCertsBat)) {
        Set-Status $lblStep3Status "InstallCerts.bat not found at: $InstallCertsBat" $C_RED
        return $false
    }

    Set-Status $lblStep3Status "Installing certificates  --  a new window will open; follow the prompts ..." $C_AMBER
    Flush-UI

    try {
        $proc = Start-Process -FilePath "cmd.exe" `
                    -ArgumentList "/c `"`"$InstallCertsBat`"`"" `
                    -Wait -PassThru

        if ($proc.ExitCode -eq 0) {
            Set-Status $lblStep3Status "Certificates installed successfully!" $C_GREEN
            $script:StepDone[3] = $true; Update-Progress; return $true
        } else {
            Set-Status $lblStep3Status "Certificate install failed  (exit code $($proc.ExitCode)).  Check the console output." $C_RED
            return $false
        }
    } catch {
        Set-Status $lblStep3Status "Failed to launch installer: $($_.Exception.Message)" $C_RED
        return $false
    }
}

# ── Step 4: Patch blue.dll ────────────────────────────────────────────────
function Invoke-Step4 {
    if (-not $script:TqPath) {
        Set-Status $lblStep4Status "Select a client first." $C_RED; return $false }

    if (-not (Test-Path $BlueDllPatchCli)) {
        Set-Status $lblStep4Status "tools\ClientSETUP\blue_dll_patch.ps1 is missing from the repository!" $C_RED
        return $false
    }

    if (-not (Test-Path $BlueDllPatchRecipePath)) {
        Set-Status $lblStep4Status "tools\ClientSETUP\blue_patch_recipe.json is missing from the repository!" $C_RED
        return $false
    }

    $destDir = Join-Path $script:TqPath "bin64"
    $destDll = Join-Path $destDir "blue.dll"

    if (-not (Test-Path $destDir)) {
        Set-Status $lblStep4Status "bin64 folder not found at: $destDir" $C_RED
        return $false
    }

    Set-Status $lblStep4Status "Patching blue.dll ..." $C_AMBER; Flush-UI

    try {
        $patchState = Get-BlueDllPatchState $destDll
        switch ($patchState.State) {
            "already_patched" {
                Set-Status $lblStep4Status "Already patched  --  blue.dll is up to date." $C_GREEN
                $script:StepDone[4] = $true; Update-Progress; return $true
            }
            "patchable_original" { }
            "patchable_variant" { }
            "unsupported" {
                Set-Status $lblStep4Status "Cannot patch  --  $($patchState.Message)" $C_RED
                return $false
            }
            "missing_file" {
                Set-Status $lblStep4Status "Cannot patch  --  blue.dll was not found in bin64." $C_RED
                return $false
            }
            "missing_recipe" {
                Set-Status $lblStep4Status "Cannot patch  --  tools\ClientSETUP\blue_patch_recipe.json is missing." $C_RED
                return $false
            }
            "missing_patcher" {
                Set-Status $lblStep4Status "Cannot patch  --  tools\ClientSETUP\blue_dll_patch.ps1 is missing." $C_RED
                return $false
            }
            default {
                Set-Status $lblStep4Status $patchState.Message $C_RED
                return $false
            }
        }

        $patchArgs = @(
            "--input", $destDll,
            "--in-place",
            "--backup-suffix", ".original",
            "--recipe", $BlueDllPatchRecipePath
        )
        if ($patchState.State -eq "patchable_variant") {
            $patchArgs += "--attempt-anyway"
        }

        $patchResult = Invoke-BlueDllPatchHelper -Arguments $patchArgs
        $output = @($patchResult.Output)
        $exitCode = [int]$patchResult.ExitCode
        if ($exitCode -ne 0) {
            $detail = ($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ }) -join " "
            if (-not $detail) { $detail = "The local blue.dll patch helper returned exit code $exitCode." }
            Set-Status $lblStep4Status "Patch failed  --  $detail" $C_RED
            return $false
        }

        $finalState = Get-BlueDllPatchState $destDll
        if ($finalState.State -eq "already_patched") {
            Set-Status $lblStep4Status "blue.dll patched!  Original preserved as blue.dll.original." $C_GREEN
            $script:StepDone[4] = $true; Update-Progress; return $true
        } else {
            Set-Status $lblStep4Status "Patch command ran, but final verification did not report a patched state." $C_RED
            return $false
        }
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match "used by another process") {
            Set-Status $lblStep4Status "blue.dll is locked!  Close your EVE client first, then try again." $C_RED
        } else {
            Set-Status $lblStep4Status "Failed: $msg" $C_RED
        }
        return $false
    }
}

# ── Step 5: Patch start.ini ──────────────────────────────────────────────
function Invoke-Step5 {
    if (-not $script:TqPath) {
        Set-Status $lblStep5Status "Select a client first." $C_RED; return $false }

    $iniPath = Join-Path $script:TqPath "start.ini"

    if (-not (Test-Path $iniPath)) {
        Set-Status $lblStep5Status "start.ini not found at: $iniPath" $C_RED
        return $false
    }

    Set-Status $lblStep5Status "Patching start.ini ..." $C_AMBER; Flush-UI

    try {
        $iniSummary = Get-StartIniPatchSummary $iniPath
        if ($iniSummary.IsPatched) {
            Set-Status $lblStep5Status "Already patched  --  values are correct." $C_GREEN
            $script:StepDone[5] = $true; Update-Progress; return $true
        }

        # Backup (once)
        $backup = "$iniPath.original"
        if (-not (Test-Path $backup)) { Copy-Item -LiteralPath $iniPath -Destination $backup }

        # Rewrite the file to use the same canonical lines as the repo template.
        Set-StartIniPatchValues $iniPath

        # Verify
        $finalSummary = Get-StartIniPatchSummary $iniPath
        if ($finalSummary.IsPatched) {
            Set-Status $lblStep5Status "start.ini patched to match the EvEJS template.  Original backed up." $C_GREEN
            $script:StepDone[5] = $true; Update-Progress; return $true
        } else {
            Set-Status $lblStep5Status "Write succeeded but verification failed.  Check start.ini manually." $C_RED
            return $false
        }
    } catch {
        Set-Status $lblStep5Status "Failed: $($_.Exception.Message)" $C_RED
        return $false
    }
}

# ── Run All (Steps 2-5 in order) ─────────────────────────────────────────
function Invoke-AllSteps {
    $btnRunAll.IsEnabled = $false
    Enable-StepButtons $false
    Flush-UI

    $ok = $true

    if ($ok -and -not $script:StepDone[2]) { if (-not (Invoke-Step2)) { $ok = $false }; Flush-UI }
    if ($ok -and -not $script:StepDone[3]) { if (-not (Invoke-Step3)) { $ok = $false }; Flush-UI }
    if ($ok -and -not $script:StepDone[4]) { if (-not (Invoke-Step4)) { $ok = $false }; Flush-UI }
    if ($ok -and -not $script:StepDone[5]) { if (-not (Invoke-Step5)) { $ok = $false }; Flush-UI }

    Enable-StepButtons $true

    if (-not $ok) {
        [System.Windows.MessageBox]::Show(
            "One or more steps failed - check the status messages for details.`n`nYou can retry individual steps with their Run buttons.",
            "EvEJS Setup",
            [System.Windows.MessageBoxButton]::OK,
            [System.Windows.MessageBoxImage]::Warning) | Out-Null
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# EVENT WIRING
# ═══════════════════════════════════════════════════════════════════════════════

# Browse button
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description         = "Select your EVE Online client folder"
    $dlg.ShowNewFolderButton = $false
    $dlg.RootFolder          = [System.Environment+SpecialFolder]::MyComputer
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        Invoke-ClientSelection $dlg.SelectedPath
    }
})

# Allow typing / pasting a path
$txtClientPath.Add_KeyDown({
    if ($_.Key -eq "Return") { Invoke-ClientSelection $txtClientPath.Text }
})

# Individual step buttons
$btnStep2.Add_Click({ Invoke-Step2 })
$btnStep3.Add_Click({ Invoke-Step3 })
$btnStep4.Add_Click({ Invoke-Step4 })
$btnStep5.Add_Click({ Invoke-Step5 })

# Run All
$btnRunAll.Add_Click({ Invoke-AllSteps })

# Close
$btnClose.Add_Click({ $window.Close() })

# ═══════════════════════════════════════════════════════════════════════════════
# PRE-FLIGHT CHECKS
# ═══════════════════════════════════════════════════════════════════════════════
Ensure-LauncherConfig
$missing = @()
if (-not (Test-Path $ConfigBat))      { $missing += "tools\ClientSETUP\scripts\EvEJSConfig.bat" }
if (-not (Test-Path $InstallCertsBat)){ $missing += "tools\ClientSETUP\scripts\InstallCerts.bat" }
if (-not (Test-Path $BlueDllPatchCli)) { $missing += "tools\ClientSETUP\blue_dll_patch.ps1" }
if (-not (Test-Path $BlueDllPatchRecipePath)) { $missing += "tools\ClientSETUP\blue_patch_recipe.json" }

if ($missing.Count -gt 0) {
    [System.Windows.MessageBox]::Show(
        "The following required files are missing:`n`n" +
        ($missing -join "`n") +
        "`n`nMake sure you are running this from inside the EvEJS repository.",
        "EvEJS Setup - Missing Files",
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error) | Out-Null
}

# ═══════════════════════════════════════════════════════════════════════════════
# AUTO-DETECT EXISTING CONFIG ON STARTUP
# ═══════════════════════════════════════════════════════════════════════════════
if (Test-Path $ConfigBat) {
    # Parse the current EVEJS_CLIENT_PATH out of EvEJSConfig.bat
    foreach ($cfgLine in [System.IO.File]::ReadAllLines($ConfigBat)) {
        if ($cfgLine -match '^set "EVEJS_CLIENT_PATH=(.+)"') {
            $existingPath = $Matches[1]
            # Expand %EVEJS_REPO_ROOT% if present
            if ($existingPath -match '%EVEJS_REPO_ROOT%') {
                $existingPath = $existingPath -replace '%EVEJS_REPO_ROOT%', $RepoRoot
            }
            if (Test-Path (Join-Path $existingPath "bin64\exefile.exe")) {
                Invoke-ClientSelection $existingPath
            }
            break
        }
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# SHOW WINDOW
# ═══════════════════════════════════════════════════════════════════════════════
$window.ShowDialog() | Out-Null
