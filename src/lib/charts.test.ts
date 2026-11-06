import { describe, expect, it } from "vitest";
import { editPoint, emptyChart, isIllustrative, stats, toRows, type ChartSpec } from "./charts";

const spec: ChartSpec = {
  title: "Revenue", type: "line", unit: "USD", illustrative: false,
  series: [
    { name: "2024", points: [{ label: "Mar", value: 5000, quote: "5,000 in March", verified: true, edited: false }, { label: "Apr", value: 7500, quote: "", verified: false, edited: false }] },
    { name: "2025", points: [{ label: "Apr", value: 8000, quote: "", verified: true, edited: false }] },
  ],
};

describe("charts", () => {
  it("builds one row per label across series", () => {
    expect(toRows(spec)).toEqual([{ label: "Mar", "2024": 5000 }, { label: "Apr", "2024": 7500, "2025": 8000 }]);
  });
  it("marks an edited number as entered by the user and drops its quote", () => {
    const e = editPoint(spec, 0, 0, { value: 5200 });
    expect(e.series[0].points[0]).toMatchObject({ value: 5200, verified: false, edited: true, quote: "" });
    expect(spec.series[0].points[0].value).toBe(5000); // original untouched
    expect(stats(e)).toEqual({ total: 3, verified: 1, edited: 1 });
  });
  it("labels a chart illustrative until a number is backed or entered", () => {
    expect(isIllustrative({ ...spec, illustrative: true })).toBe(true);
    expect(isIllustrative(editPoint({ ...spec, illustrative: true }, 0, 0, { value: 1 }))).toBe(false);
    expect(emptyChart().series[0].points[0].edited).toBe(true);
  });
});

import { parseTable, toCsv } from "./charts";
describe("pasted tables", () => {
  it("reads a spreadsheet paste with a header, keeps the numbers exactly and calls months a line chart", () => {
    const r = parseTable("Month\tRevenue\tCost\nJan\t$1,200\t800\nFeb\t$1,500\t900\nMar\t$1,900\t950");
    expect("spec" in r).toBe(true);
    if (!("spec" in r)) return;
    expect(r.spec.type).toBe("line");
    expect(r.spec.unit).toBe("$");
    expect(r.spec.series.map((s) => s.name)).toEqual(["Revenue", "Cost"]);
    expect(r.spec.series[0].points.map((p) => p.value)).toEqual([1200, 1500, 1900]);
    expect(r.spec.series[0].points.every((p) => p.edited && !p.verified)).toBe(true);
  });
  it("reads two plain columns without a header and rejects text with no numbers", () => {
    const r = parseTable("EU, 40%\nUS, 60%");
    expect("spec" in r && r.spec.series[0].points.length).toBe(2);
    expect("error" in parseTable("a,b\nc,d")).toBe(true);
    expect("error" in parseTable("just one line")).toBe(true);
  });
  it("exports the data as CSV with quoting", () => {
    const csv = toCsv({ title: "t", type: "bar", unit: "", illustrative: false, series: [{ name: "S, one", points: [{ label: "A", value: 1, quote: "", verified: false, edited: true }] }] });
    expect(csv).toBe('Label,"S, one"\nA,1');
  });
});
