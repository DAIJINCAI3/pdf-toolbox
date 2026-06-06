"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import FileUploader from "@/components/FileUploader";
import { renderPage, getTotalPages, saveEditedPDF }
  from "@/lib/pdf-editor";
import { downloadPDF } from "@/lib/merge-pdf";

/* ================================================================ */

const SCALE = 1.5;

type Tool = "highlighter" | "pen" | "text" | "eraser";

const HL_COLORS = ["#fde047", "#86efac", "#93c5fd", "#fca5a5", "#d8b4fe"];
const PEN_COLORS = ["#1e293b", "#ef4444", "#2563eb", "#16a34a", "#ea580c"];
const PEN_SIZES = [2, 4, 6, 10];

interface Stroke {
  id: string; pageNum: number;
  points: { x: number; y: number }[];
  color: string; size: number; tool: "highlighter" | "pen";
}

interface TextNote {
  id: string; pageNum: number;
  text: string; x: number; y: number;
  color: string; size: number;
}

/* ================================================================
   主组件
   ================================================================ */

export default function EditPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const bgRef = useRef<ImageData | null>(null);
  const drawReqRef = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // 工具
  const [tool, setTool] = useState<Tool>("highlighter");
  const [hlColor, setHlColor] = useState(HL_COLORS[0]);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(4);

  // 标注
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [notes, setNotes] = useState<TextNote[]>([]);

  // 撤销栈
  const [undoStack, setUndoStack] = useState<{ s: Stroke[]; n: TextNote[] }[]>([]);

  // 文字弹层
  const [noteInput, setNoteInput] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState("");

  // 绘制状态（用 ref，不触发渲染）
  const drawingRef = useRef(false);
  const curPointsRef = useRef<{ x: number; y: number }[]>([]);
  const drawingColorRef = useRef("");
  const drawingSizeRef = useRef(4);
  const drawingToolRef = useRef<"highlighter" | "pen">("highlighter");

  const idRef = useRef(0);
  const nid = () => `a${++idRef.current}`;

  /* ================================================================
     渲染 + 绘制
     ================================================================ */

  const loadPage = useCallback(async (buf: ArrayBuffer, pg: number) => {
    const cv = canvasRef.current; if (!cv) return;
    setLoading(true);
    try {
      const result = await renderPage(buf, pg, cv, SCALE);
      const ctx = cv.getContext("2d")!;
      bgRef.current = ctx.getImageData(0, 0, cv.width, cv.height);
      requestPaint();
    } catch (e) { setMsg(String(e)); }
    finally { setLoading(false); }
  }, []);

  function requestPaint() {
    cancelAnimationFrame(drawReqRef.current);
    drawReqRef.current = requestAnimationFrame(paint);
  }

  function paint() {
    const cv = canvasRef.current, bg = bgRef.current;
    if (!cv || !bg) return;
    const ctx = cv.getContext("2d")!;
    ctx.putImageData(bg, 0, 0);

    // 已保存的标记
    for (const s of strokes) {
      if (s.pageNum !== page) continue;
      drawStroke(ctx, s);
    }

    // 文字便签
    for (const n of notes) {
      if (n.pageNum !== page) continue;
      ctx.font = `bold ${n.size}px "Microsoft YaHei", sans-serif`;
      ctx.shadowColor = "rgba(255,255,255,0.9)"; ctx.shadowBlur = 3;
      ctx.fillStyle = n.color; ctx.fillText(n.text, n.x, n.y);
    }

    // 正在绘制的笔触
    if (drawingRef.current && curPointsRef.current.length >= 2) {
      drawStroke(ctx, {
        id: "", pageNum: page,
        points: curPointsRef.current,
        color: drawingColorRef.current,
        size: drawingSizeRef.current,
        tool: drawingToolRef.current,
      });
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
    ctx.save();
    if (s.tool === "highlighter") {
      // 直接用宽线条 + 透明度，不做 path 计算（性能好且效果自然）
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size * 4;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.3;
    } else {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.9;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 标注变化 → 重绘（仅在 strokes/notes 变化时，不是鼠标移动时）
  useEffect(() => { requestPaint(); }, [strokes, notes, page]);

  /* ================================================================
     文件 + 翻页
     ================================================================ */

  const onFile = async (files: File[]) => {
    if (!files.length) return;
    const f = files[0]; setFile(f);
    setStrokes([]); setNotes([]); setUndoStack([]);
    setPage(1); setMsg("");
    const buf = await f.arrayBuffer(); bufferRef.current = buf.slice(0);
    try { setTotal(await getTotalPages(buf)); await loadPage(bufferRef.current, 1); }
    catch (e) { setMsg(String(e)); }
  };

  const go = (p: number) => {
    if (p < 1 || p > total || !bufferRef.current) return;
    setPage(p); loadPage(bufferRef.current, p);
  };

  /* ================================================================
     鼠标事件 — 极简模式切换
     ================================================================ */

  const evPos = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const cv = canvasRef.current!;
    return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
  };

  const pushUndo = () => setUndoStack(p => [...p.slice(-99), { s: [...strokes], n: [...notes] }]);

  // ---- 橡皮擦 ----
  const eraseAt = (p: { x: number; y: number }) => {
    const margin = 15;
    const hitStroke = [...strokes].reverse().find(s =>
      s.pageNum === page && s.points.some(pt => Math.abs(pt.x - p.x) < margin && Math.abs(pt.y - p.y) < margin)
    );
    if (hitStroke) { pushUndo(); setStrokes(s => s.filter(x => x.id !== hitStroke.id)); return; }
    const hitNote = [...notes].reverse().find(n =>
      n.pageNum === page && Math.abs(n.x - p.x) < 50 && Math.abs(n.y - p.y) < 20
    );
    if (hitNote) { pushUndo(); setNotes(n => n.filter(x => x.id !== hitNote.id)); }
  };

  const md = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const p = evPos(e);

    if (tool === "eraser") { eraseAt(p); return; }

    if (tool === "text") { setNoteInput(p); setDraft(""); return; }

    // 画笔 / 高亮 — 开始绘制
    pushUndo();
    drawingRef.current = true;
    curPointsRef.current = [p];
    drawingColorRef.current = tool === "highlighter" ? hlColor : penColor;
    drawingSizeRef.current = tool === "highlighter" ? 3 : penSize;
    drawingToolRef.current = tool === "highlighter" ? "highlighter" : "pen";
    requestPaint();
  };

  const mm = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!drawingRef.current) return;
    const p = evPos(e);
    curPointsRef.current.push(p);
    requestPaint(); // 只要 requestPaint，不做 setState
  };

  const mu = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!drawingRef.current) return;
    drawingRef.current = false;

    const pts = [...curPointsRef.current];
    if (pts.length >= 2) {
      setStrokes(s => [...s, {
        id: nid(), pageNum: page, points: pts,
        color: drawingColorRef.current,
        size: drawingSizeRef.current,
        tool: drawingToolRef.current,
      }]);
    }
    curPointsRef.current = [];
    requestPaint();
  };

  const addNote = () => {
    if (!noteInput || !draft.trim()) { setNoteInput(null); return; }
    pushUndo();
    setNotes(n => [...n, { id: nid(), pageNum: page, text: draft.trim(), x: noteInput.x, y: noteInput.y, color: penColor, size: 18 }]);
    setNoteInput(null); setDraft("");
  };

  const undo = () => {
    const last = undoStack[undoStack.length - 1]; if (!last) return;
    setStrokes(last.s); setNotes(last.n); setUndoStack(s => s.slice(0, -1));
  };

  const deleteOne = (kind: "s" | "n", id: string) => {
    pushUndo(); if (kind === "s") setStrokes(s => s.filter(x => x.id !== id));
    else setNotes(n => n.filter(x => x.id !== id));
  };

  const clearAll = () => { if (!strokes.length && !notes.length) return; pushUndo(); setStrokes([]); setNotes([]); };

  const save = async () => {
    if (!bufferRef.current || !file) return;
    setLoading(true);
    try {
      // 把 strokes 转成 pdf-editor 格式保存
      const marks = strokes.filter(s => s.tool === "highlighter").map(s => {
        const minX = Math.min(...s.points.map(p => p.x)), maxX = Math.max(...s.points.map(p => p.x));
        const minY = Math.min(...s.points.map(p => p.y)), maxY = Math.max(...s.points.map(p => p.y));
        return { id: s.id, pageNum: s.pageNum, type: "highlight" as const, rects: [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }], color: s.color };
      });
      const penStrokes = strokes.filter(s => s.tool === "pen").map(s => ({ id: s.id, pageNum: s.pageNum, points: s.points, color: s.color, width: s.size }));
      const textAnnos = notes.map(n => ({ id: n.id, pageNum: n.pageNum, text: n.text, x: n.x, y: n.y, fontSize: n.size, color: n.color }));
      const d = await saveEditedPDF(bufferRef.current, textAnnos, marks, penStrokes, SCALE);
      downloadPDF(d, file.name.replace(/\.pdf$/i, "") + "_标注版.pdf");
      setMsg("✅ 已保存！");
    } catch (e) { setMsg("保存失败：" + String(e)); }
    finally { setLoading(false); }
  };

  const curS = strokes.filter(s => s.pageNum === page);
  const curN = notes.filter(n => n.pageNum === page);
  const totalAnno = strokes.length + notes.length;

  /* ================================================================
     UI
     ================================================================ */

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">✏️ PDF 标注</h1>
      <p className="mb-5 text-sm text-gray-400">
        像用荧光笔和钢笔在纸上写字一样，直接在 PDF 上标注。所有处理在浏览器本地完成。
      </p>

      {!file ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-16 text-center">
          <div className="mb-4 text-5xl">📄</div>
          <p className="mb-2 text-lg font-medium text-gray-700">拖拽 PDF 文件到此处</p>
          <p className="mb-4 text-sm text-gray-400">或点击选择文件</p>
          <FileUploader
            accept={{ "application/pdf": [".pdf"] }}
            multiple={false}
            onFilesSelected={onFile}
            placeholder="选择 PDF"
            subPlaceholder=""
          />
        </div>
      ) : (
        <>
          {/* 现代化工具栏 */}
          <div className="mb-4 flex items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
            {/* 工具按钮 */}
            {([
              { id: "highlighter", icon: "🖍️", label: "高亮笔" },
              { id: "pen", icon: "✏️", label: "钢笔" },
              { id: "text", icon: "💬", label: "文字" },
              { id: "eraser", icon: "🧹", label: "橡皮" },
            ] as const).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                className={`flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                  tool === t.id
                    ? "bg-gray-900 text-white shadow"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t.icon} <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}

            <div className="mx-1 h-6 w-px bg-gray-200" />

            {/* 颜色选择 */}
            {tool === "highlighter" && HL_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setHlColor(c)} className={`h-7 w-7 rounded-full border-2 transition ${hlColor === c ? "border-gray-800 scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} title={`高亮色 ${c}`} />
            ))}
            {tool === "pen" && PEN_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setPenColor(c)} className={`h-7 w-7 rounded-full border-2 transition ${penColor === c ? "border-gray-800 scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} title={`画笔色 ${c}`} />
            ))}

            {tool === "pen" && (
              <>
                <div className="mx-1 h-6 w-px bg-gray-200" />
                {PEN_SIZES.map(sz => (
                  <button key={sz} type="button" onClick={() => setPenSize(sz)}
                    className={`rounded-full transition ${penSize === sz ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    style={{ width: 28, height: 28 }} title={`${sz}px`}
                  >
                    <span style={{ fontSize: sz + 6, lineHeight: "28px" }}>●</span>
                  </button>
                ))}
              </>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <button type="button" onClick={undo} disabled={!undoStack.length} className="rounded-xl px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-25">↩ 撤销</button>
              <button type="button" onClick={save} disabled={loading || !totalAnno} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">💾 保存</button>
            </div>
          </div>

          {/* 状态信息 */}
          <div className="mb-3 flex items-center gap-4 text-xs text-gray-400">
            <span>{tool === "highlighter" ? "🖍️ 按住鼠标在 PDF 上画线 → 荧光笔效果" : tool === "pen" ? "✏️ 按住鼠标画线 → 钢笔笔迹" : tool === "text" ? "💬 点击 PDF 任意位置 → 添加文字便签" : "🧹 点击标注即可删除"}</span>
            {total > 1 && <span className="ml-auto">第 {page}/{total} 页</span>}
          </div>

          {msg && <div className="mb-2 rounded-xl bg-blue-50 px-3 py-1.5 text-xs text-blue-600">{msg}</div>}

          {/* 翻页按钮 */}
          {total > 1 && (
            <div className="mb-3 flex items-center justify-center gap-2">
              <button type="button" onClick={() => go(page - 1)} disabled={page <= 1} className="rounded-full border px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-25">← 上一页</button>
              <button type="button" onClick={() => go(page + 1)} disabled={page >= total} className="rounded-full border px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-25">下一页 →</button>
            </div>
          )}

          {/* Canvas 区域 */}
          <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" /></div>}
            <canvas ref={canvasRef} className="block max-w-full" />
            <div
              className="absolute inset-0"
              style={{ cursor: tool === "eraser" ? "pointer" : tool === "text" ? "cell" : "crosshair", touchAction: "none" }}
              onMouseDown={md} onMouseMove={mm} onMouseUp={mu}
              onMouseLeave={() => { if (drawingRef.current) { drawingRef.current = false; requestPaint(); } }}
            />

            {/* 文字输入浮层 */}
            {noteInput && (
              <div className="absolute z-20 rounded-xl border-2 border-blue-400 bg-white p-2 shadow-2xl" style={{ left: noteInput.x / SCALE, top: noteInput.y / SCALE }}>
                <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addNote(); if (e.key === "Escape") setNoteInput(null); }}
                  placeholder="输入文字后回车…" className="w-44 rounded-lg border-none px-2 py-1.5 text-sm outline-none" style={{ color: penColor }} />
                <div className="mt-1 flex justify-end gap-1">
                  <button type="button" onClick={() => setNoteInput(null)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-100">取消</button>
                  <button type="button" onClick={addNote} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">确定</button>
                </div>
              </div>
            )}
          </div>

          {/* 标注列表 */}
          {totalAnno > 0 && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">当前页标注 ({curS.length + curN.length})</h3>
                <button type="button" onClick={clearAll} className="text-xs text-red-400 hover:underline">清除全部</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {curS.map(s => (
                  <div key={s.id} className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.tool === "highlighter" ? "荧光笔" : "钢笔"}
                    <button type="button" onClick={() => deleteOne("s", s.id)} className="ml-1 text-gray-300 hover:text-red-500">×</button>
                  </div>
                ))}
                {curN.map(n => (
                  <div key={n.id} className="flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs">
                    💬 {n.text.slice(0, 15)}{n.text.length > 15 ? "…" : ""}
                    <button type="button" onClick={() => deleteOne("n", n.id)} className="ml-1 text-blue-300 hover:text-red-500">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
