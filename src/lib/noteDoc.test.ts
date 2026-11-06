// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { checklistOf, htmlToMarkdown, metaOf, previewOf, tagsOf, toHtml, withMeta } from "./noteDoc";

describe("note documents", () => {
  it("turns old plain-text notes into paragraphs and lists, and leaves rich notes alone", () => {
    expect(toHtml("Hello <b>\n- one\n- two")).toBe("<p>Hello &lt;b&gt;</p><ul><li><p>one</p></li><li><p>two</p></li></ul>");
    expect(toHtml("<p>Already rich</p>")).toBe("<p>Already rich</p>");
  });
  it("keeps folder, pin and deleted time in the meta and drops empty values", () => {
    const n = { id: "1", kind: "note" as const, title: "t", body: "" };
    const m = withMeta(withMeta(n, { folder: "Work", pinned: true }), { deleted_at: 5 });
    expect(metaOf(m)).toEqual({ folder: "Work", pinned: true, deleted_at: 5 });
    expect(metaOf(withMeta(m, { folder: undefined, pinned: false, deleted_at: undefined }))).toEqual({ folder: undefined, pinned: false, deleted_at: undefined });
    expect(metaOf({ meta: "not json" })).toEqual({});
  });
  it("finds hash tags and counts checklist progress", () => {
    expect(tagsOf("Plan #Launch and #q4-goals, not C# or a#b")).toEqual(["launch", "q4-goals"]);
    expect(checklistOf('<li data-checked="true" data-type="taskItem"></li><li data-checked="false" data-type="taskItem"></li>')).toEqual({ done: 1, total: 2 });
    expect(previewOf("Title\nfirst line\nsecond", "Title")).toBe("first line second");
  });
  it("exports headings, emphasis, lists, checklists and tables to Markdown", () => {
    const html = '<h1>Big</h1><p>a <strong>bold</strong> and <em>it</em> <a href="https://x.y">link</a></p><ul><li><p>one</p></li></ul><ul data-type="taskList"><li data-checked="true"><p>done</p></li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const md = htmlToMarkdown("Doc", html);
    expect(md).toContain("# Big");
    expect(md).toContain("a **bold** and *it* [link](https://x.y)");
    expect(md).toContain("- one");
    expect(md).toContain("- [x] done");
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");
  });
});
