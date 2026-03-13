$ErrorActionPreference = "SilentlyContinue"

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
  $stoppedAny = $false
  foreach ($procId in $procIds) {
    if ($procId -ne $PID) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host ("Stopped PID " + $procId)
      $stoppedAny = $true
    }
  }

  return $stoppedAny
}

function Stop-WorkspaceDevProcs([string]$workspacePath) {
  $patterns = @(
    "*vite*",
    "*npm run dev*",
    "*tsx watch src/index.ts*",
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

  $stoppedAny = $false
  foreach ($proc in $devProcs) {
    if ($proc.ProcessId -ne $PID) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host ("Stopped PID " + $proc.ProcessId)
      $stoppedAny = $true
    }
  }

  return $stoppedAny
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host "Stopping Dark Forest dev processes..."
$stoppedFromPorts = Stop-ByPort -ports @(2567, 5173, 5174, 5175)
$stoppedFromCmdline = Stop-WorkspaceDevProcs -workspacePath $root

# Second pass catches children that survive after parent termination.
$stoppedFromPortsSecondPass = Stop-ByPort -ports @(2567, 5173, 5174, 5175)

if (-not ($stoppedFromPorts -or $stoppedFromCmdline -or $stoppedFromPortsSecondPass)) {
  Write-Host "No matching dev processes found."
}

Write-Host "Done."
