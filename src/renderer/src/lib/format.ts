// Shared formatting helpers. All numbers in the UI should pass through
// these so locale and unit conventions stay consistent.

export function fmtW(watts: number, digits = 1): string {
  if (!isFinite(watts) || watts < 0) return '—';
  if (watts >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
  return `${watts.toFixed(digits)} W`;
}

export function fmtKWh(kwh: number, digits = 2): string {
  if (!isFinite(kwh) || kwh < 0) return '—';
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${kwh.toFixed(digits)} kWh`;
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

export function fmtCO2(kg: number, digits = 1): string {
  if (!isFinite(kg) || kg < 0) return '—';
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  return `${kg.toFixed(digits)} kg`;
}

export function fmtPercent(x: number, digits = 0): string {
  if (!isFinite(x)) return '—';
  return `${x.toFixed(digits)}%`;
}

export function fmtDate(d: Date | string): string {
  const dd = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dd.getTime())) return '—';
  return dd.toLocaleString();
}

export function fmtTime(d: Date | string): string {
  const dd = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dd.getTime())) return '—';
  return dd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(hours: number): string {
  if (!isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}
