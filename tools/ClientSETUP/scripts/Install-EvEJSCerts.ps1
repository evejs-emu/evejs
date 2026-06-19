param(
  [string]$ClientPath,
  [switch]$ForceRebuildGatewayCert,
  [switch]$SkipRootStore,
  [switch]$SkipClientBundles
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$caCertPath = Join-Path $repoRoot "server\certs\xmpp-ca-cert.pem"
$caKeyPath = Join-Path $repoRoot "server\certs\xmpp-ca-key.pem"
$builderScriptPath = Join-Path $PSScriptRoot "build-gateway-cert.js"
$gatewayCertDir = Join-Path $repoRoot "server\src\_secondary\express\certs"
$gatewayCertPath = Join-Path $gatewayCertDir "gateway-dev-cert.pem"
$gatewayKeyPath = Join-Path $gatewayCertDir "gateway-dev-key.pem"
$gatewayFriendlyName = "eve.js Public Gateway TLS"
$gatewaySubject = "CN=dev-public-gateway.evetech.net"

function Write-Step {
  param([string]$Message)

  Write-Host "[eve.js] $Message" -ForegroundColor Cyan
}

function Get-NodeCommand {
  $nodeCommand = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $nodeCommand) {
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
  }

  return $nodeCommand
}

function Resolve-ConfiguredClientPath {
  param([string]$ConfiguredPath)

  $candidates = @()
  if ($ConfiguredPath) {
    $candidates += $ConfiguredPath
  }
  if ($env:EVEJS_CLIENT_PATH) {
    $candidates += $env:EVEJS_CLIENT_PATH
  }
  $repoClientPath = Join-Path $repoRoot "client\EVE\tq"
  if (Test-Path $repoClientPath) {
    $candidates += $repoClientPath
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path -Path $candidate).Path
    }
  }

  return $null
}

function Get-ClientBundlePaths {
  param([string]$ResolvedClientPath)

  if (-not $ResolvedClientPath) {
    return @()
  }

  return @(
    (Join-Path $ResolvedClientPath "bin64\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin64\packages\certifi\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin\packages\certifi\cacert.pem")
  ) | Where-Object { Test-Path $_ }
}

function Remove-PemBlockFromContent {
  param(
    [string]$Content,
    [string]$PemBlock
  )

  if (-not $PemBlock) {
    return $Content
  }

  $trimmedPem = $PemBlock.Trim()
  if (-not $trimmedPem) {
    return $Content
  }

  return ($Content -replace [regex]::Escape($trimmedPem), "").TrimEnd() + "`r`n"
}

function Ensure-PemBundleContainsCa {
  param(
    [string]$BundlePath,
    [string]$PemCaPath,
    [string[]]$PemBlocksToRemove = @()
  )

  $bundleRaw = Get-Content -Path $BundlePath -Raw
  foreach ($pemBlock in $PemBlocksToRemove) {
    $bundleRaw = Remove-PemBlockFromContent -Content $bundleRaw -PemBlock $pemBlock
  }

  $caRaw = (Get-Content -Path $PemCaPath -Raw).Trim()
  if ($bundleRaw.Contains($caRaw)) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($BundlePath, $bundleRaw, $encoding)
    Write-Step "CA already present in $BundlePath"
    return
  }

  $updated = $bundleRaw.TrimEnd() + "`r`n`r`n" + $caRaw + "`r`n"
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($BundlePath, $updated, $encoding)
  Write-Step "Appended CA to $BundlePath"
}

function Ensure-RootTrust {
  param([string]$PemPath)

  $cert = Get-PfxCertificate -FilePath $PemPath
  $existing = Get-ChildItem Cert:\CurrentUser\Root | Where-Object {
    $_.Thumbprint -eq $cert.Thumbprint
  }

  if ($existing) {
    Write-Step "CA already trusted in CurrentUser\Root."
    return
  }

  Import-Certificate -FilePath $PemPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
  Write-Step "Installed CA into CurrentUser\Root."
}

function Remove-ExistingGatewayCerts {
  $stores = @("Cert:\CurrentUser\My", "Cert:\CurrentUser\Root")
  foreach ($store in $stores) {
    $existing = Get-ChildItem $store | Where-Object {
      $_.FriendlyName -eq $gatewayFriendlyName -or $_.Subject -eq $gatewaySubject
    }

    foreach ($cert in $existing) {
      Remove-Item -Path (Join-Path $store $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue
    }
  }
}

function Test-GatewayLeafNeedsRebuild {
  param([string]$CertPath)

  if (-not (Test-Path $CertPath)) {
    return $true
  }

  try {
    $cert = Get-PfxCertificate -FilePath $CertPath
    return [string]::Equals($cert.Subject, $cert.Issuer, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $true
  }
}

function Build-GatewayCertificate {
  New-Item -ItemType Directory -Force -Path $gatewayCertDir | Out-Null

  $previousLeafPem = $null
  if (Test-Path $gatewayCertPath) {
    $previousLeafPem = (Get-Content -Path $gatewayCertPath -Raw).Trim()
  }

  if ($ForceRebuildGatewayCert) {
    Remove-ExistingGatewayCerts
    Remove-Item -Path $gatewayCertPath, $gatewayKeyPath -Force -ErrorAction SilentlyContinue
  }

  if ((Test-Path $gatewayCertPath) -and (Test-Path $gatewayKeyPath) -and (-not (Test-GatewayLeafNeedsRebuild -CertPath $gatewayCertPath))) {
    Write-Step "Gateway TLS files already exist."
    return $previousLeafPem
  }

  $nodeCommand = Get-NodeCommand
  & $nodeCommand $builderScriptPath `
    --ca-cert $caCertPath `
    --ca-key $caKeyPath `
    --out-cert $gatewayCertPath `
    --out-key $gatewayKeyPath

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build gateway TLS certificate."
  }

  Write-Step "Built CA-signed public-gateway TLS cert under $gatewayCertDir"
  return $previousLeafPem
}

if (-not (Test-Path $caCertPath)) {
  throw "Missing CA certificate at $caCertPath"
}

if (-not (Test-Path $caKeyPath)) {
  throw "Missing CA private key at $caKeyPath"
}

$oldLeafPem = Build-GatewayCertificate

if (-not $SkipRootStore) {
  Ensure-RootTrust -PemPath $caCertPath
}

if (-not $SkipClientBundles) {
  $resolvedClientPath = Resolve-ConfiguredClientPath -ConfiguredPath $ClientPath
  if (-not $resolvedClientPath) {
    throw "Client path was not found. Edit tools\ClientSETUP\scripts\EvEJSConfig.bat or pass -ClientPath."
  }

  $bundlePaths = Get-ClientBundlePaths -ResolvedClientPath $resolvedClientPath
  if (-not $bundlePaths) {
    throw "No client cacert.pem bundle was found under $resolvedClientPath"
  }

  $currentLeafPem = $null
  if (Test-Path $gatewayCertPath) {
    $currentLeafPem = (Get-Content -Path $gatewayCertPath -Raw).Trim()
  }

  foreach ($bundlePath in $bundlePaths) {
    Ensure-PemBundleContainsCa `
      -BundlePath $bundlePath `
      -PemCaPath $caCertPath `
      -PemBlocksToRemove @($oldLeafPem, $currentLeafPem)
  }
}

Write-Step "Chat and public-gateway certificates are ready."
