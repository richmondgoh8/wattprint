// Persistent Windows host-process probe.
// Spawns powershell.exe once and keeps it alive, streaming Get-Process
// snapshots as JSON lines. Consumers compute CPU% from CPU-second deltas,
// so no process is spawned per sample.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { findPowerShell } from './hardware.js'

export interface HostProcessRow {
  pid: number
  name: string
  /** CPU usage as percent of one core (instantaneous PerfProc counter). */
  cpuPct: number | null
  /** Private working set in bytes (matches Task Manager's Memory column). */
  memoryBytes: number | null
}

export interface HostTelemetry {
  cpuPct: number | null
  memUsedBytes: number | null
  memTotalBytes: number | null
  diskReadBps: number | null
  diskWriteBps: number | null
  netRxBps: number | null
  netTxBps: number | null
  gpuUtilPct: number | null
  /** Real GPU power (W) via LibreHardwareMonitor, if the DLLs are present. */
  gpuPowerW: number | null
  /** Top GPU engine consumer (name + engine %), if any. */
  gpuTopName: string | null
  gpuTopPct: number | null
  /** Top GPU engine consumers by process, sorted descending. */
  gpuConsumers: { name: string; pct: number }[]
}

export interface HostSnapshot {
  processes: HostProcessRow[]
  telemetry: HostTelemetry
}

const EMPTY_TELEMETRY: HostTelemetry = {
  cpuPct: null,
  memUsedBytes: null,
  memTotalBytes: null,
  diskReadBps: null,
  diskWriteBps: null,
  netRxBps: null,
  netTxBps: null,
  gpuUtilPct: null,
  gpuPowerW: null,
  gpuTopName: null,
  gpuTopPct: null,
  gpuConsumers: []
}

const POLL_MS = 1000
const MAX_RESTART_BACKOFF_MS = 30_000

export class HostProcessHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private latest: HostSnapshot = { processes: [], telemetry: EMPTY_TELEMETRY }
  private buffer = ''
  private restarts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private alive = false
  private lhmDir: string | null = null
  private pollMs = POLL_MS

  get rows(): HostProcessRow[] {
    return this.latest.processes
  }

  get telemetry(): HostTelemetry {
    return this.latest.telemetry
  }

  get isAlive(): boolean {
    return this.alive
  }

  start(lhmDir: string | null = null): void {
    if (this.child || this.restartTimer) return
    if (lhmDir != null) this.lhmDir = lhmDir
    this.spawn()
  }

  stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    this.alive = false
    if (child) child.kill()
  }

  /** Change the loop poll cadence; restarts the helper when it differs. */
  setPollMs(ms: number): void {
    const clamped = Math.max(250, Math.round(ms))
    if (clamped === this.pollMs) return
    this.pollMs = clamped
    const child = this.child
    if (!child) return
    this.child = null
    this.alive = false
    this.restarts = 0
    child.kill()
    this.spawn()
  }

  private spawn(): void {
    const ps = findPowerShell()
    if (!ps) {
      // No PowerShell anywhere (native Linux/macOS): stay dead instead of
      // retrying forever. The collector falls back to systeminformation.
      this.alive = false
      this.child = null
      return
    }
    const lhmLiteral = this.lhmDir ? `$lhmDir = '${this.lhmDir.replace(/'/g, "''")}'` : '$lhmDir = $null'
    const script = [
      '$ErrorActionPreference = "SilentlyContinue"',
      lhmLiteral,
      'if ($lhmDir) { try { Add-Type -Path (Join-Path $lhmDir "LibreHardwareMonitorLib.dll"); $computer = New-Object LibreHardwareMonitor.Hardware.Computer; $computer.IsGpuEnabled = $true; $computer.Open() } catch { $computer = $null } } else { $computer = $null }',
      'while ($true) {',
      '  $procs = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object { [pscustomobject]@{ Id = $_.IDProcess; ProcessName = ($_.Name -split "#")[0]; CpuPct = [double]$_.PercentProcessorTime; PrivateBytes = [int64]$_.WorkingSetPrivate } })',
      '  $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -eq "_Total" } | Select-Object -First 1).PercentProcessorTime',
      '  $os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 FreePhysicalMemory, TotalVisibleMemorySize',
      '  $disk = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk) | Where-Object { $_.Name -eq "_Total" } | Select-Object -First 1',
      '  $net = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)',
      '  $netRx = 0.0; $netTx = 0.0; foreach ($n in $net) { $netRx += $n.BytesReceivedPersec; $netTx += $n.BytesSentPersec }',
      '  $gpuEng = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)',
      '  $gpuUtil = 0.0; foreach ($g in $gpuEng) { if ($g.Name -match "engtype_") { $gpuUtil += $g.UtilizationPercentage } }; $gpuUtil = [math]::Min(100, $gpuUtil)',
      '  $procNames = @{}; foreach ($proc in $procs) { if (-not $procNames.ContainsKey([int]$proc.Id)) { $procNames[[int]$proc.Id] = $proc.ProcessName } }',
      '  $gpuByName = @{}; foreach ($g in $gpuEng) { if ($g.Name -match "engtype_") { $m = [regex]::Match($g.Name, "pid_(\\d+)_"); if ($m.Success) { $k = [int]$m.Groups[1].Value; $nm = $procNames[$k]; if (-not $nm) { $nm = "pid " + $k }; if ($gpuByName.ContainsKey($nm)) { $gpuByName[$nm] += $g.UtilizationPercentage } else { $gpuByName[$nm] = $g.UtilizationPercentage } } } }',
      '  $gpuList = @(); foreach ($kv in $gpuByName.GetEnumerator()) { $gpuList += [pscustomobject]@{ name = $kv.Key; pct = [double]$kv.Value } }',
      '  $gpuList = @($gpuList | Sort-Object pct -Descending); $gpuConsumers = @($gpuList | Select-Object -First 10); $gpuTopName = $null; $gpuTopPct = $null; if ($gpuList.Count -gt 0) { $gpuTopName = $gpuList[0].name; $gpuTopPct = $gpuList[0].pct }',
      '  $gpuPowerW = $null; if ($computer) { foreach ($hw in $computer.Hardware) { if ($hw.HardwareType -eq [LibreHardwareMonitor.Hardware.HardwareType]::GpuAmd -or $hw.HardwareType -eq [LibreHardwareMonitor.Hardware.HardwareType]::GpuNvidia) { $hw.Update(); foreach ($s in $hw.Sensors) { if ($s.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Power) { $gpuPowerW = [double]$s.Value } } } } }',
      '  $obj = [pscustomobject]@{ processes = $procs; cpuPct = [double]$cpu; memUsedBytes = [int64](([double]$os.TotalVisibleMemorySize - [double]$os.FreePhysicalMemory) * 1024); memTotalBytes = [int64]([double]$os.TotalVisibleMemorySize * 1024); diskReadBps = [int64]$disk.DiskReadBytesPersec; diskWriteBps = [int64]$disk.DiskWriteBytesPersec; netRxBps = [int64]$netRx; netTxBps = [int64]$netTx; gpuUtilPct = [double]$gpuUtil; gpuPowerW = $gpuPowerW; gpuTopName = $gpuTopName; gpuTopPct = $gpuTopPct; gpuConsumers = $gpuConsumers }',
      '  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3))',
      '  [Console]::Out.Flush()',
      `  Start-Sleep -Milliseconds ${this.pollMs}`,
      '}'
    ].join('; ')
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true
      })
    } catch {
      this.scheduleRestart()
      return
    }
    this.child = child
    this.alive = true
    child.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')))
    child.stderr.on('data', () => {
      // drain — the loop emits nothing on stderr
    })
    child.on('error', () => this.onExit(child))
    child.on('exit', () => this.onExit(child))
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = null
    this.alive = false
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.child) return
    const delay = Math.min(POLL_MS * 2 ** this.restarts, MAX_RESTART_BACKOFF_MS)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, delay)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let index: number
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (!parsed || typeof parsed !== 'object') continue
        const record = parsed as Record<string, unknown>
        const rawProcesses = Array.isArray(record.processes) ? record.processes : [record]
        const processes = rawProcesses
          .filter(
            (row): row is Record<string, unknown> =>
              !!row && typeof row === 'object' && typeof row.Id === 'number' && row.Id > 0
          )
          .map((row) => ({
            pid: row.Id as number,
            name: typeof row.ProcessName === 'string' ? (row.ProcessName as string) : `pid ${row.Id as number}`,
            cpuPct: typeof row.CpuPct === 'number' ? (row.CpuPct as number) : null,
            memoryBytes: typeof row.PrivateBytes === 'number' ? (row.PrivateBytes as number) : null
          }))
        this.latest = {
          processes,
          telemetry: {
            cpuPct: typeof record.cpuPct === 'number' ? record.cpuPct : null,
            memUsedBytes: typeof record.memUsedBytes === 'number' ? record.memUsedBytes : null,
            memTotalBytes: typeof record.memTotalBytes === 'number' ? record.memTotalBytes : null,
            diskReadBps: typeof record.diskReadBps === 'number' ? record.diskReadBps : null,
            diskWriteBps: typeof record.diskWriteBps === 'number' ? record.diskWriteBps : null,
            netRxBps: typeof record.netRxBps === 'number' ? record.netRxBps : null,
            netTxBps: typeof record.netTxBps === 'number' ? record.netTxBps : null,
            gpuUtilPct: typeof record.gpuUtilPct === 'number' ? record.gpuUtilPct : null,
            gpuPowerW: typeof record.gpuPowerW === 'number' ? record.gpuPowerW : null,
            gpuTopName: typeof record.gpuTopName === 'string' ? record.gpuTopName : null,
            gpuTopPct: typeof record.gpuTopPct === 'number' ? record.gpuTopPct : null,
            gpuConsumers: Array.isArray(record.gpuConsumers)
              ? (record.gpuConsumers as Record<string, unknown>[])
                  .filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && typeof c.pct === 'number')
                  .map((c) => ({ name: c.name as string, pct: c.pct as number }))
              : []
          }
        }
        this.restarts = 0
        this.alive = true
      } catch {
        // malformed line — ignore and keep reading
      }
    }
  }
}
