param(
  [switch]$NoUi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$script:CliPath = Join-Path $PSScriptRoot "config-manager-cli.js"
$script:IconManifestPath = Join-Path $PSScriptRoot "assets\icon-map.json"
$script:ClientIconsRoot = Join-Path $PSScriptRoot "assets\eve-icons"
$script:UiIconsRoot = Join-Path $PSScriptRoot "assets\ui-icons"
$script:Culture = [System.Globalization.CultureInfo]::InvariantCulture

$script:SettingsFieldControllers = @{}
$script:SettingsSnapshot = $null
$script:SettingsDirty = $false
$script:IsRenderingSettings = $false

$script:DatabaseSnapshot = $null
$script:DbWorkingPlayer = $null
$script:DatabaseDirty = $false
$script:IsRenderingDatabase = $false
$script:DbRawJsonDirty = $false
$script:SuppressPlayerSelection = $false
$script:IconManifest = $null
$script:NextGeneratedItemId = $null

function New-Brush {
  param([Parameter(Mandatory = $true)][string]$Color)
  return [System.Windows.Media.BrushConverter]::new().ConvertFromString($Color)
}

$script:Brushes = @{
  Slate900 = New-Brush "#0F172A"
  Slate700 = New-Brush "#334155"
  Slate500 = New-Brush "#64748B"
  Slate200 = New-Brush "#D9E2EC"
  Slate100 = New-Brush "#F4F7FB"
  White = New-Brush "#FFFFFF"
  GreenBg = New-Brush "#DDF6EF"
  GreenFg = New-Brush "#0F766E"
  AmberBg = New-Brush "#FFF5DD"
  AmberFg = New-Brush "#9A6700"
  RedBg = New-Brush "#FDE7EA"
  RedFg = New-Brush "#B42318"
  BlueBg = New-Brush "#EAF4FB"
  BlueFg = New-Brush "#2F6F9F"
}

function Invoke-ProjectCli {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @(),
    [object]$InputObject
  )

  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())

  try {
    $nodeArgs = @($script:CliPath, $Command) + @($Arguments)
    $result =
      if ($PSBoundParameters.ContainsKey("InputObject")) {
        $payloadJson = $InputObject | ConvertTo-Json -Depth 100 -Compress
        $payloadJson | & node @nodeArgs 2> $stderrPath
      } else {
        & node @nodeArgs 2> $stderrPath
      }

    $stderrText = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { "" }
    if ($LASTEXITCODE -ne 0) {
      if ([string]::IsNullOrWhiteSpace($stderrText)) {
        throw "The EvEJS helper exited with code $LASTEXITCODE."
      }
      throw $stderrText.Trim()
    }

    $jsonText = ($result -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($jsonText)) {
      throw "The EvEJS helper did not return any JSON."
    }

    return $jsonText | ConvertFrom-Json
  } finally {
    Remove-Item $stderrPath -ErrorAction SilentlyContinue
  }
}

function ConvertTo-PrettyJson {
  param([Parameter(Mandatory = $true)][object]$Value)
  return ($Value | ConvertTo-Json -Depth 100)
}

function ConvertTo-DeepClone {
  param([Parameter(Mandatory = $true)][object]$Value)
  return (ConvertTo-PrettyJson $Value) | ConvertFrom-Json
}

function Set-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [object]$Value
  )

  $existingProperty = $Object.PSObject.Properties[$Name]
  if ($null -ne $existingProperty) {
    $existingProperty.Value = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Format-DisplayValue {
  param([object]$Value)
  if ($null -eq $Value) { return "not set" }
  if ($Value -is [bool]) { if ($Value) { return "true" } else { return "false" } }
  if ($Value -is [double] -or $Value -is [single] -or $Value -is [decimal]) {
    return $Value.ToString("0.############################", $script:Culture)
  }
  return [string]$Value
}

function Parse-NumericText {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $trimmedText = $Text.Trim()
  if ($trimmedText -eq "") { throw "$Label cannot be blank." }
  if ($trimmedText -match '^-?\d+$') {
    return [Int64]::Parse($trimmedText, $script:Culture)
  }
  return [double]::Parse($trimmedText, $script:Culture)
}

function Parse-JsonObjectText {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $trimmedText = $Text.Trim()
  if ($trimmedText -eq "") { throw "$Label cannot be blank." }
  $parsed = $trimmedText | ConvertFrom-Json
  if ($parsed -isnot [pscustomobject]) { throw "$Label must be a JSON object." }
  return $parsed
}

function New-Badge {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [string]$Background = "#E2E8F0",
    [string]$Foreground = "#334155",
    [string]$Glyph = "",
    [string]$ImagePath = "",
    [double]$ImageSize = 16
  )

  $border = [System.Windows.Controls.Border]::new()
  $border.CornerRadius = [System.Windows.CornerRadius]::new(10)
  $border.Padding = [System.Windows.Thickness]::new(12, 7, 12, 7)
  $border.Margin = [System.Windows.Thickness]::new(0, 0, 8, 8)
  $border.Background = New-Brush $Background

  $panel = [System.Windows.Controls.DockPanel]::new()

  $iconElement = New-IconVisual -ImagePath $ImagePath -Glyph $Glyph -Foreground $Foreground -IconSize $ImageSize -MarginRight 8
  if ($iconElement) {
    [System.Windows.Controls.DockPanel]::SetDock($iconElement, [System.Windows.Controls.Dock]::Left)
    $panel.Children.Add($iconElement) | Out-Null
  }

  $label = [System.Windows.Controls.TextBlock]::new()
  $label.Text = $Text
  $label.FontSize = 11
  $label.FontWeight = [System.Windows.FontWeights]::SemiBold
  $label.Foreground = New-Brush $Foreground
  $label.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

  $panel.Children.Add($label) | Out-Null
  $border.Child = $panel
  return $border
}

function Resolve-UiIconPath {
  param([Parameter(Mandatory = $true)][string]$Key)

  $candidatePath = Join-Path $script:UiIconsRoot ("{0}.png" -f $Key)
  if (Test-Path $candidatePath) { return $candidatePath }
  return ""
}

function Test-IsUiIconPath {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }

  try {
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $uiRootPath = [System.IO.Path]::GetFullPath($script:UiIconsRoot)
    return $resolvedPath.StartsWith($uiRootPath, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function New-IconVisual {
  param(
    [string]$ImagePath = "",
    [string]$Glyph = "",
    [string]$GlyphFont = "Segoe MDL2 Assets",
    [string]$Foreground = "#334155",
    [double]$IconSize = 16,
    [double]$MarginRight = 8
  )

  if (-not [string]::IsNullOrWhiteSpace($ImagePath) -and (Test-Path $ImagePath)) {
    $image = [System.Windows.Controls.Image]::new()
    $image.Source = $ImagePath
    $image.Width = $IconSize
    $image.Height = $IconSize
    $image.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $image.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $image.Stretch = [System.Windows.Media.Stretch]::Uniform

    if (Test-IsUiIconPath -Path $ImagePath) {
      $plate = [System.Windows.Controls.Border]::new()
      $plate.Width = [Math]::Max($IconSize + 10, 24)
      $plate.Height = [Math]::Max($IconSize + 10, 24)
      $plate.CornerRadius = [System.Windows.CornerRadius]::new(8)
      $plate.Margin = [System.Windows.Thickness]::new(0, 0, $MarginRight, 0)
      $plate.Background = New-Brush "#334155"
      $plate.BorderBrush = New-Brush "#223042"
      $plate.BorderThickness = [System.Windows.Thickness]::new(1)
      $plate.Child = $image
      return $plate
    }

    $image.Margin = [System.Windows.Thickness]::new(0, 0, $MarginRight, 0)
    return $image
  }

  if (-not [string]::IsNullOrWhiteSpace($Glyph)) {
    $icon = [System.Windows.Controls.TextBlock]::new()
    $icon.Text = $Glyph
    $icon.FontFamily = [System.Windows.Media.FontFamily]::new($GlyphFont)
    $icon.FontSize = [Math]::Max($IconSize - 2, 12)
    $icon.Margin = [System.Windows.Thickness]::new(0, 0, $MarginRight, 0)
    $icon.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $icon.Foreground = New-Brush $Foreground
    return $icon
  }

  return $null
}

function Get-JsonPropertyValue {
  param(
    [object]$Object,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -ne $property) { return $property.Value }
  return $null
}

function Convert-GlyphTokenToText {
  param([string]$GlyphToken)

  $trimmedToken = [string]$GlyphToken
  if ([string]::IsNullOrWhiteSpace($trimmedToken)) { return [string][char]0xE10F }
  if ($trimmedToken -match '^[0-9A-Fa-f]+$') {
    return [string][char]([Convert]::ToInt32($trimmedToken, 16))
  }
  return $trimmedToken
}

function Get-IconManifest {
  if ($script:IconManifest) { return $script:IconManifest }

  if (Test-Path $script:IconManifestPath) {
    $script:IconManifest = Get-Content $script:IconManifestPath -Raw | ConvertFrom-Json
  } else {
    $script:IconManifest = [pscustomobject]@{}
  }

  return $script:IconManifest
}

function Resolve-ManifestIconSpec {
  param(
    [Parameter(Mandatory = $true)][string]$SectionName,
    [string[]]$LookupValues = @()
  )

  $manifest = Get-IconManifest
  $section = Get-JsonPropertyValue -Object $manifest -Name $SectionName
  $resolvedEntry = $null

  foreach ($lookupValue in @($LookupValues)) {
    if ([string]::IsNullOrWhiteSpace([string]$lookupValue) -or $null -eq $section) { continue }

    $exactProperty = $section.PSObject.Properties[[string]$lookupValue]
    if ($null -ne $exactProperty) {
      $resolvedEntry = $exactProperty.Value
      break
    }

    foreach ($sectionProperty in $section.PSObject.Properties) {
      if ($sectionProperty.Name -eq "default") { continue }
      if ([string]$lookupValue -like "*$($sectionProperty.Name)*") {
        $resolvedEntry = $sectionProperty.Value
        break
      }
    }

    if ($null -ne $resolvedEntry) { break }
  }

  if ($null -eq $resolvedEntry -and $null -ne $section) {
    $resolvedEntry = Get-JsonPropertyValue -Object $section -Name "default"
  }

  $foreground = [string](Get-JsonPropertyValue -Object $resolvedEntry -Name "foreground")
  if ([string]::IsNullOrWhiteSpace($foreground)) { $foreground = "#4F7EA8" }
  $background = [string](Get-JsonPropertyValue -Object $resolvedEntry -Name "background")
  if ([string]::IsNullOrWhiteSpace($background)) { $background = "#EAF4FB" }

  return [pscustomobject]@{
    glyph = Convert-GlyphTokenToText ([string](Get-JsonPropertyValue -Object $resolvedEntry -Name "glyph"))
    foreground = $foreground
    background = $background
    border = $foreground
  }
}

function Resolve-SkillIconSpec {
  param([string]$GroupName, [string]$ItemName = "")
  return Resolve-ManifestIconSpec -SectionName "skills" -LookupValues @($GroupName, $ItemName)
}

function Resolve-ShipIconSpec {
  param([string]$GroupName, [string]$ShipName = "")
  return Resolve-ManifestIconSpec -SectionName "ships" -LookupValues @($GroupName, $ShipName)
}

function Resolve-ItemIconSpec {
  param(
    [string]$GroupName,
    [object]$CategoryID,
    [string]$ItemName = ""
  )

  $normalizedCategoryId = if ($null -ne $CategoryID) { [int]$CategoryID } else { -1 }
  if ($normalizedCategoryId -eq 6) {
    return Resolve-ShipIconSpec -GroupName $GroupName -ShipName $ItemName
  }
  if ($normalizedCategoryId -eq 16) {
    return Resolve-ManifestIconSpec -SectionName "items" -LookupValues @("Skillbook", $GroupName, $ItemName)
  }

  $lookupValues = @($GroupName, $ItemName)
  if ($ItemName -match "missile") { $lookupValues = @("Missile") + $lookupValues }
  if ($ItemName -match "drone") { $lookupValues = @("Drone") + $lookupValues }
  if ($ItemName -match "charge") { $lookupValues = @("Charge") + $lookupValues }
  return Resolve-ManifestIconSpec -SectionName "items" -LookupValues $lookupValues
}

function Resolve-WalletIconSpec {
  param([Parameter(Mandatory = $true)][string]$CurrencyKey)
  return Resolve-ManifestIconSpec -SectionName "wallet" -LookupValues @($CurrencyKey)
}

function Add-IconFields {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][pscustomobject]$IconSpec
  )

  Set-ObjectProperty -Object $Object -Name "iconGlyph" -Value $IconSpec.glyph
  Set-ObjectProperty -Object $Object -Name "iconForeground" -Value $IconSpec.foreground
  Set-ObjectProperty -Object $Object -Name "iconBackground" -Value $IconSpec.background
  Set-ObjectProperty -Object $Object -Name "iconBorder" -Value $IconSpec.border
  Set-ObjectProperty -Object $Object -Name "iconFilePath" -Value ""
  return $Object
}

function Resolve-TypeIconFilePath {
  param([object]$TypeId)

  if ($null -eq $TypeId) { return "" }
  $candidatePath = Join-Path $script:ClientIconsRoot ("{0}.png" -f [string]$TypeId)
  if (Test-Path $candidatePath) { return $candidatePath }
  return ""
}

function Add-TypeIconFields {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][pscustomobject]$IconSpec,
    [object]$TypeId
  )

  $Object = Add-IconFields -Object $Object -IconSpec $IconSpec
  Set-ObjectProperty -Object $Object -Name "iconFilePath" -Value (Resolve-TypeIconFilePath -TypeId $TypeId)
  return $Object
}

function Format-CompactNumber {
  param([object]$Value)

  if ($null -eq $Value) { return "0" }
  $number = [double]$Value
  $absoluteValue = [Math]::Abs($number)
  if ($absoluteValue -ge 1000000000) {
    return ("{0:0.#}b" -f ($number / 1000000000))
  }
  if ($absoluteValue -ge 1000000) {
    return ("{0:0.#}m" -f ($number / 1000000))
  }
  if ($absoluteValue -ge 1000) {
    return ("{0:0.#}k" -f ($number / 1000))
  }
  return Format-DisplayValue $Value
}

function New-IconTextContent {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [int]$GlyphCode = 0,
    [string]$GlyphFont = "Segoe MDL2 Assets",
    [string]$IconPath = "",
    [double]$IconSize = 16
  )

  $panel = [System.Windows.Controls.StackPanel]::new()
  $panel.Orientation = [System.Windows.Controls.Orientation]::Horizontal

  $glyphText = ""
  if ($GlyphCode -gt 0) {
    $glyphText = [string][char]$GlyphCode
  }

  $iconElement = New-IconVisual -ImagePath $IconPath -Glyph $glyphText -GlyphFont $GlyphFont -Foreground "#334155" -IconSize $IconSize -MarginRight 8
  if ($iconElement) {
    $panel.Children.Add($iconElement) | Out-Null
  }

  $label = [System.Windows.Controls.TextBlock]::new()
  $label.Text = $Text
  $label.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $panel.Children.Add($label) | Out-Null
  return $panel
}

function Set-ButtonChrome {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Controls.Button]$Button,
    [Parameter(Mandatory = $true)][string]$Text,
    [int]$GlyphCode = 0,
    [string]$IconKey = "",
    [double]$IconSize = 16
  )

  $iconPath = ""
  if (-not [string]::IsNullOrWhiteSpace($IconKey)) {
    $iconPath = Resolve-UiIconPath -Key $IconKey
  }

  $Button.Content = New-IconTextContent -Text $Text -GlyphCode $GlyphCode -IconPath $iconPath -IconSize $IconSize
}

function Set-StatusUi {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("ready", "dirty", "success", "error", "info")][string]$Tone = "ready",
    [string]$BadgeText = ""
  )

  $toneConfig = switch ($Tone) {
    "dirty" { @{ Background = $script:Brushes.AmberBg; Foreground = $script:Brushes.AmberFg; Badge = "Unsaved changes" } }
    "success" { @{ Background = $script:Brushes.GreenBg; Foreground = $script:Brushes.GreenFg; Badge = "Saved" } }
    "error" { @{ Background = $script:Brushes.RedBg; Foreground = $script:Brushes.RedFg; Badge = "Error" } }
    "info" { @{ Background = $script:Brushes.BlueBg; Foreground = $script:Brushes.BlueFg; Badge = "Info" } }
    default { @{ Background = $script:Brushes.GreenBg; Foreground = $script:Brushes.GreenFg; Badge = "Ready" } }
  }

  $resolvedBadgeText = if ($BadgeText) { $BadgeText } else { $toneConfig.Badge }
  $script:FooterStatusText.Text = $Message
  $script:FooterStatusText.Foreground = $toneConfig.Foreground
  $script:HeroBadgeBorder.Background = $toneConfig.Background
  $script:HeroBadgeBorder.BorderBrush = $toneConfig.Foreground
  $script:HeroBadgeText.Foreground = $toneConfig.Foreground
  $script:HeroBadgeText.Text = ("STATUS: {0}" -f $resolvedBadgeText.ToUpperInvariant())
}

function Set-SettingsDirtyState {
  param([bool]$Dirty, [string]$Message = "")
  $script:SettingsDirty = $Dirty
  if ($Dirty) {
    $resolvedMessage = if ($Message) { $Message } else { "Server settings have unsaved changes." }
    Set-StatusUi -Message $resolvedMessage -Tone "dirty" -BadgeText "Settings changed"
  } else {
    $resolvedMessage = if ($Message) { $Message } else { "Server settings loaded and ready." }
    Set-StatusUi -Message $resolvedMessage -Tone "ready" -BadgeText "Settings ready"
  }
}

function Set-DatabaseDirtyState {
  param([bool]$Dirty, [string]$Message = "")
  $script:DatabaseDirty = $Dirty
  if ($Dirty) {
    $resolvedMessage = if ($Message) { $Message } else { "Player database changes are waiting to be saved." }
    Set-StatusUi -Message $resolvedMessage -Tone "dirty" -BadgeText "Database changed"
  } else {
    $resolvedMessage = if ($Message) { $Message } else { "Player database loaded and ready." }
    Set-StatusUi -Message $resolvedMessage -Tone "ready" -BadgeText "Database ready"
  }
}

function Confirm-DiscardChanges {
  param([Parameter(Mandatory = $true)][string]$Area, [bool]$IsDirty)
  if (-not $IsDirty) { return $true }
  $result = [System.Windows.MessageBox]::Show(
    "You have unsaved changes in $Area. Discard them?",
    "EvEJS Config Manager",
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Warning
  )
  return $result -eq [System.Windows.MessageBoxResult]::Yes
}

function Get-SourceLabel {
  param([string]$Source)
  switch ($Source) {
    "env" { return "Environment" }
    "local" { return "Local file" }
    "shared" { return "Shared file" }
    default { return "Default" }
  }
}

function Get-GroupDescription {
  param([string]$Group)
  switch ($Group) {
    "Basics" { return "Everyday toggles and the most common runtime switches." }
    "Structures & Safety" { return "Upwell bypasses and timer scaling controls for structure and safety workflows." }
    "Client Compatibility" { return "Values the client handshake expects to match your build." }
    "Network" { return "Ports and URLs used by the local services and redirects." }
    "Market & Services" { return "Market daemon connectivity, retries, and related service tuning." }
    "HyperNet" { return "HyperNet kill-switch, pricing, and startup seeding controls." }
    "World & Performance" { return "Startup loading, debris cleanup, and runtime performance tuning." }
    "NPC & Crimewatch" { return "NPC startup behavior and CONCORD / Crimewatch controls." }
    default { return "Advanced settings for EvEJS." }
  }
}

function Get-ControlValue {
  param([Parameter(Mandatory = $true)][pscustomobject]$Controller)
  switch ($Controller.Kind) {
    "boolean" { return [bool]$Controller.Control.IsChecked }
    "select" { return $Controller.Control.SelectedValue }
    default { return $Controller.Control.Text }
  }
}

function Set-ControlValue {
  param([Parameter(Mandatory = $true)][pscustomobject]$Controller, [object]$Value)
  switch ($Controller.Kind) {
    "boolean" { $Controller.Control.IsChecked = [bool]$Value }
    "select" {
      $Controller.Control.SelectedValue = $Value
      if ($null -eq $Controller.Control.SelectedItem -and $Controller.Control.Items.Count -gt 0) {
        $Controller.Control.SelectedIndex = 0
      }
    }
    default { $Controller.Control.Text = Format-DisplayValue $Value }
  }
}

function Register-SettingsDirtyHandler {
  param([Parameter(Mandatory = $true)][object]$Control, [Parameter(Mandatory = $true)][string]$Kind)
  $handler = {
    if (-not $script:IsRenderingSettings) {
      Set-SettingsDirtyState -Dirty $true -Message "Server settings are staged in the form. Click Save Changes to write them."
    }
  }

  switch ($Kind) {
    "boolean" { $Control.Add_Checked($handler); $Control.Add_Unchecked($handler) }
    "select" { $Control.Add_SelectionChanged($handler) }
    default { $Control.Add_TextChanged($handler) }
  }
}

function New-SettingsFieldController {
  param([Parameter(Mandatory = $true)][pscustomobject]$Entry)

  switch ($Entry.control) {
    "boolean" {
      $checkBox = [System.Windows.Controls.CheckBox]::new()
      $checkBox.Content = "Enabled"
      $checkBox.FontSize = 14
      $checkBox.Foreground = $script:Brushes.Slate900
      $controller = [pscustomobject]@{ Kind = "boolean"; Control = $checkBox; Entry = $Entry }
    }
    "select" {
      $comboBox = [System.Windows.Controls.ComboBox]::new()
      $comboBox.MinWidth = 340
      $comboBox.Height = 38
      $comboBox.Padding = [System.Windows.Thickness]::new(8, 4, 8, 4)
      $comboBox.DisplayMemberPath = "label"
      $comboBox.SelectedValuePath = "value"
      $comboBox.ItemsSource = @($Entry.options)
      $comboBox.Style = $script:Window.FindResource("ConfigComboBoxStyle")
      $controller = [pscustomobject]@{ Kind = "select"; Control = $comboBox; Entry = $Entry }
    }
    default {
      $textBox = [System.Windows.Controls.TextBox]::new()
      $textBox.MinWidth = 340
      $textBox.Height = 38
      $textBox.VerticalContentAlignment = [System.Windows.VerticalAlignment]::Center
      $textBox.Style = $script:Window.FindResource("ConfigTextBoxStyle")
      $controller = [pscustomobject]@{ Kind = $Entry.control; Control = $textBox; Entry = $Entry }
    }
  }

  Register-SettingsDirtyHandler -Control $controller.Control -Kind $controller.Kind
  return $controller
}

function New-SettingsCard {
  param([Parameter(Mandatory = $true)][pscustomobject]$Entry)

  $card = [System.Windows.Controls.Border]::new()
  $card.CornerRadius = [System.Windows.CornerRadius]::new(16)
  $card.BorderThickness = [System.Windows.Thickness]::new(1)
  $card.BorderBrush = $script:Brushes.Slate200
  $card.Background = $script:Brushes.White
  $card.Padding = [System.Windows.Thickness]::new(18)
  $card.Margin = [System.Windows.Thickness]::new(0, 0, 0, 14)

  $layout = [System.Windows.Controls.StackPanel]::new()
  $headerGrid = [System.Windows.Controls.Grid]::new()
  $headerGrid.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
  $headerGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "*" })
  $headerGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "Auto" })

  $titleStack = [System.Windows.Controls.StackPanel]::new()
  $titleText = [System.Windows.Controls.TextBlock]::new()
  $titleText.Text = $Entry.label
  $titleText.FontSize = 17
  $titleText.FontWeight = [System.Windows.FontWeights]::SemiBold
  $titleText.Foreground = $script:Brushes.Slate900
  $keyText = [System.Windows.Controls.TextBlock]::new()
  $keyText.Text = $Entry.key
  $keyText.FontSize = 11
  $keyText.Foreground = $script:Brushes.Slate500
  $keyText.Margin = [System.Windows.Thickness]::new(0, 2, 0, 0)
  $titleStack.Children.Add($titleText) | Out-Null
  $titleStack.Children.Add($keyText) | Out-Null
  [System.Windows.Controls.Grid]::SetColumn($titleStack, 0)

  $badgePanel = [System.Windows.Controls.WrapPanel]::new()
  $badgePanel.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
  $badgePanel.Children.Add((New-Badge -Text ("Source: {0}" -f (Get-SourceLabel $Entry.source)) -Background "#E2E8F0" -Foreground "#334155")) | Out-Null
  $badgePanel.Children.Add((New-Badge -Text ("Default: {0}" -f (Format-DisplayValue $Entry.defaultValue)) -Background "#DBEAFE" -Foreground "#1D4ED8")) | Out-Null
  if ($Entry.source -eq "env" -and $Entry.envVar) {
    $badgePanel.Children.Add((New-Badge -Text ("Env: {0}" -f $Entry.envVar) -Background "#FEF3C7" -Foreground "#92400E")) | Out-Null
  }
  [System.Windows.Controls.Grid]::SetColumn($badgePanel, 1)

  $headerGrid.Children.Add($titleStack) | Out-Null
  $headerGrid.Children.Add($badgePanel) | Out-Null
  $layout.Children.Add($headerGrid) | Out-Null

  $descriptionText = [System.Windows.Controls.TextBlock]::new()
  $descriptionText.Text = (@($Entry.description) -join " ")
  $descriptionText.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $descriptionText.FontSize = 13
  $descriptionText.Foreground = $script:Brushes.Slate700
  $descriptionText.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
  $layout.Children.Add($descriptionText) | Out-Null

  $validText = [System.Windows.Controls.TextBlock]::new()
  $validText.Text = "Valid values: $($Entry.validValues)"
  $validText.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $validText.FontSize = 12
  $validText.Foreground = $script:Brushes.Slate500
  $validText.Margin = [System.Windows.Thickness]::new(0, 0, 0, 14)
  $layout.Children.Add($validText) | Out-Null

  $controlGrid = [System.Windows.Controls.Grid]::new()
  $controlGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "*" })
  $controlGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "Auto" })

  $controller = New-SettingsFieldController -Entry $Entry
  Set-ControlValue -Controller $controller -Value $Entry.fileValue
  [System.Windows.Controls.Grid]::SetColumn($controller.Control, 0)

  $resetButton = [System.Windows.Controls.Button]::new()
  $resetButton.Content = "Use Default"
  $resetButton.Margin = [System.Windows.Thickness]::new(12, 0, 0, 0)
  $resetButton.Padding = [System.Windows.Thickness]::new(16, 10, 16, 10)
  $resetButton.Style = $script:Window.FindResource("SecondaryButtonStyle")
  [System.Windows.Controls.Grid]::SetColumn($resetButton, 1)

  $capturedController = $controller
  $capturedEntry = $Entry
  $resetButton.Add_Click({
    Set-ControlValue -Controller $capturedController -Value $capturedEntry.defaultValue
    Set-SettingsDirtyState -Dirty $true -Message ("{0} has been reset in the form." -f $capturedEntry.label)
  })

  $script:SettingsFieldControllers[$Entry.key] = $controller

  $controlGrid.Children.Add($controller.Control) | Out-Null
  $controlGrid.Children.Add($resetButton) | Out-Null
  $layout.Children.Add($controlGrid) | Out-Null
  $card.Child = $layout
  return $card
}

function Collect-SettingsValues {
  $values = @{}
  foreach ($key in $script:SettingsFieldControllers.Keys) {
    $values[$key] = Get-ControlValue -Controller $script:SettingsFieldControllers[$key]
  }
  return $values
}

function Render-SettingsSnapshot {
  param([Parameter(Mandatory = $true)][pscustomobject]$Snapshot, [string]$ReadyMessage = "Server settings loaded and ready.")

  $script:IsRenderingSettings = $true
  try {
    $script:SettingsSnapshot = $Snapshot
    $script:SettingsFieldControllers = @{}
    $script:SettingsPathText.Text = "Saved file: $($Snapshot.paths.localConfigPath)"
    if (@($Snapshot.environmentOverrides).Count -gt 0) {
      $script:SettingsEnvNoteText.Text = @($Snapshot.notes) -join " "
      $script:SettingsEnvNoteText.Visibility = [System.Windows.Visibility]::Visible
    } else {
      $script:SettingsEnvNoteText.Text = ""
      $script:SettingsEnvNoteText.Visibility = [System.Windows.Visibility]::Collapsed
    }

    $script:SettingsTabs.Items.Clear()
    foreach ($group in @($Snapshot.groupOrder)) {
      $groupEntries = @($Snapshot.entries | Where-Object { $_.group -eq $group })
      if ($groupEntries.Count -eq 0) { continue }

      $tabItem = [System.Windows.Controls.TabItem]::new()
      $tabItem.Header = $group
      $scrollViewer = [System.Windows.Controls.ScrollViewer]::new()
      $scrollViewer.VerticalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Auto
      $contentStack = [System.Windows.Controls.StackPanel]::new()
      $contentStack.Margin = [System.Windows.Thickness]::new(0, 12, 0, 0)

      $introCard = [System.Windows.Controls.Border]::new()
      $introCard.CornerRadius = [System.Windows.CornerRadius]::new(16)
      $introCard.Padding = [System.Windows.Thickness]::new(18)
      $introCard.Background = $script:Brushes.Slate100
      $introCard.BorderBrush = $script:Brushes.Slate200
      $introCard.BorderThickness = [System.Windows.Thickness]::new(1)
      $introCard.Margin = [System.Windows.Thickness]::new(0, 0, 0, 14)
      $introText = [System.Windows.Controls.TextBlock]::new()
      $introText.Text = Get-GroupDescription $group
      $introText.TextWrapping = [System.Windows.TextWrapping]::Wrap
      $introText.FontSize = 13
      $introText.Foreground = $script:Brushes.Slate700
      $introCard.Child = $introText
      $contentStack.Children.Add($introCard) | Out-Null

      foreach ($entry in $groupEntries) {
        $contentStack.Children.Add((New-SettingsCard -Entry $entry)) | Out-Null
      }

      $scrollViewer.Content = $contentStack
      $tabItem.Content = $scrollViewer
      $script:SettingsTabs.Items.Add($tabItem) | Out-Null
    }

    if ($script:SettingsTabs.Items.Count -gt 0) { $script:SettingsTabs.SelectedIndex = 0 }
    Set-SettingsDirtyState -Dirty $false -Message $ReadyMessage
  } finally {
    $script:IsRenderingSettings = $false
  }
}

function New-DatabaseWorkingCopy {
  param([Parameter(Mandatory = $true)][pscustomobject]$SelectedPlayer)

  $catalogByKey = @{}
  foreach ($catalogEntry in @($script:DatabaseSnapshot.skillCatalog)) {
    $catalogByKey[[string]$catalogEntry.skillKey] = ConvertTo-DeepClone $catalogEntry
  }
  foreach ($skill in @($SelectedPlayer.skillsList)) {
    if (-not $catalogByKey.ContainsKey([string]$skill.skillKey)) {
      $catalogByKey[[string]$skill.skillKey] = ConvertTo-DeepClone $skill
    }
  }

  return [pscustomobject]@{
    summary = ConvertTo-DeepClone $SelectedPlayer.summary
    originalAccountKey = [string]$SelectedPlayer.originalAccountKey
    accountName = [string]$SelectedPlayer.accountName
    account = ConvertTo-DeepClone $SelectedPlayer.account
    characterId = [string]$SelectedPlayer.characterId
    character = ConvertTo-DeepClone $SelectedPlayer.character
    skillsList = Convert-SkillStoreToList -SkillStore (Convert-SkillListToMap -SkillList @($SelectedPlayer.skillsList)) -CatalogByKey $catalogByKey
    itemsList = Convert-ItemMapToList -ItemsMap (Convert-ItemListToMap -ItemList @($SelectedPlayer.itemsList))
    metrics = ConvertTo-DeepClone $SelectedPlayer.metrics
    references = ConvertTo-DeepClone $SelectedPlayer.references
    warningMessages = @($SelectedPlayer.warningMessages)
  }
}

function Convert-SkillListToMap {
  param([Parameter(Mandatory = $true)][object[]]$SkillList)
  $map = [ordered]@{}
  foreach ($skill in $SkillList) { $map[[string]$skill.skillKey] = $skill.raw }
  return [pscustomobject]$map
}

function Convert-ItemListToMap {
  param([Parameter(Mandatory = $true)][object[]]$ItemList)
  $map = [ordered]@{}
  foreach ($item in $ItemList) { $map[[string]$item.itemKey] = $item.raw }
  return [pscustomobject]$map
}

function Build-DisplayItems {
  param([Parameter(Mandatory = $true)][object[]]$Items, [Parameter(Mandatory = $true)][scriptblock]$LabelBuilder, [Parameter(Mandatory = $true)][string]$KeyName)
  return @(
    foreach ($item in $Items) {
      [pscustomobject]@{
        key = [string]$item.$KeyName
        label = (& $LabelBuilder $item)
      }
    }
  )
}

function Get-SkillPointsForLevel {
  param(
    [double]$Rank = 1,
    [int]$Level = 0
  )

  $resolvedLevel = [Math]::Max(0, [Math]::Min(5, $Level))
  $resolvedRank = if ($Rank -gt 0) { $Rank } else { 1 }
  $skillPointTable = @(0, 250, 1415, 8000, 45255, 256000)
  return [int64][Math]::Round($skillPointTable[$resolvedLevel] * $resolvedRank)
}

function Update-WorkingPlayerDerivedData {
  if (-not $script:DbWorkingPlayer) { return }

  $skills = @($script:DbWorkingPlayer.skillsList)
  $items = @($script:DbWorkingPlayer.itemsList)
  $skillPointTotal = 0
  $shipCount = @($items | Where-Object { [int]$_.categoryID -eq 6 }).Count

  foreach ($skill in $skills) {
    if ($null -ne $skill.skillPoints) {
      $skillPointTotal += [double]$skill.skillPoints
    }
  }

  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "skillCount" -Value $skills.Count
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "itemCount" -Value $items.Count
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "shipCount" -Value $shipCount
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "skillPoints" -Value ([int64][Math]::Round($skillPointTotal))
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "skillPoints" -Value ([int64][Math]::Round($skillPointTotal))

  if ($script:DbWorkingPlayer.metrics) {
    Set-ObjectProperty -Object $script:DbWorkingPlayer.metrics -Name "skillCount" -Value $skills.Count
    Set-ObjectProperty -Object $script:DbWorkingPlayer.metrics -Name "itemCount" -Value $items.Count
    Set-ObjectProperty -Object $script:DbWorkingPlayer.metrics -Name "shipCount" -Value $shipCount
  }
}

function Convert-SkillStoreToList {
  param(
    [Parameter(Mandatory = $true)][object]$SkillStore,
    [Parameter(Mandatory = $true)][hashtable]$CatalogByKey
  )

  $skillKeys =
    if ($SkillStore -is [System.Collections.IDictionary]) {
      @($SkillStore.Keys)
    } else {
      @($SkillStore.PSObject.Properties | ForEach-Object { [string]$_.Name })
    }

  $entries = @(
    foreach ($skillKey in ($skillKeys | Sort-Object)) {
      $rawValue =
        if ($SkillStore -is [System.Collections.IDictionary]) {
          $SkillStore[$skillKey]
        } else {
          (Get-JsonPropertyValue -Object $SkillStore -Name $skillKey)
        }
      $raw = ConvertTo-DeepClone $rawValue
      $catalogEntry = $CatalogByKey[[string]$skillKey]
      $skillName = if ($raw.itemName) { [string]$raw.itemName } elseif ($catalogEntry) { [string]$catalogEntry.itemName } else { "Skill $skillKey" }
      $groupName = if ($raw.groupName) { [string]$raw.groupName } elseif ($catalogEntry) { [string]$catalogEntry.groupName } else { "" }
      $skillRank = if ($null -ne $raw.skillRank) { [double]$raw.skillRank } elseif ($catalogEntry -and $null -ne $catalogEntry.skillRank) { [double]$catalogEntry.skillRank } else { 1 }
      $skillLevel = if ($null -ne $raw.skillLevel) { [int]$raw.skillLevel } else { 0 }
      $trainedSkillLevel = if ($null -ne $raw.trainedSkillLevel) { [int]$raw.trainedSkillLevel } else { $skillLevel }
      $effectiveSkillLevel = if ($null -ne $raw.effectiveSkillLevel) { [int]$raw.effectiveSkillLevel } else { $trainedSkillLevel }
      $skillPoints = if ($null -ne $raw.skillPoints) { [int64]$raw.skillPoints } else { Get-SkillPointsForLevel -Rank $skillRank -Level $skillLevel }
      $resolvedTypeId = if ($null -ne $raw.typeID) { $raw.typeID } elseif ($catalogEntry) { $catalogEntry.typeID } else { [int]$skillKey }
      $iconSpec = Resolve-SkillIconSpec -GroupName $groupName -ItemName $skillName

      Add-TypeIconFields -Object ([pscustomobject]@{
        skillKey = [string]$skillKey
        typeID = $resolvedTypeId
        itemName = $skillName
        groupName = $groupName
        groupID = if ($null -ne $raw.groupID) { $raw.groupID } elseif ($catalogEntry) { $catalogEntry.groupID } else { $null }
        skillRank = $skillRank
        skillLevel = $skillLevel
        trainedSkillLevel = $trainedSkillLevel
        effectiveSkillLevel = $effectiveSkillLevel
        skillPoints = $skillPoints
        inTraining = [bool]$raw.inTraining
        raw = $raw
      }) -IconSpec $iconSpec -TypeId $resolvedTypeId
    }
  )

  return @($entries | Sort-Object itemName, skillKey)
}

function New-SkillRawFromCatalog {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$CatalogEntry,
    [Parameter(Mandatory = $true)][string]$CharacterId,
    [int]$Level = 0
  )

  $resolvedLevel = [Math]::Max(0, [Math]::Min(5, $Level))
  $skillRank = if ($null -ne $CatalogEntry.skillRank -and [double]$CatalogEntry.skillRank -gt 0) { [double]$CatalogEntry.skillRank } else { 1 }
  $skillPoints = Get-SkillPointsForLevel -Rank $skillRank -Level $resolvedLevel
  $itemId = [Int64]::Parse(("{0}{1}" -f $CharacterId, $CatalogEntry.skillKey), $script:Culture)

  return [pscustomobject]@{
    itemID = $itemId
    typeID = if ($null -ne $CatalogEntry.typeID) { $CatalogEntry.typeID } else { [int]$CatalogEntry.skillKey }
    ownerID = [Int64]::Parse($CharacterId, $script:Culture)
    locationID = [Int64]::Parse($CharacterId, $script:Culture)
    flagID = 7
    categoryID = 16
    groupID = $CatalogEntry.groupID
    groupName = $CatalogEntry.groupName
    itemName = $CatalogEntry.itemName
    published = if ($null -ne $CatalogEntry.published) { [bool]$CatalogEntry.published } else { $true }
    skillLevel = $resolvedLevel
    trainedSkillLevel = $resolvedLevel
    effectiveSkillLevel = $resolvedLevel
    virtualSkillLevel = $null
    skillRank = $skillRank
    skillPoints = $skillPoints
    trainedSkillPoints = $skillPoints
    inTraining = $false
    trainingStartSP = $skillPoints
    trainingDestinationSP = $skillPoints
    trainingStartTime = $null
    trainingEndTime = $null
  }
}

function New-DatabaseSkillCatalog {
  if (-not $script:DatabaseSnapshot) { return @() }

  $catalogByKey = @{}
  foreach ($catalogEntry in @($script:DatabaseSnapshot.skillCatalog)) {
    $catalogByKey[[string]$catalogEntry.skillKey] = ConvertTo-DeepClone $catalogEntry
  }

  foreach ($skill in @($script:DbWorkingPlayer.skillsList)) {
    $skillKey = [string]$skill.skillKey
    if (-not $catalogByKey.ContainsKey($skillKey)) {
      $catalogByKey[$skillKey] = [pscustomobject]@{
        skillKey = $skillKey
        typeID = if ($null -ne $skill.typeID) { $skill.typeID } else { [int]$skillKey }
        itemName = $skill.itemName
        groupName = $skill.groupName
        groupID = $skill.groupID
        skillRank = if ($null -ne $skill.skillRank) { $skill.skillRank } else { 1 }
        published = $true
      }
    }
  }

  return @(
    $catalogByKey.Values |
      Sort-Object groupName, itemName, skillKey |
      ForEach-Object {
        Add-TypeIconFields -Object $_ -IconSpec (Resolve-SkillIconSpec -GroupName $_.groupName -ItemName $_.itemName) -TypeId $_.typeID
      }
  )
}

function Get-ShipCatalogEntryByTypeId {
  param([object]$TypeId)

  if (-not $script:DatabaseSnapshot) { return $null }
  return ($script:DatabaseSnapshot.shipCatalog | Where-Object { [string]$_.typeID -eq [string]$TypeId } | Select-Object -First 1)
}

function Resolve-ItemLocationLabel {
  param(
    [Parameter(Mandatory = $true)][object]$Raw,
    [hashtable]$RawLookup = @{}
  )

  $locationId = [string](Get-JsonPropertyValue -Object $Raw -Name "locationID")
  if ([string]::IsNullOrWhiteSpace($locationId)) { return "Unknown location" }

  if ($script:DbWorkingPlayer) {
    $character = Get-JsonPropertyValue -Object $script:DbWorkingPlayer -Name "character"
    $summary = Get-JsonPropertyValue -Object $script:DbWorkingPlayer -Name "summary"
    $stationId = Get-JsonPropertyValue -Object $character -Name "stationID"
    $solarSystemId = Get-JsonPropertyValue -Object $character -Name "solarSystemID"
    $stationName = Get-JsonPropertyValue -Object $summary -Name "stationName"
    $solarSystemName = Get-JsonPropertyValue -Object $summary -Name "solarSystemName"

    if ($locationId -eq [string]$stationId) {
      return "Station Hangar | $stationName"
    }
    if ($locationId -eq [string]$solarSystemId) {
      return "In Space | $solarSystemName"
    }
  }

  if ($RawLookup.ContainsKey($locationId)) {
    $container = $RawLookup[$locationId]
    $containerShipName = Get-JsonPropertyValue -Object $container -Name "shipName"
    $containerItemName = Get-JsonPropertyValue -Object $container -Name "itemName"
    $containerName =
      if ($containerShipName) { [string]$containerShipName }
      elseif ($containerItemName) { [string]$containerItemName }
      else { "Container $locationId" }
    return "Cargo | $containerName"
  }

  $workingItems = @(Get-JsonPropertyValue -Object $script:DbWorkingPlayer -Name "itemsList")
  $existingContainer =
    (
    $workingItems |
      Where-Object {
        $candidateKey = Get-JsonPropertyValue -Object $_ -Name "itemKey"
        if ($null -eq $candidateKey) { $candidateKey = Get-JsonPropertyValue -Object $_ -Name "itemID" }
        [string]$candidateKey -eq $locationId
      } |
      Select-Object -First 1
    )
  if ($existingContainer) {
    $existingContainerName = Get-JsonPropertyValue -Object $existingContainer -Name "itemName"
    return "Cargo | $existingContainerName"
  }

  return "Location $locationId"
}

function Convert-RawItemToListEntry {
  param(
    [Parameter(Mandatory = $true)][string]$ItemKey,
    [Parameter(Mandatory = $true)][object]$Raw,
    [hashtable]$RawLookup = @{}
  )

  $categoryIdValue = Get-JsonPropertyValue -Object $Raw -Name "categoryID"
  $typeIdValue = Get-JsonPropertyValue -Object $Raw -Name "typeID"
  $shipNameValue = Get-JsonPropertyValue -Object $Raw -Name "shipName"
  $itemNameValue = Get-JsonPropertyValue -Object $Raw -Name "itemName"
  $groupNameValue = Get-JsonPropertyValue -Object $Raw -Name "groupName"
  $quantityRaw = Get-JsonPropertyValue -Object $Raw -Name "quantity"
  $stackSizeRaw = Get-JsonPropertyValue -Object $Raw -Name "stacksize"
  $groupIdValue = Get-JsonPropertyValue -Object $Raw -Name "groupID"

  $categoryId = if ($null -ne $categoryIdValue) { [int]$categoryIdValue } else { $null }
  $catalogEntry = if ($categoryId -eq 6) { Get-ShipCatalogEntryByTypeId -TypeId $typeIdValue } else { $null }
  $itemName =
    if ($shipNameValue) { [string]$shipNameValue }
    elseif ($itemNameValue) { [string]$itemNameValue }
    elseif ($catalogEntry) { [string]$catalogEntry.name }
    else { "Item $ItemKey" }
  $groupName =
    if ($groupNameValue) { [string]$groupNameValue }
    elseif ($catalogEntry -and $catalogEntry.groupName) { [string]$catalogEntry.groupName }
    else { "" }
  $quantityValue =
    if ($categoryId -eq 6) { 1 }
    elseif ($null -ne $quantityRaw -and [double]$quantityRaw -gt 0) { [double]$quantityRaw }
    elseif ($null -ne $stackSizeRaw -and [double]$stackSizeRaw -gt 0) { [double]$stackSizeRaw }
    else { 1 }
  $metaText =
    if ($categoryId -eq 6) {
      if ($groupName) { "Ship | $groupName" } else { "Ship" }
    } else {
      $groupLabel = if ($groupName) { $groupName } else { "Inventory Item" }
      "$groupLabel | Qty $([int64][Math]::Round($quantityValue))"
    }

  Add-TypeIconFields -Object ([pscustomobject]@{
    itemKey = [string]$ItemKey
    typeID = $typeIdValue
    itemName = $itemName
    typeName = if ($catalogEntry) { $catalogEntry.name } elseif ($itemNameValue) { [string]$itemNameValue } else { "Type $typeIdValue" }
    quantity = $quantityValue
    quantityLabel = if ($categoryId -eq 6) { $groupName } else { "x$([int64][Math]::Round($quantityValue))" }
    categoryID = $categoryId
    groupID = $groupIdValue
    groupName = $groupName
    locationLabel = Resolve-ItemLocationLabel -Raw $Raw -RawLookup $RawLookup
    metaText = $metaText
    isShip = ($categoryId -eq 6)
    raw = $Raw
  }) -IconSpec (Resolve-ItemIconSpec -GroupName $groupName -CategoryID $categoryId -ItemName $itemName) -TypeId $typeIdValue
}

function Convert-ItemMapToList {
  param([Parameter(Mandatory = $true)][pscustomobject]$ItemsMap)

  $rawLookup = @{}
  foreach ($property in $ItemsMap.PSObject.Properties) {
    $rawLookup[[string]$property.Name] = ConvertTo-DeepClone $property.Value
  }

  return @(
    $ItemsMap.PSObject.Properties |
      ForEach-Object {
        Convert-RawItemToListEntry -ItemKey ([string]$_.Name) -Raw (ConvertTo-DeepClone $_.Value) -RawLookup $rawLookup
      } |
      Sort-Object itemName, itemKey
  )
}

function Get-PlayerDisplayEntry {
  param([Parameter(Mandatory = $true)][pscustomobject]$Player)

  Add-TypeIconFields -Object ([pscustomobject]@{
    characterId = [string]$Player.characterId
    characterName = [string]$Player.characterName
    accountName = [string]$Player.accountName
    shipName = [string]$Player.shipName
    shipTypeID = $Player.shipTypeID
    solarSystemName = [string]$Player.solarSystemName
    warningMessages = @($Player.warningMessages)
    searchText = [string]$Player.searchText
  }) -IconSpec (Resolve-ShipIconSpec -GroupName "" -ShipName $Player.shipName) -TypeId $Player.shipTypeID
}

function Search-DatabaseTypes {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("ship", "item")][string]$Kind,
    [string]$Query = ""
  )

  if ($Kind -eq "ship" -and $script:DatabaseSnapshot -and $script:DatabaseSnapshot.shipCatalog) {
    $needle = $Query.Trim().ToLowerInvariant()
    return @(
      $script:DatabaseSnapshot.shipCatalog |
        Where-Object {
          if ($needle -eq "") { return $true }
          (("{0} {1}" -f $_.name, $_.groupName).ToLowerInvariant() -like "*$needle*")
        } |
        Select-Object -First 80
    )
  }

  return @(Invoke-ProjectCli -Command "database-type-search" -Arguments @($Kind, $Query))
}

function Convert-TypeSearchResultToDisplayEntry {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("ship", "item")][string]$Kind,
    [Parameter(Mandatory = $true)][pscustomobject]$Result
  )

  $displayName = if ($Kind -eq "ship") { [string]$Result.name } else { [string]$Result.name }
  $metaText =
    if ($Kind -eq "ship") {
      "{0} | Cargo {1:N0} m3" -f $Result.groupName, [double]$Result.capacity
    } else {
      "{0} | Volume {1:N2} m3" -f $Result.groupName, [double]$Result.volume
    }

  Add-TypeIconFields -Object ([pscustomobject]@{
    typeID = [string]$Result.typeID
    name = $displayName
    groupName = [string]$Result.groupName
    categoryID = $Result.categoryID
    metaText = $metaText
    raw = $Result
  }) -IconSpec (
    if ($Kind -eq "ship") {
      Resolve-ShipIconSpec -GroupName $Result.groupName -ShipName $displayName
    } else {
      Resolve-ItemIconSpec -GroupName $Result.groupName -CategoryID $Result.categoryID -ItemName $displayName
    }
  ) -TypeId $Result.typeID
}

function Get-NextGeneratedItemId {
  if (-not $script:NextGeneratedItemId) {
    $script:NextGeneratedItemId =
      if ($script:DatabaseSnapshot -and $script:DatabaseSnapshot.nextItemIdSeed) {
        [int64]$script:DatabaseSnapshot.nextItemIdSeed
      } else {
        [int64]990000001
      }
  }

  $nextId = [int64]$script:NextGeneratedItemId
  $script:NextGeneratedItemId = $nextId + 1
  return $nextId
}

function New-LocationOption {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][Int64]$LocationId,
    [Parameter(Mandatory = $true)][int]$FlagId,
    [string]$HelperText = ""
  )

  return [pscustomobject]@{
    key = $Key
    label = $Label
    locationID = $LocationId
    flagID = $FlagId
    helperText = $HelperText
  }
}

function Get-ShipLocationOptions {
  param([pscustomobject]$ExistingItem)

  $options = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary

  if ($character.stationID) {
    $option = New-LocationOption -Key "station" -Label ("Station Hangar | {0}" -f $summary.stationName) -LocationId ([int64]$character.stationID) -FlagId 4 -HelperText "Safe default. The ship will appear in the pilot's station hangar."
    $seen[$option.key] = $true
    $options.Add($option)
  }

  if ($character.solarSystemID) {
    $option = New-LocationOption -Key "space" -Label ("In Space | {0}" -f $summary.solarSystemName) -LocationId ([int64]$character.solarSystemID) -FlagId 0 -HelperText "Places the ship in space in the pilot's current solar system."
    $seen[$option.key] = $true
    $options.Add($option)
  }

  if ($ExistingItem) {
    $currentKey = "current:{0}:{1}" -f [string]$ExistingItem.raw.locationID, [string]$ExistingItem.raw.flagID
    if (-not $seen.ContainsKey($currentKey)) {
      $options.Add((New-LocationOption -Key $currentKey -Label ("Keep Current | {0}" -f $ExistingItem.locationLabel) -LocationId ([int64]$ExistingItem.raw.locationID) -FlagId ([int]$ExistingItem.raw.flagID) -HelperText "Preserves the ship exactly where it already lives.")) | Out-Null
    }
  }

  return @($options)
}

function Get-ItemLocationOptions {
  param([pscustomobject]$ExistingItem)

  $options = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary

  if ($character.stationID) {
    $option = New-LocationOption -Key "station" -Label ("Station Hangar | {0}" -f $summary.stationName) -LocationId ([int64]$character.stationID) -FlagId 4 -HelperText "Places the item directly in the pilot's station hangar."
    $seen[$option.key] = $true
    $options.Add($option)
  }

  foreach ($ship in @($script:DbWorkingPlayer.itemsList | Where-Object { [int]$_.categoryID -eq 6 })) {
    $option = New-LocationOption -Key ("cargo:{0}" -f $ship.itemKey) -Label ("Cargo | {0}" -f $ship.itemName) -LocationId ([int64]$ship.itemKey) -FlagId 5 -HelperText "Adds the item into this ship's cargo hold."
    if (-not $seen.ContainsKey($option.key)) {
      $seen[$option.key] = $true
      $options.Add($option)
    }
  }

  if ($ExistingItem) {
    $currentKey = "current:{0}:{1}" -f [string]$ExistingItem.raw.locationID, [string]$ExistingItem.raw.flagID
    if (-not $seen.ContainsKey($currentKey)) {
      $options.Add((New-LocationOption -Key $currentKey -Label ("Keep Current | {0}" -f $ExistingItem.locationLabel) -LocationId ([int64]$ExistingItem.raw.locationID) -FlagId ([int]$ExistingItem.raw.flagID) -HelperText "Preserves the current container or location for this item.")) | Out-Null
    }
  }

  return @($options)
}

function New-DefaultSpaceState {
  param([Parameter(Mandatory = $true)][Int64]$SystemId)

  return [pscustomobject]@{
    systemID = $SystemId
    position = [pscustomobject]@{ x = 0; y = 0; z = 0 }
    velocity = [pscustomobject]@{ x = 0; y = 0; z = 0 }
    direction = [pscustomobject]@{ x = 1; y = 0; z = 0 }
    targetPoint = [pscustomobject]@{ x = 0; y = 0; z = 0 }
    speedFraction = 0
    mode = "STOP"
    targetEntityID = $null
    followRange = 0
    orbitDistance = 0
    orbitNormal = [pscustomobject]@{ x = 0; y = 0; z = 1 }
    orbitSign = 1
    warpState = $null
  }
}

function New-DefaultConditionState {
  return [pscustomobject]@{
    damage = 0
    charge = 1
    armorDamage = 0
    shieldCharge = 1
    incapacitated = $false
  }
}

function Build-ShipRawFromType {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$TypeEntry,
    [Parameter(Mandatory = $true)][pscustomobject]$LocationOption,
    [Parameter(Mandatory = $true)][string]$DisplayName,
    [pscustomobject]$ExistingRaw
  )

  $raw = if ($ExistingRaw) { ConvertTo-DeepClone $ExistingRaw } else { [pscustomobject]@{} }
  $itemId = if ($ExistingRaw) { [int64]$ExistingRaw.itemID } else { Get-NextGeneratedItemId }
  $resolvedName = if ($DisplayName.Trim()) { $DisplayName.Trim() } else { [string]$TypeEntry.name }
  $spaceState =
    if ([int]$LocationOption.flagID -eq 0) {
      if ($ExistingRaw -and $ExistingRaw.spaceState) { ConvertTo-DeepClone $ExistingRaw.spaceState } else { New-DefaultSpaceState -SystemId ([int64]$LocationOption.locationID) }
    } else {
      $null
    }

  foreach ($pair in ([ordered]@{
    itemID = $itemId
    typeID = [int]$TypeEntry.typeID
    ownerID = [int64]$script:DbWorkingPlayer.characterId
    locationID = [int64]$LocationOption.locationID
    flagID = [int]$LocationOption.flagID
    quantity = -1
    stacksize = 1
    singleton = 1
    groupID = $TypeEntry.groupID
    categoryID = 6
    customInfo = ""
    itemName = $resolvedName
    mass = $TypeEntry.mass
    volume = $TypeEntry.volume
    capacity = $TypeEntry.capacity
    radius = $TypeEntry.radius
    spaceState = $spaceState
    conditionState = if ($ExistingRaw -and $ExistingRaw.conditionState) { ConvertTo-DeepClone $ExistingRaw.conditionState } else { New-DefaultConditionState }
    shipID = $itemId
    shipTypeID = [int]$TypeEntry.typeID
    shipName = $resolvedName
  }).GetEnumerator()) {
    Set-ObjectProperty -Object $raw -Name $pair.Key -Value $pair.Value
  }

  return $raw
}

function Build-InventoryItemRawFromType {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$TypeEntry,
    [Parameter(Mandatory = $true)][pscustomobject]$LocationOption,
    [Parameter(Mandatory = $true)][string]$DisplayName,
    [Parameter(Mandatory = $true)][Int64]$Quantity,
    [pscustomobject]$ExistingRaw
  )

  $raw = if ($ExistingRaw) { ConvertTo-DeepClone $ExistingRaw } else { [pscustomobject]@{} }
  $itemId = if ($ExistingRaw) { [int64]$ExistingRaw.itemID } else { Get-NextGeneratedItemId }
  $resolvedName = if ($DisplayName.Trim()) { $DisplayName.Trim() } else { [string]$TypeEntry.name }

  foreach ($pair in ([ordered]@{
    itemID = $itemId
    typeID = [int]$TypeEntry.typeID
    ownerID = [int64]$script:DbWorkingPlayer.characterId
    locationID = [int64]$LocationOption.locationID
    flagID = [int]$LocationOption.flagID
    quantity = $Quantity
    stacksize = $Quantity
    singleton = 0
    groupID = $TypeEntry.groupID
    categoryID = $TypeEntry.categoryID
    customInfo = ""
    itemName = $resolvedName
    mass = $TypeEntry.mass
    volume = $TypeEntry.volume
    capacity = $TypeEntry.capacity
    radius = $TypeEntry.radius
  }).GetEnumerator()) {
    Set-ObjectProperty -Object $raw -Name $pair.Key -Value $pair.Value
  }

  return $raw
}

function Update-SelectedShipReferences {
  param([Parameter(Mandatory = $true)][pscustomobject]$UpdatedEntry)

  if ([string]$UpdatedEntry.itemKey -ne [string]$script:DbWorkingPlayer.character.shipID) { return }

  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipID" -Value ([int64]$UpdatedEntry.itemKey)
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipTypeID" -Value $UpdatedEntry.raw.shipTypeID
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipName" -Value $UpdatedEntry.raw.shipName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "shipName" -Value $UpdatedEntry.raw.shipName
}

function Update-ItemActionState {
  $hasSelection = $script:DbItemPreviewList -and $script:DbItemPreviewList.SelectedItem
  if ($script:DbEditItemButton) { $script:DbEditItemButton.IsEnabled = [bool]$hasSelection }
  if ($script:DbRemoveItemButton) { $script:DbRemoveItemButton.IsEnabled = [bool]$hasSelection }
}

function Open-ItemShipEditor {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("ship", "item")][string]$Kind,
    [pscustomobject]$ExistingItem
  )

  if (-not $script:DbWorkingPlayer) { return }
  Sync-OverviewControlsToWorkingCopy

  $isEdit = ($null -ne $ExistingItem)
  $windowTitle =
    if ($Kind -eq "ship") {
      if ($isEdit) { "Edit Ship" } else { "Add Ship" }
    } else {
      if ($isEdit) { "Edit Item" } else { "Add Item" }
    }
  $helperText =
    if ($Kind -eq "ship") {
      "Pick a hull, give it a pilot-friendly name, and choose whether it lands in the hangar or current system."
    } else {
      "Search the item database, set quantity, and drop the stack into a hangar or ship cargo hold."
    }

  [xml]$editorXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="1020" Height="700" MinWidth="900" MinHeight="620" WindowStartupLocation="CenterOwner" Background="#F4F7FB" FontFamily="Segoe UI">
  <Grid Margin="18">
    <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
    <Border Grid.Row="0" CornerRadius="22" Padding="22" Margin="0,0,0,16" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1">
      <StackPanel>
        <TextBlock x:Name="EditorHeroTitle" FontSize="28" FontWeight="SemiBold" Foreground="#102235" />
        <TextBlock x:Name="EditorHeroText" Margin="0,8,0,0" FontSize="13" Foreground="#516579" TextWrapping="Wrap" />
      </StackPanel>
    </Border>
    <Grid Grid.Row="1">
      <Grid.ColumnDefinitions><ColumnDefinition Width="360" /><ColumnDefinition Width="16" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
      <Border Grid.Column="0" CornerRadius="20" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="16">
        <DockPanel LastChildFill="True">
          <StackPanel DockPanel.Dock="Top">
            <TextBlock Text="Catalog Search" FontSize="18" FontWeight="SemiBold" Foreground="#102235" />
            <TextBlock Text="Search by name or group." Margin="0,6,0,12" FontSize="12" Foreground="#6A7C90" />
            <TextBox x:Name="EditorSearchBox" Height="38" Padding="10,6,10,6" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" />
          </StackPanel>
          <ListBox x:Name="EditorResultList" Margin="0,12,0,0" BorderThickness="0" Background="Transparent" />
        </DockPanel>
      </Border>
      <Border Grid.Column="2" CornerRadius="20" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="20">
        <Grid>
          <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="*" /></Grid.RowDefinitions>
          <DockPanel Grid.Row="0">
            <Border x:Name="EditorIconCard" Width="54" Height="54" CornerRadius="16" BorderBrush="#D9E2EC" BorderThickness="1" Background="#EAF4FB">
              <Grid>
                <TextBlock x:Name="EditorIconGlyph" FontFamily="Segoe MDL2 Assets" FontSize="24" Foreground="#2F6F9F" HorizontalAlignment="Center" VerticalAlignment="Center" />
                <Image x:Name="EditorIconImage" Stretch="Uniform" Margin="6" />
              </Grid>
            </Border>
            <StackPanel Margin="14,0,0,0">
              <TextBlock x:Name="EditorNameHeadline" FontSize="24" FontWeight="SemiBold" Foreground="#102235" />
              <TextBlock x:Name="EditorMetaText" Margin="0,6,0,0" FontSize="12" Foreground="#6A7C90" TextWrapping="Wrap" />
            </StackPanel>
          </DockPanel>
          <Border Grid.Row="1" Margin="0,16,0,0" CornerRadius="14" Background="#F7FAFD" BorderBrush="#E2E8F0" BorderThickness="1" Padding="14">
            <TextBlock x:Name="EditorHelperText" FontSize="12" Foreground="#516579" TextWrapping="Wrap" />
          </Border>
          <Grid Grid.Row="2" Margin="0,18,0,0">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
            <StackPanel Grid.Column="0" Margin="0,0,10,0">
              <TextBlock x:Name="EditorNameLabel" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,6" />
              <TextBox x:Name="EditorNameTextBox" Height="38" Padding="10,6,10,6" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" />
            </StackPanel>
            <StackPanel Grid.Column="1" Margin="10,0,0,0">
              <TextBlock x:Name="EditorQtyLabel" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,6" />
              <TextBox x:Name="EditorQtyTextBox" Height="38" Padding="10,6,10,6" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" />
            </StackPanel>
          </Grid>
          <StackPanel Grid.Row="3" Margin="0,18,0,0">
            <TextBlock Text="Where should it go?" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,6" />
            <ComboBox x:Name="EditorLocationCombo" Height="38" Padding="8,4,8,4" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" />
            <TextBlock x:Name="EditorLocationHelpText" Margin="0,8,0,0" FontSize="12" Foreground="#6A7C90" TextWrapping="Wrap" />
          </StackPanel>
          <Border Grid.Row="4" Margin="0,18,0,0" CornerRadius="16" Background="#FFFFFF" BorderBrush="#E2E8F0" BorderThickness="1" Padding="16">
            <StackPanel>
              <TextBlock Text="Power Notes" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
              <TextBlock x:Name="EditorPowerText" Margin="0,8,0,0" FontSize="12" Foreground="#516579" TextWrapping="Wrap" />
            </StackPanel>
          </Border>
        </Grid>
      </Border>
    </Grid>
    <Border Grid.Row="2" Margin="0,16,0,0" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="16">
      <DockPanel LastChildFill="False">
        <TextBlock x:Name="EditorFooterText" VerticalAlignment="Center" FontSize="12" Foreground="#6A7C90" Text="Changes are staged locally until you click Save Player Changes." />
        <StackPanel DockPanel.Dock="Right" Orientation="Horizontal">
          <Button x:Name="EditorCancelButton" Margin="0,0,10,0" Padding="14,10,14,10">Cancel</Button>
          <Button x:Name="EditorApplyButton" Padding="16,10,16,10">Stage Change</Button>
        </StackPanel>
      </DockPanel>
    </Border>
  </Grid>
</Window>
'@

  $editorWindow = [System.Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($editorXaml))
  $editorWindow.Title = "EvEJS $windowTitle"
  $editorWindow.Owner = $script:Window

  $editorHeroTitle = $editorWindow.FindName("EditorHeroTitle")
  $editorHeroText = $editorWindow.FindName("EditorHeroText")
  $editorSearchBox = $editorWindow.FindName("EditorSearchBox")
  $editorResultList = $editorWindow.FindName("EditorResultList")
  $editorIconCard = $editorWindow.FindName("EditorIconCard")
  $editorIconGlyph = $editorWindow.FindName("EditorIconGlyph")
  $editorIconImage = $editorWindow.FindName("EditorIconImage")
  $editorNameHeadline = $editorWindow.FindName("EditorNameHeadline")
  $editorMetaText = $editorWindow.FindName("EditorMetaText")
  $editorHelperText = $editorWindow.FindName("EditorHelperText")
  $editorNameLabel = $editorWindow.FindName("EditorNameLabel")
  $editorNameTextBox = $editorWindow.FindName("EditorNameTextBox")
  $editorQtyLabel = $editorWindow.FindName("EditorQtyLabel")
  $editorQtyTextBox = $editorWindow.FindName("EditorQtyTextBox")
  $editorLocationCombo = $editorWindow.FindName("EditorLocationCombo")
  $editorLocationHelpText = $editorWindow.FindName("EditorLocationHelpText")
  $editorPowerText = $editorWindow.FindName("EditorPowerText")
  $editorFooterText = $editorWindow.FindName("EditorFooterText")
  $editorCancelButton = $editorWindow.FindName("EditorCancelButton")
  $editorApplyButton = $editorWindow.FindName("EditorApplyButton")

  foreach ($button in @($editorCancelButton, $editorApplyButton)) { $button.Style = $script:Window.FindResource("SecondaryButtonStyle") }
  $editorApplyButton.Style = $script:Window.FindResource("PrimaryButtonStyle")
  Set-ButtonChrome -Button $editorCancelButton -Text "Cancel" -GlyphCode 0xE711 -IconKey "close"
  Set-ButtonChrome -Button $editorApplyButton -Text "Stage Change" -GlyphCode 0xE70B -IconKey "checkmark"

  $editorHeroTitle.Text = $windowTitle
  $editorHeroText.Text = $helperText
  $editorNameLabel.Text = if ($Kind -eq "ship") { "Ship Name" } else { "Display Name" }
  $editorQtyLabel.Text = if ($Kind -eq "ship") { "Hull Count" } else { "Quantity" }
  $editorQtyTextBox.Text = if ($Kind -eq "ship") { "1" } elseif ($ExistingItem) { [string][int64][Math]::Round([double]$ExistingItem.quantity) } else { "1" }
  if ($Kind -eq "ship") { $editorQtyTextBox.IsEnabled = $false; $editorQtyTextBox.Opacity = 0.55 }
  $editorPowerText.Text =
    if ($Kind -eq "ship") {
      "Editing the active ship updates the character ship name/type automatically. Removing the active ship is blocked on purpose."
    } else {
      "Use station hangar for safe storage, or cargo locations for immediate inventory placement on a ship."
    }
  $editorFooterText.Text = if ($isEdit) { "Editing $($ExistingItem.itemName). The change only hits disk when you save the player." } else { "This creates a new staged record for the selected player." }

  $editorResultList.SelectedValuePath = "typeID"
  $editorLocationCombo.DisplayMemberPath = "label"
  $editorLocationCombo.SelectedValuePath = "key"
  $editorResultList.ItemContainerStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="{x:Type ListBoxItem}">
  <Setter Property="Padding" Value="0" />
  <Setter Property="Margin" Value="0,0,0,10" />
  <Setter Property="HorizontalContentAlignment" Value="Stretch" />
  <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="{x:Type ListBoxItem}"><Border x:Name="Card" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" CornerRadius="16"><ContentPresenter /></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Card" Property="Background" Value="#F7FAFD" /><Setter TargetName="Card" Property="BorderBrush" Value="#B9D4E8" /></Trigger><Trigger Property="IsSelected" Value="True"><Setter TargetName="Card" Property="Background" Value="#EAF4FB" /><Setter TargetName="Card" Property="BorderBrush" Value="#6FAEDC" /></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter>
</Style>
'@)
  $editorResultList.ItemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding name}" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
      <TextBlock Text="{Binding metaText}" Margin="0,4,0,0" FontSize="11" Foreground="#6A7C90" TextWrapping="Wrap" />
    </StackPanel>
  </Grid>
</DataTemplate>
'@)

  $locationOptions = if ($Kind -eq "ship") { @(Get-ShipLocationOptions -ExistingItem $ExistingItem) } else { @(Get-ItemLocationOptions -ExistingItem $ExistingItem) }
  $editorLocationCombo.ItemsSource = $locationOptions
  if (@($locationOptions).Count -gt 0) { $editorLocationCombo.SelectedIndex = 0 }

  $selectedDisplayResult = $null
  $updateLocationHelp = {
    $selection = $editorLocationCombo.SelectedItem
    $editorLocationHelpText.Text = if ($selection) { [string]$selection.helperText } else { "" }
  }
  $refreshSelectionPanel = {
    $selection = $editorResultList.SelectedItem
    if (-not $selection) { return }
    $selectedDisplayResult = $selection
    $editorIconGlyph.Text = [string]$selection.iconGlyph
    $editorIconGlyph.Foreground = New-Brush ([string]$selection.iconForeground)
    $editorIconCard.Background = New-Brush ([string]$selection.iconBackground)
    $editorIconCard.BorderBrush = New-Brush ([string]$selection.iconBorder)
    $editorIconImage.Source = if ($selection.iconFilePath) { $selection.iconFilePath } else { $null }
    $editorNameHeadline.Text = [string]$selection.name
    $editorMetaText.Text = [string]$selection.metaText
    $editorHelperText.Text =
      if ($Kind -eq "ship") {
        "Type ID $($selection.typeID) | $($selection.groupName). Great for stocking replacement hulls or staging named admin ships."
      } else {
        "Type ID $($selection.typeID) | $($selection.groupName). Friendly editor mode keeps you out of raw JSON for normal inventory work."
      }
    if ([string]::IsNullOrWhiteSpace($editorNameTextBox.Text)) {
      $editorNameTextBox.Text = [string]$selection.name
    }
  }
  $refreshResults = {
    $results = @(Search-DatabaseTypes -Kind $Kind -Query $editorSearchBox.Text)
    $display = @($results | ForEach-Object { Convert-TypeSearchResultToDisplayEntry -Kind $Kind -Result $_ })
    $editorResultList.ItemsSource = $display
    if ($display.Count -gt 0) {
      $preferredTypeId =
        if ($ExistingItem) {
          [string](Get-JsonPropertyValue -Object $ExistingItem.raw -Name "typeID")
        } elseif ($selectedDisplayResult) {
          [string]$selectedDisplayResult.typeID
        } else {
          [string]$display[0].typeID
        }
      $resolved = ($display | Where-Object { [string]$_.typeID -eq $preferredTypeId } | Select-Object -First 1)
      $editorResultList.SelectedItem = if ($resolved) { $resolved } else { $display[0] }
    }
  }

  if ($ExistingItem) {
    $existingShipName = Get-JsonPropertyValue -Object $ExistingItem.raw -Name "shipName"
    $editorNameTextBox.Text = if ($existingShipName) { [string]$existingShipName } else { [string]$ExistingItem.itemName }
    foreach ($locationOption in @($locationOptions)) {
      $existingLocationId = [int64](Get-JsonPropertyValue -Object $ExistingItem.raw -Name "locationID")
      $existingFlagId = [int](Get-JsonPropertyValue -Object $ExistingItem.raw -Name "flagID")
      if ([int64]$locationOption.locationID -eq $existingLocationId -and [int]$locationOption.flagID -eq $existingFlagId) {
        $editorLocationCombo.SelectedValue = $locationOption.key
        break
      }
    }
    if ($Kind -eq "item") {
      $editorQtyTextBox.Text = [string][int64][Math]::Round([double]$ExistingItem.quantity)
    }
    $editorSearchBox.Text = [string]$ExistingItem.itemName
  }

  $editorSearchBox.Add_TextChanged({ & $refreshResults })
  $editorResultList.Add_SelectionChanged({ & $refreshSelectionPanel })
  $editorLocationCombo.Add_SelectionChanged({ & $updateLocationHelp })
  $editorCancelButton.Add_Click({ $editorWindow.Close() })
  $editorApplyButton.Add_Click({
    try {
      $selectedType = $editorResultList.SelectedItem
      if (-not $selectedType) { throw "Pick a ship or item type first." }
      $location = $editorLocationCombo.SelectedItem
      if (-not $location) { throw "Choose where the item should go." }

      $displayName = $editorNameTextBox.Text.Trim()
      if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = [string]$selectedType.name }
      $existingRaw = if ($ExistingItem) { $ExistingItem.raw } else { $null }

      $newRaw =
        if ($Kind -eq "ship") {
          Build-ShipRawFromType -TypeEntry $selectedType.raw -LocationOption $location -DisplayName $displayName -ExistingRaw $existingRaw
        } else {
          $quantity = [int64](Parse-NumericText -Text $editorQtyTextBox.Text -Label "Item quantity")
          if ($quantity -lt 1) { throw "Item quantity must be at least 1." }
          Build-InventoryItemRawFromType -TypeEntry $selectedType.raw -LocationOption $location -DisplayName $displayName -Quantity $quantity -ExistingRaw $existingRaw
        }

      $newEntry = Convert-RawItemToListEntry -ItemKey ([string]$newRaw.itemID) -Raw $newRaw

      if ($ExistingItem) {
        $script:DbWorkingPlayer.itemsList = @(
          foreach ($candidate in @($script:DbWorkingPlayer.itemsList)) {
            if ([string]$candidate.itemKey -eq [string]$ExistingItem.itemKey) { $newEntry } else { $candidate }
          }
        )
      } else {
        $script:DbWorkingPlayer.itemsList = @($script:DbWorkingPlayer.itemsList + $newEntry | Sort-Object itemName, itemKey)
      }

      if ($Kind -eq "ship") { Update-SelectedShipReferences -UpdatedEntry $newEntry }
      Update-WorkingPlayerDerivedData
      Render-DatabasePlayer
      Set-DatabaseDirtyState -Dirty $true -Message ("{0} {1} is staged in the database working copy." -f $(if ($isEdit) { "Updated" } else { "Added" }), $displayName)
      $editorWindow.DialogResult = $true
      $editorWindow.Close()
    } catch {
      [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
    }
  })

  & $refreshResults
  & $updateLocationHelp
  $null = $editorWindow.ShowDialog()
}

function Remove-SelectedInventoryEntry {
  if (-not $script:DbItemPreviewList.SelectedItem) { return }

  $selectedItem = [pscustomobject]$script:DbItemPreviewList.SelectedItem
  if ([string]$selectedItem.itemKey -eq [string]$script:DbWorkingPlayer.character.shipID) {
    throw "The currently active ship cannot be removed from this helper. Switch the player to another ship first."
  }

  $decision = [System.Windows.MessageBox]::Show(
    "Remove $($selectedItem.itemName) from the staged player inventory?",
    "EvEJS Database Helper",
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Warning
  )
  if ($decision -ne [System.Windows.MessageBoxResult]::Yes) { return }

  $script:DbWorkingPlayer.itemsList = @($script:DbWorkingPlayer.itemsList | Where-Object { [string]$_.itemKey -ne [string]$selectedItem.itemKey })
  Update-WorkingPlayerDerivedData
  Render-DatabasePlayer
  Set-DatabaseDirtyState -Dirty $true -Message "$($selectedItem.itemName) was removed from the staged inventory."
}

function Update-DatabaseSummary {
  if (-not $script:DbWorkingPlayer) { return }
  $summary = $script:DbWorkingPlayer.summary
  $script:DbPlayerHeadline.Text = "$($summary.characterName)  •  $($script:DbWorkingPlayer.accountName)"
  $script:DbPlayerMeta.Text = "$($summary.shipName) • $($summary.stationName) • $($summary.solarSystemName) • $($summary.corporationName)"
  $warnings = @($script:DbWorkingPlayer.warningMessages)
  $script:DbWarningText.Text = ($warnings -join " ")
  $script:DbWarningText.Visibility = if ($warnings.Count -gt 0) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }

  $script:DbMetricPanel.Children.Clear()
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("ISK: {0}" -f (Format-DisplayValue $summary.balance)) -Background "#DBEAFE" -Foreground "#1D4ED8")) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Skills: {0}" -f $summary.skillCount) -Background "#DCFCE7" -Foreground "#166534")) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Items: {0}" -f $summary.itemCount) -Background "#EDE9FE" -Foreground "#6D28D9")) | Out-Null
}

function Render-OverviewFields {
  if (-not $script:DbWorkingPlayer) { return }
  $account = $script:DbWorkingPlayer.account
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary

  $script:DbAccountNameTextBox.Text = [string]$script:DbWorkingPlayer.accountName
  $script:DbBannedCheckBox.IsChecked = [bool]$account.banned
  $script:DbCharacterNameTextBox.Text = [string]$character.characterName
  $script:DbShipNameTextBox.Text = [string]$character.shipName
  $script:DbBalanceTextBox.Text = Format-DisplayValue $character.balance
  $script:DbPlexTextBox.Text = Format-DisplayValue $character.plexBalance
  $script:DbAurTextBox.Text = Format-DisplayValue $character.aurBalance
  $script:DbSecurityStatusTextBox.Text = Format-DisplayValue $character.securityStatus
  $script:DbDaysLeftTextBox.Text = Format-DisplayValue $character.daysLeft
  $script:DbDescriptionTextBox.Text = [string]$character.description
  $script:DbOverviewCorporationText.Text = [string]$summary.corporationName
  $script:DbOverviewStationText.Text = [string]$summary.stationName
  $script:DbOverviewSystemText.Text = [string]$summary.solarSystemName

  $script:DbSkillPreviewList.DisplayMemberPath = "label"
  $script:DbSkillPreviewList.ItemsSource = Build-DisplayItems -Items @($script:DbWorkingPlayer.skillsList) -KeyName "skillKey" -LabelBuilder {
    param($skill)
    "{0}  •  Level {1}" -f $skill.itemName, $skill.skillLevel
  }

  $script:DbItemPreviewList.DisplayMemberPath = "label"
  $script:DbItemPreviewList.ItemsSource = Build-DisplayItems -Items @($script:DbWorkingPlayer.itemsList) -KeyName "itemKey" -LabelBuilder {
    param($item)
    "{0}  •  {1}" -f $item.itemName, $item.locationLabel
  }
}

function Refresh-RawJsonEditors {
  if (-not $script:DbWorkingPlayer) { return }
  $script:DbAccountJsonTextBox.Text = ConvertTo-PrettyJson $script:DbWorkingPlayer.account
  $script:DbCharacterJsonTextBox.Text = ConvertTo-PrettyJson $script:DbWorkingPlayer.character
  $script:DbSkillsJsonTextBox.Text = ConvertTo-PrettyJson (Convert-SkillListToMap -SkillList @($script:DbWorkingPlayer.skillsList))
  $script:DbItemsJsonTextBox.Text = ConvertTo-PrettyJson (Convert-ItemListToMap -ItemList @($script:DbWorkingPlayer.itemsList))
  $script:DbRawJsonDirty = $false
}

function Sync-OverviewControlsToWorkingCopy {
  if (-not $script:DbWorkingPlayer) { return }
  $accountName = $script:DbAccountNameTextBox.Text.Trim()
  $characterName = $script:DbCharacterNameTextBox.Text.Trim()
  if ($accountName -eq "") { throw "Account name cannot be blank." }
  if ($characterName -eq "") { throw "Character name cannot be blank." }

  $script:DbWorkingPlayer.accountName = $accountName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.account -Name "banned" -Value ([bool]$script:DbBannedCheckBox.IsChecked)
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "characterName" -Value $characterName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipName" -Value $script:DbShipNameTextBox.Text.Trim()
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "balance" -Value (Parse-NumericText -Text $script:DbBalanceTextBox.Text -Label "ISK balance")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "plexBalance" -Value (Parse-NumericText -Text $script:DbPlexTextBox.Text -Label "PLEX balance")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "aurBalance" -Value (Parse-NumericText -Text $script:DbAurTextBox.Text -Label "AUR balance")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "securityStatus" -Value (Parse-NumericText -Text $script:DbSecurityStatusTextBox.Text -Label "Security status")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "daysLeft" -Value (Parse-NumericText -Text $script:DbDaysLeftTextBox.Text -Label "Days left")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "description" -Value $script:DbDescriptionTextBox.Text

  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "characterName" -Value $characterName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "accountName" -Value $accountName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "banned" -Value ([bool]$script:DbBannedCheckBox.IsChecked)
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "shipName" -Value $script:DbShipNameTextBox.Text.Trim()
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "balance" -Value $script:DbWorkingPlayer.character.balance
}

function Apply-RawJsonEditors {
  if (-not $script:DbWorkingPlayer) { return }
  $script:DbWorkingPlayer.account = Parse-JsonObjectText -Text $script:DbAccountJsonTextBox.Text -Label "Account JSON"
  $script:DbWorkingPlayer.character = Parse-JsonObjectText -Text $script:DbCharacterJsonTextBox.Text -Label "Character JSON"
  $skillsMap = Parse-JsonObjectText -Text $script:DbSkillsJsonTextBox.Text -Label "Skills JSON"
  $itemsMap = Parse-JsonObjectText -Text $script:DbItemsJsonTextBox.Text -Label "Items JSON"

  $script:DbWorkingPlayer.skillsList = @(
    $skillsMap.PSObject.Properties |
      ForEach-Object {
        $raw = ConvertTo-DeepClone $_.Value
        [pscustomobject]@{
          skillKey = [string]$_.Name
          itemName = if ($raw.itemName) { [string]$raw.itemName } else { "Skill $($_.Name)" }
          skillLevel = if ($null -ne $raw.skillLevel) { $raw.skillLevel } else { 0 }
          raw = $raw
        }
      } |
      Sort-Object itemName, skillKey
  )

  $script:DbWorkingPlayer.itemsList = @(
    $itemsMap.PSObject.Properties |
      ForEach-Object {
        $raw = ConvertTo-DeepClone $_.Value
        [pscustomobject]@{
          itemKey = [string]$_.Name
          itemName = if ($raw.itemName) { [string]$raw.itemName } else { "Item $($_.Name)" }
          locationLabel = if ($null -ne $raw.locationID) { "Location $($raw.locationID)" } else { "Unknown location" }
          raw = $raw
        }
      } |
      Sort-Object itemName, itemKey
  )

  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "skillCount" -Value $script:DbWorkingPlayer.skillsList.Count
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "itemCount" -Value $script:DbWorkingPlayer.itemsList.Count
  $script:DbRawJsonDirty = $false
}

function Render-DatabasePlayer {
  if (-not $script:DbWorkingPlayer) { return }
  $script:IsRenderingDatabase = $true
  try {
    Update-DatabaseSummary
    Render-OverviewFields
    Refresh-RawJsonEditors
  } finally {
    $script:IsRenderingDatabase = $false
  }
}

function Update-PlayerListDisplay {
  $searchText = $script:DbSearchBox.Text.Trim().ToLowerInvariant()
  $players = @($script:DatabaseSnapshot.players)
  if ($searchText -ne "") {
    $players = @($players | Where-Object { [string]$_.searchText -like "*$searchText*" })
  }

  $displayItems = @(
    foreach ($player in $players) {
      [pscustomobject]@{
        key = [string]$player.characterId
        label = "{0}  •  {1}" -f $player.characterName, $player.accountName
      }
    }
  )

  $script:DbPlayerList.DisplayMemberPath = "label"
  $script:DbPlayerList.SelectedValuePath = "key"
  $script:DbPlayerList.ItemsSource = $displayItems
  if ($displayItems.Count -gt 0) {
    $selectedId = if ($script:DatabaseSnapshot.selectedCharacterId) { $script:DatabaseSnapshot.selectedCharacterId } else { $displayItems[0].key }
    $script:SuppressPlayerSelection = $true
    $script:DbPlayerList.SelectedValue = $selectedId
    $script:SuppressPlayerSelection = $false
  }
}

function Render-DatabaseSnapshot {
  param([Parameter(Mandatory = $true)][pscustomobject]$Snapshot, [string]$ReadyMessage = "Player database loaded and ready.")
  $script:IsRenderingDatabase = $true
  try {
    $script:DatabaseSnapshot = $Snapshot
    $script:DbPathText.Text = "Data root: $($Snapshot.paths.dataRoot)"
    $script:DbCountsText.Text = "$($Snapshot.playerCount) characters loaded"
    Update-PlayerListDisplay
    if ($Snapshot.selectedPlayer) {
      $script:DbWorkingPlayer = New-DatabaseWorkingCopy -SelectedPlayer $Snapshot.selectedPlayer
      Render-DatabasePlayer
    }
    Set-DatabaseDirtyState -Dirty $false -Message $ReadyMessage
  } finally {
    $script:IsRenderingDatabase = $false
  }
}

function Reload-DatabaseSnapshot {
  param([string]$CharacterId = "")
  $snapshot = if ($CharacterId) { Invoke-ProjectCli -Command "database-export" -Arguments @($CharacterId) } else { Invoke-ProjectCli -Command "database-export" }
  Render-DatabaseSnapshot -Snapshot $snapshot
}

function Save-DatabasePlayer {
  if (-not $script:DbWorkingPlayer) { return }
  Sync-OverviewControlsToWorkingCopy
  if ($script:DbRawJsonDirty) { Apply-RawJsonEditors }
  $payload = @{
    characterId = $script:DbWorkingPlayer.characterId
    originalAccountKey = $script:DbWorkingPlayer.originalAccountKey
    accountName = $script:DbWorkingPlayer.accountName
    account = $script:DbWorkingPlayer.account
    character = $script:DbWorkingPlayer.character
    skills = Convert-SkillListToMap -SkillList @($script:DbWorkingPlayer.skillsList)
    items = Convert-ItemListToMap -ItemList @($script:DbWorkingPlayer.itemsList)
  }
  $snapshot = Invoke-ProjectCli -Command "database-save" -InputObject $payload
  Render-DatabaseSnapshot -Snapshot $snapshot -ReadyMessage "Saved player database changes."
  Set-StatusUi -Message "Saved player database changes." -Tone "success" -BadgeText "Database saved"
}

function Get-TextBoxNumericValue {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Controls.TextBox]$TextBox,
    [double]$Fallback = 0,
    [string]$Label = "value"
  )

  $text = $TextBox.Text.Trim()
  if ($text -eq "") { return $Fallback }
  return Parse-NumericText -Text $text -Label $Label
}

function Invoke-NodeScript {
  param([Parameter(Mandatory = $true)][string]$ScriptPath)

  # Temporarily suppress $ErrorActionPreference = "Stop" so that native-command
  # stderr output does not raise a NativeCommandError before we can inspect
  # $LASTEXITCODE ourselves.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & node $ScriptPath 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }

  if ($exitCode -ne 0) {
    $errText = ($output | ForEach-Object { "$_" }) -join "`n"
    throw "node $([System.IO.Path]::GetFileName($ScriptPath)) failed (exit $exitCode):`n$errText"
  }
}

function Invoke-AssetExtraction {
  $clientIconIndex = Join-Path $PSScriptRoot "assets\eve-icon-index.json"
  $uiIconIndex = Join-Path $PSScriptRoot "assets\ui-icon-index.json"

  $needsClient = -not (Test-Path $clientIconIndex)
  $needsUi = -not (Test-Path $uiIconIndex)
  if (-not $needsClient -and -not $needsUi) { return }

  $eveClientPath = $env:EVEJS_CLIENT_PATH
  if (-not $eveClientPath) {
    Write-Host "Skipping asset extraction: EVEJS_CLIENT_PATH is not set (run via OpenServerConfig.bat)."
    return
  }
  $resIndexPath = Join-Path $eveClientPath "resfileindex.txt"
  if (-not (Test-Path $resIndexPath)) {
    Write-Host "Skipping asset extraction: EVE client not found at $eveClientPath"
    return
  }

  Write-Host "Extracting assets from EVE client (first run)..."

  if ($needsClient) {
    Write-Host "  Extracting item/ship icons..."
    Invoke-NodeScript -ScriptPath (Join-Path $PSScriptRoot "extract-client-icons.js")
  }

  if ($needsUi) {
    Write-Host "  Extracting UI icons..."
    Invoke-NodeScript -ScriptPath (Join-Path $PSScriptRoot "extract-ui-icons.js")
  }

  Write-Host "  Asset extraction complete."
}

function Initialize-AppChrome {
  $script:Window.Title = "EvEJS Control Center"
  $script:FooterHintText.Text = "Skill Studio, pilot quick actions, and raw JSON editing all write back into the project database files."

  $buttonMap = @(
    @{ Button = $script:SettingsOpenFileButton; Text = "Open File"; Glyph = 0xE8A5; IconKey = "open_window" },
    @{ Button = $script:SettingsDefaultsButton; Text = "Load Defaults"; Glyph = 0xE777; IconKey = "randomize" },
    @{ Button = $script:SettingsReloadButton; Text = "Reload"; Glyph = 0xE72C; IconKey = "refresh" },
    @{ Button = $script:SettingsSaveButton; Text = "Save Changes"; Glyph = 0xE74E; IconKey = "save" },
    @{ Button = $script:DbOpenFolderButton; Text = "Open Data Folder"; Glyph = 0xE838; IconKey = "folder" },
    @{ Button = $script:DbReloadButton; Text = "Reload"; Glyph = 0xE72C; IconKey = "refresh" },
    @{ Button = $script:DbSkillStudioButton; Text = "Skill Studio"; Glyph = 0xE943; IconKey = "skillbook" },
    @{ Button = $script:DbSaveButton; Text = "Save Player Changes"; Glyph = 0xE74E; IconKey = "save" },
    @{ Button = $script:DbSkillStudioOverviewButton; Text = "Open Skill Studio"; Glyph = 0xE943; IconKey = "skillbook" },
    @{ Button = $script:DbGrantIskButton; Text = "+10M ISK"; Glyph = 0xEC1F; IconKey = "isk" },
    @{ Button = $script:DbAddGameTimeButton; Text = "+30 Days"; Glyph = 0xE823; IconKey = "time" },
    @{ Button = $script:DbMaxSecurityButton; Text = "Security 5.0"; Glyph = 0xE7BA; IconKey = "security" },
    @{ Button = $script:DbClearBanButton; Text = "Clear Ban"; Glyph = 0xE8FB; IconKey = "checkmark" },
    @{ Button = $script:DbMaxOwnedSkillsButton; Text = "Owned Skills V"; Glyph = 0xE76B; IconKey = "skillbook" },
    @{ Button = $script:DbAddShipButton; Text = "Add Ship"; Glyph = 0xE710; IconKey = "add" },
    @{ Button = $script:DbAddItemButton; Text = "Add Item"; Glyph = 0xE8FD; IconKey = "cargo" },
    @{ Button = $script:DbEditItemButton; Text = "Edit Selection"; Glyph = 0xE70F; IconKey = "edit" },
    @{ Button = $script:DbRemoveItemButton; Text = "Remove Selection"; Glyph = 0xE74D; IconKey = "delete" },
    @{ Button = $script:DbOpenRawButton; Text = "Raw JSON View"; Glyph = 0xE943; IconKey = "details" },
    @{ Button = $script:DbRefreshJsonButton; Text = "Refresh From Working Copy"; Glyph = 0xE72C; IconKey = "refresh" },
    @{ Button = $script:DbApplyJsonButton; Text = "Apply Raw JSON"; Glyph = 0xE70B; IconKey = "checkmark" }
  )

  foreach ($item in $buttonMap) {
    if ($item.Button) {
      Set-ButtonChrome -Button $item.Button -Text $item.Text -GlyphCode $item.Glyph -IconKey $item.IconKey
    }
  }

  $itemContainerStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
       xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
       TargetType="{x:Type ListBoxItem}">
  <Setter Property="Padding" Value="0" />
  <Setter Property="Margin" Value="0,0,0,10" />
  <Setter Property="HorizontalContentAlignment" Value="Stretch" />
  <Setter Property="Template">
    <Setter.Value>
      <ControlTemplate TargetType="{x:Type ListBoxItem}">
        <Border x:Name="Card" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" CornerRadius="16">
          <ContentPresenter />
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property="IsMouseOver" Value="True">
            <Setter TargetName="Card" Property="Background" Value="#F7FAFD" />
            <Setter TargetName="Card" Property="BorderBrush" Value="#B9D4E8" />
          </Trigger>
          <Trigger Property="IsSelected" Value="True">
            <Setter TargetName="Card" Property="Background" Value="#EAF4FB" />
            <Setter TargetName="Card" Property="BorderBrush" Value="#6FAEDC" />
          </Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>
    </Setter.Value>
  </Setter>
</Style>
'@)

  $playerTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto" />
      <RowDefinition Height="Auto" />
      <RowDefinition Height="Auto" />
    </Grid.RowDefinitions>
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="Auto" />
      <ColumnDefinition Width="12" />
      <ColumnDefinition Width="*" />
    </Grid.ColumnDefinitions>
    <Border Grid.RowSpan="3" Width="42" Height="42" CornerRadius="13" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <TextBlock Grid.Row="0" Grid.Column="2" Text="{Binding characterName}" FontSize="14" FontWeight="SemiBold" Foreground="#102235" />
    <TextBlock Grid.Row="1" Grid.Column="2" Text="{Binding accountName}" Margin="0,5,0,0" FontSize="12" Foreground="#4F6276" />
    <Grid Grid.Row="2" Grid.Column="2" Margin="0,8,0,0">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*" />
        <ColumnDefinition Width="Auto" />
      </Grid.ColumnDefinitions>
      <TextBlock Grid.Column="0" Text="{Binding shipName}" FontSize="11" Foreground="#2F6F9F" />
      <TextBlock Grid.Column="1" Text="{Binding solarSystemName}" FontSize="11" Foreground="#6A7C90" />
    </Grid>
  </Grid>
</DataTemplate>
'@)

  $skillTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="Auto" />
      <ColumnDefinition Width="12" />
      <ColumnDefinition Width="*" />
      <ColumnDefinition Width="Auto" />
    </Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding itemName}" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
      <TextBlock Text="{Binding groupName}" Margin="0,4,0,0" FontSize="11" Foreground="#6A7C90" />
      <TextBlock Text="{Binding skillPoints, StringFormat=SP {0:N0}}" Margin="0,6,0,0" FontSize="11" Foreground="#2F6F9F" />
    </StackPanel>
    <TextBlock Grid.Column="3" Text="{Binding skillLevel, StringFormat=Level {0}}" Margin="10,0,0,0" VerticalAlignment="Top" FontSize="11" FontWeight="SemiBold" Foreground="#5A84A7" />
  </Grid>
</DataTemplate>
'@)

  $itemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding itemName}" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
      <TextBlock Text="{Binding metaText}" Margin="0,4,0,0" FontSize="11" Foreground="#2F6F9F" />
      <TextBlock Text="{Binding locationLabel}" Margin="0,5,0,0" FontSize="11" Foreground="#6A7C90" TextWrapping="Wrap" />
    </StackPanel>
  </Grid>
</DataTemplate>
'@)

  foreach ($listBox in @($script:DbPlayerList, $script:DbSkillPreviewList, $script:DbItemPreviewList)) {
    $listBox.BorderThickness = [System.Windows.Thickness]::new(0)
    $listBox.Background = $script:Brushes.White
    $listBox.ItemContainerStyle = $itemContainerStyle
  }

  $script:DbPlayerList.ItemTemplate = $playerTemplate
  $script:DbSkillPreviewList.ItemTemplate = $skillTemplate
  $script:DbItemPreviewList.ItemTemplate = $itemTemplate
}

function Open-SkillStudio {
  if (-not $script:DbWorkingPlayer) { return }

  if ($script:DbRawJsonDirty) {
    $decision = [System.Windows.MessageBox]::Show(
      "Raw JSON changes are still pending. Click Yes to apply them first, No to discard those raw JSON edits, or Cancel to stay here.",
      "EvEJS Skill Studio",
      [System.Windows.MessageBoxButton]::YesNoCancel,
      [System.Windows.MessageBoxImage]::Question
    )
    if ($decision -eq [System.Windows.MessageBoxResult]::Cancel) { return }
    if ($decision -eq [System.Windows.MessageBoxResult]::Yes) {
      Apply-RawJsonEditors
      Render-DatabasePlayer
    } else {
      $script:IsRenderingDatabase = $true
      try { Refresh-RawJsonEditors } finally { $script:IsRenderingDatabase = $false }
    }
  }

  Sync-OverviewControlsToWorkingCopy
  $catalog = New-DatabaseSkillCatalog
  if (@($catalog).Count -eq 0) { return }

  $catalogByKey = @{}
  foreach ($entry in @($catalog)) { $catalogByKey[[string]$entry.skillKey] = ConvertTo-DeepClone $entry }
  $originalSkillStore = @{}
  foreach ($skill in @($script:DbWorkingPlayer.skillsList)) { $originalSkillStore[[string]$skill.skillKey] = ConvertTo-DeepClone $skill.raw }
  $skillStore = @{}
  foreach ($entry in $originalSkillStore.GetEnumerator()) { $skillStore[[string]$entry.Key] = ConvertTo-DeepClone $entry.Value }

  [xml]$studioXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="EvEJS Skill Studio" Width="1080" Height="740" MinWidth="980" MinHeight="660" WindowStartupLocation="CenterOwner" Background="#F4F7FB" FontFamily="Segoe UI">
  <Grid Margin="18">
    <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
    <Border Grid.Row="0" CornerRadius="24" Padding="24" Margin="0,0,0,16" BorderBrush="#6FAEDC" BorderThickness="1"><Border.Background><LinearGradientBrush StartPoint="0,0" EndPoint="1,1"><GradientStop Color="#FFFFFF" Offset="0" /><GradientStop Color="#F1F6FB" Offset="0.62" /><GradientStop Color="#E6F0F7" Offset="1" /></LinearGradientBrush></Border.Background><StackPanel><TextBlock Text="Skill Studio" FontSize="28" FontWeight="SemiBold" Foreground="#102235" /><TextBlock Text="Search every known skill, set clean levels instantly, and stage changes before saving the player database." Margin="0,8,0,0" FontSize="13" Foreground="#516579" TextWrapping="Wrap" /></StackPanel></Border>
    <Grid Grid.Row="1"><Grid.ColumnDefinitions><ColumnDefinition Width="360" /><ColumnDefinition Width="14" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
      <Border Grid.Column="0" CornerRadius="20" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="16"><DockPanel LastChildFill="True"><StackPanel DockPanel.Dock="Top"><TextBlock Text="Skill Catalog" FontSize="18" FontWeight="SemiBold" Foreground="#102235" /><TextBlock Text="Search by skill or group. Untrained skills can be added instantly." Margin="0,6,0,12" FontSize="12" Foreground="#6A7C90" TextWrapping="Wrap" /><TextBox x:Name="StudioSearchBox" Height="38" Margin="0,0,0,10" Padding="10,6,10,6" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" /><ComboBox x:Name="StudioGroupCombo" Height="38" Margin="0,0,0,12" Padding="8,4,8,4" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" /><WrapPanel Margin="0,0,0,12"><Button x:Name="StudioFilteredIIIButton" Content="Filtered to III" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioFilteredVButton" Content="Filtered to V" Margin="0,0,8,8" Padding="12,8,12,8" /></WrapPanel></StackPanel><ListBox x:Name="StudioSkillList" BorderThickness="0" Background="Transparent" /></DockPanel></Border>
      <Border Grid.Column="2" CornerRadius="20" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="20"><Grid><Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="*" /></Grid.RowDefinitions><TextBlock x:Name="StudioSkillHeadline" Text="Pick a skill" FontSize="24" FontWeight="SemiBold" Foreground="#102235" /><TextBlock x:Name="StudioSkillMeta" Grid.Row="1" Margin="0,8,0,0" FontSize="13" Foreground="#6A7C90" TextWrapping="Wrap" /><WrapPanel x:Name="StudioBadgePanel" Grid.Row="2" Margin="0,14,0,0" /><Grid Grid.Row="3" Margin="0,16,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions><StackPanel Grid.Column="0" Margin="0,0,10,0"><TextBlock Text="Level" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,6" /><TextBox x:Name="StudioLevelTextBox" Height="38" Padding="10,6,10,6" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" /></StackPanel><StackPanel Grid.Column="1" Margin="10,0,10,0"><TextBlock Text="Skill Points" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,6" /><TextBox x:Name="StudioSkillPointsTextBox" Height="38" Padding="10,6,10,6" BorderBrush="#D5E0EA" BorderThickness="1" Background="#FFFFFF" Foreground="#102235" /></StackPanel><StackPanel Grid.Column="2" Margin="10,0,0,0"><TextBlock Text="Training" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,6" /><CheckBox x:Name="StudioTrainingCheckBox" Content="Currently training" FontSize="13" Foreground="#102235" VerticalAlignment="Center" /></StackPanel></Grid><StackPanel Grid.Row="4" Margin="0,18,0,0"><TextBlock Text="Level Deck" FontSize="12" FontWeight="SemiBold" Foreground="#5B6B80" Margin="0,0,0,8" /><WrapPanel><Button x:Name="StudioLevel0Button" Content="Level 0" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel1Button" Content="Level I" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel2Button" Content="Level II" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel3Button" Content="Level III" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel4Button" Content="Level IV" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel5Button" Content="Level V" Margin="0,0,8,8" Padding="12,8,12,8" /></WrapPanel><WrapPanel Margin="0,18,0,0"><Button x:Name="StudioApplyButton" Content="Apply to Selected Skill" Margin="0,0,8,8" Padding="14,10,14,10" /><Button x:Name="StudioResetButton" Content="Restore Original" Margin="0,0,8,8" Padding="14,10,14,10" /><Button x:Name="StudioRemoveButton" Content="Remove Skill" Margin="0,0,8,8" Padding="14,10,14,10" /></WrapPanel><TextBlock x:Name="StudioStatusText" Margin="0,12,0,0" FontSize="12" Foreground="#2F6F9F" TextWrapping="Wrap" /></StackPanel></Grid></Border>
    </Grid>
    <Border Grid.Row="2" Margin="0,16,0,0" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="16"><DockPanel LastChildFill="False"><TextBlock x:Name="StudioFooterText" VerticalAlignment="Center" FontSize="12" Foreground="#6A7C90" Text="Skill changes stay staged here until you click Apply To Player." /><StackPanel DockPanel.Dock="Right" Orientation="Horizontal"><Button x:Name="StudioCancelButton" Content="Cancel" Margin="0,0,10,0" Padding="14,10,14,10" /><Button x:Name="StudioSaveButton" Content="Apply To Player" Padding="16,10,16,10" /></StackPanel></DockPanel></Border>
  </Grid>
</Window>
'@

  $studioWindow = [System.Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($studioXaml))
  $studioWindow.Owner = $script:Window
  $studioSearchBox = $studioWindow.FindName("StudioSearchBox")
  $studioGroupCombo = $studioWindow.FindName("StudioGroupCombo")
  $studioSkillList = $studioWindow.FindName("StudioSkillList")
  $studioSkillHeadline = $studioWindow.FindName("StudioSkillHeadline")
  $studioSkillMeta = $studioWindow.FindName("StudioSkillMeta")
  $studioBadgePanel = $studioWindow.FindName("StudioBadgePanel")
  $studioLevelTextBox = $studioWindow.FindName("StudioLevelTextBox")
  $studioSkillPointsTextBox = $studioWindow.FindName("StudioSkillPointsTextBox")
  $studioTrainingCheckBox = $studioWindow.FindName("StudioTrainingCheckBox")
  $studioStatusText = $studioWindow.FindName("StudioStatusText")
  $studioFooterText = $studioWindow.FindName("StudioFooterText")
  $studioApplyButton = $studioWindow.FindName("StudioApplyButton")
  $studioResetButton = $studioWindow.FindName("StudioResetButton")
  $studioRemoveButton = $studioWindow.FindName("StudioRemoveButton")
  $studioFilteredIIIButton = $studioWindow.FindName("StudioFilteredIIIButton")
  $studioFilteredVButton = $studioWindow.FindName("StudioFilteredVButton")
  $studioCancelButton = $studioWindow.FindName("StudioCancelButton")
  $studioSaveButton = $studioWindow.FindName("StudioSaveButton")

  $studioSkillList.SelectedValuePath = "skillKey"
  $studioGroupCombo.DisplayMemberPath = "label"
  $studioGroupCombo.SelectedValuePath = "value"
  $studioGroupCombo.ItemsSource = @([pscustomobject]@{ label = "All Groups"; value = "" }) + @($catalog | Where-Object { $_.groupName } | Select-Object -ExpandProperty groupName -Unique | Sort-Object | ForEach-Object { [pscustomobject]@{ label = $_; value = $_ } })
  $studioGroupCombo.SelectedIndex = 0
  foreach ($button in @($studioApplyButton, $studioResetButton, $studioRemoveButton, $studioFilteredIIIButton, $studioFilteredVButton, $studioCancelButton, $studioSaveButton)) { $button.Style = $script:Window.FindResource("SecondaryButtonStyle") }
  $studioSaveButton.Style = $script:Window.FindResource("PrimaryButtonStyle")
  $studioSkillList.ItemContainerStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="{x:Type ListBoxItem}">
  <Setter Property="Padding" Value="0" />
  <Setter Property="Margin" Value="0,0,0,10" />
  <Setter Property="HorizontalContentAlignment" Value="Stretch" />
  <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="{x:Type ListBoxItem}"><Border x:Name="Card" Background="#F8FBFF" BorderBrush="#DCE8F5" BorderThickness="1" CornerRadius="16"><ContentPresenter /></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Card" Property="Background" Value="#F0F9FF" /><Setter TargetName="Card" Property="BorderBrush" Value="#67E8F9" /></Trigger><Trigger Property="IsSelected" Value="True"><Setter TargetName="Card" Property="Background" Value="#CCFBF1" /><Setter TargetName="Card" Property="BorderBrush" Value="#0F766E" /></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter>
</Style>
'@)
  $studioSkillList.ItemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /><ColumnDefinition Width="Auto" /></Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding itemName}" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
      <TextBlock Text="{Binding groupName}" Margin="0,4,0,0" FontSize="11" Foreground="#6A7C90" />
      <TextBlock Text="{Binding statusText}" Margin="0,6,0,0" FontSize="11" Foreground="#2F6F9F" />
    </StackPanel>
    <TextBlock Grid.Column="3" Text="{Binding currentLevel, StringFormat=Level {0}}" Margin="10,0,0,0" VerticalAlignment="Top" FontSize="11" FontWeight="SemiBold" Foreground="#5A84A7" />
  </Grid>
</DataTemplate>
'@)
  Set-ButtonChrome -Button $studioFilteredIIIButton -Text "Filtered to III" -GlyphCode 0xE76B -IconKey "skillbook"
  Set-ButtonChrome -Button $studioFilteredVButton -Text "Filtered to V" -GlyphCode 0xE76B -IconKey "skillbook"
  Set-ButtonChrome -Button $studioApplyButton -Text "Apply to Selected Skill" -GlyphCode 0xE70B -IconKey "checkmark"
  Set-ButtonChrome -Button $studioResetButton -Text "Restore Original" -GlyphCode 0xE777 -IconKey "randomize"
  Set-ButtonChrome -Button $studioRemoveButton -Text "Remove Skill" -GlyphCode 0xE74D -IconKey "delete"
  Set-ButtonChrome -Button $studioCancelButton -Text "Cancel" -GlyphCode 0xE711 -IconKey "close"
  Set-ButtonChrome -Button $studioSaveButton -Text "Apply To Player" -GlyphCode 0xE74E -IconKey "save"

  $selectedSkillKey = ""
  $refreshSkillList = {
    $search = $studioSearchBox.Text.Trim().ToLowerInvariant()
    $group = [string]$studioGroupCombo.SelectedValue
    $items = @($catalog | Where-Object { (-not $group -or $_.groupName -eq $group) -and (-not $search -or (("{0} {1}" -f $_.itemName, $_.groupName).ToLowerInvariant() -like "*$search*")) } | ForEach-Object {
      $raw = if ($skillStore.ContainsKey([string]$_.skillKey)) { $skillStore[[string]$_.skillKey] } else { $null }
      Add-TypeIconFields -Object ([pscustomobject]@{
        skillKey = [string]$_.skillKey
        typeID = $_.typeID
        itemName = $_.itemName
        groupName = if ($_.groupName) { $_.groupName } else { "Ungrouped" }
        currentLevel = if ($raw) { [int]$raw.skillLevel } else { 0 }
        statusText = if ($raw) { "Active | SP $('{0:N0}' -f [int64]$raw.skillPoints)" } else { "Not trained yet" }
      }) -IconSpec (Resolve-SkillIconSpec -GroupName $_.groupName -ItemName $_.itemName) -TypeId $_.typeID
    })
    $studioSkillList.ItemsSource = $items
    if ($items.Count -gt 0) {
      $resolved = if ($selectedSkillKey -and ($items | Where-Object { $_.skillKey -eq $selectedSkillKey })) { $selectedSkillKey } else { $items[0].skillKey }
      $studioSkillList.SelectedValue = $resolved
    }
    $studioFooterText.Text = "{0} skills in view | {1} currently trained on this player" -f $items.Count, @($skillStore.Keys).Count
  }

  $updateSelectedSkillPanel = {
    $selectedSkillKey = [string]$studioSkillList.SelectedValue
    if (-not $selectedSkillKey) { return }
    $catalogEntry = $catalogByKey[$selectedSkillKey]
    $raw = if ($skillStore.ContainsKey($selectedSkillKey)) { $skillStore[$selectedSkillKey] } else { $null }
    $level = if ($raw) { [int]$raw.skillLevel } else { 0 }
    $points = if ($raw) { [int64]$raw.skillPoints } else { Get-SkillPointsForLevel -Rank $catalogEntry.skillRank -Level $level }
    $groupLabel = if ($catalogEntry.groupName) { [string]$catalogEntry.groupName } else { "Ungrouped" }
    $ownedLabel = if ($raw) { "Yes" } else { "No" }
    $studioSkillHeadline.Text = [string]$catalogEntry.itemName
    $studioSkillMeta.Text = "{0} | Rank {1} | Type {2}" -f $groupLabel, $catalogEntry.skillRank, $catalogEntry.typeID
    $studioLevelTextBox.Text = [string]$level
    $studioSkillPointsTextBox.Text = [string]$points
    $studioTrainingCheckBox.IsChecked = if ($raw) { [bool]$raw.inTraining } else { $false }
    $studioBadgePanel.Children.Clear()
    $skillIcon = Resolve-SkillIconSpec -GroupName $catalogEntry.groupName -ItemName $catalogEntry.itemName
    $studioBadgePanel.Children.Add((New-Badge -Text ("Owned {0}" -f $ownedLabel) -Background "#DBEAFE" -Foreground "#1D4ED8" -Glyph $skillIcon.glyph)) | Out-Null
    $studioBadgePanel.Children.Add((New-Badge -Text ("Recommended V SP {0:N0}" -f (Get-SkillPointsForLevel -Rank $catalogEntry.skillRank -Level 5)) -Background "#DCFCE7" -Foreground "#166534" -Glyph ([string][char]0xE76B))) | Out-Null
  }

  $applySelectedSkill = {
    $selectedSkillKey = [string]$studioSkillList.SelectedValue
    if (-not $selectedSkillKey) { return }
    $catalogEntry = $catalogByKey[$selectedSkillKey]
    $level = [int](Parse-NumericText -Text $studioLevelTextBox.Text -Label "Skill level")
    if ($level -lt 0 -or $level -gt 5) { throw "Skill level must be between 0 and 5." }
    $raw = if ($skillStore.ContainsKey($selectedSkillKey)) { ConvertTo-DeepClone $skillStore[$selectedSkillKey] } else { New-SkillRawFromCatalog -CatalogEntry $catalogEntry -CharacterId $script:DbWorkingPlayer.characterId -Level $level }
    $points = Get-TextBoxNumericValue -TextBox $studioSkillPointsTextBox -Fallback (Get-SkillPointsForLevel -Rank $catalogEntry.skillRank -Level $level) -Label "Skill points"
    foreach ($pair in @{ typeID = $catalogEntry.typeID; groupID = $catalogEntry.groupID; groupName = $catalogEntry.groupName; itemName = $catalogEntry.itemName; skillRank = $catalogEntry.skillRank; skillLevel = $level; trainedSkillLevel = $level; effectiveSkillLevel = $level; skillPoints = $points; trainedSkillPoints = $points; trainingStartSP = $points; trainingDestinationSP = $points; inTraining = [bool]$studioTrainingCheckBox.IsChecked }.GetEnumerator()) { Set-ObjectProperty -Object $raw -Name $pair.Key -Value $pair.Value }
    $skillStore[$selectedSkillKey] = $raw
    $studioStatusText.Text = "{0} staged at level {1}." -f $catalogEntry.itemName, $level
    & $refreshSkillList
    & $updateSelectedSkillPanel
  }

  $studioSearchBox.Add_TextChanged({ & $refreshSkillList })
  $studioGroupCombo.Add_SelectionChanged({ & $refreshSkillList })
  $studioSkillList.Add_SelectionChanged({ & $updateSelectedSkillPanel })
  $studioFilteredIIIButton.Add_Click({ foreach ($entry in @($studioSkillList.ItemsSource)) { $skillStore[[string]$entry.skillKey] = New-SkillRawFromCatalog -CatalogEntry $catalogByKey[[string]$entry.skillKey] -CharacterId $script:DbWorkingPlayer.characterId -Level 3 }; $studioStatusText.Text = "Applied level III to every skill in the current filtered list."; & $refreshSkillList; & $updateSelectedSkillPanel })
  $studioFilteredVButton.Add_Click({ foreach ($entry in @($studioSkillList.ItemsSource)) { $skillStore[[string]$entry.skillKey] = New-SkillRawFromCatalog -CatalogEntry $catalogByKey[[string]$entry.skillKey] -CharacterId $script:DbWorkingPlayer.characterId -Level 5 }; $studioStatusText.Text = "Applied level V to every skill in the current filtered list."; & $refreshSkillList; & $updateSelectedSkillPanel })
  $studioApplyButton.Add_Click({ try { & $applySelectedSkill } catch { [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null } })
  $studioResetButton.Add_Click({ $selectedSkillKey = [string]$studioSkillList.SelectedValue; if ($selectedSkillKey) { if ($originalSkillStore.ContainsKey($selectedSkillKey)) { $skillStore[$selectedSkillKey] = ConvertTo-DeepClone $originalSkillStore[$selectedSkillKey] } elseif ($skillStore.ContainsKey($selectedSkillKey)) { $null = $skillStore.Remove($selectedSkillKey) }; $studioStatusText.Text = "Restored the original skill values."; & $refreshSkillList; & $updateSelectedSkillPanel } })
  $studioRemoveButton.Add_Click({ $selectedSkillKey = [string]$studioSkillList.SelectedValue; if ($selectedSkillKey -and $skillStore.ContainsKey($selectedSkillKey)) { $null = $skillStore.Remove($selectedSkillKey); $studioStatusText.Text = "Removed the selected skill from the staged player."; & $refreshSkillList; & $updateSelectedSkillPanel } })
  foreach ($levelButton in 0..5) {
    $button = $studioWindow.FindName("StudioLevel{0}Button" -f $levelButton)
    $button.Style = $script:Window.FindResource("SecondaryButtonStyle")
    Set-ButtonChrome -Button $button -Text ("Level {0}" -f $(if ($levelButton -eq 0) { "0" } elseif ($levelButton -eq 1) { "I" } elseif ($levelButton -eq 2) { "II" } elseif ($levelButton -eq 3) { "III" } elseif ($levelButton -eq 4) { "IV" } else { "V" })) -GlyphCode 0xE76B -IconKey "skillbook" -IconSize 14
    $capturedLevel = $levelButton
    $button.Add_Click({
      $selectedSkillKey = [string]$studioSkillList.SelectedValue
      if ($selectedSkillKey) {
        $studioLevelTextBox.Text = [string]$capturedLevel
        $studioSkillPointsTextBox.Text = [string](Get-SkillPointsForLevel -Rank $catalogByKey[$selectedSkillKey].skillRank -Level $capturedLevel)
        & $applySelectedSkill
      }
    }.GetNewClosure())
  }
  $studioCancelButton.Add_Click({ $studioWindow.Close() })
  $studioSaveButton.Add_Click({
    if ($studioSkillList.SelectedValue -and $studioLevelTextBox.Text.Trim() -ne "") {
      try { & $applySelectedSkill } catch { [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null; return }
    }
    $script:DbWorkingPlayer.skillsList = Convert-SkillStoreToList -SkillStore $skillStore -CatalogByKey $catalogByKey
    Update-WorkingPlayerDerivedData
    Render-DatabasePlayer
    Set-DatabaseDirtyState -Dirty $true -Message "Skill Studio changes are staged in the working copy."
    $studioWindow.DialogResult = $true
    $studioWindow.Close()
  })

  & $refreshSkillList
  & $updateSelectedSkillPanel
  $null = $studioWindow.ShowDialog()
}

function Update-DatabaseSummary {
  if (-not $script:DbWorkingPlayer) { return }
  Update-WorkingPlayerDerivedData
  $summary = $script:DbWorkingPlayer.summary
  $script:DbPlayerHeadline.Text = "$($summary.characterName)  |  $($script:DbWorkingPlayer.accountName)"
  $script:DbPlayerMeta.Text = "$($summary.shipName) | $($summary.stationName) | $($summary.solarSystemName) | $($summary.corporationName)"
  $warnings = @($script:DbWorkingPlayer.warningMessages)
  $script:DbWarningText.Text = ($warnings -join " ")
  $script:DbWarningText.Visibility = if ($warnings.Count -gt 0) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  $iskIcon = Resolve-WalletIconSpec -CurrencyKey "isk"
  $plexIcon = Resolve-WalletIconSpec -CurrencyKey "plex"
  $aurIcon = Resolve-WalletIconSpec -CurrencyKey "aur"
  $skillIcon = Resolve-SkillIconSpec -GroupName "Spaceship Command"
  $itemIcon = Resolve-ItemIconSpec -GroupName "" -CategoryID 4 -ItemName "Inventory"
  $shipIcon = Resolve-ShipIconSpec -GroupName "" -ShipName $summary.shipName
  $walletBadgeIconPath = Resolve-UiIconPath -Key "wallet"
  $iskBadgeIconPath = Resolve-UiIconPath -Key "isk"
  $plexBadgeIconPath = Resolve-UiIconPath -Key "plex"
  $aurBadgeIconPath = Resolve-UiIconPath -Key "aur"
  $skillBadgeIconPath = Resolve-UiIconPath -Key "skillbook"
  $itemBadgeIconPath = Resolve-UiIconPath -Key "cargo"
  $iskMetricIconPath = $iskBadgeIconPath
  if ([string]::IsNullOrWhiteSpace($iskMetricIconPath)) {
    $iskMetricIconPath = $walletBadgeIconPath
  }
  $script:DbMetricPanel.Children.Clear()
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("ISK {0}" -f (Format-CompactNumber $summary.balance)) -Background $iskIcon.background -Foreground $iskIcon.foreground -Glyph $iskIcon.glyph -ImagePath $iskMetricIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("PLEX {0}" -f (Format-CompactNumber $script:DbWorkingPlayer.character.plexBalance)) -Background $plexIcon.background -Foreground $plexIcon.foreground -Glyph $plexIcon.glyph -ImagePath $plexBadgeIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("AUR {0}" -f (Format-CompactNumber $script:DbWorkingPlayer.character.aurBalance)) -Background $aurIcon.background -Foreground $aurIcon.foreground -Glyph $aurIcon.glyph -ImagePath $aurBadgeIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("SP {0}" -f (Format-CompactNumber $summary.skillPoints)) -Background "#E8F7F2" -Foreground "#166534" -Glyph $skillIcon.glyph -ImagePath $skillBadgeIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Ships {0}" -f $summary.shipCount) -Background $shipIcon.background -Foreground $shipIcon.foreground -Glyph $shipIcon.glyph)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Items {0}" -f $summary.itemCount) -Background $itemIcon.background -Foreground $itemIcon.foreground -Glyph $itemIcon.glyph -ImagePath $itemBadgeIconPath -ImageSize 16)) | Out-Null
}

function Render-OverviewFields {
  if (-not $script:DbWorkingPlayer) { return }
  $account = $script:DbWorkingPlayer.account
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary
  $script:DbAccountNameTextBox.Text = [string]$script:DbWorkingPlayer.accountName
  $script:DbBannedCheckBox.IsChecked = [bool]$account.banned
  $script:DbCharacterNameTextBox.Text = [string]$character.characterName
  $script:DbShipNameTextBox.Text = [string]$character.shipName
  $script:DbBalanceTextBox.Text = Format-DisplayValue $character.balance
  $script:DbPlexTextBox.Text = Format-DisplayValue $character.plexBalance
  $script:DbAurTextBox.Text = Format-DisplayValue $character.aurBalance
  $script:DbSecurityStatusTextBox.Text = Format-DisplayValue $character.securityStatus
  $script:DbDaysLeftTextBox.Text = Format-DisplayValue $character.daysLeft
  $script:DbDescriptionTextBox.Text = [string]$character.description
  $script:DbOverviewCorporationText.Text = [string]$summary.corporationName
  $script:DbOverviewStationText.Text = [string]$summary.stationName
  $script:DbOverviewSystemText.Text = [string]$summary.solarSystemName
  $script:DbSkillPreviewList.DisplayMemberPath = ""
  $script:DbItemPreviewList.DisplayMemberPath = ""
  $script:DbItemPreviewList.SelectedValuePath = "itemKey"
  $script:DbSkillPreviewList.ItemsSource = @($script:DbWorkingPlayer.skillsList)
  $script:DbItemPreviewList.ItemsSource = @($script:DbWorkingPlayer.itemsList)
  Update-ItemActionState
}

function Apply-RawJsonEditors {
  if (-not $script:DbWorkingPlayer) { return }
  $script:DbWorkingPlayer.account = Parse-JsonObjectText -Text $script:DbAccountJsonTextBox.Text -Label "Account JSON"
  $script:DbWorkingPlayer.character = Parse-JsonObjectText -Text $script:DbCharacterJsonTextBox.Text -Label "Character JSON"
  $skillsMap = Parse-JsonObjectText -Text $script:DbSkillsJsonTextBox.Text -Label "Skills JSON"
  $itemsMap = Parse-JsonObjectText -Text $script:DbItemsJsonTextBox.Text -Label "Items JSON"
  $catalogByKey = @{}
  foreach ($entry in @(New-DatabaseSkillCatalog)) { $catalogByKey[[string]$entry.skillKey] = $entry }
  $skillStore = @{}
  foreach ($property in $skillsMap.PSObject.Properties) { $skillStore[[string]$property.Name] = ConvertTo-DeepClone $property.Value }
  $script:DbWorkingPlayer.skillsList = Convert-SkillStoreToList -SkillStore $skillStore -CatalogByKey $catalogByKey
  $script:DbWorkingPlayer.itemsList = Convert-ItemMapToList -ItemsMap $itemsMap
  Update-WorkingPlayerDerivedData
  $script:DbRawJsonDirty = $false
}

function Update-PlayerListDisplay {
  $searchText = $script:DbSearchBox.Text.Trim().ToLowerInvariant()
  $players = @($script:DatabaseSnapshot.players)
  if ($searchText -ne "") { $players = @($players | Where-Object { [string]$_.searchText -like "*$searchText*" }) }
  $script:DbPlayerList.SelectedValuePath = "characterId"
  $script:DbPlayerList.ItemsSource = @($players | ForEach-Object { Get-PlayerDisplayEntry -Player $_ })
  if (@($players).Count -gt 0) {
    $selectedId = if ($script:DatabaseSnapshot.selectedCharacterId) { $script:DatabaseSnapshot.selectedCharacterId } else { $players[0].characterId }
    $script:SuppressPlayerSelection = $true
    $script:DbPlayerList.SelectedValue = $selectedId
    $script:SuppressPlayerSelection = $false
  }
}

function Render-DatabaseSnapshot {
  param([Parameter(Mandatory = $true)][pscustomobject]$Snapshot, [string]$ReadyMessage = "Player database loaded and ready.")
  $script:IsRenderingDatabase = $true
  try {
    $script:DatabaseSnapshot = $Snapshot
    $script:NextGeneratedItemId = if ($Snapshot.nextItemIdSeed) { [int64]$Snapshot.nextItemIdSeed } else { [int64]990000001 }
    $script:DbPathText.Text = "Data root: $($Snapshot.paths.dataRoot)"
    $script:DbCountsText.Text = "$($Snapshot.playerCount) characters loaded | $(@($Snapshot.skillCatalog).Count) skills ready in Skill Studio"
    Update-PlayerListDisplay
    if ($Snapshot.selectedPlayer) {
      $script:DbWorkingPlayer = New-DatabaseWorkingCopy -SelectedPlayer $Snapshot.selectedPlayer
      $script:DbWorkingPlayer.itemsList = Convert-ItemMapToList -ItemsMap (Convert-ItemListToMap -ItemList @($script:DbWorkingPlayer.itemsList))
      Render-DatabasePlayer
    }
    Set-DatabaseDirtyState -Dirty $false -Message $ReadyMessage
  } finally {
    $script:IsRenderingDatabase = $false
  }
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="EvEJS Config Manager"
        Width="1280"
        Height="920"
        MinWidth="1100"
        MinHeight="760"
        WindowStartupLocation="CenterScreen"
        Background="#F4F7FB"
        FontFamily="Segoe UI">
  <Window.Resources>
    <Style x:Key="SecondaryButtonStyle" TargetType="Button">
      <Setter Property="FontSize" Value="13" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Background" Value="#FFFFFF" />
      <Setter Property="Foreground" Value="#17324D" />
      <Setter Property="BorderBrush" Value="#D5E0EA" />
      <Setter Property="BorderThickness" Value="1" />
      <Setter Property="Cursor" Value="Hand" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Chrome"
                    Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    BorderThickness="{TemplateBinding BorderThickness}"
                    CornerRadius="14">
              <ContentPresenter HorizontalAlignment="Center"
                                VerticalAlignment="Center"
                                Margin="{TemplateBinding Padding}" />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Chrome" Property="Background" Value="#F7FAFD" />
                <Setter TargetName="Chrome" Property="BorderBrush" Value="#6FAEDC" />
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="Chrome" Property="Background" Value="#EAF4FB" />
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="Chrome" Property="Opacity" Value="0.55" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="PrimaryButtonStyle" TargetType="Button" BasedOn="{StaticResource SecondaryButtonStyle}">
      <Setter Property="Background" Value="#4F7EA8" />
      <Setter Property="Foreground" Value="#FFFFFF" />
      <Setter Property="BorderBrush" Value="#6FAEDC" />
    </Style>
    <Style x:Key="ConfigTextBoxStyle" TargetType="TextBox">
      <Setter Property="Padding" Value="10,6,10,6" />
      <Setter Property="FontSize" Value="14" />
      <Setter Property="Foreground" Value="#0F172A" />
      <Setter Property="Background" Value="#FFFFFF" />
      <Setter Property="BorderBrush" Value="#D5E0EA" />
      <Setter Property="BorderThickness" Value="1" />
    </Style>
    <Style x:Key="ConfigComboBoxStyle" TargetType="ComboBox">
      <Setter Property="FontSize" Value="14" />
      <Setter Property="Foreground" Value="#0F172A" />
      <Setter Property="Background" Value="#FFFFFF" />
      <Setter Property="BorderBrush" Value="#D5E0EA" />
      <Setter Property="BorderThickness" Value="1" />
    </Style>
    <Style x:Key="SectionLabelStyle" TargetType="TextBlock">
      <Setter Property="FontSize" Value="12" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Foreground" Value="#5B6B80" />
      <Setter Property="Margin" Value="0,0,0,6" />
    </Style>
    <Style TargetType="TabItem">
      <Setter Property="FontSize" Value="13" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Padding" Value="18,10" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="TabItem">
            <Border x:Name="TabChrome"
                    Background="#EAF1F7"
                    BorderBrush="#D5E0EA"
                    BorderThickness="1"
                    CornerRadius="14"
                    Margin="0,0,8,0">
              <ContentPresenter ContentSource="Header"
                                HorizontalAlignment="Center"
                                VerticalAlignment="Center"
                                Margin="{TemplateBinding Padding}" />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsSelected" Value="True">
                <Setter TargetName="TabChrome" Property="Background" Value="#FFFFFF" />
                <Setter TargetName="TabChrome" Property="BorderBrush" Value="#6FAEDC" />
              </Trigger>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="TabChrome" Property="BorderBrush" Value="#6A7A8F" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid Margin="18">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto" />
      <RowDefinition Height="*" />
      <RowDefinition Height="Auto" />
    </Grid.RowDefinitions>

    <Border Grid.Row="0" CornerRadius="24" Padding="24" Margin="0,0,0,14">
      <Border.Background>
        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
          <GradientStop Color="#FFFFFF" Offset="0" />
          <GradientStop Color="#F1F6FB" Offset="0.62" />
          <GradientStop Color="#E6F0F7" Offset="1" />
        </LinearGradientBrush>
      </Border.Background>
      <Border.BorderBrush>
        <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
          <GradientStop Color="#D5E0EA" Offset="0" />
          <GradientStop Color="#6FAEDC" Offset="0.6" />
          <GradientStop Color="#D5E0EA" Offset="1" />
        </LinearGradientBrush>
      </Border.BorderBrush>
      <Border.BorderThickness>1</Border.BorderThickness>
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*" />
          <ColumnDefinition Width="Auto" />
        </Grid.ColumnDefinitions>
        <StackPanel>
          <TextBlock Text="EvEJS Command Nexus"
                     FontSize="28"
                     FontWeight="SemiBold"
                     Foreground="#102235" />
          <TextBlock Text="Capsuleer-side control for server settings, player data, and fast recovery actions."
                     Margin="0,8,0,0"
                     FontSize="14"
                     Foreground="#516579" />
          <TextBlock Text="Command decks: Server Settings and Server Database"
                     Margin="0,14,0,0"
                     FontSize="12"
                     Foreground="#6A7C90" />
        </StackPanel>
        <Border x:Name="HeroBadgeBorder"
                Grid.Column="1"
                VerticalAlignment="Top"
                Background="#F7FAFD"
                BorderBrush="#D5E0EA"
                BorderThickness="1"
                CornerRadius="10"
                Padding="14,8,14,8">
          <TextBlock x:Name="HeroBadgeText"
                     FontSize="12"
                     FontWeight="SemiBold"
                     Foreground="#2F6F9F"
                     Text="STATUS: READY" />
        </Border>
      </Grid>
    </Border>

    <TabControl x:Name="MasterTabs" Grid.Row="1" Background="Transparent">
      <TabItem Header="Server Settings">
        <Grid Margin="0,12,0,0">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
          </Grid.RowDefinitions>
          <Border Grid.Row="0" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*" />
                <ColumnDefinition Width="Auto" />
              </Grid.ColumnDefinitions>
              <StackPanel>
                <TextBlock x:Name="SettingsPathText" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
                <TextBlock x:Name="SettingsEnvNoteText" Margin="0,8,0,0" FontSize="12" Foreground="#2F6F9F" TextWrapping="Wrap" Visibility="Collapsed" />
              </StackPanel>
              <StackPanel Grid.Column="1" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="SettingsOpenFileButton" Content="Open File" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="SettingsDefaultsButton" Content="Load Defaults" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="SettingsReloadButton" Content="Reload" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="SettingsSaveButton" Content="Save Changes" Padding="18,10,18,10" Style="{StaticResource PrimaryButtonStyle}" />
              </StackPanel>
            </Grid>
          </Border>
          <TabControl x:Name="SettingsTabs" Grid.Row="1" Background="Transparent" />
        </Grid>
      </TabItem>

      <TabItem Header="Server Database">
        <Grid Margin="0,12,0,0">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
          </Grid.RowDefinitions>

          <Border Grid.Row="0" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*" />
                <ColumnDefinition Width="Auto" />
              </Grid.ColumnDefinitions>
              <StackPanel>
                <TextBlock x:Name="DbPathText" FontSize="13" FontWeight="SemiBold" Foreground="#102235" />
                <TextBlock x:Name="DbCountsText" Margin="0,8,0,0" FontSize="12" Foreground="#6A7C90" />
              </StackPanel>
              <StackPanel Grid.Column="1" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="DbOpenFolderButton" Content="Open Data Folder" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="DbReloadButton" Content="Reload" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="DbSkillStudioButton" Content="Skill Studio" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="DbSaveButton" Content="Save Player Changes" Padding="18,10,18,10" Style="{StaticResource PrimaryButtonStyle}" />
              </StackPanel>
            </Grid>
          </Border>

          <Grid Grid.Row="1">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="320" />
              <ColumnDefinition Width="14" />
              <ColumnDefinition Width="*" />
            </Grid.ColumnDefinitions>

            <Border Grid.Column="0" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="16">
              <DockPanel LastChildFill="True">
                <StackPanel DockPanel.Dock="Top">
                  <TextBlock Text="Players" FontSize="18" FontWeight="SemiBold" Foreground="#102235" />
                  <TextBlock Text="Search by character, account, system, corporation, or ship." Margin="0,6,0,12" FontSize="12" Foreground="#6A7C90" TextWrapping="Wrap" />
                  <TextBox x:Name="DbSearchBox" Height="38" Margin="0,0,0,12" Style="{StaticResource ConfigTextBoxStyle}" />
                </StackPanel>
                <ListBox x:Name="DbPlayerList" BorderThickness="0" Background="Transparent" />
              </DockPanel>
            </Border>

            <Grid Grid.Column="2">
              <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
              </Grid.RowDefinitions>

              <Border Grid.Row="0" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                <StackPanel>
                  <TextBlock x:Name="DbPlayerHeadline" FontSize="24" FontWeight="SemiBold" Foreground="#102235" Text="No player selected" />
                  <TextBlock x:Name="DbPlayerMeta" Margin="0,8,0,0" FontSize="13" Foreground="#6A7C90" TextWrapping="Wrap" />
                  <TextBlock x:Name="DbWarningText" Margin="0,10,0,0" FontSize="12" Foreground="#2F6F9F" TextWrapping="Wrap" Visibility="Collapsed" />
                  <WrapPanel x:Name="DbMetricPanel" Margin="0,14,0,0" />
                </StackPanel>
              </Border>

              <TabControl x:Name="DbDetailTabs" Grid.Row="1" Background="Transparent">
                <TabItem Header="Overview">
                  <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <Border CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,12,0,0">
                      <Grid>
                        <Grid.ColumnDefinitions>
                          <ColumnDefinition Width="*" />
                          <ColumnDefinition Width="*" />
                        </Grid.ColumnDefinitions>
                        <Grid.RowDefinitions>
                          <RowDefinition Height="Auto" />
                          <RowDefinition Height="Auto" />
                          <RowDefinition Height="Auto" />
                          <RowDefinition Height="*" />
                        </Grid.RowDefinitions>

                        <StackPanel Grid.Row="0" Grid.Column="0" Margin="0,0,12,12">
                          <TextBlock Text="Account Name" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbAccountNameTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                        <StackPanel Grid.Row="0" Grid.Column="1" Margin="12,0,0,12">
                          <TextBlock Text="Banned" Style="{StaticResource SectionLabelStyle}" />
                          <CheckBox x:Name="DbBannedCheckBox" Content="Account is banned" FontSize="14" Foreground="#102235" />
                        </StackPanel>

                        <StackPanel Grid.Row="1" Grid.Column="0" Margin="0,0,12,12">
                          <TextBlock Text="Character Name" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbCharacterNameTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                        <StackPanel Grid.Row="1" Grid.Column="1" Margin="12,0,0,12">
                          <TextBlock Text="Ship Name" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbShipNameTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>

                        <Grid Grid.Row="2" Grid.ColumnSpan="2">
                          <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                          </Grid.ColumnDefinitions>
                          <StackPanel Grid.Column="0" Margin="0,0,8,12">
                            <TextBlock Text="ISK Balance" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbBalanceTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                          <StackPanel Grid.Column="1" Margin="8,0,8,12">
                            <TextBlock Text="PLEX Balance" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbPlexTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                          <StackPanel Grid.Column="2" Margin="8,0,8,12">
                            <TextBlock Text="AUR Balance" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbAurTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                          <StackPanel Grid.Column="3" Margin="8,0,0,12">
                            <TextBlock Text="Security Status" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbSecurityStatusTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                        </Grid>

                        <Grid Grid.Row="3" Grid.ColumnSpan="2">
                          <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="2*" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                          </Grid.ColumnDefinitions>

                          <StackPanel Grid.Column="0" Margin="0,0,12,0">
                            <TextBlock Text="Description" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbDescriptionTextBox" Height="160" AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                            <DockPanel Margin="0,14,0,6">
                              <TextBlock Text="Known Skills" Style="{StaticResource SectionLabelStyle}" />
                              <Button x:Name="DbSkillStudioOverviewButton" DockPanel.Dock="Right" Content="Open Skill Studio" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                            </DockPanel>
                            <ListBox x:Name="DbSkillPreviewList" Height="180" />
                          </StackPanel>

                          <StackPanel Grid.Column="1" Margin="12,0,12,0">
                            <TextBlock Text="Pilot Quick Actions" Style="{StaticResource SectionLabelStyle}" />
                            <WrapPanel Margin="0,0,0,12">
                              <Button x:Name="DbGrantIskButton" Content="+10M ISK" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbAddGameTimeButton" Content="+30 Days" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbMaxSecurityButton" Content="Security 5.0" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbClearBanButton" Content="Clear Ban" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbMaxOwnedSkillsButton" Content="Owned Skills V" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbOpenRawButton" Content="Raw JSON View" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                            </WrapPanel>
                            <TextBlock Text="Read-only References" Style="{StaticResource SectionLabelStyle}" />
                            <TextBlock Text="Corporation" Style="{StaticResource SectionLabelStyle}" Margin="0,12,0,6" />
                            <TextBlock x:Name="DbOverviewCorporationText" Foreground="#334155" TextWrapping="Wrap" />
                            <TextBlock Text="Station" Style="{StaticResource SectionLabelStyle}" Margin="0,12,0,6" />
                            <TextBlock x:Name="DbOverviewStationText" Foreground="#334155" TextWrapping="Wrap" />
                            <TextBlock Text="Solar System" Style="{StaticResource SectionLabelStyle}" Margin="0,12,0,6" />
                            <TextBlock x:Name="DbOverviewSystemText" Foreground="#334155" TextWrapping="Wrap" />
                          </StackPanel>

                          <StackPanel Grid.Column="2" Margin="12,0,0,0">
                            <DockPanel Margin="0,0,0,10">
                              <TextBlock Text="Owned Items" Style="{StaticResource SectionLabelStyle}" />
                              <WrapPanel DockPanel.Dock="Right">
                                <Button x:Name="DbAddShipButton" Content="Add Ship" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                                <Button x:Name="DbAddItemButton" Content="Add Item" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                                <Button x:Name="DbEditItemButton" Content="Edit Selection" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                                <Button x:Name="DbRemoveItemButton" Content="Remove Selection" Margin="0,0,0,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              </WrapPanel>
                            </DockPanel>
                            <ListBox x:Name="DbItemPreviewList" Height="320" />
                            <TextBlock Text="Days Left" Style="{StaticResource SectionLabelStyle}" Margin="0,14,0,6" />
                            <TextBox x:Name="DbDaysLeftTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                        </Grid>
                      </Grid>
                    </Border>
                  </ScrollViewer>
                </TabItem>

                <TabItem Header="Raw JSON">
                  <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <StackPanel Margin="0,12,0,0">
                      <Border CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Raw object editors" FontSize="18" FontWeight="SemiBold" Foreground="#102235" />
                          <TextBlock Text="This is the full-control escape hatch. Edit carefully, then click Apply Raw JSON before saving." Margin="0,8,0,0" FontSize="12" Foreground="#6A7C90" TextWrapping="Wrap" />
                          <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                            <Button x:Name="DbRefreshJsonButton" Content="Refresh From Working Copy" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                            <Button x:Name="DbApplyJsonButton" Content="Apply Raw JSON" Padding="16,10,16,10" Style="{StaticResource PrimaryButtonStyle}" />
                          </StackPanel>
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Account JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbAccountJsonTextBox" Height="180" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Character JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbCharacterJsonTextBox" Height="240" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Skills JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbSkillsJsonTextBox" Height="220" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="18">
                        <StackPanel>
                          <TextBlock Text="Items JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbItemsJsonTextBox" Height="220" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>
                    </StackPanel>
                  </ScrollViewer>
                </TabItem>
              </TabControl>
            </Grid>
          </Grid>
        </Grid>
      </TabItem>
    </TabControl>

    <Border Grid.Row="2" CornerRadius="18" Background="#FFFFFF" BorderBrush="#D9E2EC" BorderThickness="1" Padding="16" Margin="0,14,0,0">
      <DockPanel LastChildFill="True">
        <TextBlock x:Name="FooterHintText" DockPanel.Dock="Right" FontSize="12" Foreground="#6A7C90" VerticalAlignment="Center" Text="Changes save directly into the project files" />
        <TextBlock x:Name="FooterStatusText" FontSize="12" FontWeight="SemiBold" Foreground="#0F766E" VerticalAlignment="Center" Text="Ready" />
      </DockPanel>
    </Border>
  </Grid>
</Window>
'@

[xml]$xamlDocument = $xaml
$reader = [System.Xml.XmlNodeReader]::new($xamlDocument)
$script:Window = [System.Windows.Markup.XamlReader]::Load($reader)

$script:HeroBadgeBorder = $script:Window.FindName("HeroBadgeBorder")
$script:HeroBadgeText = $script:Window.FindName("HeroBadgeText")
$script:FooterStatusText = $script:Window.FindName("FooterStatusText")
$script:FooterHintText = $script:Window.FindName("FooterHintText")

$script:SettingsPathText = $script:Window.FindName("SettingsPathText")
$script:SettingsEnvNoteText = $script:Window.FindName("SettingsEnvNoteText")
$script:SettingsOpenFileButton = $script:Window.FindName("SettingsOpenFileButton")
$script:SettingsDefaultsButton = $script:Window.FindName("SettingsDefaultsButton")
$script:SettingsReloadButton = $script:Window.FindName("SettingsReloadButton")
$script:SettingsSaveButton = $script:Window.FindName("SettingsSaveButton")
$script:SettingsTabs = $script:Window.FindName("SettingsTabs")

$script:DbPathText = $script:Window.FindName("DbPathText")
$script:DbCountsText = $script:Window.FindName("DbCountsText")
$script:DbOpenFolderButton = $script:Window.FindName("DbOpenFolderButton")
$script:DbReloadButton = $script:Window.FindName("DbReloadButton")
$script:DbSkillStudioButton = $script:Window.FindName("DbSkillStudioButton")
$script:DbSaveButton = $script:Window.FindName("DbSaveButton")
$script:DbSearchBox = $script:Window.FindName("DbSearchBox")
$script:DbPlayerList = $script:Window.FindName("DbPlayerList")
$script:DbPlayerHeadline = $script:Window.FindName("DbPlayerHeadline")
$script:DbPlayerMeta = $script:Window.FindName("DbPlayerMeta")
$script:DbWarningText = $script:Window.FindName("DbWarningText")
$script:DbMetricPanel = $script:Window.FindName("DbMetricPanel")
$script:DbDetailTabs = $script:Window.FindName("DbDetailTabs")
$script:DbAccountNameTextBox = $script:Window.FindName("DbAccountNameTextBox")
$script:DbBannedCheckBox = $script:Window.FindName("DbBannedCheckBox")
$script:DbCharacterNameTextBox = $script:Window.FindName("DbCharacterNameTextBox")
$script:DbShipNameTextBox = $script:Window.FindName("DbShipNameTextBox")
$script:DbBalanceTextBox = $script:Window.FindName("DbBalanceTextBox")
$script:DbPlexTextBox = $script:Window.FindName("DbPlexTextBox")
$script:DbAurTextBox = $script:Window.FindName("DbAurTextBox")
$script:DbSecurityStatusTextBox = $script:Window.FindName("DbSecurityStatusTextBox")
$script:DbDescriptionTextBox = $script:Window.FindName("DbDescriptionTextBox")
$script:DbDaysLeftTextBox = $script:Window.FindName("DbDaysLeftTextBox")
$script:DbOverviewCorporationText = $script:Window.FindName("DbOverviewCorporationText")
$script:DbOverviewStationText = $script:Window.FindName("DbOverviewStationText")
$script:DbOverviewSystemText = $script:Window.FindName("DbOverviewSystemText")
$script:DbSkillStudioOverviewButton = $script:Window.FindName("DbSkillStudioOverviewButton")
$script:DbGrantIskButton = $script:Window.FindName("DbGrantIskButton")
$script:DbAddGameTimeButton = $script:Window.FindName("DbAddGameTimeButton")
$script:DbMaxSecurityButton = $script:Window.FindName("DbMaxSecurityButton")
$script:DbClearBanButton = $script:Window.FindName("DbClearBanButton")
$script:DbMaxOwnedSkillsButton = $script:Window.FindName("DbMaxOwnedSkillsButton")
$script:DbAddShipButton = $script:Window.FindName("DbAddShipButton")
$script:DbAddItemButton = $script:Window.FindName("DbAddItemButton")
$script:DbEditItemButton = $script:Window.FindName("DbEditItemButton")
$script:DbRemoveItemButton = $script:Window.FindName("DbRemoveItemButton")
$script:DbOpenRawButton = $script:Window.FindName("DbOpenRawButton")
$script:DbSkillPreviewList = $script:Window.FindName("DbSkillPreviewList")
$script:DbItemPreviewList = $script:Window.FindName("DbItemPreviewList")
$script:DbAccountJsonTextBox = $script:Window.FindName("DbAccountJsonTextBox")
$script:DbCharacterJsonTextBox = $script:Window.FindName("DbCharacterJsonTextBox")
$script:DbSkillsJsonTextBox = $script:Window.FindName("DbSkillsJsonTextBox")
$script:DbItemsJsonTextBox = $script:Window.FindName("DbItemsJsonTextBox")
$script:DbRefreshJsonButton = $script:Window.FindName("DbRefreshJsonButton")
$script:DbApplyJsonButton = $script:Window.FindName("DbApplyJsonButton")

Invoke-AssetExtraction

Initialize-AppChrome

$settingsSnapshot = Invoke-ProjectCli -Command "export"
$databaseSnapshot = Invoke-ProjectCli -Command "database-export"
Render-SettingsSnapshot -Snapshot $settingsSnapshot
Render-DatabaseSnapshot -Snapshot $databaseSnapshot

if ($NoUi) {
  Write-Output "EvEJS Config Manager loaded successfully."
  return
}

$script:SettingsOpenFileButton.Add_Click({
  Start-Process -FilePath "notepad.exe" -ArgumentList @($script:SettingsSnapshot.paths.localConfigPath)
})

$script:SettingsDefaultsButton.Add_Click({
  foreach ($controller in $script:SettingsFieldControllers.Values) {
    Set-ControlValue -Controller $controller -Value $controller.Entry.defaultValue
  }
  Set-SettingsDirtyState -Dirty $true -Message "Default values are loaded into the settings form. Click Save Changes to write them."
})

$script:SettingsReloadButton.Add_Click({
  if (-not (Confirm-DiscardChanges -Area "server settings" -IsDirty $script:SettingsDirty)) { return }
  try {
    $snapshot = Invoke-ProjectCli -Command "export"
    Render-SettingsSnapshot -Snapshot $snapshot -ReadyMessage "Reloaded server settings from disk."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:SettingsSaveButton.Add_Click({
  try {
    $snapshot = Invoke-ProjectCli -Command "save" -InputObject @{ values = (Collect-SettingsValues) }
    Render-SettingsSnapshot -Snapshot $snapshot -ReadyMessage "Saved server settings."
    Set-StatusUi -Message "Saved server settings." -Tone "success" -BadgeText "Settings saved"
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbOpenFolderButton.Add_Click({
  Start-Process -FilePath "explorer.exe" -ArgumentList @($script:DatabaseSnapshot.paths.dataRoot)
})

$script:DbReloadButton.Add_Click({
  if (-not (Confirm-DiscardChanges -Area "the player database" -IsDirty $script:DatabaseDirty)) { return }
  try {
    Reload-DatabaseSnapshot -CharacterId $script:DatabaseSnapshot.selectedCharacterId
    Set-DatabaseDirtyState -Dirty $false -Message "Reloaded player database from disk."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbSkillStudioButton.Add_Click({
  try {
    Open-SkillStudio
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbSkillStudioOverviewButton.Add_Click({
  try {
    Open-SkillStudio
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbSaveButton.Add_Click({
  try {
    Save-DatabasePlayer
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbGrantIskButton.Add_Click({
  $nextValue = [double](Get-TextBoxNumericValue -TextBox $script:DbBalanceTextBox -Fallback 0 -Label "ISK balance") + 10000000
  $script:DbBalanceTextBox.Text = [string][int64]$nextValue
  Set-DatabaseDirtyState -Dirty $true -Message "Added 10,000,000 ISK to the staged player wallet."
})

$script:DbAddGameTimeButton.Add_Click({
  $nextValue = [double](Get-TextBoxNumericValue -TextBox $script:DbDaysLeftTextBox -Fallback 0 -Label "Days left") + 30
  $script:DbDaysLeftTextBox.Text = [string][int64]$nextValue
  Set-DatabaseDirtyState -Dirty $true -Message "Added 30 days to the staged player account."
})

$script:DbMaxSecurityButton.Add_Click({
  $script:DbSecurityStatusTextBox.Text = "5"
  Set-DatabaseDirtyState -Dirty $true -Message "Set security status to 5.0 in the staged player form."
})

$script:DbClearBanButton.Add_Click({
  $script:DbBannedCheckBox.IsChecked = $false
  Set-DatabaseDirtyState -Dirty $true -Message "Cleared the account ban flag in the staged player form."
})

$script:DbMaxOwnedSkillsButton.Add_Click({
  try {
    Sync-OverviewControlsToWorkingCopy
    $catalogByKey = @{}
    foreach ($entry in @(New-DatabaseSkillCatalog)) { $catalogByKey[[string]$entry.skillKey] = $entry }
    $skillStore = @{}
    foreach ($skill in @($script:DbWorkingPlayer.skillsList)) {
      $catalogEntry = $catalogByKey[[string]$skill.skillKey]
      if ($catalogEntry) {
        $skillStore[[string]$skill.skillKey] = New-SkillRawFromCatalog -CatalogEntry $catalogEntry -CharacterId $script:DbWorkingPlayer.characterId -Level 5
      } else {
        $skillStore[[string]$skill.skillKey] = ConvertTo-DeepClone $skill.raw
      }
    }
    $script:DbWorkingPlayer.skillsList = Convert-SkillStoreToList -SkillStore $skillStore -CatalogByKey $catalogByKey
    Update-WorkingPlayerDerivedData
    Render-DatabasePlayer
    Set-DatabaseDirtyState -Dirty $true -Message "Upgraded all currently owned skills to level V in the staged player."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbAddShipButton.Add_Click({
  try {
    Open-ItemShipEditor -Kind "ship"
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbAddItemButton.Add_Click({
  try {
    Open-ItemShipEditor -Kind "item"
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbEditItemButton.Add_Click({
  try {
    $selectedItem = [pscustomobject]$script:DbItemPreviewList.SelectedItem
    if (-not $selectedItem) { return }
    if ([int]$selectedItem.categoryID -eq 6) {
      Open-ItemShipEditor -Kind "ship" -ExistingItem $selectedItem
    } else {
      Open-ItemShipEditor -Kind "item" -ExistingItem $selectedItem
    }
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbRemoveItemButton.Add_Click({
  try {
    Remove-SelectedInventoryEntry
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbOpenRawButton.Add_Click({
  $script:DbDetailTabs.SelectedIndex = 1
  Set-StatusUi -Message "Switched to the raw JSON helper view." -Tone "info" -BadgeText "Raw view"
})

$script:DbSearchBox.Add_TextChanged({
  if (-not $script:IsRenderingDatabase) { Update-PlayerListDisplay }
})

$script:DbPlayerList.Add_SelectionChanged({
  if ($script:SuppressPlayerSelection -or $script:IsRenderingDatabase) { return }
  $newCharacterId = [string]$script:DbPlayerList.SelectedValue
  if (-not $newCharacterId -or $newCharacterId -eq [string]$script:DatabaseSnapshot.selectedCharacterId) { return }
  if (-not (Confirm-DiscardChanges -Area "the selected player" -IsDirty $script:DatabaseDirty)) {
    $script:SuppressPlayerSelection = $true
    $script:DbPlayerList.SelectedValue = $script:DatabaseSnapshot.selectedCharacterId
    $script:SuppressPlayerSelection = $false
    return
  }
  try {
    Reload-DatabaseSnapshot -CharacterId $newCharacterId
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbItemPreviewList.Add_SelectionChanged({
  if (-not $script:IsRenderingDatabase) { Update-ItemActionState }
})

foreach ($overviewControl in @(
  $script:DbAccountNameTextBox,
  $script:DbCharacterNameTextBox,
  $script:DbShipNameTextBox,
  $script:DbBalanceTextBox,
  $script:DbPlexTextBox,
  $script:DbAurTextBox,
  $script:DbSecurityStatusTextBox,
  $script:DbDescriptionTextBox,
  $script:DbDaysLeftTextBox
)) {
  $overviewControl.Add_TextChanged({
    if (-not $script:IsRenderingDatabase) {
      Set-DatabaseDirtyState -Dirty $true -Message "Player overview changes are staged in the form."
    }
  })
}

$script:DbBannedCheckBox.Add_Checked({
  if (-not $script:IsRenderingDatabase) { Set-DatabaseDirtyState -Dirty $true -Message "Player overview changes are staged in the form." }
})
$script:DbBannedCheckBox.Add_Unchecked({
  if (-not $script:IsRenderingDatabase) { Set-DatabaseDirtyState -Dirty $true -Message "Player overview changes are staged in the form." }
})

foreach ($rawTextBox in @(
  $script:DbAccountJsonTextBox,
  $script:DbCharacterJsonTextBox,
  $script:DbSkillsJsonTextBox,
  $script:DbItemsJsonTextBox
)) {
  $rawTextBox.Add_TextChanged({
    if (-not $script:IsRenderingDatabase) {
      $script:DbRawJsonDirty = $true
      Set-DatabaseDirtyState -Dirty $true -Message "Raw JSON edits are staged. Apply or save to keep them."
    }
  })
}

$script:DbRefreshJsonButton.Add_Click({
  try {
    Sync-OverviewControlsToWorkingCopy
    $script:IsRenderingDatabase = $true
    try {
      Refresh-RawJsonEditors
    } finally {
      $script:IsRenderingDatabase = $false
    }
    Set-DatabaseDirtyState -Dirty $script:DatabaseDirty -Message "Refreshed raw JSON from the current working copy."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbApplyJsonButton.Add_Click({
  try {
    Apply-RawJsonEditors
    Render-DatabasePlayer
    Set-DatabaseDirtyState -Dirty $true -Message "Applied raw JSON changes to the working copy."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:Window.Add_Closing({
  param($sender, $eventArgs)
  if (-not (Confirm-DiscardChanges -Area "server settings" -IsDirty $script:SettingsDirty)) {
    $eventArgs.Cancel = $true
    return
  }
  if (-not (Confirm-DiscardChanges -Area "the player database" -IsDirty $script:DatabaseDirty)) {
    $eventArgs.Cancel = $true
  }
})

$null = $script:Window.ShowDialog()
