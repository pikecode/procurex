export type SettlementCycle = 'WEEKLY' | 'HALF_MONTHLY' | 'MONTHLY' | 'IMMEDIATE';

export interface SettlementPeriod {
  cycle: SettlementCycle;
  startDate: string;
  endDate: string;
}

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export function settlementPeriod(cycle: SettlementCycle, occurredAt: Date): SettlementPeriod {
  const date = toShanghaiDateParts(occurredAt);

  if (cycle === 'IMMEDIATE') {
    return { cycle, startDate: date.isoDate, endDate: date.isoDate };
  }

  if (cycle === 'WEEKLY') {
    const start = addDays(date.utcDate, -(date.weekdayIso - 1));
    const end = addDays(start, 6);
    return { cycle, startDate: formatUtcDate(start), endDate: formatUtcDate(end) };
  }

  if (cycle === 'HALF_MONTHLY') {
    const endDay = date.day <= 15 ? 15 : daysInMonth(date.year, date.month);
    const startDay = date.day <= 15 ? 1 : 16;
    return {
      cycle,
      startDate: formatDateParts(date.year, date.month, startDay),
      endDate: formatDateParts(date.year, date.month, endDay),
    };
  }

  return {
    cycle,
    startDate: formatDateParts(date.year, date.month, 1),
    endDate: formatDateParts(date.year, date.month, daysInMonth(date.year, date.month)),
  };
}

function toShanghaiDateParts(value: Date): {
  year: number;
  month: number;
  day: number;
  weekdayIso: number;
  isoDate: string;
  utcDate: Date;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(value);

  const get = (type: string): string => {
    const part = parts.find((item) => item.type === type);
    if (!part) {
      throw new Error(`Missing ${type} in formatted date`);
    }
    return part.value;
  };

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const isoDate = formatDateParts(year, month, day);
  const weekdayIso = weekdayToIso(get('weekday'));

  return {
    year,
    month,
    day,
    weekdayIso,
    isoDate,
    utcDate: new Date(Date.UTC(year, month - 1, day)),
  };
}

function weekdayToIso(weekday: string): number {
  const lookup: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const result = lookup[weekday];
  if (!result) {
    throw new Error(`Unsupported weekday ${weekday}`);
  }
  return result;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatUtcDate(value: Date): string {
  return formatDateParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
