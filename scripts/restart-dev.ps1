param(
  [switch]$NoServer,
  [switch]$NoClient,
  [int]$Seed = -1,
  [int]$PlanetCount = -1,
  [int]$MoonCount = -1,
  [int]$BeltCount = -1
)
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $root "server"
$serverLogPath = Join-Path $root ".server-dev.log"
$serverErrLogPath = Join-Path $root ".server-dev.err.log"

function Resolve-StarSystemValue([int]$explicitValue, [int]$randomMinInclusive, [int]$randomMaxExclusive) {
  if ($explicitValue -ge 0) {
    return $explicitValue
  }

  return Get-Random -Minimum $randomMinInclusive -Maximum $randomMaxExclusive
}

$randomSeed = Resolve-StarSystemValue -explicitValue $Seed -randomMinInclusive 0 -randomMaxExclusive 10000
$randomPlanetCount = Resolve-StarSystemValue -explicitValue $PlanetCount -randomMinInclusive 0 -randomMaxExclusive 4
$randomMoonCount = Resolve-StarSystemValue -explicitValue $MoonCount -randomMinInclusive 0 -randomMaxExclusive 4
$randomBeltCount = Resolve-StarSystemValue -explicitValue $BeltCount -randomMinInclusive 0 -randomMaxExclusive 4

function Stop-ByPort([int[]]$ports) {
  $procIds = @()
  foreach ($port in $ports) {
    $lines = netstat -ano | Select-String "LISTENING\s+\d+$" | Select-String ":$port\s"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split "\s+") | Where-Object { $_ -ne "" }
      if ($parts.Length -gt 0) {
        $procIdText = $parts[-1]
        if ($procIdText -match "^\d+$") {
          $procIds += [int]$procIdText
        }
      }
    }
  }

  $procIds = $procIds | Select-Object -Unique
  foreach ($procId in $procIds) {
    if ($procId -ne $PID) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Wait-PortFree([int[]]$ports, [int]$maxAttempts = 20) {
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $occupied = $false
    foreach ($port in $ports) {
      $isListening = netstat -ano | Select-String "LISTENING\s+\d+$" | Select-String ":$port\s"
      if ($isListening) {
        $occupied = $true
        break
      }
    }
    if (-not $occupied) {
      return $true
    }
    Start-Sleep -Milliseconds 200
    Stop-ByPort -ports $ports
  }
  return $false
}

function Stop-WorkspaceDevProcs([string]$workspacePath) {
  $patterns = @(
    "*vite*",
    "*npm run dev*",
    "*watch src/index.ts*",
    "*tsx src/index.ts*",
    "*tsx.cmd src/index.ts*"
  )

  $devProcs = Get-CimInstance Win32_Process | Where-Object {
    if (-not $_.CommandLine) { return $false }
    if ($_.CommandLine -notlike "*$workspacePath*") { return $false }

    foreach ($pattern in $patterns) {
      if ($_.CommandLine -like $pattern) { return $true }
    }

    return $false
  }

  foreach ($proc in $devProcs) {
    if ($proc.ProcessId -ne $PID) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "Stopping existing dev listeners/processes..."
Stop-ByPort -ports @(2567, 5173, 5174, 5175)
Stop-WorkspaceDevProcs -workspacePath $root
if (-not (Wait-PortFree -ports @(2567, 5173, 5174, 5175))) {
  Write-Host "Warning: one or more dev ports are still in use. Server may fail to start."
}

Write-Host ("Star system config: seed={0} planets={1} moons={2} belts={3}" -f $randomSeed, $randomPlanetCount, $randomMoonCount, $randomBeltCount)
Write-Host "Reuse the same values with -Seed/-PlanetCount/-MoonCount/-BeltCount for a reproducible restart."

if (-not $NoServer) {
  Write-Host "Starting server in background (no pop-out)..."
  Set-Content -Path $serverLogPath -Value "" -Encoding Unicode
  Set-Content -Path $serverErrLogPath -Value "" -Encoding Unicode
  $serverCommand = "/c cd /d ""$serverDir"" && set DF_STAR_SYSTEM_SEED=$randomSeed && set DF_STAR_SYSTEM_PLANETS=$randomPlanetCount && set DF_STAR_SYSTEM_MOONS=$randomMoonCount && set DF_STAR_SYSTEM_BELTS=$randomBeltCount && .\node_modules\.bin\tsx.cmd src/index.ts"
  $serverProc = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList $serverCommand `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serverLogPath `
    -RedirectStandardError $serverErrLogPath `
    -PassThru
  if (-not $serverProc) {
    throw "Failed to start server process."
  }
  Write-Host ("Server PID: " + $serverProc.Id)
  Write-Host ("Server log: " + $serverLogPath)
  Write-Host ("Server error log: " + $serverErrLogPath)

  $serverReady = $false
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    $isListening = netstat -ano | Select-String "LISTENING\s+\d+$" | Select-String ":2567\s"
    if ($isListening) {
      $serverReady = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $serverReady) {
    Write-Host "Server failed to bind to port 2567."
  }
}

if (-not $NoClient) {
  Write-Host "Starting client in current terminal..."
  Set-Location $root
  npm run dev
}
