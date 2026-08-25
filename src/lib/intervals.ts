export interface Interval {
  start: Date;
  end: Date;
}

export function isEmpty(interval: Interval): boolean {
  return interval.end.getTime() <= interval.start.getTime();
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

export function contains(outer: Interval, inner: Interval): boolean {
  return (
    outer.start.getTime() <= inner.start.getTime() && outer.end.getTime() >= inner.end.getTime()
  );
}

function subtractOne(base: Interval, cut: Interval): Interval[] {
  if (!overlaps(base, cut)) {
    return [base];
  }

  const remaining: Interval[] = [];

  if (cut.start.getTime() > base.start.getTime()) {
    remaining.push({ start: base.start, end: cut.start });
  }
  if (cut.end.getTime() < base.end.getTime()) {
    remaining.push({ start: cut.end, end: base.end });
  }

  return remaining;
}

export function subtract(bases: Interval[], cuts: Interval[]): Interval[] {
  let remaining = bases.filter((interval) => !isEmpty(interval));

  for (const cut of cuts) {
    if (isEmpty(cut)) continue;

    remaining = remaining.flatMap((base) => subtractOne(base, cut));
  }

  return remaining
    .filter((interval) => !isEmpty(interval))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function slotsWithin(
  interval: Interval,
  durationMinutes: number,
  stepMinutes: number,
): Date[] {
  const durationMs = durationMinutes * 60_000;
  const stepMs = stepMinutes * 60_000;
  const slots: Date[] = [];

  for (
    let start = interval.start.getTime();
    start + durationMs <= interval.end.getTime();
    start += stepMs
  ) {
    slots.push(new Date(start));
  }

  return slots;
}

export function durationMinutes(interval: Interval): number {
  if (isEmpty(interval)) {
    return 0;
  }

  return Math.round((interval.end.getTime() - interval.start.getTime()) / 60_000);
}
