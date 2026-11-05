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
