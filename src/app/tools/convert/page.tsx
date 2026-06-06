"use client";

import { useState, useCallback } from "react";
import FileUploader from "@/components/FileUploader";
import { pdfToDocx, pdfToXlsx, pdfToPptx, downloadBlob } from "@/lib/convert-client";

const FORMATS = [
  { value: "docx", label: "Word (.docx)", icon: "📝", desc: "提取文字生成可编辑的 Word 文档", filename: "converted.docx" },
  { value: "xlsx", label: "Excel (.xlsx)", icon: "📊", desc: "每页一行，适合表格类 PDF 导出", filename: "converted.xlsx" },
  { value: "pptx", label: "PPT (.pptx)", icon: "📽️", desc: "每页生成一张幻灯片，方便演示", filename: "converted.pptx" },
] as const;

export default function ConvertPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>("docx");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  const handleFileSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setError("");
      setProgress("");
    }
  }, []);

  const handleConvert = async () => {
    if (!file) return;
    setProcessing(true);
    setError("");
    setProgress("正在提取 PDF 文字…");

    try {
      const buffer = await file.arrayBuffer();
      let blob: Blob;

      setProgress("正在生成文件…");

      switch (format) {
        case "docx":
          blob = await pdfToDocx(buffer, file.name, setProgress);
          break;
        case "xlsx":
          blob = await pdfToXlsx(buffer, file.name, setProgress);
          break;
        case "pptx":
          blob = await pdfToPptx(buffer, file.name, setProgress);
          break;
        default:
          throw new Error("不支持的格式");
      }

      setProgress("✅ 转换完成！文件已自动下载。");
      const outName = file.name.replace(/\.pdf$/i, "") + "." + format;
      downloadBlob(blob, outName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "转换失败");
      setProgress("");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">🔄 格式互转</h1>
        <p className="text-gray-500">
          纯浏览器端转换，无需服务器，无需安装任何软件。文字提取后生成新文件。
        </p>
      </div>

      {/* 说明 */}
      <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
        🎉 完全在浏览器中完成，不依赖任何后端服务。支持文字型 PDF。
        扫描图片型 PDF 请先使用 OCR 工具。
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFileSelected}
          placeholder="拖拽 PDF 或点击选择"
          subPlaceholder="选择需要转换的 PDF（文字型）"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => { setFile(null); setError(""); setProgress(""); }}
            className="mb-4 text-sm text-blue-600 hover:underline"
          >
            ← 重新选择
          </button>

          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-medium">📄 {file.name}</p>
            <p className="text-xs text-gray-400 mt-1">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>

          {/* 目标格式 */}
          <div className="mb-6">
            <h3 className="mb-3 font-semibold text-gray-700">选择目标格式</h3>
            <div className="space-y-2">
              {FORMATS.map((f) => (
                <label
                  key={f.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-all ${
                    format === f.value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={f.value}
                    checked={format === f.value}
                    onChange={() => setFormat(f.value)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <span className="font-medium">
                      {f.icon} {f.label}
                    </span>
                    <p className="mt-0.5 text-xs text-gray-500">{f.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {progress && !error && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              {progress}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              ❌ {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleConvert}
            disabled={processing}
            className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {processing ? "转换中…" : `转为 ${FORMATS.find(f => f.value === format)?.label}`}
          </button>
        </>
      )}
    </div>
  );
}
