# Watchdog for mutation runs (24 Nov 2026). Every 15 s: kills any node process of the mutation test suite (started by
# tools/mutation-test.mjs with --title=synalla-mutation-suite) that has run over 120 s or uses over 3 GB. It matches
# only that marker: matching "--test-isolation" killed an unrelated test run of another repo (24 Nov). When Stryker has exited, kills every leftover suite
# process and stops. Started by tools/run-mutation.sh next to Stryker.
param([int]$MaxSeconds = 120, [int]$MaxMB = 3072)
$seenStryker = $false
while ($true) {
  $now = Get-Date
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
  $stryker = @($procs | Where-Object { $_.CommandLine -like '*stryker.js*' })
  if ($stryker.Count -gt 0) { $seenStryker = $true }
  foreach ($p in ($procs | Where-Object { $_.CommandLine -like '*--title=synalla-mutation-suite*' })) {
    $age = ($now - $p.CreationDate).TotalSeconds; $mb = $p.WorkingSetSize / 1MB
    if ($age -gt $MaxSeconds -or $mb -gt $MaxMB -or ($seenStryker -and $stryker.Count -eq 0)) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      "$($now.ToString('o')) killed suite process $($p.ProcessId) age $([int]$age) s, $([int]$mb) MB"
    }
  }
  if ($seenStryker -and $stryker.Count -eq 0) { "$($now.ToString('o')) Stryker gone; watchdog stops"; break }
  Start-Sleep 15
}
