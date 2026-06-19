Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
[System.Windows.Forms.Application]::EnableVisualStyles()

# ── Dark title bar via DWM (Windows 10/11) ──
# This only needs basic System types — no extra assembly refs needed
try {
    Add-Type -ErrorAction Stop @"
using System;
using System.Runtime.InteropServices;
public class DwmHelper {
    [DllImport("dwmapi.dll", PreserveSig = true)]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    public static void SetDarkTitleBar(IntPtr hwnd) {
        int val = 1;
        DwmSetWindowAttribute(hwnd, 20, ref val, 4);
    }
}
"@
} catch {}

# ── Paths (unchanged) ──
$script:RepoRoot   = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$script:SeedBatch  = Join-Path $PSScriptRoot "BuildMarketSeed.bat"
$script:SeedConfig = Join-Path $PSScriptRoot "config\market-seed.local.toml"
$script:SeedReadme = Join-Path $PSScriptRoot "README.md"

# ── Launch helper (unchanged) ──
function Start-SeedConsole {
    param([Parameter(Mandatory=$true)][string]$Mode)
    $batchPath = '"' + $script:SeedBatch + '"'
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k $batchPath $Mode" -WorkingDirectory $script:RepoRoot | Out-Null
}

function Open-TextFile {
    param([Parameter(Mandatory=$true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        [void][System.Windows.Forms.MessageBox]::Show(
            "File not found:`n$Path",
            "EvEJS Market Seed Builder",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        return
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    Start-Process -FilePath "notepad.exe" -ArgumentList @($resolvedPath) | Out-Null
}

# ══════════════════════════════════════════════════════════
# HELPER: Enable double-buffering via reflection (no C#)
# ══════════════════════════════════════════════════════════
$script:dbProp = [System.Windows.Forms.Control].GetProperty(
    "DoubleBuffered",
    [System.Reflection.BindingFlags]"Instance,NonPublic"
)
$script:setStyleMethod = [System.Windows.Forms.Control].GetMethod(
    "SetStyle",
    [System.Reflection.BindingFlags]"Instance,NonPublic"
)
$script:bufferFlags = [System.Windows.Forms.ControlStyles]::AllPaintingInWmPaint -bor
    [System.Windows.Forms.ControlStyles]::UserPaint -bor
    [System.Windows.Forms.ControlStyles]::OptimizedDoubleBuffer

function Enable-DoubleBuffer($ctrl) {
    [void]$script:dbProp.SetValue($ctrl, $true)
    [void]$script:setStyleMethod.Invoke($ctrl, @($script:bufferFlags, $true))
}

function New-BufferedPanel {
    $p = New-Object System.Windows.Forms.Panel
    Enable-DoubleBuffer $p
    return $p
}

# ══════════════════════════════════════════════════════════
# COLOR PALETTE — EVE Online inspired deep space theme
# ══════════════════════════════════════════════════════════
$c = @{
    BgDeep          = [System.Drawing.Color]::FromArgb(12, 13, 23)
    BgPanel         = [System.Drawing.Color]::FromArgb(20, 22, 38)
    BgCard          = [System.Drawing.Color]::FromArgb(28, 31, 52)
    BgCardHover     = [System.Drawing.Color]::FromArgb(38, 42, 68)
    BgInput         = [System.Drawing.Color]::FromArgb(22, 24, 40)
    Accent          = [System.Drawing.Color]::FromArgb(0, 180, 216)
    AccentBright    = [System.Drawing.Color]::FromArgb(50, 210, 240)
    AccentDim       = [System.Drawing.Color]::FromArgb(0, 100, 130)
    AccentSubtle    = [System.Drawing.Color]::FromArgb(20, 40, 58)
    TextWhite       = [System.Drawing.Color]::FromArgb(230, 235, 245)
    TextPrimary     = [System.Drawing.Color]::FromArgb(195, 200, 215)
    TextSecondary   = [System.Drawing.Color]::FromArgb(130, 140, 165)
    TextMuted       = [System.Drawing.Color]::FromArgb(80, 88, 110)
    Border          = [System.Drawing.Color]::FromArgb(40, 44, 65)
    BorderLight     = [System.Drawing.Color]::FromArgb(55, 60, 85)
    BorderAccent    = [System.Drawing.Color]::FromArgb(0, 130, 160)
    BtnPrimary      = [System.Drawing.Color]::FromArgb(0, 140, 175)
    BtnPrimaryHov   = [System.Drawing.Color]::FromArgb(0, 170, 210)
    BtnPrimaryPress = [System.Drawing.Color]::FromArgb(0, 110, 140)
    BtnGhost        = [System.Drawing.Color]::FromArgb(35, 38, 58)
    BtnGhostHov     = [System.Drawing.Color]::FromArgb(48, 52, 78)
    BtnGhostPress   = [System.Drawing.Color]::FromArgb(28, 31, 48)
    Green           = [System.Drawing.Color]::FromArgb(80, 200, 120)
    GreenDim        = [System.Drawing.Color]::FromArgb(20, 50, 35)
    Orange          = [System.Drawing.Color]::FromArgb(255, 170, 50)
    OrangeDim       = [System.Drawing.Color]::FromArgb(50, 38, 15)
    Red             = [System.Drawing.Color]::FromArgb(220, 80, 80)
}

# ══════════════════════════════════════════════════════════
# FONTS
# ══════════════════════════════════════════════════════════
$fonts = @{
    Title      = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
    Subtitle   = New-Object System.Drawing.Font("Segoe UI", 11)
    Section    = New-Object System.Drawing.Font("Segoe UI Semibold", 9)
    BtnTitle   = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
    BtnDesc    = New-Object System.Drawing.Font("Segoe UI", 8.5)
    Small      = New-Object System.Drawing.Font("Segoe UI", 9)
    SmallBold  = New-Object System.Drawing.Font("Segoe UI Semibold", 9)
    Mono       = New-Object System.Drawing.Font("Consolas", 8.5)
    Tiny       = New-Object System.Drawing.Font("Segoe UI", 8)
    Badge      = New-Object System.Drawing.Font("Segoe UI Semibold", 7.5)
    Icon       = New-Object System.Drawing.Font("Segoe UI Symbol", 16)
}

# ══════════════════════════════════════════════════════════
# MAIN FORM
# ══════════════════════════════════════════════════════════
$form = New-Object System.Windows.Forms.Form
Enable-DoubleBuffer $form
$form.Text = "EvEJS Market Seed Builder"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(780, 680)
$form.MinimumSize = New-Object System.Drawing.Size(780, 680)
$form.MaximizeBox = $false
$form.FormBorderStyle = "FixedSingle"
$form.BackColor = $c.BgDeep
$form.ForeColor = $c.TextPrimary
$form.Opacity = 0

# Apply dark title bar
$form.Add_HandleCreated({
    try { [DwmHelper]::SetDarkTitleBar($form.Handle) } catch {}
})

# Custom icon
try {
    $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(
        [System.IO.Path]::Combine([Environment]::GetFolderPath("System"), "shell32.dll")
    )
} catch {}

# ── Tooltip component ──
$tooltip = New-Object System.Windows.Forms.ToolTip
$tooltip.InitialDelay = 400
$tooltip.ReshowDelay = 200
$tooltip.AutoPopDelay = 8000
$tooltip.BackColor = [System.Drawing.Color]::FromArgb(35, 38, 58)
$tooltip.ForeColor = [System.Drawing.Color]::FromArgb(195, 200, 215)

# ══════════════════════════════════════════════════════════
# HEADER SECTION
# ══════════════════════════════════════════════════════════
$headerPanel = New-BufferedPanel
$headerPanel.Location = New-Object System.Drawing.Point(0, 0)
$headerPanel.Size = New-Object System.Drawing.Size(780, 100)
$headerPanel.BackColor = $c.BgPanel
$form.Controls.Add($headerPanel)

# Accent line under header
$accentLine = New-BufferedPanel
$accentLine.Location = New-Object System.Drawing.Point(0, 100)
$accentLine.Size = New-Object System.Drawing.Size(780, 2)
$accentLine.BackColor = $c.Accent
$form.Controls.Add($accentLine)

$accentLine.Add_Paint({
    param($s, $e)
    $rect = $s.ClientRectangle
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $c.AccentDim, $c.AccentBright,
        [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
    )
    $e.Graphics.FillRectangle($brush, $rect)
    $brush.Dispose()
})

# Star icon + Title
$headerPanel.Add_Paint({
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = "AntiAlias"
    $g.TextRenderingHint = "ClearTypeGridFit"

    $starBrush = New-Object System.Drawing.SolidBrush($c.Accent)
    $g.DrawString([char]0x2726, $fonts.Title, $starBrush, 28, 18)
    $starBrush.Dispose()

    $titleBrush = New-Object System.Drawing.SolidBrush($c.TextWhite)
    $g.DrawString("EvEJS Market Seed Builder", $fonts.Title, $titleBrush, 62, 18)
    $titleBrush.Dispose()

    $subBrush = New-Object System.Drawing.SolidBrush($c.TextSecondary)
    $g.DrawString("Build standalone market databases for development and testing", $fonts.Subtitle, $subBrush, 32, 60)
    $subBrush.Dispose()
})

# ══════════════════════════════════════════════════════════
# HELPER: Rounded rectangle path
# ══════════════════════════════════════════════════════════
function New-RoundedPath {
    param([System.Drawing.Rectangle]$Rect, [int]$Radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $Radius * 2
    $path.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
    $path.AddArc($Rect.Right - $d - 1, $Rect.Y, $d, $d, 270, 90)
    $path.AddArc($Rect.Right - $d - 1, $Rect.Bottom - $d - 1, $d, $d, 0, 90)
    $path.AddArc($Rect.X, $Rect.Bottom - $d - 1, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# ══════════════════════════════════════════════════════════
# HELPER: Create an action card (button with icon + desc)
# ══════════════════════════════════════════════════════════
function New-ActionCard {
    param(
        [string]$Icon,
        [string]$Title,
        [string]$Description,
        [string]$TooltipText,
        [int]$X, [int]$Y,
        [int]$Width = 340, [int]$Height = 90,
        [scriptblock]$OnClick,
        [bool]$IsPrimary = $false,
        [bool]$IsRecommended = $false,
        [string]$AccentColor = ""
    )

    $card = New-BufferedPanel
    $card.Location = New-Object System.Drawing.Point($X, $Y)
    $card.Size = New-Object System.Drawing.Size($Width, $Height)
    $card.BackColor = $c.BgCard
    $card.Cursor = [System.Windows.Forms.Cursors]::Hand
    $card.Tag = @{
        Hovered = $false; Pressed = $false
        Icon = $Icon; Title = $Title; Desc = $Description
        Primary = $IsPrimary; Recommended = $IsRecommended; AccentColor = $AccentColor
        Action = $OnClick.GetNewClosure()
    }

    if ($TooltipText) { $tooltip.SetToolTip($card, $TooltipText) }

    $card.Add_Paint({
        param($s, $e)
        $g = $e.Graphics
        $g.SmoothingMode = "AntiAlias"
        $g.TextRenderingHint = "ClearTypeGridFit"
        $tag = $s.Tag
        $rect = $s.ClientRectangle

        # Choose background color based on state
        $bgColor = if ($tag.Pressed) {
            if ($tag.Primary) { $c.BtnPrimaryPress } else { $c.BtnGhostPress }
        } elseif ($tag.Hovered) {
            if ($tag.Primary) { $c.BtnPrimaryHov } else { $c.BgCardHover }
        } else {
            if ($tag.Primary) { $c.BtnPrimary } else { $c.BgCard }
        }

        # Rounded background
        $path = New-RoundedPath -Rect $rect -Radius 8
        $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
        $g.FillPath($bgBrush, $path)
        $bgBrush.Dispose()

        # Border
        $borderColor = if ($tag.Hovered -or $tag.Pressed) { $c.BorderAccent }
                       elseif ($tag.Primary) { $c.AccentDim }
                       else { $c.Border }
        $pen = New-Object System.Drawing.Pen($borderColor, 1)
        $g.DrawPath($pen, $path)
        $pen.Dispose()

        # Left accent stripe
        if ($tag.Primary -or $tag.AccentColor) {
            $stripeColor = if ($tag.AccentColor -eq "green") { $c.Green }
                           elseif ($tag.AccentColor -eq "orange") { $c.Orange }
                           else { $c.Accent }
            $stripeRect = New-Object System.Drawing.Rectangle -ArgumentList $rect.X, ($rect.Y + 8), 4, ($rect.Height - 16)
            $stripeBrush = New-Object System.Drawing.SolidBrush($stripeColor)
            $g.FillRectangle($stripeBrush, $stripeRect)
            $stripeBrush.Dispose()
        }

        # Icon
        $iconColor = if ($tag.Primary) { $c.TextWhite } else { $c.Accent }
        $iconBrush = New-Object System.Drawing.SolidBrush($iconColor)
        $g.DrawString($tag.Icon, $fonts.Icon, $iconBrush, 16, $(if ($s.Height -gt 70) { 22 } else { 14 }))
        $iconBrush.Dispose()

        # Title
        $titleBrush = New-Object System.Drawing.SolidBrush($c.TextWhite)
        $g.DrawString($tag.Title, $fonts.BtnTitle, $titleBrush, 52, $(if ($s.Height -gt 70) { 18 } else { 12 }))
        $titleBrush.Dispose()

        # Description
        if ($tag.Desc -and $s.Height -gt 55) {
            $descColor = if ($tag.Primary) { [System.Drawing.Color]::FromArgb(180, 200, 220) } else { $c.TextSecondary }
            $descBrush = New-Object System.Drawing.SolidBrush($descColor)
            $descRect = New-Object System.Drawing.RectangleF -ArgumentList 52, 42, ($s.Width - 68), ($s.Height - 48)
            $g.DrawString($tag.Desc, $fonts.BtnDesc, $descBrush, $descRect)
            $descBrush.Dispose()
        }

        # "Recommended" badge
        if ($tag.Recommended) {
            $badgeText = " RECOMMENDED "
            $badgeSize = $g.MeasureString($badgeText, $fonts.Badge)
            $badgeX = $s.Width - $badgeSize.Width - 12
            $badgeY2 = 10
            $badgeRectF = New-Object System.Drawing.RectangleF -ArgumentList $badgeX, $badgeY2, $badgeSize.Width, ($badgeSize.Height + 2)
            $badgeRectI = [System.Drawing.Rectangle]::Round($badgeRectF)
            $badgePath = New-RoundedPath -Rect $badgeRectI -Radius 4
            $badgeBg = New-Object System.Drawing.SolidBrush($c.GreenDim)
            $g.FillPath($badgeBg, $badgePath)
            $badgeBg.Dispose()
            $badgeBorder = New-Object System.Drawing.Pen($c.Green, 1)
            $g.DrawPath($badgeBorder, $badgePath)
            $badgeBorder.Dispose()
            $badgeTxtBrush = New-Object System.Drawing.SolidBrush($c.Green)
            $g.DrawString($badgeText, $fonts.Badge, $badgeTxtBrush, $badgeX, $badgeY2 + 1)
            $badgeTxtBrush.Dispose()
            $badgePath.Dispose()
        }

        $path.Dispose()
    })

    # Hover/click effects
    $card.Add_MouseEnter({ param($s); $s.Tag.Hovered = $true; $s.Invalidate() })
    $card.Add_MouseLeave({ param($s); $s.Tag.Hovered = $false; $s.Tag.Pressed = $false; $s.Invalidate() })
    $card.Add_MouseDown({ param($s); $s.Tag.Pressed = $true; $s.Invalidate() })
    $card.Add_MouseUp({
        param($s, $e)
        $s.Tag.Pressed = $false; $s.Invalidate()
        if ($s.ClientRectangle.Contains($e.Location)) {
            $action = $s.Tag.Action
            if ($action -is [scriptblock]) { & $action }
        }
    })

    return $card
}

# ══════════════════════════════════════════════════════════
# HELPER: Section header label
# ══════════════════════════════════════════════════════════
function New-SectionHeader {
    param([string]$Text, [int]$X, [int]$Y)
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $Text.ToUpper()
    $lbl.Font = $fonts.Section
    $lbl.ForeColor = $c.TextMuted
    $lbl.AutoSize = $true
    $lbl.BackColor = $c.BgDeep
    $lbl.Location = New-Object System.Drawing.Point($X, $Y)
    return $lbl
}

# ══════════════════════════════════════════════════════════
# HELPER: Ghost button (for footer actions)
# ══════════════════════════════════════════════════════════
function New-GhostButton {
    param(
        [string]$Icon, [string]$Text,
        [int]$X, [int]$Y,
        [int]$Width = 140, [int]$Height = 38,
        [scriptblock]$OnClick, [object[]]$ActionArgs = @(), [string]$TooltipText = ""
    )
    $btn = New-BufferedPanel
    $btn.Location = New-Object System.Drawing.Point($X, $Y)
    $btn.Size = New-Object System.Drawing.Size($Width, $Height)
    $btn.BackColor = $c.BtnGhost
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
    $btn.Tag = @{
        Hovered = $false; Pressed = $false
        Icon = $Icon; Text = $Text
        Action = $OnClick.GetNewClosure()
        ActionArgs = @($ActionArgs)
    }

    if ($TooltipText) { $tooltip.SetToolTip($btn, $TooltipText) }

    $btn.Add_Paint({
        param($s, $e)
        $g = $e.Graphics
        $g.SmoothingMode = "AntiAlias"
        $g.TextRenderingHint = "ClearTypeGridFit"
        $tag = $s.Tag
        $rect = $s.ClientRectangle

        $bgColor = if ($tag.Pressed) { $c.BtnGhostPress }
                   elseif ($tag.Hovered) { $c.BtnGhostHov }
                   else { $c.BtnGhost }

        $path = New-RoundedPath -Rect $rect -Radius 6
        $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
        $g.FillPath($bgBrush, $path)
        $bgBrush.Dispose()

        $borderColor = if ($tag.Hovered) { $c.BorderLight } else { $c.Border }
        $pen = New-Object System.Drawing.Pen($borderColor, 1)
        $g.DrawPath($pen, $path)
        $pen.Dispose()

        $display = "$($tag.Icon)  $($tag.Text)"
        $txtColor = if ($tag.Hovered) { $c.TextWhite } else { $c.TextPrimary }
        $txtBrush = New-Object System.Drawing.SolidBrush($txtColor)
        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = "Center"
        $sf.LineAlignment = "Center"
        $textRect = New-Object System.Drawing.RectangleF($rect.X, $rect.Y, $rect.Width, $rect.Height)
        $g.DrawString($display, $fonts.Small, $txtBrush, $textRect, $sf)
        $txtBrush.Dispose()
        $sf.Dispose()
        $path.Dispose()
    })

    $btn.Add_MouseEnter({ param($s); $s.Tag.Hovered = $true; $s.Invalidate() })
    $btn.Add_MouseLeave({ param($s); $s.Tag.Hovered = $false; $s.Tag.Pressed = $false; $s.Invalidate() })
    $btn.Add_MouseDown({ param($s); $s.Tag.Pressed = $true; $s.Invalidate() })
    $btn.Add_MouseUp({
        param($s, $e)
        $s.Tag.Pressed = $false; $s.Invalidate()
        if ($s.ClientRectangle.Contains($e.Location)) {
            $action = $s.Tag.Action
            $actionArgs = @($s.Tag.ActionArgs)
            if ($action -is [scriptblock]) { & $action @actionArgs }
        }
    })

    return $btn
}

# ══════════════════════════════════════════════════════════
# BUILD TARGETS SECTION
# ══════════════════════════════════════════════════════════
$margin = 32
$cardGap = 16
$cardW = 340
$sectionY = 118

$form.Controls.Add((New-SectionHeader -Text "Build Targets" -X $margin -Y $sectionY))

$row1Y = $sectionY + 26

# Card: Full Universe  (U+25CE = ◎)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x25CE) `
    -Title "Full Universe" `
    -Description "Build market data for every solar system. Takes the longest but gives you a complete dataset." `
    -TooltipText "Runs: BuildMarketSeed.bat full`nBuilds a complete market seed DB for all known regions." `
    -X $margin -Y $row1Y -Width $cardW -Height 90 `
    -OnClick { Start-SeedConsole "full" }))

# Card: Jita + New Caldari (Recommended)  (U+2605 = ★)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x2605) `
    -Title "Jita + New Caldari" `
    -Description "Fast build for the two main trade hubs. Perfect for market UI work and station testing." `
    -TooltipText "Runs: BuildMarketSeed.bat jita`nSolar systems: Jita (30000142) + New Caldari (30000145)`nIdeal for most development work." `
    -X ($margin + $cardW + $cardGap) -Y $row1Y -Width $cardW -Height 90 `
    -IsPrimary $true -IsRecommended $true `
    -OnClick { Start-SeedConsole "jita" }))

$row2Y = $row1Y + 90 + $cardGap

# Card: Quick Smoke  (U+26A1 = ⚡)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x26A1) `
    -Title "Quick Smoke Test" `
    -Description "A minimal build to quickly validate that everything works. Great for CI or fast iteration." `
    -TooltipText "Runs: BuildMarketSeed.bat smoke`nBuilds a tiny dataset just to verify the pipeline is healthy." `
    -X $margin -Y $row2Y -Width $cardW -Height 90 `
    -AccentColor "orange" `
    -OnClick { Start-SeedConsole "smoke" }))

# Card: Rebuild Summaries  (U+2261 = ≡)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x2261) `
    -Title "Rebuild Summaries" `
    -Description "Regenerate summary tables from an existing seed database without re-importing orders." `
    -TooltipText "Runs: BuildMarketSeed.bat rebuild-summaries`nOnly recalculates aggregate data. Does not re-download or re-import." `
    -X ($margin + $cardW + $cardGap) -Y $row2Y -Width $cardW -Height 90 `
    -OnClick { Start-SeedConsole "rebuild-summaries" }))

# ══════════════════════════════════════════════════════════
# TOOLS SECTION
# ══════════════════════════════════════════════════════════
$toolsY = $row2Y + 90 + 28

$form.Controls.Add((New-SectionHeader -Text "Tools" -X $margin -Y $toolsY))

$toolRow = $toolsY + 26
$toolW = [math]::Floor(($cardW * 2 + $cardGap - $cardGap * 2) / 3)

# Card: Doctor  (U+2699 = ⚙)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x2699) `
    -Title "Doctor" `
    -Description "Check your environment and dependencies." `
    -TooltipText "Runs: BuildMarketSeed.bat doctor`nVerifies Node.js, npm packages, config files, and folder structure." `
    -X $margin -Y $toolRow -Width $toolW -Height 78 `
    -AccentColor "green" `
    -OnClick { Start-SeedConsole "doctor" }))

# Card: Show Presets  (U+2630 = ☰)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x2630) `
    -Title "Show Presets" `
    -Description "List all available preset configurations." `
    -TooltipText "Runs: BuildMarketSeed.bat presets`nPrints all known system/region presets to the console." `
    -X ($margin + $toolW + $cardGap) -Y $toolRow -Width $toolW -Height 78 `
    -OnClick { Start-SeedConsole "presets" }))

# Card: Build Release  (U+25C6 = ◆)
$form.Controls.Add((New-ActionCard `
    -Icon ([char]0x25C6) `
    -Title "Build Release" `
    -Description "Compile a distributable release binary." `
    -TooltipText "Runs: BuildMarketSeed.bat build-release`nProduces a standalone binary for distribution." `
    -X ($margin + ($toolW + $cardGap) * 2) -Y $toolRow -Width $toolW -Height 78 `
    -OnClick { Start-SeedConsole "build-release" }))

# ══════════════════════════════════════════════════════════
# PRESET INFO BAR
# ══════════════════════════════════════════════════════════
$infoY = $toolRow + 78 + 20

$infoPanel = New-BufferedPanel
$infoPanel.Location = New-Object System.Drawing.Point($margin, $infoY)
$infoPanel.Size = New-Object System.Drawing.Size -ArgumentList ($cardW * 2 + $cardGap), 36
$infoPanel.BackColor = $c.AccentSubtle

$infoPanel.Add_Paint({
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = "AntiAlias"
    $g.TextRenderingHint = "ClearTypeGridFit"
    $rect = $s.ClientRectangle

    $path = New-RoundedPath -Rect $rect -Radius 6
    $bgBrush = New-Object System.Drawing.SolidBrush($c.AccentSubtle)
    $g.FillPath($bgBrush, $path)
    $bgBrush.Dispose()
    $pen = New-Object System.Drawing.Pen($c.AccentDim, 1)
    $g.DrawPath($pen, $path)
    $pen.Dispose()

    $iconBrush = New-Object System.Drawing.SolidBrush($c.Accent)
    $g.DrawString([char]0x2139, $fonts.SmallBold, $iconBrush, 12, 8)
    $iconBrush.Dispose()

    $txtBrush = New-Object System.Drawing.SolidBrush($c.TextSecondary)
    $g.DrawString("Hub presets:  Jita = 30000142    New Caldari = 30000145", $fonts.Mono, $txtBrush, 32, 10)
    $txtBrush.Dispose()
    $path.Dispose()
})
$form.Controls.Add($infoPanel)

# ══════════════════════════════════════════════════════════
# FOOTER
# ══════════════════════════════════════════════════════════
$footerY = $infoY + 48

$sepLine = New-BufferedPanel
$sepLine.Location = New-Object System.Drawing.Point($margin, $footerY)
$sepLine.Size = New-Object System.Drawing.Size -ArgumentList ($cardW * 2 + $cardGap), 1
$sepLine.BackColor = $c.Border
$form.Controls.Add($sepLine)

$btnY = $footerY + 16

# Footer buttons  (U+2699 = ⚙, U+2302 = ⌂, U+2715 = ✕)
$form.Controls.Add((New-GhostButton -Icon ([char]0x2699) -Text "Edit Config" -X $margin -Y $btnY -Width 148 `
    -TooltipText "Open the local config file (market-seed.local.toml) in your text editor." `
    -OnClick { param($Path) Open-TextFile -Path $Path } `
    -ActionArgs @($script:SeedConfig) ))

$form.Controls.Add((New-GhostButton -Icon ([char]0x2302) -Text "Open README" -X ($margin + 148 + 12) -Y $btnY -Width 148 `
    -TooltipText "View the Market Seed README documentation." `
    -OnClick { param($Path) Open-TextFile -Path $Path } `
    -ActionArgs @($script:SeedReadme) ))

$closeX = $margin + $cardW * 2 + $cardGap - 120
$form.Controls.Add((New-GhostButton -Icon ([char]0x2715) -Text "Close" -X $closeX -Y $btnY -Width 120 `
    -OnClick { $form.Close() }))

# Footer info text
$footerTextY = $btnY + 48
$footerInfo = New-Object System.Windows.Forms.Label
$footerInfo.Text = "Each action opens a new console window so you can watch the live output."
$footerInfo.Font = $fonts.Tiny
$footerInfo.ForeColor = $c.TextMuted
$footerInfo.AutoSize = $true
$footerInfo.BackColor = $c.BgDeep
$footerInfo.Location = New-Object System.Drawing.Point($margin, $footerTextY)
$form.Controls.Add($footerInfo)

# ══════════════════════════════════════════════════════════
# FADE-IN ANIMATION
# ══════════════════════════════════════════════════════════
$fadeTimer = New-Object System.Windows.Forms.Timer
$fadeTimer.Interval = 16  # ~60fps

$fadeTimer.Add_Tick({
    $newOpacity = $form.Opacity + 0.06
    if ($newOpacity -ge 1.0) {
        $form.Opacity = 1.0
        $fadeTimer.Stop()
    } else {
        $form.Opacity = $newOpacity
    }
})

$form.Add_Shown({ $fadeTimer.Start() })

# ══════════════════════════════════════════════════════════
# SHOW THE FORM
# ══════════════════════════════════════════════════════════
[void]$form.ShowDialog()

# Cleanup
$fadeTimer.Dispose()
$tooltip.Dispose()
foreach ($f in $fonts.Values) { $f.Dispose() }
