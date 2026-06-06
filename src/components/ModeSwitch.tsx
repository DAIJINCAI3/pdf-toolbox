"use client";

import { useState, useEffect } from "react";

interface ModeSwitchProps {
  /** 当前文件大小（bytes），用于自动提醒 */
  fileSize?: number;
  /** 当前文件页数，用于自动提醒 */
  pageCount?: number;
}

/**
 * 本地/云端模式开关
 *
 * 默认本地处理。当文件 >50MB 或 >500 页时，自动弹出建议切换云端。
 * 当前云端模式暂不可用（需后端部署），仅作为未来扩展入口。
 */
export function useProcessingMode(opts?: ModeSwitchProps) {
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    if (!opts) return;
    const isBig = (opts.fileSize && opts.fileSize > 50 * 1024 * 1024) ||
      (opts.pageCount && opts.pageCount > 500);
    if (isBig && mode === "local") {
      setShowTip(true);
    }
  }, [opts?.fileSize, opts?.pageCount, mode]);

  const dismissTip = () => setShowTip(false);

  return { mode, setMode, showTip, dismissTip };
}

export default function ModeSwitch({
  mode,
  onChange,
  disabled = false,
}: {
  mode: "local" | "cloud";
  onChange: (m: "local" | "cloud") => void;
  disabled?: boolean;
}) {
  const isCloud = mode === "cloud";

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium ${!isCloud ? "text-green-600" : "text-gray-400"}`}>
        🏠 本地
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isCloud}
        disabled={disabled}
        onClick={() => onChange(isCloud ? "local" : "cloud")}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        } ${isCloud ? "bg-blue-600" : "bg-gray-300"}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            isCloud ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <span className={`text-xs font-medium ${isCloud ? "text-blue-600" : "text-gray-400"}`}>
        ☁️ 云端
      </span>
    </div>
  );
}

export function CloudTip({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <span>⚠️ 文件较大，本地处理可能较慢。云端模式暂不可用，敬请期待。</span>
      <button type="button" onClick={onDismiss} className="flex-shrink-0 text-amber-400 hover:text-amber-600">✕</button>
    </div>
  );
}
