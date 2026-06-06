"use client";

import { useState, useRef, useCallback } from "react";
import FileUploader from "@/components/FileUploader";

type Mode = "idle" | "summary" | "chat";

export default function AIPage() {
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [summary, setSummary] = useState("");
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 聊天状态
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 提取的文本上下文
  const [extractedText, setExtractedText] = useState("");

  // ---- 文件选择 ----
  const handleFileSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setSummary("");
      setHint("");
      setError("");
      setChatHistory([]);
      setExtractedText("");
    }
  }, []);

  // ---- AI 总结 ----
  const handleSummary = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setSummary("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (apiKey) formData.append("apiKey", apiKey);

      const res = await fetch("/api/pdf/ai/summary", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSummary(data.summary);
      setHint(data.hint || "");
      // 保存提取的文本供后续对话使用
      setMode("summary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // ---- 提取文本（对话前准备） ----
  const prepareChat = async () => {
    if (!file) return;
    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (apiKey) formData.append("apiKey", apiKey);

      // 先用 summary 接口提取文本，但不传文本（用同样的后端提取逻辑）
      const res = await fetch("/api/pdf/ai/summary", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      // summary 接口返回了 textLength，但我们需要原始文本
      // 这里在后端已经提取了文本，下次对话直接发送
      setMode("chat");
      setChatHistory([
        {
          role: "assistant",
          content: `已加载文档「${file.name}」，请问有什么想了解的？`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // ---- 发送对话消息 ----
  const handleChat = async () => {
    if (!file || !chatInput.trim() || streaming) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);
    setError("");

    try {
      // 先提取文本
      const formData = new FormData();
      formData.append("file", file);
      if (apiKey) formData.append("apiKey", apiKey);

      const extractRes = await fetch("/api/pdf/ai/summary", {
        method: "POST",
        body: formData,
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData.error);

      const context = extractData.summary || extractData.rawText || "";

      // 再发送对话
      const res = await fetch("/api/pdf/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context,
          message: userMsg,
          apiKey: apiKey || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error);
      }

      // ---- 读取 SSE 流 ----
      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let assistantMsg = "";

      setChatHistory((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                setError(parsed.error);
                break;
              }
              if (parsed.content) {
                assistantMsg += parsed.content;
                setChatHistory((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantMsg,
                  };
                  return updated;
                });
              }
            } catch {
              // 非 JSON 数据跳过
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "对话失败");
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold">🤖 AI 智能助手</h1>
        <p className="text-gray-500">
          上传 PDF，AI 帮你总结要点或对话问答。使用 DeepSeek API。
        </p>
      </div>

      {/* API Key 输入 */}
      <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <label className="text-sm font-medium text-yellow-800">
          🔑 DeepSeek API Key（可选，若不填则使用默认 Key）
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="mt-1 w-full rounded border border-yellow-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-yellow-600">
          你的 Key 仅本次使用，不会存储。
          <a
            href="https://platform.deepseek.com/api_keys"
            target="_blank"
            rel="noopener"
            className="ml-1 underline"
          >
            获取 Key →
          </a>
        </p>
      </div>

      {/* 文件上传 */}
      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFileSelected}
          placeholder="拖拽 PDF 到此处或点击选择"
          subPlaceholder="选择需要 AI 分析的 PDF 文件"
        />
      ) : (
        <>
          <button
            onClick={() => {
              setFile(null);
              setSummary("");
              setError("");
              setMode("idle");
              setChatHistory([]);
            }}
            className="mb-4 text-sm text-blue-600 hover:underline"
          >
            ← 重新选择文件
          </button>

          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-medium text-gray-800">📄 {file.name}</p>
          </div>

          {/* 操作按钮 */}
          {mode !== "chat" && (
            <div className="mb-6 flex gap-3">
              <button
                onClick={handleSummary}
                disabled={loading}
                className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "分析中..." : "📋 AI 总结"}
              </button>
              <button
                onClick={prepareChat}
                disabled={loading}
                className="flex-1 rounded-lg border border-blue-600 bg-white py-3 font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                💬 与 PDF 对话
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* 总结结果 */}
          {summary && mode === "summary" && (
            <div className="mb-4 rounded-lg border border-green-200 bg-white p-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">📋 AI 总结</h3>
                <button
                  onClick={() => setMode("idle")}
                  className="text-sm text-blue-600 hover:underline"
                >
                  继续对话 →
                </button>
              </div>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">
                {summary}
              </div>
              {hint && (
                <p className="mt-3 text-xs text-gray-400">{hint}</p>
              )}
            </div>
          )}

          {/* 对话区域 */}
          {mode === "chat" && (
            <div>
              <div className="mb-4 rounded-lg border border-gray-200 bg-white">
                <div className="max-h-80 overflow-y-auto p-4">
                  {chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`mb-3 ${msg.role === "user" ? "text-right" : ""}`}
                    >
                      <span className="mb-1 block text-xs font-medium text-gray-400">
                        {msg.role === "user" ? "你" : "🤖 AI"}
                      </span>
                      <div
                        className={`inline-block max-w-[85%] rounded-lg px-4 py-2 text-left text-sm ${
                          msg.role === "user"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {msg.content || (streaming ? "思考中..." : "")}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* 输入框 */}
                <div className="flex gap-2 border-t border-gray-200 p-3">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleChat();
                      }
                    }}
                    placeholder="输入你的问题..."
                    disabled={streaming}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                  />
                  <button
                    onClick={handleChat}
                    disabled={streaming || !chatInput.trim()}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    发送
                  </button>
                </div>
              </div>

              <button
                onClick={() => setMode("idle")}
                className="text-sm text-gray-500 hover:underline"
              >
                ← 返回功能选择
              </button>
            </div>
          )}

          {/* 隐私提示 */}
          <p className="mt-6 text-xs text-gray-400">
            ⚠️ 注意：AI 功能会将 PDF 中的文字发送到 DeepSeek API 处理。敏感文件请谨慎使用。
            文本最多分析前 {3000} 个字符。
          </p>
        </>
      )}
    </div>
  );
}
