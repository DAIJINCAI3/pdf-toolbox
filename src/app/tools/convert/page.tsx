"use client";

import { useState, useCallback } from "react";
import FileUploader from "@/components/FileUploader";

const FORMATS = [
  { value: "docx", label: "Word (.docx)", icon: "📝", desc: "转为可编辑的 Word 文档" },
  { value: "xlsx", label: "Excel (.xlsx)", icon: "📊", desc: "提取表格数据为 Excel" },
  { value: "pptx", label: "PPT (.pptx)", icon: "📽️", desc: "转为 PowerPoint 演示文稿" },
] as const;

export default function ConvertPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>("docx");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [serverMsg, setServerMsg] = useState("");

  const handleFileSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setError("");
      setServerMsg("");
    }
  }, []);

  const handleConvert = async () => {
    if (!file) return;
    setProcessing(true);
    setError("");
    setServerMsg("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", format);

      const res = await fetch("/api/pdf/convert", { method: "POST", body: formData });

      if (!res.ok) {
        const data = await res.json();

        // 503 = 未安装 LibreOffice
        if (res.status === 503 && data.installGuide) {
          setServerMsg(
            `⚠️ 服务器未安装 LibreOffice，暂不支持此功能。\n\n📌 解决方案：\n${data.installGuide}`
          );
          setError("此功能需要 LibreOffice，Vercel 免费版不支持。");
          return;
        }

        throw new Error(data.error || "转换失败");
      }

      // 下载转换结果
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `converted.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "转换失败");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">🔄 格式互转</h1>
        <p className="text-gray-500">
          将 PDF 转换为 Word、Excel 或 PowerPoint 格式
        </p>
      </div>

      {/* 说明 */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
        💡 此功能需要后端安装 LibreOffice。当前部署在 Vercel（Serverless），暂不可用。
        如需使用，请将项目部署到 VPS 并安装 <code className="bg-blue-100 px-1 rounded">sudo apt install libreoffice</code>。
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFileSelected}
          placeholder="拖拽 PDF 文件或点击选择"
          subPlaceholder="选择需要转换的 PDF"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => { setFile(null); setError(""); setServerMsg(""); }}
            className="mb-4 text-sm text-blue-600 hover:underline"
          >
            ← 重新选择
          </button>

          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-medium">{file.name}</p>
          </div>

          {/* 目标格式选择 */}
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

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              {error}
              {serverMsg && (
                <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{serverMsg}</pre>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleConvert}
            disabled={processing}
            className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {processing ? "转换中..." : "开始转换"}
          </button>
        </>
      )}
    </div>
  );
}
