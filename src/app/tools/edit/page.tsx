"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import FileUploader from "@/components/FileUploader";
import {
  renderPage, getTotalPages, saveEditedPDF, findMarkRects,
  type TextAnnotation, type MarkAnnotation, type PenStroke, type TextItem,
} from "@/lib/pdf-editor";
import { downloadPDF } from "@/lib/merge-pdf";

/* ================================================================
   颜色预设
   ================================================================ */

const COLORS = [
  { hex: "#fde047", name: "黄" },
  { hex: "#86efac", name: "绿" },
  { hex: "#93c5fd", name: "蓝" },
  { hex: "#fca5a5", name: "红" },
  { hex: "#d8b4fe", name: "紫" },
  { hex: "#fdba74", name: "橙" },
];

const PEN_COLORS = [
  { hex: "#ef4444", name: "红" },
  { hex: "#1e293b", name: "黑" },
  { hex: "#2563eb", name: "蓝" },
  { hex: "#16a34a", name: "绿" },
];

/* ================================================================
   主组件
   ================================================================ */

export default function EditPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const textItemsRef = useRef<TextItem[]>([]);
  const bgRef = useRef<HTMLCanvasElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1.5);

  // 工具模式
  type Tool = "select" | "pen" | "text";
  const [tool, setTool] = useState<Tool>("select");

  // 颜色
  const [hlColor, setHlColor] = useState(COLORS[0].hex);
  const [penColor, setPenColor] = useState(PEN_COLORS[1].hex);
  const [penWidth, setPenWidth] = useState(3);
  const [textColor, setTextColor] = useState("#cc0000");
  const [textSize, setTextSize] = useState(16);

  // 标注数据
  const [marks, setMarks] = useState<MarkAnnotation[]>([]);
  const [texts, setTexts] = useState<TextAnnotation[]>([]);
  const [strokes, setStrokes] = useState<PenStroke[]>([]);
  const [undoStack, setUndoStack] = useState<{ marks: MarkAnnotation[]; texts: TextAnnotation[]; strokes: PenStroke[] }[]>([]);

  // 选区
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState({ x: 0, y: 0 });
  const [selEnd, setSelEnd] = useState({ x: 0, y: 0 });
  const [selRects, setSelRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);

  // 浮动菜单位置
  const [floatMenu, setFloatMenu] = useState<{ x: number; y: number } | null>(null);

  // 画笔
  const [drawing, setDrawing] = useState(false);
  const curStrokeRef = useRef<PenStroke | null>(null);

  // 文字输入
  const [addingText, setAddingText] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");

  const idRef = useRef(0);
  const nid = () => `a${++idRef.current}`;

  /* ================================================================
     页面渲染 + overlay
     ================================================================ */

  const renderCur = useCallback(async (buf: ArrayBuffer, pg: number) => {
    if (!canvasRef.current) return;
    setLoading(true);
    try {
      const r = await renderPage(buf, pg, canvasRef.current, scale);
      textItemsRef.current = r.textItems;
      if (!bgRef.current) bgRef.current = document.createElement("canvas");
      bgRef.current.width = canvasRef.current.width;
      bgRef.current.height = canvasRef.current.height;
      bgRef.current.getContext("2d")!.drawImage(canvasRef.current, 0, 0);
      drawAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "渲染失败");
    } finally { setLoading(false); }
  }, [scale]);

  function drawAll() {
    const c = canvasRef.current, b = bgRef.current;
    if (!c || !b) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(b, 0, 0);

    // marks
    for (const m of marks) {
      if (m.pageNum !== page) continue;
      for (const r of m.rects) {
        if (m.type === "highlight") { ctx.fillStyle = m.color; ctx.globalAlpha = 0.35; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1; }
        if (m.type === "underline") { ctx.strokeStyle = m.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h - 2); ctx.lineTo(r.x + r.w, r.y + r.h - 2); ctx.stroke(); }
        if (m.type === "strikethrough") { ctx.strokeStyle = m.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); ctx.stroke(); }
      }
    }

    // texts
    for (const a of texts) {
      if (a.pageNum !== page) continue;
      ctx.font = `bold ${a.fontSize}px "Microsoft YaHei", sans-serif`;
      ctx.shadowColor = "rgba(255,255,255,0.9)"; ctx.shadowBlur = 3;
      ctx.fillStyle = a.color; ctx.fillText(a.text, a.x, a.y);
    }

    // strokes
    for (const s of strokes) {
      if (s.pageNum !== page || s.points.length < 2) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // selection preview
    if (selecting && selRects.length) {
      for (const r of selRects) { ctx.fillStyle = hlColor; ctx.globalAlpha = 0.2; ctx.fillRect(r.x, r.y, r.w, r.h); }
      ctx.globalAlpha = 1;
    }

    // drawing preview
    if (drawing && curStrokeRef.current?.points.length) {
      const s = curStrokeRef.current;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  useEffect(() => { drawAll(); }, [marks, texts, strokes, page, selecting, selRects, drawing]);

  /* ================================================================
     文件 / 翻页
     ================================================================ */

  const loadFile = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const f = files[0]; setFile(f); setMarks([]); setTexts([]); setStrokes([]); setUndoStack([]); setPage(1); setError("");
    const buf = await f.arrayBuffer(); bufferRef.current = buf.slice(0);
    try { setTotal(await getTotalPages(buf)); await renderCur(bufferRef.current, 1); } catch (e) { setError(String(e)); }
  }, [renderCur]);

  const go = (p: number) => { if (p < 1 || p > total || !bufferRef.current) return; setPage(p); renderCur(bufferRef.current, p); };

  /* ================================================================
     交互
     ================================================================ */

  const pos = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvasRef.current!.width / r.width), y: (e.clientY - r.top) * (canvasRef.current!.height / r.height) };
  };

  const pushUndo = () => setUndoStack(p => [...p.slice(-19), { marks: [...marks], texts: [...texts], strokes: [...strokes] }]);
  const undo = () => {
    const s = undoStack[undoStack.length - 1]; if (!s) return;
    setMarks(s.marks); setTexts(s.texts); setStrokes(s.strokes); setUndoStack(p => p.slice(0, -1));
  };

  const md = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = pos(e);

    if (tool === "pen") {
      pushUndo();
      setDrawing(true);
      curStrokeRef.current = { id: nid(), pageNum: page, points: [p], color: penColor, width: penWidth };
      return;
    }

    if (tool === "text") {
      setAddingText(p); setDraftText(""); return;
    }

    // select mode — 开始选择
    setFloatMenu(null);
    setSelStart(p); setSelEnd(p); setSelRects([]); setSelecting(true);
  };

  const mm = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = pos(e);

    if (drawing && curStrokeRef.current) {
      curStrokeRef.current.points.push(p);
      drawAll(); // 实时画笔预览
      return;
    }

    if (selecting) {
      setSelEnd(p);
      const box = { x: Math.min(selStart.x, p.x), y: Math.min(selStart.y, p.y), w: Math.abs(p.x - selStart.x), h: Math.abs(p.y - selStart.y) };
      setSelEnd(p);
      if (box.w > 3 || box.h > 3) setSelRects(findMarkRects(box, textItemsRef.current));
    }
  };

  const mu = (e: React.MouseEvent) => {
    e.preventDefault();

    if (drawing && curStrokeRef.current) {
      setStrokes(p => [...p, { ...curStrokeRef.current!, points: [...curStrokeRef.current!.points] }]);
      setDrawing(false); curStrokeRef.current = null; return;
    }

    if (selecting) {
      setSelecting(false);
      if (selRects.length > 0) {
        const p = pos(e);
        // 浮动菜单位置：选区右下角
        const lastR = selRects[selRects.length - 1];
        setFloatMenu({ x: lastR.x + lastR.w + 8, y: lastR.y - 8 });
      } else {
        setFloatMenu(null);
      }
    }
  };

  /* ================================================================
     标注操作
     ================================================================ */

  const doMark = (type: MarkAnnotation["type"]) => {
    if (!selRects.length) return;
    pushUndo();
    setMarks(p => [...p, { id: nid(), pageNum: page, type, rects: [...selRects], color: hlColor }]);
    setFloatMenu(null); setSelRects([]);
  };

  const addText = () => {
    if (!addingText || !draftText.trim()) { setAddingText(null); return; }
    pushUndo();
    setTexts(p => [...p, { id: nid(), pageNum: page, text: draftText.trim(), x: addingText.x, y: addingText.y, fontSize: textSize, color: textColor }]);
    setAddingText(null); setDraftText("");
  };

  const deleteAnno = (type: "mark" | "text" | "stroke", id: string) => {
    pushUndo();
    if (type === "mark") setMarks(p => p.filter(m => m.id !== id));
    if (type === "text") setTexts(p => p.filter(t => t.id !== id));
    if (type === "stroke") setStrokes(p => p.filter(s => s.id !== id));
  };

  const save = async () => {
    if (!bufferRef.current || !file) return;
    setLoading(true);
    try {
      const d = await saveEditedPDF(bufferRef.current, texts, marks, strokes, scale);
      downloadPDF(d, file.name.replace(/\.pdf$/i, "") + "_标注版.pdf");
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const curM = marks.filter(m => m.pageNum === page);
  const curT = texts.filter(t => t.pageNum === page);
  const curS = strokes.filter(s => s.pageNum === page);
  const totalAnno = marks.length + texts.length + strokes.length;

  /* ================================================================
     UI
     ================================================================ */

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">✏️ PDF 标注</h1>
        <p className="mt-1 text-sm text-gray-500">选区弹出工具栏 · 自由画笔 · 便签批注</p>
      </div>

      {!file ? (
        <FileUploader accept={{ "application/pdf": [".pdf"] }} multiple={false} onFilesSelected={loadFile} placeholder="拖拽 PDF 或点击选择" subPlaceholder="选择需要标注的 PDF" />
      ) : (
        <div className="flex gap-4">
          {/* 编辑区 */}
          <div className="flex-1 min-w-0">
            {/* 工具栏 */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border bg-white p-2">
              {/* 工具切换 */}
              <button type="button" onClick={() => { setTool("select"); setSelRects([]); setFloatMenu(null); }} className={`rounded px-3 py-1.5 text-xs font-medium transition ${tool === "select" ? "bg-gray-800 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>📝 选区</button>
              <button type="button" onClick={() => { setTool("pen"); setSelRects([]); setFloatMenu(null); }} className={`rounded px-3 py-1.5 text-xs font-medium transition ${tool === "pen" ? "bg-gray-800 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>✒️ 画笔</button>
              <button type="button" onClick={() => { setTool("text"); setSelRects([]); setFloatMenu(null); }} className={`rounded px-3 py-1.5 text-xs font-medium transition ${tool === "text" ? "bg-gray-800 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>💬 文字</button>

              <span className="mx-1 h-5 w-px bg-gray-200" />

              {/* 画笔配置 */}
              {tool === "pen" && (
                <>
                  {PEN_COLORS.map(c => <button key={c.hex} type="button" title={c.name} onClick={() => setPenColor(c.hex)} className="h-6 w-6 rounded-full border-2" style={{ backgroundColor: c.hex, borderColor: penColor === c.hex ? "#1e293b" : "transparent" }} />)}
                  <select value={penWidth} onChange={e => setPenWidth(+e.target.value)} className="rounded border px-1.5 py-1 text-xs" title="粗细">{ [1,2,3,5,8].map(w => <option key={w} value={w}>{w}px</option>) }</select>
                </>
              )}

              {/* 选区颜色 */}
              {tool === "select" && (
                COLORS.map(c => <button key={c.hex} type="button" title={c.name} onClick={() => setHlColor(c.hex)} className="h-6 w-6 rounded border-2" style={{ backgroundColor: c.hex, borderColor: hlColor === c.hex ? "#1e293b" : "transparent" }} />)
              )}

              {/* 文字颜色+大小 */}
              {tool === "text" && (
                <>
                  {["#cc0000", "#2563eb", "#16a34a", "#1e293b"].map(h => <button key={h} type="button" onClick={() => setTextColor(h)} className="h-6 w-6 rounded-full border-2" style={{ backgroundColor: h, borderColor: textColor === h ? "#1e293b" : "transparent" }} />)}
                  <select value={textSize} onChange={e => setTextSize(+e.target.value)} className="rounded border px-1.5 py-1 text-xs" title="大小">{ [12,14,16,18,24,32].map(s => <option key={s} value={s}>{s}px</option>) }</select>
                </>
              )}

              <span className="mx-1 h-5 w-px bg-gray-200" />

              <button type="button" onClick={undo} disabled={undoStack.length === 0} className="rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30" title="撤销">↩ 撤销</button>
              <div className="flex-1" />
              <button type="button" onClick={save} disabled={loading || totalAnno === 0} className="rounded bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40">💾 保存下载</button>
            </div>

            {/* 提示 */}
            <div className="mb-2 rounded bg-gray-50 px-3 py-1 text-xs text-gray-400">
              {tool === "select" && "📝 在文字上按住拖拽 → 选中文字 → 弹出工具栏选择高亮/下划线/删除线"}
              {tool === "pen" && "✒️ 按住鼠标/触屏自由绘制 → 松手完成一笔"}
              {tool === "text" && "💬 点击 PDF 任意位置 → 输入文字 → Enter 确认"}
            </div>

            {error && <div className="mb-2 rounded bg-red-50 px-3 py-1 text-xs text-red-600">{error}</div>}

            {/* 翻页 */}
            {total > 1 && (
              <div className="mb-2 flex items-center justify-center gap-3 text-sm">
                <button type="button" onClick={() => go(page - 1)} disabled={page <= 1} className="rounded border px-2 py-1 disabled:opacity-30">←</button>
                <span className="text-gray-600 min-w-[60px] text-center">{page} / {total}</span>
                <button type="button" onClick={() => go(page + 1)} disabled={page >= total} className="rounded border px-2 py-1 disabled:opacity-30">→</button>
              </div>
            )}

            {/* Canvas */}
            <div className="relative inline-block rounded-lg border border-gray-300 bg-white shadow-sm overflow-hidden">
              {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><span className="text-sm text-gray-400">加载中…</span></div>}
              <canvas ref={canvasRef} className="block max-w-full" />
              <div className="absolute inset-0" style={{ cursor: tool === "pen" ? "crosshair" : tool === "text" ? "cell" : "text", touchAction: "none", userSelect: "none" }} onMouseDown={md} onMouseMove={mm} onMouseUp={mu} onMouseLeave={() => { if (!drawing) setSelecting(false); }} />

              {/* 浮动工具栏 — 选区后弹出 */}
              {floatMenu && selRects.length > 0 && (
                <div className="absolute z-30 flex items-center gap-0.5 rounded-lg border bg-white p-1 shadow-xl" style={{ left: floatMenu.x / scale, top: floatMenu.y / scale - 40 }}>
                  <button type="button" onClick={() => doMark("highlight")} className="rounded px-2 py-1 text-xs font-medium hover:bg-yellow-100" title="高亮">🖍️ 高亮</button>
                  <button type="button" onClick={() => doMark("underline")} className="rounded px-2 py-1 text-xs font-medium hover:bg-blue-100" title="下划线">T̲ 下划线</button>
                  <button type="button" onClick={() => doMark("strikethrough")} className="rounded px-2 py-1 text-xs font-medium hover:bg-red-100" title="删除线">T̶ 删除线</button>
                  <button type="button" onClick={() => setFloatMenu(null)} className="ml-1 rounded px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600">✕</button>
                </div>
              )}

              {/* 文字输入浮层 */}
              {addingText && (
                <div className="absolute z-30 flex items-center gap-1 rounded border-2 border-blue-400 bg-white p-1 shadow-lg" style={{ left: addingText.x / scale, top: addingText.y / scale }}>
                  <input autoFocus value={draftText} onChange={e => setDraftText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addText(); if (e.key === "Escape") setAddingText(null); }} placeholder="输入文字…" className="w-40 border-none px-2 py-1 text-sm outline-none" style={{ color: textColor }} />
                  <button type="button" onClick={addText} className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">✓</button>
                  <button type="button" onClick={() => setAddingText(null)} className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">✕</button>
                </div>
              )}
            </div>
          </div>

          {/* 右侧标注列表 */}
          <div className="w-52 flex-shrink-0">
            <div className="sticky top-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">标注列表 <span className="font-normal text-gray-400">({totalAnno})</span></h3>
                <button type="button" onClick={() => { if (totalAnno === 0) return; pushUndo(); setMarks([]); setTexts([]); setStrokes([]); }} className="text-xs text-red-400 hover:underline">清空</button>
              </div>
              <div className="max-h-[60vh] space-y-1 overflow-y-auto">
                {curM.map(m => <div key={m.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"><div className="h-2.5 w-2.5 rounded flex-shrink-0" style={{ backgroundColor: m.color }} /><span className="flex-1 truncate">{m.type === "highlight" ? "高亮" : m.type === "underline" ? "下划线" : "删除线"}</span><button type="button" onClick={() => deleteAnno("mark", m.id)} className="text-gray-300 hover:text-red-500">×</button></div>)}
                {curS.map(s => <div key={s.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"><div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} /><span className="flex-1 truncate">画笔</span><button type="button" onClick={() => deleteAnno("stroke", s.id)} className="text-gray-300 hover:text-red-500">×</button></div>)}
                {curT.map(t => <div key={t.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"><div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} /><span className="flex-1 truncate">{t.text}</span><button type="button" onClick={() => deleteAnno("text", t.id)} className="text-gray-300 hover:text-red-500">×</button></div>)}
                {totalAnno === 0 && <p className="py-6 text-center text-xs text-gray-300">暂无标注</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
