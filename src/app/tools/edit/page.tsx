"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import FileUploader from "@/components/FileUploader";
import {
  renderPage, getTotalPages, saveEditedPDF, findHighlightRects,
  type TextAnnotation, type HighlightRange, type TextItem,
} from "@/lib/pdf-editor";
import { downloadPDF } from "@/lib/merge-pdf";

/* ================================================================
   常量
   ================================================================ */

const HL_COLORS = [
  { hex: "#fde047", label: "黄色", border: "#eab308" },
  { hex: "#fca5a5", label: "红色", border: "#ef4444" },
  { hex: "#a5f3fc", label: "青色", border: "#06b6d4" },
  { hex: "#bbf7d0", label: "绿色", border: "#22c55e" },
];

const TEXT_COLORS = [
  { hex: "#cc0000", label: "红" },
  { hex: "#2563eb", label: "蓝" },
  { hex: "#16a34a", label: "绿" },
  { hex: "#1e293b", label: "黑" },
];

/* ================================================================
   主组件
   ================================================================ */

export default function EditPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const textItemsRef = useRef<TextItem[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 工具
  const [tool, setTool] = useState<"highlight" | "text">("highlight");
  const [hlColor, setHlColor] = useState(HL_COLORS[0]);
  const [textColor, setTextColor] = useState(TEXT_COLORS[0].hex);
  const [fontSize, setFontSize] = useState(16);

  // 标注数据
  const [highlights, setHighlights] = useState<HighlightRange[]>([]);
  const [textAnnos, setTextAnnos] = useState<TextAnnotation[]>([]);

  // 拖拽状态
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState({ x: 0, y: 0 });
  const [selEnd, setSelEnd] = useState({ x: 0, y: 0 });

  // 文字添加状态
  const [addingText, setAddingText] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");

  // 选中文字（用于高亮）
  const idRef = useRef(0);
  const nextId = () => `a-${++idRef.current}`;

  /** 高亮颜色 → 边框颜色 */
  function hlColorsBorder(hex: string): string {
    const map: Record<string, string> = { "#fde047": "#eab308", "#fca5a5": "#ef4444", "#a5f3fc": "#06b6d4", "#bbf7d0": "#22c55e" };
    return map[hex] || "#888888";
  }

  // scale 写死 1.5，与 renderPage 保持一致
  const SCALE = 1.5;

  /* ================================================================
     渲染
     ================================================================ */

  const renderCurrentPage = useCallback(async (buf: ArrayBuffer, page: number) => {
    if (!canvasRef.current) return;
    setLoading(true);
    try {
      const result = await renderPage(buf, page, canvasRef.current, SCALE);
      textItemsRef.current = result.textItems;
      setPageSize({ w: result.width, h: result.height });
      drawAnnotations();
    } catch (e) {
      setError("渲染失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  }, []);

  // 每次标注/页码变化后重绘标注
  useEffect(() => {
    drawAnnotations();
  }, [highlights, textAnnos, currentPage, selecting, selEnd]);

  function drawAnnotations() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 重新渲染基础页面
    if (bufferRef.current) {
      renderPage(bufferRef.current, currentPage, canvas, SCALE).then((result) => {
        textItemsRef.current = result.textItems;
        setPageSize({ w: result.width, h: result.height });

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // 高亮
        for (const hl of highlights) {
          if (hl.pageNum !== currentPage) continue;
          ctx.save();
          for (const r of hl.rects) {
            ctx.fillStyle = hl.color;
            ctx.globalAlpha = 0.35;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = hlColorsBorder(hl.color);
            ctx.lineWidth = 1;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
          }
          ctx.restore();
        }

        // 文字标注
        for (const a of textAnnos) {
          if (a.pageNum !== currentPage) continue;
          ctx.save();
          ctx.font = `bold ${a.fontSize}px "Microsoft YaHei", sans-serif`;
          ctx.shadowColor = "rgba(255,255,255,0.85)";
          ctx.shadowBlur = 4;
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, a.x, a.y);
          ctx.restore();
        }

        // 拖拽选区的实时预览
        if (selecting) {
          const box = getSelectionBox();
          if (box.w > 3 || box.h > 3) {
            const rects = findHighlightRects(box, textItemsRef.current);
            ctx.save();
            ctx.fillStyle = hlColor.hex;
            ctx.globalAlpha = 0.25;
            ctx.strokeStyle = hlColor.border;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 2]);
            for (const r of rects) {
              ctx.fillRect(r.x, r.y, r.w, r.h);
              ctx.strokeRect(r.x, r.y, r.w, r.h);
            }
            ctx.restore();
          }
        }
      });
    }
  }

  function getSelectionBox() {
    return {
      x: Math.min(selStart.x, selEnd.x),
      y: Math.min(selStart.y, selEnd.y),
      w: Math.abs(selEnd.x - selStart.x),
      h: Math.abs(selEnd.y - selStart.y),
    };
  }

  /* ================================================================
     文件加载
     ================================================================ */

  const handleFileSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    setFile(f);
    setHighlights([]);
    setTextAnnos([]);
    setCurrentPage(1);
    setError("");

    const buf = await f.arrayBuffer();
    bufferRef.current = buf.slice(0); // 拷贝，防止 pdfjs worker detach

    try {
      const total = await getTotalPages(buf);
      setTotalPages(total);
      await renderCurrentPage(bufferRef.current, 1);
    } catch (e) {
      setError("无法加载：" + (e instanceof Error ? e.message : ""));
    }
  }, [renderCurrentPage]);

  const goPage = (p: number) => {
    if (p < 1 || p > totalPages || !bufferRef.current) return;
    setCurrentPage(p);
    renderCurrentPage(bufferRef.current, p);
  };

  /* ================================================================
     Overlay 交互
     ================================================================ */

  const getEventPos = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    // canvas 的 CSS 尺寸可能被缩放，需要换算到 canvas 实际像素
    const scaleX = (canvasRef.current?.width || 1) / rect.width;
    const scaleY = (canvasRef.current?.height || 1) / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === "text") {
      const pos = getEventPos(e);
      setAddingText(pos);
      setDraftText("");
      return;
    }

    if (tool === "highlight") {
      const pos = getEventPos(e);
      setSelStart(pos);
      setSelEnd(pos);
      setSelecting(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === "highlight" && selecting) {
      setSelEnd(getEventPos(e));
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === "highlight" && selecting) {
      setSelecting(false);
      const end = getEventPos(e);
      setSelEnd(end);

      const box = {
        x: Math.min(selStart.x, end.x),
        y: Math.min(selStart.y, end.y),
        w: Math.abs(end.x - selStart.x),
        h: Math.abs(end.y - selStart.y),
      };

      const rects = findHighlightRects(box, textItemsRef.current);
      if (rects.length > 0) {
        setHighlights((prev) => [
          ...prev,
          { id: nextId(), pageNum: currentPage, rects, color: hlColor.hex },
        ]);
      }
    }
  };

  /* ================================================================
     文字确认
     ================================================================ */

  const confirmText = () => {
    if (!addingText || !draftText.trim()) {
      setAddingText(null);
      return;
    }

    setTextAnnos((prev) => [
      ...prev,
      {
        id: nextId(),
        pageNum: currentPage,
        text: draftText.trim(),
        x: addingText.x,
        y: addingText.y,
        fontSize,
        color: textColor,
      },
    ]);
    setAddingText(null);
    setDraftText("");
  };

  /* ================================================================
     删除 + 保存
     ================================================================ */

  const removeHighlight = (id: string) => setHighlights((prev) => prev.filter((h) => h.id !== id));
  const removeTextAnno = (id: string) => setTextAnnos((prev) => prev.filter((a) => a.id !== id));

  const handleSave = async () => {
    if (!bufferRef.current || !file) return;
    setLoading(true);
    try {
      const data = await saveEditedPDF(bufferRef.current, textAnnos, highlights, SCALE);
      const name = file.name.replace(/\.pdf$/i, "");
      downloadPDF(data, `${name}_标注版.pdf`);
    } catch (e) {
      setError("保存失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  // 当前页标注
  const curHL = highlights.filter((h) => h.pageNum === currentPage);
  const curTA = textAnnos.filter((a) => a.pageNum === currentPage);
  const allHL = highlights.filter((h) => h.pageNum !== currentPage);
  const allTA = textAnnos.filter((a) => a.pageNum !== currentPage);

  /* ================================================================
     UI
     ================================================================ */

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">✏️ PDF 标注编辑</h1>
        <p className="mt-1 text-sm text-gray-500">选中文字自动高亮 · 点击任意位置添加标注 · 所见即所得</p>
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFileSelected}
          placeholder="拖拽 PDF 文件或点击选择"
          subPlaceholder="选择需要标注的 PDF"
        />
      ) : (
        <div className="flex gap-4">
          {/* ===== 左侧编辑区 ===== */}
          <div className="flex-1 min-w-0">
            {/* 工具栏 */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2.5">
              <span className="text-xs text-gray-400 mr-1">工具：</span>
              <button
                type="button"
                onClick={() => setTool("highlight")}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  tool === "highlight"
                    ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                🖍️ 划词高亮
              </button>
              <button
                type="button"
                onClick={() => setTool("text")}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  tool === "text"
                    ? "bg-blue-100 text-blue-800 ring-1 ring-blue-400"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                🔤 添加文字
              </button>

              <span className="mx-1 text-gray-200">|</span>

              {tool === "highlight" ? (
                <>
                  <span className="text-xs text-gray-400">颜色：</span>
                  {HL_COLORS.map((c) => (
                    <button
                      key={c.hex} type="button" title={c.label}
                      onClick={() => setHlColor(c)}
                      className="h-6 w-7 rounded border-2 transition-all"
                      style={{
                        backgroundColor: c.hex,
                        borderColor: hlColor.hex === c.hex ? "#1e293b" : "transparent",
                      }}
                    />
                  ))}
                </>
              ) : (
                <>
                  <span className="text-xs text-gray-400">颜色：</span>
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.hex} type="button" title={c.label}
                      onClick={() => setTextColor(c.hex)}
                      className="h-6 w-6 rounded-full border-2 transition-all"
                      style={{
                        backgroundColor: c.hex,
                        borderColor: textColor === c.hex ? "#1e293b" : "transparent",
                      }}
                    />
                  ))}
                  <span className="text-xs text-gray-400 ml-1">大小：</span>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                    title="字号"
                  >
                    {[12,14,16,18,20,24,28,32,40].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </>
              )}

              <span className="mx-1 text-gray-200">|</span>

              <button
                type="button"
                onClick={handleSave}
                disabled={loading || (highlights.length === 0 && textAnnos.length === 0)}
                className="rounded bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
              >
                💾 保存下载
              </button>
            </div>

            {/* 提示条 */}
            <div className="mb-2 rounded bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
              {tool === "highlight"
                ? "🖍️ 按住鼠标在文字上拖拽 → 自动识别文字区域 → 松开即高亮"
                : "🔤 在 PDF 上点击任意位置 → 输入文字 → 按 Enter 确认"}
            </div>

            {error && (
              <div className="mb-2 rounded bg-red-50 px-3 py-1.5 text-xs text-red-600">{error}</div>
            )}

            {/* 翻页 */}
            {totalPages > 1 && (
              <div className="mb-2 flex items-center justify-center gap-3 text-sm">
                <button onClick={() => goPage(currentPage - 1)} disabled={currentPage <= 1} className="rounded border px-2 py-1 disabled:opacity-30">←</button>
                <span className="text-gray-600">{currentPage}/{totalPages}</span>
                <button onClick={() => goPage(currentPage + 1)} disabled={currentPage >= totalPages} className="rounded border px-2 py-1 disabled:opacity-30">→</button>
              </div>
            )}

            {/* Canvas + Overlay */}
            <div className="relative inline-block rounded-lg border border-gray-300 bg-white shadow-sm overflow-hidden">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
                  <span className="text-sm text-gray-400">加载中…</span>
                </div>
              )}
              <canvas ref={canvasRef} className="block max-w-full" />
              {/* 透明交互层 */}
              <div
                ref={overlayRef}
                className="absolute inset-0 z-5"
                style={{ cursor: tool === "highlight" ? "text" : "crosshair" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setSelecting(false)}
              />

              {/* 文字输入框（原位编辑） */}
              {addingText && (
                <div
                  className="absolute z-20"
                  style={{ left: addingText.x / SCALE, top: addingText.y / SCALE }}
                >
                  <div className="flex items-center gap-1 rounded border-2 border-blue-400 bg-white p-1 shadow-lg">
                    <input
                      autoFocus
                      type="text"
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmText();
                        if (e.key === "Escape") setAddingText(null);
                      }}
                      placeholder="输入文字后回车"
                      className="w-40 rounded border-none px-2 py-1 text-sm outline-none"
                      style={{ color: textColor, fontSize: `${fontSize * 0.6}px` }}
                    />
                    <button
                      type="button"
                      onClick={confirmText}
                      className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700"
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingText(null)}
                      className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-300"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ===== 右侧标注列表 ===== */}
          <div className="w-60 flex-shrink-0">
            <div className="sticky top-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  标注列表
                  <span className="ml-1 font-normal text-gray-400">
                    ({highlights.length + textAnnos.length})
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => { setHighlights([]); setTextAnnos([]); }}
                  className="text-xs text-red-500 hover:underline"
                >
                  清除全部
                </button>
              </div>

              <div className="max-h-96 space-y-1.5 overflow-y-auto">
                {/* 当前页 */}
                {curHL.length + curTA.length > 0 && (
                  <div className="mb-2 text-xs text-gray-400">当前页</div>
                )}
                {curHL.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs">
                    <div className="h-3 w-3 flex-shrink-0 rounded" style={{ backgroundColor: h.color }} />
                    <span className="flex-1 truncate text-amber-800">高亮 ({h.rects.length}行)</span>
                    <button type="button" onClick={() => removeHighlight(h.id)} className="text-amber-400 hover:text-red-500">✕</button>
                  </div>
                ))}
                {curTA.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
                    <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                    <span className="flex-1 truncate text-blue-800">{a.text}</span>
                    <button type="button" onClick={() => removeTextAnno(a.id)} className="text-blue-400 hover:text-red-500">✕</button>
                  </div>
                ))}

                {/* 其他页 */}
                {allHL.length + allTA.length > 0 && (
                  <>
                    <div className="mb-1 mt-3 text-xs text-gray-400">其他页</div>
                    <p className="text-xs text-gray-400">
                      共 {allHL.length + allTA.length} 个标注（仅显示当前页）
                    </p>
                  </>
                )}

                {highlights.length === 0 && textAnnos.length === 0 && (
                  <p className="text-xs text-gray-300 py-6 text-center">
                    还没有标注<br />
                    {tool === "highlight" ? "拖拽文字添加高亮" : "点击页面添加文字"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
