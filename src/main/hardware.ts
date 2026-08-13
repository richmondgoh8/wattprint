import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import * as si from 'systeminformation'
import type { SystemInfo } from '../shared/types.js'

const execFileAsync = promisify(execFile)

interface WindowsHostHardware {
  cpu: {
    Name: string | null
    Manufacturer: string | null
    NumberOfCores: number | null
    NumberOfLogicalProcessors: number | null
    MaxClockSpeed: number | null
    CurrentClockSpeed: number | null
    SocketDesignation: string | null
    L2CacheSize: number | null
    L3CacheSize: number | null
    VirtualizationFirmwareEnabled: boolean | null
  } | null
  memory: {
    Capacity: number | null
    BankLabel: string | null
    SMBIOSMemoryType: number | null
    FormFactor: number | null
    Speed: number | null
    ConfiguredClockSpeed: number | null
    Manufacturer: string | null
    PartNumber: string | null
    SerialNumber: string | null
    TotalWidth: number | null
    ConfiguredVoltage: number | null
  }[]
  gpus: {
    Name: string | null
    AdapterCompatibility: string | null
    PNPDeviceID: string | null
    AdapterRAM: number | null
    DriverVersion: string | null
    Status: string | null
  }[]
  disks: {
    DeviceID: string | null
    Model: string | null
    Caption: string | null
    Manufacturer: string | null
    PNPDeviceID: string | null
    MediaType: string | null
    Size: number | null
    InterfaceType: string | null
    FirmwareRevision: string | null
    SerialNumber: string | null
    Status: string | null
  }[]
  networks: {
    Name: string | null
    AdapterType: string | null
    Speed: number | null
    MACAddress: string | null
    NetConnectionStatus: number | null
    PhysicalAdapter: boolean | null
  }[]
  physical: {
    DeviceId: string | null
    FriendlyName: string | null
    SerialNumber: string | null
    Size: number | null
    BusType: string | null
    MediaType: string | null
  }[]
  motherboard: {
    Manufacturer: string | null
    Product: string | null
    Version: string | null
  } | null
  bios: {
    Manufacturer: string | null
    SMBIOSBIOSVersion: string | null
    ReleaseDate: string | null
  } | null
  os: {
    Caption: string | null
    Version: string | null
    BuildNumber: string | null
    OSArchitecture: string | null
    Hostname: string | null
  } | null
  hostname: string | null
}

let windowsHostPromise: Promise<WindowsHostHardware | null> | null = null

function isWsl(): boolean {
  if (process.platform !== 'linux') return false
  try {
    return /microsoft|wsl/i.test(`${readFileSync('/proc/version', 'utf8')} ${process.env['WSL_INTEROP'] ?? ''} ${process.env['WSL_DISTRO_NAME'] ?? ''}`)
  } catch {
    return false
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  // Fast path: one PowerShell query for the Windows host, used both from WSL
  // and natively on Windows (avoids ~15 slow systeminformation spawns).
  if (isWsl() || process.platform === 'win32') {
    const [host, localMemory] = await Promise.all([getWindowsHostHardware(), safe(si.mem(), null)])
    if (host) return normalizeWindowsHost(host, localMemory)
  }
  return normalizeLocalHardware()
}

async function getWindowsHostHardware(): Promise<WindowsHostHardware | null> {
  if (!isWsl() && process.platform !== 'win32') return null
  if (!windowsHostPromise) windowsHostPromise = queryWindowsHostHardware()
  return windowsHostPromise
}

async function queryWindowsHostHardware(): Promise<WindowsHostHardware | null> {
  const command = findPowerShell()
  if (!command) return null

  const script = [
    '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,CurrentClockSpeed,SocketDesignation,L2CacheSize,L3CacheSize,VirtualizationFirmwareEnabled',
    '$memory = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,BankLabel,SMBIOSMemoryType,FormFactor,Speed,ConfiguredClockSpeed,Manufacturer,PartNumber,SerialNumber,TotalWidth,ConfiguredVoltage)',
    '$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,PNPDeviceID,AdapterRAM,DriverVersion,Status)',
    '$disks = @(Get-CimInstance Win32_DiskDrive | Select-Object DeviceID,Model,Caption,Manufacturer,PNPDeviceID,MediaType,Size,InterfaceType,FirmwareRevision,SerialNumber,Status)',
    '$networks = @(Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -and $_.MACAddress } | Select-Object Name,AdapterType,Speed,MACAddress,NetConnectionStatus,PhysicalAdapter)',
    'try { $physical = @(Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,SerialNumber,Size,BusType,MediaType) } catch { $physical = @() }',
    '$baseboard = Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,Version',
    '$bios = Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate',
    '$osinfo = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture',
    '$hostname = Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Name',
    '[pscustomobject]@{ cpu = $cpu; memory = $memory; gpus = $gpus; disks = $disks; physical = $physical; networks = $networks; motherboard = $baseboard; bios = $bios; os = $osinfo; hostname = $hostname } | ConvertTo-Json -Compress -Depth 5'
  ].join('; ')

  try {
    const { stdout } = await execFileAsync(command, ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    })
    const parsed = JSON.parse(stdout.trim()) as Partial<WindowsHostHardware>
    if (!parsed || !Array.isArray(parsed.gpus)) return null
    return {
      cpu: parsed.cpu ?? null,
      memory: Array.isArray(parsed.memory) ? parsed.memory : [],
      gpus: parsed.gpus,
      disks: Array.isArray(parsed.disks) ? parsed.disks : [],
      physical: Array.isArray(parsed.physical) ? parsed.physical : [],
      networks: Array.isArray(parsed.networks) ? parsed.networks : [],
      motherboard: parsed.motherboard ?? null,
      bios: parsed.bios ?? null,
      os: parsed.os
        ? { ...parsed.os, Hostname: typeof parsed.hostname === 'string' ? parsed.hostname : null }
        : null,
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : null
    }
  } catch {
    return null
  }
}

export function findPowerShell(): string | null {
  if (process.env['PATH']?.split(':').some((dir) => dir.toLowerCase().includes('windows'))) {
    return 'powershell.exe'
  }
  // WSL dev: .NET cannot load assemblies from \\wsl.localhost shares, but
  // plain PowerShell calls work fine via the /mnt/c fallback.
  const wslFallback = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  try {
    return existsSync(wslFallback) ? wslFallback : null
  } catch {
    return null
  }
}

function normalizeWindowsHost(host: WindowsHostHardware, localMemory: Awaited<ReturnType<typeof si.mem>> | null): SystemInfo {
  const cpu = host.cpu
  const cpuBrand = textOr(cpu?.Name)
  const memoryModules = host.memory.map((m) => ({
    sizeBytes: numberOr(m.Capacity),
    bank: textOr(m.BankLabel),
    type: memoryType(m.SMBIOSMemoryType),
    formFactor: formFactor(m.FormFactor),
    clockMHz: numberOrNull(m.ConfiguredClockSpeed ?? m.Speed),
    manufacturer: resolveMemoryVendor(m.Manufacturer, m.PartNumber),
    partNumber: textOr(m.PartNumber),
    serialNumber: textOr(m.SerialNumber),
    ecc: m.TotalWidth != null ? m.TotalWidth > 64 : null,
    voltageMv: numberOrNull(m.ConfiguredVoltage)
  }))
  const totalBytes = memoryModules.reduce((sum, m) => sum + m.sizeBytes, 0)
  const cpuRef = resolveCpuReference(cpuBrand)

  return {
    cpu: {
      brand: cpuBrand,
      manufacturer: textOr(cpu?.Manufacturer),
      socket: textOr(cpu?.SocketDesignation),
      cores: numberOr(cpu?.NumberOfLogicalProcessors),
      physicalCores: numberOr(cpu?.NumberOfCores),
      speedGHz: numberOr(cpu?.CurrentClockSpeed) / 1000,
      speedMinGHz: 0,
      speedMaxGHz: numberOr(cpu?.MaxClockSpeed) / 1000,
      cache: { l1dBytes: 0, l1iBytes: 0, l2Bytes: numberOr(cpu?.L2CacheSize) * 1024, l3Bytes: numberOr(cpu?.L3CacheSize) * 1024 },
      virtualization: cpu?.VirtualizationFirmwareEnabled ?? null,
      codename: cpuRef.codename,
      tdpW: cpuRef.tdpW
    },
    memory: {
      totalBytes,
      usedBytes: numberOr(localMemory?.used),
      freeBytes: numberOr(localMemory?.free),
      availableBytes: numberOr(localMemory?.available),
      swapTotalBytes: numberOr(localMemory?.swaptotal),
      swapUsedBytes: numberOr(localMemory?.swapused),
      modules: memoryModules
    },
    gpus: host.gpus.map(normalizeWindowsGpu),
    disks: mergePhysicalDisks(host.disks, host.physical),
    networks: host.networks.map((n) => ({
      name: textOr(n.Name),
      type: textOr(n.AdapterType),
      speedMbps: n.Speed == null ? null : n.Speed / 1_000_000,
      mac: textOr(n.MACAddress),
      ip4: '—',
      state: networkState(n.NetConnectionStatus),
      duplex: '—',
      virtual: !(n.PhysicalAdapter ?? true)
    })),
    motherboard: {
      manufacturer: textOr(host.motherboard?.Manufacturer),
      model: textOr(host.motherboard?.Product),
      version: textOr(host.motherboard?.Version),
      chipset: resolveChipset(host.motherboard?.Product)
    },
    bios: {
      vendor: textOr(host.bios?.Manufacturer),
      version: textOr(host.bios?.SMBIOSBIOSVersion),
      releaseDate: parseWmiDate(host.bios?.ReleaseDate ?? null)
    },
    diagnostics: {
      runtime: 'WSL2',
      gpuSource: 'Windows WMI via PowerShell',
      gpuStatus: host.gpus.length > 0 ? 'Host GPU detected' : 'No host GPU returned'
    },
    os: {
      platform: 'win32',
      release: textOr(host.os?.Version),
      hostname: textOr(host.os?.Hostname ?? host.hostname),
      build: textOr(host.os?.BuildNumber),
      arch: textOr(host.os?.OSArchitecture),
      distro: textOr(host.os?.Caption)
    }
  }
}

function normalizeWindowsGpu(gpu: WindowsHostHardware['gpus'][number]): SystemInfo['gpus'][number] {
  const vendorId = gpu.PNPDeviceID?.match(/VEN_([0-9A-F]{4})/i)?.[1]?.toUpperCase() ?? null
  const deviceId = gpu.PNPDeviceID?.match(/DEV_([0-9A-F]{4})/i)?.[1]?.toUpperCase() ?? null
  return {
    vendor: textOr(gpu.AdapterCompatibility),
    model: textOr(gpu.Name),
    vendorId,
    deviceId,
    bus: gpu.PNPDeviceID?.startsWith('PCI') ? 'PCI' : '—',
    busAddress: null,
    vramBytes: null,
    vramDynamic: false,
    driver: textOr(gpu.DriverVersion),
    status: textOr(gpu.Status),
    utilizationGpu: null,
    utilizationMemory: null,
    temperatureC: null,
    powerDrawW: null,
    note: gpu.AdapterRAM != null ? 'Windows WMI VRAM is a 32-bit legacy field and is not shown as exact capacity.' : null
  }
}

async function normalizeLocalHardware(): Promise<SystemInfo> {
  const [cpu, mem, memLayout, graphics, os, disks, networks, baseboard, bios] = await Promise.all([
    safe(si.cpu(), null),
    safe(si.mem(), null),
    safe(si.memLayout(), []),
    safe(si.graphics(), { controllers: [], displays: [] }),
    safe(si.osInfo(), null),
    safe(si.diskLayout(), []),
    safe(si.networkInterfaces(), []),
    safe(si.baseboard(), null),
    safe(si.bios(), null)
  ])
  const localGpus = graphics.controllers ?? []
  const cpuBrand = textOr(cpu?.brand)
  const cpuRef = resolveCpuReference(cpuBrand)
  return {
    cpu: {
      brand: cpuBrand,
      manufacturer: textOr(cpu?.manufacturer),
      socket: textOr(cpu?.socket),
      cores: numberOr(cpu?.cores),
      physicalCores: numberOr(cpu?.physicalCores),
      speedGHz: numberOr(cpu?.speed),
      speedMinGHz: numberOr(cpu?.speedMin),
      speedMaxGHz: numberOr(cpu?.speedMax),
      cache: {
        l1dBytes: numberOr(cpu?.cache?.l1d),
        l1iBytes: numberOr(cpu?.cache?.l1i),
        l2Bytes: numberOr(cpu?.cache?.l2),
        l3Bytes: numberOr(cpu?.cache?.l3)
      },
      virtualization: cpu?.virtualization ?? null,
      codename: cpuRef.codename,
      tdpW: cpuRef.tdpW
    },
    memory: {
      totalBytes: numberOr(mem?.total),
      usedBytes: numberOr(mem?.used),
      freeBytes: numberOr(mem?.free),
      availableBytes: numberOr(mem?.available),
      swapTotalBytes: numberOr(mem?.swaptotal),
      swapUsedBytes: numberOr(mem?.swapused),
      modules: memLayout.map((m) => ({
        sizeBytes: numberOr(m.size),
        bank: textOr(m.bank),
        type: textOr(m.type),
        formFactor: textOr(m.formFactor),
        clockMHz: numberOrNull(m.clockSpeed),
        manufacturer: resolveMemoryVendor(m.manufacturer, m.partNum),
        partNumber: textOr(m.partNum),
        serialNumber: textOr(m.serialNum),
        ecc: m.ecc ?? null,
        voltageMv: numberOrNull(m.voltageConfigured)
      }))
    },
    gpus: localGpus.map((g) => ({
      vendor: textOr(g.vendor),
      model: textOr(g.model),
      vendorId: g.vendorId ?? null,
      deviceId: g.deviceId ?? null,
      bus: textOr(g.bus),
      busAddress: g.busAddress ?? null,
      vramBytes: g.vram == null ? null : g.vram * 1024 ** 2,
      vramDynamic: g.vramDynamic,
      driver: textOr(g.driverVersion),
      status: 'Detected',
      utilizationGpu: numberOrNull(g.utilizationGpu),
      utilizationMemory: numberOrNull(g.utilizationMemory),
      temperatureC: numberOrNull(g.temperatureGpu),
      powerDrawW: numberOrNull(g.powerDraw),
      note: null
    })),
    disks: disks.map((d) => ({
      device: textOr(d.device),
      model: textOr(d.name),
      vendor: textOr(d.vendor),
      type: textOr(d.type),
      sizeBytes: numberOr(d.size),
      interfaceType: textOr(d.interfaceType),
      firmware: textOr(d.firmwareRevision),
      serialNumber: textOr(d.serialNum),
      temperatureC: numberOrNull(d.temperature),
      smartStatus: textOr(d.smartStatus)
    })),
    networks: networks.filter((n) => !n.internal).map((n) => ({
      name: textOr(n.iface),
      type: textOr(n.type),
      speedMbps: numberOrNull(n.speed),
      mac: textOr(n.mac),
      ip4: textOr(n.ip4),
      state: textOr(n.operstate),
      duplex: textOr(n.duplex),
      virtual: n.virtual
    })),
    diagnostics: {
      runtime: process.platform,
      gpuSource: 'systeminformation',
      gpuStatus: localGpus.length > 0 ? 'GPU detected' : 'GPU not visible to this runtime'
    },
    motherboard: {
      manufacturer: textOr(baseboard?.manufacturer),
      model: textOr(baseboard?.model),
      version: textOr(baseboard?.version),
      chipset: resolveChipset(baseboard?.model)
    },
    bios: {
      vendor: textOr(bios?.vendor),
      version: textOr(bios?.version),
      releaseDate: normalizeBiosDate(bios?.releaseDate ?? null)
    },
    os: {
      platform: process.platform,
      release: textOr(os?.release),
      hostname: textOr(os?.hostname),
      build: textOr(os?.build),
      arch: textOr(os?.arch),
      distro: textOr(os?.distro)
    }
  }
}

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch {
    return fallback
  }
}

function textOr(value: unknown): string {
  const text = value == null ? '' : String(value).trim()
  return text || '—'
}

function resolveDiskVendor(manufacturer: string | null, model: string | null, caption: string | null, friendlyName: string | null = null): string {
  const rawManufacturer = textOr(manufacturer)
  const identity = `${model ?? ''} ${caption ?? ''} ${friendlyName ?? ''} ${manufacturer ?? ''}`.toUpperCase()
  const generic = new Set(['—', 'ATA', 'SCSI', 'NVME', 'STANDARD DISK DRIVES', 'MICROSOFT', 'GENERIC'])
  const matches: [RegExp, string][] = [
    [/\b(WD|WDC|WESTERN DIGITAL)\b|\bWD\s+(GREEN|BLUE|BLACK|RED|PURPLE|GOLD)\b/, 'Western Digital'],
    [/\b(CRUCIAL|CT\d+MX|MX500|BX500|P[1-5]\d+)/, 'Crucial'],
    [/\b(SAMSUNG|MZ[-_])/, 'Samsung'],
    [/\b(SEAGATE|ST\d{3,})/, 'Seagate'],
    [/\b(KINGSTON|SA\d{2,})/, 'Kingston'],
    [/\b(TOSHIBA|KIOXIA)/, 'Kioxia / Toshiba'],
    [/\b(INTEL)/, 'Intel'],
    [/\b(MICRON)/, 'Micron'],
    [/\b(SK\s*HYNIX|HYNIX)/, 'SK hynix'],
    [/\b(SANDISK)/, 'SanDisk'],
    [/\b(ADATA)/, 'ADATA'],
    [/\b(CORSAIR)/, 'Corsair'],
    [/\b(SILICON\s+POWER)/, 'Silicon Power'],
    [/\b(TEAMGROUP|TEAM\s+T-FORCE)/, 'TeamGroup']
  ]
  const cleanedManufacturer = rawManufacturer.toUpperCase().replace(/[()]/g, '').trim()
  return matches.find(([pattern]) => pattern.test(identity))?.[1]
    ?? (generic.has(cleanedManufacturer) ? '—' : rawManufacturer)
}

function mergePhysicalDisks(wmiDisks: WindowsHostHardware['disks'], physical: WindowsHostHardware['physical']): SystemInfo['disks'] {
  const bySerial = new Map<string, WindowsHostHardware['physical'][number]>()
  for (const p of physical) {
    const serial = (p.SerialNumber ?? '').trim().toLowerCase()
    if (serial) bySerial.set(serial, p)
  }
  return wmiDisks.map((d) => {
    const serial = (d.SerialNumber ?? '').trim().toLowerCase()
    const p = serial ? bySerial.get(serial) : undefined
    const model = textOr(d.Model) !== '—' ? textOr(d.Model) : p?.FriendlyName ? textOr(p.FriendlyName) : textOr(d.Caption)
    return {
      device: textOr(d.DeviceID),
      model,
      vendor: resolveDiskVendor(d.Manufacturer, d.Model, d.Caption, p?.FriendlyName ?? null),
      type: p?.MediaType ? textOr(p.MediaType) : textOr(d.MediaType),
      sizeBytes: numberOr(p?.Size ?? d.Size),
      interfaceType: p?.BusType ? textOr(p.BusType) : textOr(d.InterfaceType),
      firmware: textOr(d.FirmwareRevision),
      serialNumber: textOr(d.SerialNumber),
      temperatureC: null,
      smartStatus: textOr(d.Status)
    }
  })
}

function resolveMemoryVendor(manufacturer: string | null | undefined, partNumber: string | null | undefined): string {
  const rawManufacturer = textOr(manufacturer)
  const part = (partNumber ?? '').toUpperCase()
  if (rawManufacturer !== '—' && !/unknown|unidentified|generic|standard/i.test(rawManufacturer)) return rawManufacturer
  const matches: [RegExp, string][] = [
    [/^(CMK|CMW|CMT|CML|CMH|CMD|CMU|CMR|CMX)/, 'Corsair'],
    [/^(KVR|KHX|KF|KD|HX)/, 'Kingston'],
    [/^(M378|M471|M393|M491)/, 'Samsung'],
    [/^(HMA|HMT|HMC|HYS)/, 'SK hynix'],
    [/^(CT|BL|BLS)/, 'Crucial'],
    [/^(F4|F5|F3)/, 'G.Skill'],
    [/^(TEAM|TPX|TLS)/, 'TeamGroup'],
    [/^(AD5|AX5)/, 'ADATA'],
    [/^(MT40|MT60|MT18)/, 'Micron'],
    [/^(MD4|MD8)/, 'PNY'],
    [/^(PSD|PLD|PVS)/, 'Patriot'],
    [/^(TS1|TS5|TS8)/, 'Transcend']
  ]
  return matches.find(([pattern]) => pattern.test(part))?.[1] ?? (rawManufacturer === '—' ? 'Unknown' : rawManufacturer)
}

export function resolveCpuReference(brand: string): { codename: string; tdpW: number | null } {
  const u = brand.toUpperCase()
  const table: [RegExp, string, number | null][] = [
    [/(9950X3D)/, 'Granite Ridge', 170],
    [/(9900X3D|9800X3D)/, 'Granite Ridge', 120],
    [/(9950X)/, 'Granite Ridge', 170],
    [/(9900X)/, 'Granite Ridge', 120],
    [/(9700X|9600X|9600)/, 'Granite Ridge', 65],
    [/(7900X3D|7800X3D|7950X3D)/, 'Raphael', 120],
    [/(7900X|7950X)/, 'Raphael', 170],
    [/(7700X|7600X)/, 'Raphael', 105],
    [/(7700|7600|7500F|7900)/, 'Raphael', 65],
    [/(8700G|8600G|8500G|8400F)/, 'Phoenix', 65],
    [/(5800X3D|5500X3D)/, 'Vermeer', 105],
    [/(5600X3D)/, 'Vermeer', 65],
    [/(5950X|5900X|5800X)/, 'Vermeer', 105],
    [/(5700X|5600X|5600|5500)/, 'Vermeer', 65],
    [/(5700G|5600G|5600GT|5500GT)/, 'Cezanne', 65],
    [/(4750G|4650G|4600G|4500)/, 'Renoir', 65],
    [/(3950X|3900X|3800X)/, 'Matisse', 105],
    [/(3700X)/, 'Matisse', 65],
    [/(3600X)/, 'Matisse', 95],
    [/(3600|3500|3300X|3100)/, 'Matisse', 65],
    [/(I9-14900KS|I9-14900K|I9-13900K|I9-13900KS)/, 'Raptor Lake', 125],
    [/(I7-14700K|I5-14600K|I5-13600K|I7-13700K)/, 'Raptor Lake', 125],
    [/(I9-12900K|I7-12700K|I5-12600K)/, 'Alder Lake', 125],
    [/(I3-14100|I5-14400|I5-14500)/, 'Raptor Lake', 65],
    [/(ULTRA\s+9|ULTRA\s+7|ULTRA\s+5)/, 'Arrow Lake', 65]
  ]
  const hit = table.find(([pattern]) => pattern.test(u))
  return hit ? { codename: hit[1], tdpW: hit[2] } : { codename: '—', tdpW: null }
}

function resolveChipset(model: string | null | undefined): string {
  const u = (model ?? '').toUpperCase()
  const table: [RegExp, string][] = [
    [/(B450)/, 'AMD B450'],
    [/(X470)/, 'AMD X470'],
    [/(B550)/, 'AMD B550'],
    [/(X570)/, 'AMD X570'],
    [/(A520)/, 'AMD A520'],
    [/(B650)/, 'AMD B650'],
    [/(X670)/, 'AMD X670'],
    [/(A620)/, 'AMD A620'],
    [/(B850)/, 'AMD B850'],
    [/(X870)/, 'AMD X870'],
    [/(B840)/, 'AMD B840'],
    [/(TRX50)/, 'AMD TRX50'],
    [/(Z890)/, 'Intel Z890'],
    [/(B860)/, 'Intel B860'],
    [/(H810)/, 'Intel H810'],
    [/(Z790)/, 'Intel Z790'],
    [/(B760)/, 'Intel B760'],
    [/(H610)/, 'Intel H610'],
    [/(Z690)/, 'Intel Z690'],
    [/(B660)/, 'Intel B660'],
    [/(H670)/, 'Intel H670'],
    [/(Z590)/, 'Intel Z590'],
    [/(B560)/, 'Intel B560'],
    [/(H510)/, 'Intel H510'],
    [/(Z490)/, 'Intel Z490'],
    [/(B460)/, 'Intel B460']
  ]
  return table.find(([pattern]) => pattern.test(u))?.[1] ?? '—'
}

function parseWmiDate(value: string | null): string {
  if (!value) return '—'
  const match = value.match(/\/Date\((\d+)\)\//)
  if (match) {
    const ms = Number(match[1])
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString().slice(0, 10)
  }
  return normalizeBiosDate(value)
}

function normalizeBiosDate(value: string | null): string {
  if (!value) return '—'
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const parts = value.split('/')
  if (parts.length === 3 && parts[2].length === 4) return `${parts[2]}-${parts[1]}-${parts[0]}`
  return value
}

function numberOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function memoryType(value: number | null | undefined): string {
  return ({ 20: 'DDR', 21: 'DDR2', 22: 'DDR2 FB-DIMM', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5' } as Record<number, string>)[value ?? -1] ?? textOr(value)
}

function formFactor(value: number | null | undefined): string {
  return ({ 8: 'DIMM', 12: 'SODIMM' } as Record<number, string>)[value ?? -1] ?? textOr(value)
}

function networkState(value: number | null | undefined): string {
  return ({ 0: 'Disconnected', 2: 'Connected' } as Record<number, string>)[value ?? -1] ?? textOr(value)
}
