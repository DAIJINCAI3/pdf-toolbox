"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import FileUploader from "@/components/FileUploader";
import {
  renderPage, getTotalPages, saveEditedPDF,
  type TextAnnotation, type HighlightRect,
} from "@/lib/pdf-editor";
import { downloadPDF } from "@/lib/merge-pdf";

/* ================================================================
   颜色选择器
   ================================================================ */

const COLORS = [
  { hex: "#cc0000", label: "红" },
  { hex: "#2563eb", label: "蓝" },
  { hex: "#16a34a", label: "绿" },
  { hex: "#ea580c", label: "橙" },
];

/* ================================================================
   主组件
   ================================================================ */

export default function EditPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileBufferRef = useRef<ArrayBuffer | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 工具模式：text | highlight
  const [tool, setTool] = useState<"text" | "highlight">("text");
  const [textColor, setTextColor] = useState("#cc0000");
  const [highColor, setHighColor] = useState("#fde047");
  const [fontSize, setFontSize] = useState(18);

  // 标注数据
  const [textAnnos, setTextAnnos] = useState<TextAnnotation[]>([]);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);

  // 拖拽起点（高亮用）
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // 唯一 ID
  const idRef = useRef(0);
  const nextId = () => `ann-${++idRef.current}`;

  /* ================================================================
     页面渲染
     ================================================================ */

  const doRender = async (pageNum: number, buf?: ArrayBuffer) => {
    const buffer = buf ?? fileBufferRef.current;
    if (!buffer || !canvasRef.current) return;

    setLoading(true);
    setError("");

    try {
      const info = await renderPage(buffer, pageNum, canvasRef.current, 1.5);
      setCurrentPage(info.pageNum);
      // 渲染完成后由 useEffect 负责画标注
    } catch (e) {
      setError("渲染失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  /* ================================================================
     标注绘制
     ================================================================ */

  function drawAnnotationsOverlay() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 文字标注
    for (const a of textAnnos) {
      if (a.pageNum !== currentPage) continue;
      ctx.save();
      ctx.font = `bold ${a.fontSize}px "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = a.color;
      // 文字阴影提升可读性
      ctx.shadowColor = "rgba(255,255,255,0.9)";
      ctx.shadowBlur = 3;
      ctx.fillText(a.text, a.x, a.y);
      ctx.restore();
    }

    // 高亮矩形
    for (const h of highlights) {
      if (h.pageNum !== currentPage) continue;
      ctx.save();
      ctx.fillStyle = h.color;
      ctx.globalAlpha = h.opacity;
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.restore();
    }

    // 拖拽中的预览矩形
    if (dragRect && dragRect.w > 1 && dragRect.h > 1) {
      ctx.save();
      ctx.strokeStyle = highColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillStyle = highColor;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
      ctx.restore();
    }
  }

  // 标注变化后：重新渲染页面 + 标注 overlay
  const [needsRedraw, setNeedsRedraw] = useState(0);
  const triggerRedraw = () => setNeedsRedraw((n) => n + 1);

  useEffect(() => {
    if (!fileBufferRef.current || !canvasRef.current || !file) return;
    let cancelled = false;
    (async () => {
      await renderPage(fileBufferRef.current!, currentPage, canvasRef.current!, 1.5);
      if (!cancelled) drawAnnotationsOverlay();
    })();
    return () => { cancelled = true; };
  }, [currentPage, needsRedraw, file]);

  /* ================================================================
     文件加载
     ================================================================ */

  const handleFileSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const f = files[0];
    setFile(f);
    setTextAnnos([]);
    setHighlights([]);

    const buf = await f.arrayBuffer();
    fileBufferRef.current = buf;

    try {
      const total = await getTotalPages(buf);
      setTotalPages(total);
      setCurrentPage(1); // useEffect 会自动渲染
      if (canvasRef.current) {
        await renderPage(buf, 1, canvasRef.current, 1.5);
        drawAnnotationsOverlay();
      }
    } catch (e) {
      setError("无法加载 PDF：" + (e instanceof Error ? e.message : ""));
    }
  }, []);

  // 切换页面
  const goPage = useCallback(async (p: number) => {
    if (p < 1 || p > totalPages) return;
    setCurrentPage(p); // useEffect 会自动渲染 + 画标注
  }, [totalPages]);

  /* ================================================================
     Canvas 交互
     ================================================================ */

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (tool === "highlight") {
      dragRef.current = { x, y };
      setDragRect({ x, y, w: 0, h: 0 });
    }
  }, [tool]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current || !dragRect) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    setDragRect({
      x: Math.min(dragRef.current.x, x),
      y: Math.min(dragRef.current.y, y),
      w: Math.abs(x - dragRef.current.x),
      h: Math.abs(y - dragRef.current.y),
    });
  }, [dragRect]);

  const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (tool === "highlight" && dragRef.current && dragRect && dragRect.w > 5 && dragRect.h > 5) {
      setHighlights((prev) => [
        ...prev,
        { id: nextId(), pageNum: currentPage, x: dragRect.x, y: dragRect.y, w: dragRect.w, h: dragRect.h, color: highColor, opacity: 0.35 },
      ]);
    }

    if (tool === "text") {
      const text = prompt("请输入要添加的文字：", "");
      if (text && text.trim()) {
        setTextAnnos((prev) => [
          ...prev,
          { id: nextId(), pageNum: currentPage, text: text.trim(), x, y, fontSize, color: textColor },
        ]);
      }
    }

    dragRef.current = null;
    setDragRect(null);
    triggerRedraw();
  }, [tool, currentPage, dragRect, highColor, textColor, fontSize]);

  /* ================================================================
     保存
     ================================================================ */

  const handleSave = async () => {
    if (!fileBufferRef.current) return;

    setLoading(true);
    setError("");

    try {
      const data = await saveEditedPDF(fileBufferRef.current, textAnnos, highlights, 1.5);
      const name = file?.name?.replace(/\.pdf$/i, "") || "edited";
      downloadPDF(data, `${name}_编辑版.pdf`);
    } catch (e) {
      setError("保存失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  /* ================================================================
     清除标注
     ================================================================ */

  const clearAnnotations = () => {
    setTextAnnos([]);
    setHighlights([]);
    triggerRedraw();
  };

  /* ================================================================
     UI
     ================================================================ */

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">✏️ 文档编辑</h1>
        <p className="text-gray-500">在 PDF 上添加文字标注或高亮区域</p>
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFileSelected}
          placeholder="拖拽 PDF 或点击选择"
          subPlaceholder="选择需要编辑的 PDF 文件"
        />
      ) : (
        <>
          {/* ---- 工具栏 ---- */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
            {/* 工具选择 */}
            <span className="text-sm text-gray-500">工具：</span>
            <button
              onClick={() => setTool("text")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tool === "text" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              🔤 添加文字
            </button>
            <button
              onClick={() => setTool("highlight")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tool === "highlight" ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              🖍️ 高亮标记
            </button>

            <span className="mx-1 text-gray-300">|</span>

            {/* 文字工具配置 */}
            {tool === "text" && (
              <>
                <span className="text-sm text-gray-500">颜色：</span>
                {COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setTextColor(c.hex)}
                    className="h-6 w-6 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c.hex,
                      borderColor: textColor === c.hex ? "#1e293b" : "transparent",
                      outline: textColor === c.hex ? "2px solid #1e293b" : "none",
                    }}
                    title={c.label}
                  />
                ))}
                <span className="text-sm text-gray-500 ml-2">字号：</span>
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  {[12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                    <option key={s} value={s}>{s}px</option>
                  ))}
                </select>
              </>
            )}

            {/* 高亮工具配置 */}
            {tool === "highlight" && (
              <>
                <span className="text-sm text-gray-500">颜色：</span>
                {["#fde047", "#fca5a5", "#a5f3fc", "#bbf7d0"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setHighColor(c)}
                    className="h-6 w-6 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: highColor === c ? "#1e293b" : "transparent",
                      outline: highColor === c ? "2px solid #1e293b" : "none",
                    }}
                    title={c}
                  />
                ))}
              </>
            )}

            <span className="mx-1 text-gray-300">|</span>

            {/* 操作按钮 */}
            <button
              onClick={clearAnnotations}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              清除所有标注
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? "保存中…" : `💾 保存修改 (${textAnnos.length + highlights.length} 处)`}
            </button>
          </div>

          {/* ---- 翻页 ---- */}
          {totalPages > 1 && (
            <div className="mb-3 flex items-center justify-center gap-3">
              <button
                onClick={() => goPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="rounded border px-3 py-1 text-sm disabled:opacity-30"
              >
                ← 上一页
              </button>
              <span className="text-sm text-gray-600">
                第 {currentPage} / {totalPages} 页
              </span>
              <button
                onClick={() => goPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="rounded border px-3 py-1 text-sm disabled:opacity-30"
              >
                下一页 →
              </button>
            </div>
          )}

          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2 text-center text-xs text-amber-700">
            {tool === "text"
              ? "📝 文字模式：在 PDF 上点击任意位置添加文字"
              : "🖍️ 高亮模式：按住鼠标拖拽选择区域进行高亮标记"}
          </div>

          {/* ---- Canvas 展示区 ---- */}
          <div className="overflow-auto rounded-lg border-2 border-gray-200 bg-gray-100">
            {loading && !canvasRef.current && (
              <div className="flex items-center justify-center py-20 text-gray-400">
                正在加载页面…
              </div>
            )}
            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={() => { dragRef.current = null; setDragRect(null); }}
              className="mx-auto block cursor-crosshair"
            />
          </div>

          <p className="mt-6 text-xs text-gray-400">
            💡 编辑操作完全在浏览器本地完成。添加文字时 <b>单击位置</b>；高亮时 <b>按住拖拽</b>。
            标注效果为叠加图层，不影响原 PDF 其他内容。标注数据不存储。
          </p>
        </>
      )}
    </div>
  );
}
