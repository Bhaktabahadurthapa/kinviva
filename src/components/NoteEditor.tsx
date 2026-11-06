import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";

const STYLES: [string, string][] = [["title", "Title"], ["heading", "Heading"], ["sub", "Subheading"], ["body", "Body"], ["mono", "Monospaced"], ["quote", "Block quote"]];
const MAX_IMAGE = 2_500_000;

function Btn({ label, on, onClick, children, disabled }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" className={`ne-b ${on ? "on" : ""}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
}

function currentStyle(ed: Editor): string {
  if (ed.isActive("heading", { level: 1 })) return "title";
  if (ed.isActive("heading", { level: 2 })) return "heading";
  if (ed.isActive("heading", { level: 3 })) return "sub";
  if (ed.isActive("codeBlock")) return "mono";
  if (ed.isActive("blockquote")) return "quote";
  return "body";
}

/** The writing area: styles, emphasis, lists, checklists, tables, links and pictures. Saves what you type through `onChange`. */
export function NoteEditor({ noteId, html, onChange, onError }: { noteId: string; html: string; onChange: (html: string) => void; onError: (m: string) => void }) {
  const [, force] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: "Start writing. Use the toolbar for styles, checklists, tables and pictures." }),
    ],
    content: html,
    editorProps: {
      attributes: { class: "ne-doc", "aria-label": "Note text", spellcheck: "true" },
      handlePaste: (_v, e) => {
        const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
        if (!f) return false;
        void addImage(f);
        return true;
      },
      handleDrop: (_v, e) => {
        const f = [...((e as DragEvent).dataTransfer?.files ?? [])].find((x) => x.type.startsWith("image/"));
        if (!f) return false;
        void addImage(f);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    onSelectionUpdate: () => force((n) => n + 1),
    onTransaction: () => force((n) => n + 1),
  }, [noteId]);

  useEffect(() => () => editor?.destroy(), [editor]);

  const addImage = async (f: File) => {
    if (f.size > MAX_IMAGE) return onError("That picture is larger than 2.5 MB. Choose a smaller one.");
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("Could not read the picture."));
      r.readAsDataURL(f);
    }).catch((e: Error) => (onError(e.message), ""));
    if (url) editor?.chain().focus().setImage({ src: url, alt: f.name }).run();
  };
  if (!editor) return null;

  const setStyle = (v: string) => {
    const c = editor.chain().focus();
    if (v === "title") c.setHeading({ level: 1 }).run();
    else if (v === "heading") c.setHeading({ level: 2 }).run();
    else if (v === "sub") c.setHeading({ level: 3 }).run();
    else if (v === "mono") c.setCodeBlock().run();
    else if (v === "quote") c.setBlockquote().run();
    else c.setParagraph().run();
  };
  const link = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address (leave empty to remove the link)", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) return void editor.chain().focus().unsetLink().run();
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) return onError("Links must start with https://, http:// or mailto:");
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  const inTable = editor.isActive("table");

  return (
    <div className="ne">
      <div className="ne-bar" role="toolbar" aria-label="Formatting">
        <select className="ne-style" aria-label="Text style" value={currentStyle(editor)} onChange={(e) => setStyle(e.target.value)}>
          {STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="ne-sep" />
        <Btn label="Bold (⌘B)" on={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
        <Btn label="Italic (⌘I)" on={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
        <Btn label="Underline (⌘U)" on={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
        <Btn label="Strikethrough" on={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
        <span className="ne-sep" />
        <Btn label="Checklist" on={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</Btn>
        <Btn label="Bulleted list" on={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</Btn>
        <Btn label="Numbered list" on={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</Btn>
        <Btn label="Indent" onClick={() => (editor.isActive("taskItem") ? editor.chain().focus().sinkListItem("taskItem") : editor.chain().focus().sinkListItem("listItem")).run()}>→</Btn>
        <Btn label="Outdent" onClick={() => (editor.isActive("taskItem") ? editor.chain().focus().liftListItem("taskItem") : editor.chain().focus().liftListItem("listItem")).run()}>←</Btn>
        <span className="ne-sep" />
        <Btn label="Table" on={inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Btn>
        <Btn label="Link" on={editor.isActive("link")} onClick={link}>Link</Btn>
        <Btn label="Add a picture" onClick={() => file.current?.click()}>▣</Btn>
        <Btn label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</Btn>
        <span className="ne-sep" />
        <Btn label="Undo (⌘Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
        <Btn label="Redo (⇧⌘Z)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
      </div>
      {inTable && (
        <div className="ne-bar ne-table" role="toolbar" aria-label="Table">
          <span className="ne-label">Table</span>
          <button className="ne-t" onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</button>
          <button className="ne-t" onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</button>
          <button className="ne-t" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
          <button className="ne-t" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
          <button className="ne-t danger" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button>
        </div>
      )}
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ""; }} />
      <EditorContent editor={editor} className="ne-scroll" />
    </div>
  );
}
