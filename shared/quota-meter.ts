export function quotaMeterAppearance(used: number | null | undefined, remaining = true) {
  const value = used == null || !Number.isFinite(used) ? null : Math.max(0, Math.min(100, used));
  const left = value === null ? null : 100 - value;
  const color = left === null ? "#8b949e" : left >= 50 ? "#6bb7a4" : left >= 30 ? "#d3aa64" : left >= 10 ? "#d99868" : "#df8580";
  return { amount: value === null ? null : remaining ? left : value, color };
}

/** Clockwise coordinates with zero at 12 o'clock. */
export function quotaRingPoint(index: number, count: number, size: number, stroke: number) {
  const angle = index / count * Math.PI * 2;
  const radius = (size - stroke) / 2;
  return { left: size / 2 + Math.sin(angle) * radius - stroke / 2, top: size / 2 - Math.cos(angle) * radius - stroke / 2 };
}
