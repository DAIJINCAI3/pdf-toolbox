"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import FileUploader from "@/components/FileUploader";
import { splitPDF } from "@/lib/split-pdf";
import { downloadPDF } from "@/lib/merge-pdf";

// 动态导入 pdfjs-dist，只在浏览器端加载
let pdfjsLib: typeof import("pdfjs-dist") | null = null;
if (typeof window !== "undefined") {
  import("pdfjs-dist").then((mod) => {
    pdfjsLib = mod;
    mod.GlobalWorkerOptions.workerSrc =
      "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
  });
}

export default function SplitPage() {
  const [file, setFile] = useState<File | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const renderedRef = useRef(false);

  const handleFilesSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setError("");
      setSelectedPages(new Set());
      setThumbnails([]);
      renderedRef.current = false;
    }
  }, []);

  // 当文件变化时，渲染缩略图
  useEffect(() => {
    if (!file || !pdfjsLib || renderedRef.current) return;

    let cancelled = false;
    renderedRef.current = true;

    async function renderThumbnails() {
      setLoadingPreview(true);
      setThumbnails([]);

      try {
        const arrayBuffer = await file!.arrayBuffer();
        const pdf = await pdfjsLib!.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;

        const pages = pdf.numPages;
        setTotalPages(pages);

        // 默认全选
        const allPages = new Set<number>();
        for (let i = 0; i < pages; i++) allPages.add(i);
        if (!cancelled) setSelectedPages(allPages);

        for (let i = 1; i <= pages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvas, viewport }).promise;
          if (!cancelled)
            setThumbnails((prev) => [...prev, canvas.toDataURL()]);
        }
      } catch (e) {
        if (!cancelled) setError("无法解析 PDF 文件");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }

    renderThumbnails();

    return () => {
      cancelled = true;
    };
  }, [file]);

  const togglePage = (index: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set<number>();
    for (let i = 0; i < totalPages; i++) all.add(i);
    setSelectedPages(all);
  };

  const deselectAll = () => {
    setSelectedPages(new Set());
  };

  const handleSplit = async () => {
    if (!file) return;
    const indices = Array.from(selectedPages).sort((a, b) => a - b);
    if (indices.length === 0) {
      setError("请至少选择一页");
      return;
    }

    setProcessing(true);
    setError("");

    try {
      const result = await splitPDF(file, indices);
      downloadPDF(result, "拆分后的文件.pdf");
    } catch (e) {
      setError("拆分失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">✂️ PDF 拆分</h1>
        <p className="text-gray-500">
          勾选你想要保留的页面，生成新的 PDF 文件
        </p>
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          placeholder="拖拽 PDF 文件到此处或点击选择"
          subPlaceholder="选择一个 PDF 进行拆分"
        />
      ) : (
        <>
          <button
            onClick={() => setFile(null)}
            className="mb-4 text-sm text-blue-600 hover:underline"
          >
            ← 重新选择文件
          </button>

          {loadingPreview && (
            <p className="text-center text-gray-400 py-8">
              正在加载页面预览...
            </p>
          )}

          {thumbnails.length > 0 && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  共 {totalPages} 页，已选 {selectedPages.size} 页
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={selectAll}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    全选
                  </button>
                  <button
                    onClick={deselectAll}
                    className="text-sm text-red-500 hover:underline"
                  >
                    取消全选
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {thumbnails.map((thumb, index) => (
                  <div
                    key={index}
                    onClick={() => togglePage(index)}
                    className={`cursor-pointer rounded-lg border-2 p-1 transition-colors ${
                      selectedPages.has(index)
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 opacity-60"
                    }`}
                  >
                    <img
                      src={thumb}
                      alt={`第 ${index + 1} 页`}
                      className="w-full rounded"
                    />
                    <p className="mt-1 text-center text-xs text-gray-500">
                      第 {index + 1} 页
                    </p>
                  </div>
                ))}
              </div>

              {error && (
                <p className="mt-3 text-sm text-red-500">{error}</p>
              )}

              <button
                onClick={handleSplit}
                disabled={processing}
                className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing
                  ? "处理中..."
                  : `下载选中页面（${selectedPages.size} 页）`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
