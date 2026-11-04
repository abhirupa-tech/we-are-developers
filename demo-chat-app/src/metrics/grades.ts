/**
 * Grades on three axes, S to D, from one tunable config. The overall grade is
 * the weakest of the measured axes. Interaction boundaries (200 / 500 ms)
 * mirror the common INP "good" and "poor" cut-offs; the smoothness and
 * freshness thresholds are this app's own.
 */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';
export type Axis = 'smoothness' | 'freshness' | 'responsiveness';

export const GRADE_THRESHOLDS: Record<Axis, { label: string; unit: string; limits: [number, number, number, number] }> = {
  // Upper bounds for S, A, B, C. Anything above the last is D.
  smoothness: { label: 'Smoothness', unit: '% frames dropped', limits: [1, 3, 8, 15] },
  freshness: { label: 'Freshness', unit: 'ms p95 time to paint', limits: [50, 100, 200, 400] },
  responsiveness: { label: 'Responsiveness', unit: 'ms worst interaction', limits: [100, 200, 350, 500] },
};

const ORDER: Grade[] = ['S', 'A', 'B', 'C', 'D'];

export function gradeValue(axis: Axis, value: number): Grade | null {
  if (!Number.isFinite(value)) return null;
  const limits = GRADE_THRESHOLDS[axis].limits;
  const i = limits.findIndex((limit) => value < limit);
  return ORDER[i === -1 ? 4 : i];
}

export type Grades = Record<Axis, Grade | null> & { overall: Grade | null };

export function gradeRun(m: { droppedPct: number; p95Latency: number; worstInteraction: number }): Grades {
  const g = {
    smoothness: gradeValue('smoothness', m.droppedPct),
    freshness: gradeValue('freshness', m.p95Latency),
    responsiveness: gradeValue('responsiveness', m.worstInteraction),
  };
  const measured = Object.values(g).filter((x): x is Grade => x !== null);
  const overall = measured.length
    ? measured.reduce((worst, x) => (ORDER.indexOf(x) > ORDER.indexOf(worst) ? x : worst))
    : null;
  return { ...g, overall };
}
