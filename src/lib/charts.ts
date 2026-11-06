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

const num = (s: string): number | null => {
  const t = s.trim().replace(/^[$€£]/, "").replace(/%$/, "").replace(/(?<=\d),(?=\d{3}\b)/g, "").trim();
  return t !== "" && /^-?\d*\.?\d+$/.test(t) ? Number(t) : null;
};
const splitLine = (l: string, d: string) => l.split(d).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
const LOOKS_TIME = /^(\d{4}|q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|week|\d{1,2}[/-]\d{1,2})/i;

/** Reads a pasted table (from a spreadsheet, CSV or tab-separated text) into a chart. The numbers are exactly what was pasted. */
export function parseTable(text: string): { spec: ChartSpec } | { error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: "Paste at least a header row and one row of numbers." };
  const delim = ["\t", ";", ",", "|"].map((d) => ({ d, n: lines[0].split(d).length })).sort((a, b) => b.n - a.n)[0];
  if (delim.n < 2) return { error: "Separate the columns with tabs, commas or semicolons. Copying from a spreadsheet works." };
  const rows = lines.map((l) => splitLine(l, delim.d));
  const hasHeader = rows[0].slice(1).every((c) => num(c) === null);
  const head = hasHeader ? rows[0] : rows[0].map((_, i) => (i === 0 ? "Label" : `Series ${i}`));
  const body = hasHeader ? rows.slice(1) : rows;
  const cols = head.length;
  const series: ChartSeries[] = [];
  const units = new Set<string>();
  for (let c = 1; c < cols; c++) {
    const pts: ChartPoint[] = [];
    for (const r of body) {
      const raw = r[c] ?? "";
      const v = num(raw);
      if (v === null || !r[0]) continue;
      const u = /%$/.test(raw.trim()) ? "%" : /^[$€£]/.test(raw.trim()) ? raw.trim()[0] : "";
      if (u) units.add(u);
      pts.push({ label: r[0], value: v, quote: "", verified: false, edited: true });
    }
    if (pts.length) series.push({ name: head[c] || `Series ${c}`, points: pts.slice(0, 60) });
  }
  if (series.length === 0) return { error: "No numbers were found. Put the labels in the first column and the numbers in the columns after it." };
  const time = body.slice(0, 3).every((r) => LOOKS_TIME.test(r[0] ?? ""));
  return { spec: { title: hasHeader && head[0] ? `${series[0].name} by ${head[0].toLowerCase()}` : "Pasted data", type: time ? "line" : "bar", unit: units.size === 1 ? [...units][0] : "", series: series.slice(0, 6), illustrative: false } };
}

/** The chart's data as CSV, one row per label. */
export function toCsv(spec: ChartSpec): string {
  const q = (s: string | number) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const rows = toRows(spec);
  return [["Label", ...spec.series.map((s) => s.name)].map(q).join(","), ...rows.map((r) => [r.label, ...spec.series.map((s) => r[s.name] ?? "")].map(q).join(","))].join("\n");
}
