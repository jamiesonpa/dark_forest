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
  foreach ($procId in $procIds) {
    if ($procId -ne $PID) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host ("Stopped PID " + $procId)
    }
  }
}

function Stop-WorkspaceDevProcs([string]$workspacePath) {
  $devProcs = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*$workspacePath*" -and
    (
      $_.CommandLine -like "*vite*" -or
      $_.CommandLine -like "*tsx watch src/index.ts*"
    )
  }

  foreach ($proc in $devProcs) {
    if ($proc.ProcessId -ne $PID) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host ("Stopped PID " + $proc.ProcessId)
    }
  }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host "Stopping Dark Forest dev processes..."
Stop-ByPort -ports @(2567, 5173, 5174, 5175)
Stop-WorkspaceDevProcs -workspacePath $root

Write-Host "Done."
