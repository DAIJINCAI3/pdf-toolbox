"use client";

import { useState, useCallback } from "react";
import FileUploader from "@/components/FileUploader";
import { mergePDFs, downloadPDF } from "@/lib/merge-pdf";

export default function MergePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const handleFilesSelected = useCallback((newFiles: File[]) => {
    setError("");
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setFiles((prev) => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  };

  const moveDown = (index: number) => {
    if (index === files.length - 1) return;
    setFiles((prev) => {
      const arr = [...prev];
      [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
      return arr;
    });
  };

  const handleMerge = async () => {
    if (files.length < 2) {
      setError("请至少上传 2 个 PDF 文件");
      return;
    }

    setProcessing(true);
    setError("");

    try {
      const result = await mergePDFs(files);
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
          将多个 PDF 文件按顺序合并为一个文件。上传后可以拖拽调整顺序。
        </p>
      </div>

      <FileUploader
        accept={{ "application/pdf": [".pdf"] }}
        multiple
        placeholder="拖拽 PDF 文件到此处或点击选择"
        subPlaceholder="支持一次选择多个 PDF"
        onFilesSelected={handleFilesSelected}
      />

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 font-semibold text-gray-700">
            文件列表（按合并顺序排列，可上下调整）
          </h3>
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-500 w-6">
                  {index + 1}.
                </span>
                <span className="flex-1 truncate text-sm">{file.name}</span>
                <span className="text-xs text-gray-400">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  title="上移"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index === files.length - 1}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  title="下移"
                >
                  ↓
                </button>
                <button
                  onClick={() => removeFile(index)}
                  className="text-red-400 hover:text-red-600"
                  title="移除"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {error && (
            <p className="mt-3 text-sm text-red-500">{error}</p>
          )}

          <button
            onClick={handleMerge}
            disabled={processing}
            className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {processing ? "处理中..." : "开始合并并下载"}
          </button>
        </div>
      )}
    </div>
  );
}
