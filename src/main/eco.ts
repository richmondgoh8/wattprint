// EcoQoS / Efficiency Mode action runner.
// Applies Task Manager's own "Efficiency Mode" mechanism — EcoQoS power
// throttling + IDLE priority class — to a batch of PIDs via a single
// PowerShell invocation. No admin rights required (PROCESS_SET_INFORMATION).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const ECO_NATIVE = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EcoNative {
  const uint PROCESS_SET_INFORMATION = 0x0200;
  const uint IDLE_PRIORITY_CLASS = 0x00000040;
  const uint NORMAL_PRIORITY_CLASS = 0x00000020;
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_POWER_THROTTLING_STATE { public uint Version; public uint ControlMask; public uint StateMask; }
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetProcessInformation(IntPtr hProcess, int infoClass, ref PROCESS_POWER_THROTTLING_STATE pi, int size);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetPriorityClass(IntPtr hProcess, uint priorityClass);
  public static string Apply(int pid, bool eco) {
    IntPtr h = OpenProcess(PROCESS_SET_INFORMATION, false, pid);
    if (h == IntPtr.Zero) return "open:" + Marshal.GetLastWin32Error();
    try {
      var state = new PROCESS_POWER_THROTTLING_STATE();
      state.Version = 1;
      state.ControlMask = eco ? 1u : 0u;
      state.StateMask = eco ? 1u : 0u;
      if (!SetProcessInformation(h, 4, ref state, Marshal.SizeOf<PROCESS_POWER_THROTTLING_STATE>())) return "throttle:" + Marshal.GetLastWin32Error();
      SetPriorityClass(h, eco ? IDLE_PRIORITY_CLASS : NORMAL_PRIORITY_CLASS);
      return null;
    } finally { CloseHandle(h); }
  }
}
'@
$failed = @()
foreach ($p in $env:WP_PIDS -split ',') {
  if ($p -eq '') { continue }
  try { $err = [EcoNative]::Apply([int]$p, $env:WP_ON -eq '1') } catch { $err = $_.Exception.Message }
  if ($err) { $failed += [int]$p }
}
Write-Output ("FAILED " + ($failed -join ','))
`

export function isEcoSupported(): boolean {
  return process.platform === 'win32'
}

export interface EcoBatchResult {
  ok: number
  failed: number
  failedPids: Set<number>
}

function parseFailed(stdout: string): Set<number> {
  const match = /^FAILED (.*)$/.exec((stdout || '').trim())
  if (!match || !match[1]) return new Set()
  return new Set(
    match[1]
      .split(',')
      .map((p) => Number.parseInt(p, 10))
      .filter((p) => Number.isInteger(p) && p > 0)
  )
}

/**
 * Apply (or remove) EcoQoS + priority for a batch of PIDs.
 * Returns per-PID success so callers only track PIDs the OS accepted.
 */
export async function applyEcoBatch(pids: number[], on: boolean): Promise<EcoBatchResult> {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))]
  if (unique.length === 0) return { ok: 0, failed: 0, failedPids: new Set() }
  if (!isEcoSupported()) return { ok: 0, failed: unique.length, failedPids: new Set(unique) }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ECO_NATIVE],
      {
        windowsHide: true,
        timeout: 15_000,
        env: {
          ...process.env,
          WP_PIDS: unique.join(','),
          WP_ON: on ? '1' : '0'
        }
      }
    )
    const failedPids = parseFailed(stdout)
    return { ok: unique.length - failedPids.size, failed: failedPids.size, failedPids }
  } catch {
    return { ok: 0, failed: unique.length, failedPids: new Set(unique) }
  }
}
