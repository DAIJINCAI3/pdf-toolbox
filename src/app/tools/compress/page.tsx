"use client";

import { useState, useCallback } from "react";
import FileUploader from "@/components/FileUploader";
import { compressPDF, formatFileSize } from "@/lib/compress-pdf";
import type { CompressionLevel, CompressionResult } from "@/lib/compress-pdf";
import { downloadPDF } from "@/lib/merge-pdf";

/** 三个压缩级别的配置 */
const COMPRESSION_LEVELS: {
  key: CompressionLevel;
  label: string;
  icon: string;
  desc: string;
}[] = [
  {
    key: "light",
    label: "轻度",
    icon: "🖼️",
    desc: "高画质，压缩约 10-20%，适合需要保持原图质量的文档",
  },
  {
    key: "recommended",
    label: "推荐",
    icon: "⚖️",
    desc: "平衡画质与体积，压缩约 20-40%，适合大多数场景",
  },
  {
    key: "extreme",
    label: "极限",
    icon: "🗜️",
    desc: "最大压缩，可能降低图片清晰度，适合纯文本或图片不重要的文档",
  },
];

export default function CompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState<CompressionLevel>("recommended");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    originalSize: number;
    compressedSize: number;
    strategy: string;
  } | null>(null);
  const [compressedData, setCompressedData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");

  const handleFilesSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setResult(null);
      setCompressedData(null);
      setError("");
    }
  }, []);

  const handleCompress = async () => {
    if (!file) return;

    setProcessing(true);
    setError("");

    try {
      const output = await compressPDF(file, level);
      setCompressedData(output.data);
      setResult({
        originalSize: file.size,
        compressedSize: output.data.byteLength,
        strategy: output.strategyUsed,
      });
    } catch (e) {
      setError("压缩失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!compressedData || !file) return;
    const name = file.name.replace(/\.pdf$/i, "");
    const suffix = level === "light" ? "轻度" : level === "extreme" ? "极限" : "压缩";
    downloadPDF(compressedData, `${name}_${suffix}版.pdf`);
  };

  const compressionRatio = result
    ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">📦 PDF 压缩</h1>
        <p className="text-gray-500">
          减小 PDF 文件体积，压缩过程在浏览器本地完成
        </p>
      </div>

      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          placeholder="拖拽 PDF 文件到此处或点击选择"
          subPlaceholder="选择一个需要压缩的 PDF 文件"
        />
      ) : (
        <>
          <button
            onClick={() => {
              setFile(null);
              setResult(null);
              setCompressedData(null);
            }}
            className="mb-4 text-sm text-blue-600 hover:underline"
          >
            ← 重新选择文件
          </button>

          {/* 文件信息 */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-medium text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-500">
              原始大小：{formatFileSize(file.size)}
            </p>
          </div>

          {/* ===== 压缩级别选择器 ===== */}
          <div className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              选择压缩级别
            </h3>
            <div className="space-y-2">
              {COMPRESSION_LEVELS.map((opt) => (
                <label
                  key={opt.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-all ${
                    level === opt.key
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="compressionLevel"
                    value={opt.key}
                    checked={level === opt.key}
                    onChange={() => setLevel(opt.key)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">
                      {opt.icon} {opt.label}
                    </span>
                    <p className="mt-0.5 text-xs text-gray-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 结果展示 */}
          {result && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="font-medium text-green-800">
                🎉 压缩完成！压缩率 {compressionRatio}%
              </p>
              <p className="text-sm text-green-600">
                原大小：{formatFileSize(result.originalSize)}
                {" → "}
                压缩后：{formatFileSize(result.compressedSize)}
                {" （节省 "}
                {formatFileSize(result.originalSize - result.compressedSize)}
                {"）"}
              </p>
              <p className="mt-1 text-xs text-green-500">
                策略：{result.strategy}
              </p>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

          <div className="mt-6 flex gap-3">
            {!compressedData ? (
              <button
                onClick={handleCompress}
                disabled={processing}
                className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing ? "压缩中..." : `开始${COMPRESSION_LEVELS.find(l => l.key === level)?.label}压缩`}
              </button>
            ) : (
              <button
                onClick={handleDownload}
                className="flex-1 rounded-lg bg-green-600 py-3 font-medium text-white transition-colors hover:bg-green-700"
              >
                下载压缩版
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
