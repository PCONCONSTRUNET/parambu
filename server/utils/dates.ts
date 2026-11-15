const TZ = 'America/Fortaleza';

export function todayBR(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function currentMonthBR(): string {
  return todayBR().slice(0, 7);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsClamped(isoDate: string, monthsToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const targetMonthIndex = m - 1 + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  const dt = new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  return dt.toISOString().slice(0, 10);
}

export function clampDayInMonth(yearMonth: string, day: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const safeDay = Math.max(1, Math.min(day, lastDay));
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

export function monthStart(yearMonth: string): string {
  return `${yearMonth}-01`;
}

export function monthEnd(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
}

export function enumerateMonths(fromMonth: string, toMonth: string): string[] {
  const result: string[] = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [endY, endM] = toMonth.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    result.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
}
