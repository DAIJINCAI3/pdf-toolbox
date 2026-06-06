"use client";

import { useState, useRef, useCallback } from "react";
import { extractPDFTextClient } from "@/lib/extract-pdf-text";
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
  const [extractedText, setExtractedText] = useState("");

  // 聊天
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ---- 文件选择 ----
  const handleFileSelected = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setSummary("");
      setHint("");
      setError("");
      setChatHistory([]);
      setExtractedText("");
      setMode("idle");
    }
  }, []);

  // ---- AI 总结 ----
  const handleSummary = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setSummary("");

    try {
      // 1. 浏览器端提取文字
      const buffer = await file.arrayBuffer();
      const text = await extractPDFTextClient(buffer);
      setExtractedText(text);

      // 2. 发送文本到 API
      const res = await fetch("/api/pdf/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, apiKey: apiKey || undefined }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSummary(data.summary);
      setHint(data.hint || "");
      setMode("summary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // ---- 开始对话 ----
  const prepareChat = async () => {
    if (!file) return;
    setLoading(true);
    setError("");

    try {
      if (!extractedText) {
        const buffer = await file.arrayBuffer();
        const text = await extractPDFTextClient(buffer);
        setExtractedText(text);
      }

      setMode("chat");
      setChatHistory([
        {
          role: "assistant",
          content: `已加载「${file.name}」，请问有什么想了解的？`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // ---- 发送消息 ----
  const handleChat = async () => {
    if (!chatInput.trim() || streaming) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);
    setError("");

    try {
      const res = await fetch("/api/pdf/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: extractedText,
          message: userMsg,
          apiKey: apiKey || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应");

      const decoder = new TextDecoder();
      let assistantMsg = "";

      setChatHistory((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ") && line.slice(6) !== "[DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.error) { setError(parsed.error); break; }
              if (parsed.content) {
                assistantMsg += parsed.content;
                setChatHistory((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = { role: "assistant", content: assistantMsg };
                  return u;
                });
              }
            } catch { /* skip */ }
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
          上传 PDF，AI 帮你总结要点或对话问答。文字在浏览器本地提取，仅发送文本到 API。
        </p>
      </div>

      {/* API Key */}
      <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <label className="text-sm font-medium text-yellow-800">
          🔑 DeepSeek API Key（可选）
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="mt-1 w-full rounded border border-yellow-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-yellow-600">
          仅本次使用，不存储。
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener" className="ml-1 underline">
            获取 Key →
          </a>
        </p>
      </div>

      {/* 上传 */}
      {!file ? (
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          onFilesSelected={handleFileSelected}
          placeholder="拖拽 PDF 或点击选择"
          subPlaceholder="支持文字型 PDF（非扫描图片）"
        />
      ) : (
        <>
          <button
            onClick={() => { setFile(null); setSummary(""); setError(""); setMode("idle"); setChatHistory([]); }}
            className="mb-4 text-sm text-blue-600 hover:underline"
          >
            ← 重新选择
          </button>

          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-medium">📄 {file.name}</p>
          </div>

          {mode !== "chat" && (
            <div className="mb-6 flex gap-3">
              <button
                type="button"
                onClick={handleSummary}
                disabled={loading}
                className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "分析中..." : "📋 AI 总结"}
              </button>
              <button
                type="button"
                onClick={prepareChat}
                disabled={loading}
                className="flex-1 rounded-lg border border-blue-600 bg-white py-3 font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                💬 与 PDF 对话
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
          )}

          {/* 总结结果 */}
          {summary && mode === "summary" && (
            <div className="mb-4 rounded-lg border border-green-200 bg-white p-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">📋 AI 总结</h3>
                <button type="button" onClick={() => setMode("idle")} className="text-sm text-blue-600 hover:underline">
                  继续对话 →
                </button>
              </div>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">{summary}</div>
              {hint && <p className="mt-3 text-xs text-gray-400">{hint}</p>}
            </div>
          )}

          {/* 对话 */}
          {mode === "chat" && (
            <div>
              <div className="mb-4 rounded-lg border border-gray-200 bg-white">
                <div className="max-h-80 overflow-y-auto p-4">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`mb-3 ${msg.role === "user" ? "text-right" : ""}`}>
                      <span className="mb-1 block text-xs text-gray-400">
                        {msg.role === "user" ? "你" : "🤖 AI"}
                      </span>
                      <div
                        className={`inline-block max-w-[85%] rounded-lg px-4 py-2 text-left text-sm ${
                          msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {msg.content || (streaming ? "思考中..." : "")}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex gap-2 border-t p-3">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
                    placeholder="输入问题..."
                    disabled={streaming}
                    className="flex-1 rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                  />
                  <button
                    type="button"
                    onClick={handleChat}
                    disabled={streaming || !chatInput.trim()}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    发送
                  </button>
                </div>
              </div>
              <button type="button" onClick={() => setMode("idle")} className="text-sm text-gray-500 hover:underline">
                ← 返回
              </button>
            </div>
          )}

          <p className="mt-6 text-xs text-gray-400">
            ⚠️ 文字在浏览器本地提取，仅发送前 8000 字符到 DeepSeek API。敏感文件请注意。
          </p>
        </>
      )}
    </div>
  );
}
