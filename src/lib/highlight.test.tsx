import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarked, renderTerm, stripMarks } from "./highlight";

describe("highlight", () => {
  it("turns **words** into highlights and drops stray asterisks", () => {
    const html = renderToStaticMarkup(<p>{renderMarked("Use a **queue** to absorb **bursts**. Half **done")}</p>);
    expect(html).toBe('<p>Use a <mark class="hl">queue</mark> to absorb <mark class="hl">bursts</mark>. Half done</p>');
  });
  it("strips markers for copying", () => {
    expect(stripMarks("a **b** c")).toBe("a b c");
  });
  it("bolds the term in a word list", () => {
    expect(renderToStaticMarkup(<p>{renderTerm("API: a way programs talk")}</p>)).toContain('<strong class="term">API</strong>');
  });
});
