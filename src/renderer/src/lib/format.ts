// Shared formatting helpers. All numbers in the UI should pass through
// these so locale and unit conventions stay consistent.

export function fmtW(watts: number | null | undefined, digits = 1): string {
  if (watts == null || !isFinite(watts) || watts < 0) return '—';
  if (watts >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
  return `${watts.toFixed(digits)} W`;
}

export function fmtKWh(kwh: number, digits = 2): string {
  if (!isFinite(kwh) || kwh < 0) return '—';
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${kwh.toFixed(digits)} kWh`;
}

/** Energy with sub-kWh values shown in Wh so short windows don't read as ~0. */
export function fmtEnergy(kwh: number, digits = 2): string {
  if (!isFinite(kwh) || kwh < 0) return '—';
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  if (kwh >= 1) return `${kwh.toFixed(digits)} kWh`;
  return `${(kwh * 1000).toFixed(1)} Wh`;
}

export function fmtMoney(amount: number, currency: string, digits = 2): string {
  if (!isFinite(amount) || amount < 0) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

export function fmtBytes(value: number | null | undefined): string {
  if (value == null || !isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  // One decimal for small values so e.g. 1.5 KB doesn't read as "2 KB".
  const digits = scaled < 10 ? 1 : 0;
  return `${scaled.toFixed(digits)} ${units[exponent]}`;
}

export function fmtTime(d: Date | string): string {
  const dd = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dd.getTime())) return '—';
  return dd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(d: Date | string): string {
  const dd = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dd.getTime())) return '—';
  return dd.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function fmtDuration(hours: number): string {
  if (!isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}
