"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import FileUploader from "@/components/FileUploader";
import { mergePDFs, downloadPDF } from "@/lib/merge-pdf";
import type { MergeOptions } from "@/lib/merge-pdf";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ================================================================
   类型定义
   ================================================================ */

interface FileEntry {
  id: string;
  file: File;
  thumbnail: string | null; // base64 缩略图
}

/* ================================================================
   可拖拽的单条文件卡片组件
   ================================================================ */

function SortableFileItem({
  entry,
  index,
  onRemove,
}: {
  entry: FileEntry;
  index: number;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
    >
      {/* 拖拽手柄 */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-lg text-gray-400 hover:text-gray-600 active:cursor-grabbing"
        title="拖拽排序"
      >
        ⋮⋮
      </button>

      {/* 序号 */}
      <span className="w-6 text-center text-sm font-bold text-gray-400">
        {index + 1}
      </span>

      {/* 第一页缩略图 */}
      <div className="h-24 w-20 flex-shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-100">
        {entry.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt={`预览`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl text-gray-300">
            📄
          </div>
        )}
      </div>

      {/* 文件名 + 大小 */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-800">
          {entry.file.name}
        </p>
        <p className="text-xs text-gray-400">
          {(entry.file.size / 1024 / 1024).toFixed(2)} MB
        </p>
      </div>

      {/* 删除按钮 */}
      <button
        onClick={() => onRemove(entry.id)}
        className="flex-shrink-0 text-red-400 hover:text-red-600"
        title="移除"
      >
        ✕
      </button>
    </div>
  );
}

/* ================================================================
   主页组件
   ================================================================ */

export default function MergePage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preserveBookmarks, setPreserveBookmarks] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const idCounter = useRef(0);

  // ---- 生成缩略图辅助函数 ----
  const generateThumbnail = useCallback(async (file: File): Promise<string | null> => {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.6 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      return canvas.toDataURL("image/jpeg", 0.8);
    } catch {
      return null; // 非 PDF 或损坏的文件不显示缩略图
    }
  }, []);

  // ---- 文件选择 ----
  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      setError("");

      const added: FileEntry[] = [];
      for (const file of newFiles) {
        const thumb = await generateThumbnail(file);
        added.push({
          id: `file-${++idCounter.current}`,
          file,
          thumbnail: thumb,
        });
      }
      setEntries((prev) => [...prev, ...added]);
    },
    [generateThumbnail]
  );

  // ---- 删除 ----
  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ---- 拖拽结束 ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setEntries((prev) => {
      const oldIndex = prev.findIndex((e) => e.id === active.id);
      const newIndex = prev.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // ---- 合并 ----
  const handleMerge = async () => {
    if (entries.length < 2) {
      setError("请至少上传 2 个 PDF 文件");
      return;
    }

    setProcessing(true);
    setError("");

    try {
      const files = entries.map((e) => e.file);
      const options: MergeOptions = { preserveBookmarks };
      const result = await mergePDFs(files, options);
      downloadPDF(result, "合并后的文件.pdf");
    } catch (e) {
      setError("合并失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">🔗 PDF 合并</h1>
        <p className="text-gray-500">
          上传多个 PDF，拖拽调整顺序，一键合并
        </p>
      </div>

      <FileUploader
        accept={{ "application/pdf": [".pdf"] }}
        multiple
        placeholder="拖拽 PDF 文件到此处或点击选择"
        subPlaceholder="支持一次选择多个 PDF"
        onFilesSelected={handleFilesSelected}
      />

      {entries.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">
              文件列表（{entries.length} 个文件，拖拽 ⋮⋮ 调整顺序）
            </h3>
          </div>

          {/* 拖拽区域 */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={entries.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {entries.map((entry, index) => (
                  <SortableFileItem
                    key={entry.id}
                    entry={entry}
                    index={index}
                    onRemove={removeEntry}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* 书签保留选项 */}
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={preserveBookmarks}
              onChange={(e) => setPreserveBookmarks(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            📑 保留书签（尝试保留原 PDF 的大纲结构）
          </label>

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

          <button
            onClick={handleMerge}
            disabled={processing}
            className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {processing ? "合并中..." : `合并 ${entries.length} 个文件并下载`}
          </button>
        </div>
      )}
    </div>
  );
}
