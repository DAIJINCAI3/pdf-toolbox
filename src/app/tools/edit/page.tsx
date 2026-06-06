"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import FileUploader from "@/components/FileUploader";
import {
  renderPage, getTotalPages, saveEditedPDF, findMarkRects,
  type TextAnnotation, type MarkAnnotation, type PenStroke, type TextItem,
} from "@/lib/pdf-editor";
import { downloadPDF } from "@/lib/merge-pdf";

const COLORS = [
  { hex: "#fde047", name: "黄" }, { hex: "#86efac", name: "绿" },
  { hex: "#93c5fd", name: "蓝" }, { hex: "#fca5a5", name: "红" },
  { hex: "#d8b4fe", name: "紫" }, { hex: "#fdba74", name: "橙" },
];
const PEN_COLORS = [
  { hex: "#ef4444", name: "红" }, { hex: "#1e293b", name: "黑" },
  { hex: "#2563eb", name: "蓝" }, { hex: "#16a34a", name: "绿" },
];
const SCALE = 1.5;

export default function EditPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const itemsRef = useRef<TextItem[]>([]);
  const bgRef = useRef<ImageData | null>(null);
  const paintTimerRef = useRef<number>(0);

  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  type Tool = "select" | "pen" | "text";
  const [tool, setTool] = useState<Tool>("select");
  const [hlColor, setHlColor] = useState(COLORS[0].hex);
  const [penColor, setPenColor] = useState(PEN_COLORS[1].hex);
  const [penWidth, setPenWidth] = useState(3);
  const [textColor, setTextColor] = useState("#cc0000");
  const [textSize, setTextSize] = useState(16);

  const [marks, setMarks] = useState<MarkAnnotation[]>([]);
  const [texts, setTexts] = useState<TextAnnotation[]>([]);
  const [strokes, setStrokes] = useState<PenStroke[]>([]);
  const [history, setHistory] = useState<{ m: MarkAnnotation[]; t: TextAnnotation[]; s: PenStroke[] }[]>([]);

  // 选区浮动菜单（仅 UI 状态，不参与高频渲染）
  const [floatMenu, setFloatMenu] = useState<{ x: number; y: number } | null>(null);

  // 文字输入浮层
  const [addText, setAddText] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState("");

  const cid = useRef(0);
  const nid = () => `a${++cid.current}`;

  /* ================================================================
     渲染 + 绘制（RequestAnimationFrame 防抖）
     ================================================================ */

  const render = useCallback(async (buf: ArrayBuffer, pg: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    setLoading(true);
    try {
      const r = await renderPage(buf, pg, cv, SCALE);
      itemsRef.current = r.textItems;
      const ctx = cv.getContext("2d")!;
      bgRef.current = ctx.getImageData(0, 0, cv.width, cv.height);
      requestPaint();
    } catch (e) {
      setError(e instanceof Error ? e.message : "渲染失败");
    } finally {
      setLoading(false);
    }
  }, []);

  /** 触发绘制（防抖到下一帧） */
  function requestPaint() {
    cancelAnimationFrame(paintTimerRef.current);
    paintTimerRef.current = requestAnimationFrame(doPaint);
  }

  function doPaint() {
    const cv = canvasRef.current;
    const bg = bgRef.current;
    if (!cv || !bg) return;
    const ctx = cv.getContext("2d")!;

    // 恢复背景
    ctx.putImageData(bg, 0, 0);

    // marks
    for (const m of marks) {
      if (m.pageNum !== page) continue;
      for (const r of m.rects) {
        ctx.fillStyle = m.color;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
        if (m.type === "underline") {
          ctx.strokeStyle = m.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h - 2); ctx.lineTo(r.x + r.w, r.y + r.h - 2); ctx.stroke();
        }
        if (m.type === "strikethrough") {
          ctx.strokeStyle = m.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); ctx.stroke();
        }
      }
    }

    // texts
    for (const a of texts) {
      if (a.pageNum !== page) continue;
      ctx.font = `bold ${a.fontSize}px "Microsoft YaHei", sans-serif`;
      ctx.shadowColor = "rgba(255,255,255,0.85)";
      ctx.shadowBlur = 3;
      ctx.fillStyle = a.color;
      ctx.fillText(a.text, a.x, a.y);
    }

    // strokes
    for (const s of strokes) {
      if (s.pageNum !== page || s.points.length < 2) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 标注/页码变化 → 重绘
  useEffect(() => { requestPaint(); }, [marks, texts, strokes, page]);

  /* ================================================================
     文件 / 翻页
     ================================================================ */

  const loadFile = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const f = files[0];
    setFile(f); setMarks([]); setTexts([]); setStrokes([]);
    setHistory([]); setPage(1); setError("");
    const buf = await f.arrayBuffer();
    bufferRef.current = buf.slice(0);
    try {
      setTotal(await getTotalPages(buf));
      await render(bufferRef.current, 1);
    } catch (e) {
      setError(String(e));
    }
  }, [render]);

  const go = (p: number) => {
    if (p < 1 || p > total || !bufferRef.current) return;
    setPage(p);
    render(bufferRef.current, p);
  };

  /* ================================================================
     交互（核心：拖拽状态用 ref 不触发渲染）
     ================================================================ */

  const dragRef = useRef(false);
  const dsRef = useRef({ x: 0, y: 0 });
  const deRef = useRef({ x: 0, y: 0 });
  const selRef = useRef<{ x: number; y: number; w: number; h: number }[]>([]);
  const drawRef = useRef(false);
  const penRef = useRef<PenStroke | null>(null);

  const evp = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const cv = canvasRef.current;
    if (!cv) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
  };

  const pushH = () => setHistory(p => [...p.slice(-49), { m: [...marks], t: [...texts], s: [...strokes] }]);

  const md = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = evp(e);

    if (tool === "pen") {
      pushH();
      drawRef.current = true;
      penRef.current = { id: nid(), pageNum: page, points: [p], color: penColor, width: penWidth };
      return;
    }

    if (tool === "text") {
      setAddText(p);
      setDraft("");
      return;
    }

    // select mode
    setFloatMenu(null);
    dsRef.current = p;
    deRef.current = p;
    selRef.current = [];
    dragRef.current = true;
  };

  const mm = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = evp(e);

    if (drawRef.current && penRef.current) {
      penRef.current.points.push(p);
      requestPaint();
      return;
    }

    if (dragRef.current) {
      deRef.current = p;
      const box = {
        x: Math.min(dsRef.current.x, p.x),
        y: Math.min(dsRef.current.y, p.y),
        w: Math.abs(p.x - dsRef.current.x),
        h: Math.abs(p.y - dsRef.current.y),
      };
      if (box.w > 3 || box.h > 3) {
        selRef.current = findMarkRects(box, itemsRef.current);
      } else {
        selRef.current = [];
      }
      requestPaint();
    }
  };

  const mu = (e: React.MouseEvent) => {
    e.preventDefault();

    if (drawRef.current && penRef.current) {
      setStrokes(p => [...p, { ...penRef.current!, points: [...penRef.current!.points] }]);
      drawRef.current = false;
      penRef.current = null;
      requestPaint();
      return;
    }

    if (dragRef.current) {
      dragRef.current = false;
      if (selRef.current.length > 0) {
        const last = selRef.current[selRef.current.length - 1];
        setFloatMenu({ x: last.x + last.w + 8, y: last.y - 8 });
      }
    }
  };

  const doMark = (type: MarkAnnotation["type"]) => {
    if (!selRef.current.length) return;
    pushH();
    setMarks(p => [...p, { id: nid(), pageNum: page, type, rects: [...selRef.current], color: hlColor }]);
    setFloatMenu(null);
    selRef.current = [];
    requestPaint();
  };

  const confirmText = () => {
    if (!addText || !draft.trim()) {
      setAddText(null);
      return;
    }
    pushH();
    setTexts(p => [...p, { id: nid(), pageNum: page, text: draft.trim(), x: addText.x, y: addText.y, fontSize: textSize, color: textColor }]);
    setAddText(null);
    setDraft("");
  };

  const deleteOne = (kind: string, id: string) => {
    pushH();
    if (kind === "m") setMarks(p => p.filter(x => x.id !== id));
    if (kind === "t") setTexts(p => p.filter(x => x.id !== id));
    if (kind === "s") setStrokes(p => p.filter(x => x.id !== id));
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setMarks(last.m);
    setTexts(last.t);
    setStrokes(last.s);
    setHistory(p => p.slice(0, -1));
  };

  const save = async () => {
    if (!bufferRef.current || !file) return;
    setLoading(true);
    try {
      const d = await saveEditedPDF(bufferRef.current, texts, marks, strokes, SCALE);
      downloadPDF(d, file.name.replace(/\.pdf$/i, "") + "_标注版.pdf");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // DRAG PREVIEW — 需要 UI 响应，用 requestPaint 驱动
  useEffect(() => {
    let running = false;
    const loop = () => {
      if (!running) return;
      if (dragRef.current || drawRef.current) requestPaint();
      requestAnimationFrame(loop);
    };
    running = true;
    loop();
    return () => { running = false; };
  }, []);

  const curM = marks.filter(x => x.pageNum === page);
  const curT = texts.filter(x => x.pageNum === page);
  const curS = strokes.filter(x => x.pageNum === page);
  const annTotal = marks.length + texts.length + strokes.length;

  /* ================================================================
     UI
     ================================================================ */

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">✏️ PDF 标注</h1>
        <p className="mt-1 text-sm text-gray-500">拖拽选中弹出菜单 · 自由画笔 · 点击添加文字</p>
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={loadFile}
          placeholder="拖拽 PDF 或点击选择"
          subPlaceholder="上传需要标注的 PDF"
        />
      ) : (
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            {/* 工具栏 */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border bg-white p-2">
              <button type="button" onClick={() => { setTool("select"); setFloatMenu(null); }} className={`rounded px-3 py-1.5 text-xs font-medium ${tool === "select" ? "bg-gray-800 text-white" : "bg-gray-50"}`}>📝 选区</button>
              <button type="button" onClick={() => { setTool("pen"); setFloatMenu(null); }} className={`rounded px-3 py-1.5 text-xs font-medium ${tool === "pen" ? "bg-gray-800 text-white" : "bg-gray-50"}`}>✒️ 画笔</button>
              <button type="button" onClick={() => { setTool("text"); setFloatMenu(null); }} className={`rounded px-3 py-1.5 text-xs font-medium ${tool === "text" ? "bg-gray-800 text-white" : "bg-gray-50"}`}>💬 文字</button>
              <span className="mx-1 h-5 w-px bg-gray-200" />

              {tool === "pen" && (
                <>
                  {PEN_COLORS.map(c => <button key={c.hex} type="button" title={c.name} onClick={() => setPenColor(c.hex)} className="h-6 w-6 rounded-full border-2" style={{ backgroundColor: c.hex, borderColor: penColor === c.hex ? "#333" : "transparent" }} />)}
                  <select value={penWidth} onChange={e => setPenWidth(+e.target.value)} className="rounded border px-1 py-1 text-xs" title="粗细">
                    {[1,2,3,5,8].map(w => <option key={w} value={w}>{w}px</option>)}
                  </select>
                </>
              )}

              {tool === "select" && (
                COLORS.map(c => <button key={c.hex} type="button" title={c.name} onClick={() => setHlColor(c.hex)} className="h-6 w-6 rounded border-2" style={{ backgroundColor: c.hex, borderColor: hlColor === c.hex ? "#333" : "transparent" }} />)
              )}

              {tool === "text" && (
                <>
                  {["#cc0000","#2563eb","#16a34a","#1e293b"].map(h => <button key={h} type="button" onClick={() => setTextColor(h)} className="h-6 w-6 rounded-full border-2" style={{ backgroundColor: h, borderColor: textColor === h ? "#333" : "transparent" }} />)}
                  <select value={textSize} onChange={e => setTextSize(+e.target.value)} className="rounded border px-1 py-1 text-xs" title="大小">
                    {[12,14,16,18,24,32].map(s => <option key={s} value={s}>{s}px</option>)}
                  </select>
                </>
              )}

              <span className="mx-1 h-5 w-px bg-gray-200" />
              <button type="button" onClick={undo} disabled={!history.length} className="rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30">↩ 撤销</button>
              <div className="flex-1" />
              <button type="button" onClick={save} disabled={loading || !annTotal} className="rounded bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40">💾 保存</button>
            </div>

            {/* 提示 */}
            <div className="mb-2 rounded bg-gray-50 px-3 py-1 text-xs text-gray-400">
              {tool === "select" && "📝 拖拽选中文字 → 弹出工具栏选择高亮/下划线/删除线"}
              {tool === "pen" && "✒️ 按住画线 → 松手完成"}
              {tool === "text" && "💬 点击页面上任意位置 → 输入文字 → Enter 确认"}
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
              <div
                className="absolute inset-0"
                style={{ cursor: tool === "pen" ? "crosshair" : tool === "text" ? "cell" : "text", touchAction: "none", userSelect: "none" }}
                onMouseDown={md}
                onMouseMove={mm}
                onMouseUp={mu}
                onMouseLeave={() => { dragRef.current = false; requestPaint(); }}
              />

              {/* 浮动工具栏 */}
              {floatMenu && selRef.current.length > 0 && (
                <div
                  className="absolute z-30 flex items-center gap-0.5 rounded-lg border bg-white p-1 shadow-xl"
                  style={{ left: Math.min(Math.max(floatMenu.x / SCALE, 10), 500), top: Math.min(Math.max(floatMenu.y / SCALE - 40, 10), 600) }}
                >
                  <button type="button" onClick={() => doMark("highlight")} className="rounded px-2 py-1 text-xs font-medium hover:bg-yellow-100">🖍️ 高亮</button>
                  <button type="button" onClick={() => doMark("underline")} className="rounded px-2 py-1 text-xs font-medium hover:bg-blue-100">T̲ 下划线</button>
                  <button type="button" onClick={() => doMark("strikethrough")} className="rounded px-2 py-1 text-xs font-medium hover:bg-red-100">T̶ 删除线</button>
                  <button type="button" onClick={() => { setFloatMenu(null); selRef.current = []; }} className="ml-1 rounded px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600">✕</button>
                </div>
              )}

              {/* 文字输入浮层 */}
              {addText && (
                <div className="absolute z-30 flex items-center gap-1 rounded border-2 border-blue-400 bg-white p-1 shadow-lg" style={{ left: addText.x / SCALE, top: addText.y / SCALE }}>
                  <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirmText(); if (e.key === "Escape") setAddText(null); }} placeholder="输入文字" className="w-36 border-none px-2 py-1 text-sm outline-none" style={{ color: textColor }} />
                  <button type="button" onClick={confirmText} className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">✓</button>
                  <button type="button" onClick={() => setAddText(null)} className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">✕</button>
                </div>
              )}
            </div>
          </div>

          {/* 右侧标注列表 */}
          <div className="w-48 flex-shrink-0">
            <div className="sticky top-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">标注 ({annTotal})</h3>
                <button type="button" onClick={() => { if (!annTotal) return; pushH(); setMarks([]); setTexts([]); setStrokes([]); }} className="text-xs text-red-400 hover:underline">清空</button>
              </div>
              <div className="max-h-[60vh] space-y-1 overflow-y-auto">
                {curM.map(m => (
                  <div key={m.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
                    <div className="h-2 w-2 rounded flex-shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="flex-1 truncate">{m.type === "highlight" ? "高亮" : m.type === "underline" ? "下划线" : "删除线"}</span>
                    <button type="button" onClick={() => deleteOne("m", m.id)} className="text-gray-300 hover:text-red-500">×</button>
                  </div>
                ))}
                {curS.map(s => (
                  <div key={s.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
                    <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 truncate">画笔</span>
                    <button type="button" onClick={() => deleteOne("s", s.id)} className="text-gray-300 hover:text-red-500">×</button>
                  </div>
                ))}
                {curT.map(t => (
                  <div key={t.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
                    <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 truncate">{t.text}</span>
                    <button type="button" onClick={() => deleteOne("t", t.id)} className="text-gray-300 hover:text-red-500">×</button>
                  </div>
                ))}
                {!annTotal && <p className="py-8 text-center text-xs text-gray-300">暂无标注</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
