/** Chart data with provenance: each number says where it came from. */
export type ChartType = "bar" | "line" | "pie";
export interface ChartPoint { label: string; value: number; quote: string; verified: boolean; edited: boolean }
export interface ChartSeries { name: string; points: ChartPoint[]; color?: string }
export interface ChartSpec { title: string; type: ChartType; unit: string; series: ChartSeries[]; illustrative: boolean }

export const PALETTE = ["#2563eb", "#6d28d9", "#0f7f82", "#b45309", "#be185d", "#2f855a"];

export const emptyChart = (): ChartSpec => ({ title: "New chart", type: "bar", unit: "", illustrative: false, series: [{ name: "Series 1", points: [{ label: "A", value: 0, quote: "", verified: false, edited: true }] }] });

/** One row per label with a column per series (the shape Recharts wants). */
export function toRows(spec: ChartSpec): Record<string, string | number>[] {
  const labels: string[] = [];
  for (const s of spec.series) for (const p of s.points) if (!labels.includes(p.label)) labels.push(p.label);
  return labels.map((label) => {
    const row: Record<string, string | number> = { label };
    for (const s of spec.series) {
      const p = s.points.find((x) => x.label === label);
      if (p) row[s.name] = p.value;
    }
    return row;
  });
}

/** Changing a number or a label marks the point as entered by the user: it is no longer "from the material". */
export function editPoint(spec: ChartSpec, si: number, pi: number, patch: Partial<Pick<ChartPoint, "label" | "value">>): ChartSpec {
  return {
    ...spec,
    series: spec.series.map((s, i) => (i !== si ? s : { ...s, points: s.points.map((p, j) => (j !== pi ? p : { ...p, ...patch, verified: false, edited: true, quote: "" })) })),
  };
}

export function stats(spec: ChartSpec) {
  const pts = spec.series.flatMap((s) => s.points);
  return { total: pts.length, verified: pts.filter((p) => p.verified && !p.edited).length, edited: pts.filter((p) => p.edited).length };
}

/** A chart is labelled illustrative unless at least one number is backed by the material or entered by the user. */
export const isIllustrative = (spec: ChartSpec) => spec.illustrative && stats(spec).edited === 0;

export function parseChart(body: string): ChartSpec | null {
  try {
    const v = JSON.parse(body) as ChartSpec;
    return Array.isArray(v.series) && typeof v.title === "string" ? v : null;
  } catch {
    return null;
  }
}
