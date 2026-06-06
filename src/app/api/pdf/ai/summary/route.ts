import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

const MAX_TEXT_LENGTH = 3000;

export async function POST(req: NextRequest) {
  // 限流：每个 IP 每分钟最多 5 次
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const limit = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    getKey: () => `ai-summary:${ip}`,
  });
  if (!limit.ok) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userKey = (formData.get("apiKey") as string) || null;

    let text = "";

    if (file) {
      // --- 用 pdf-parse 提取文本 ---
      const bytes = await file.arrayBuffer();
      try {
        const { extractPDFText } = await import("@/lib/extract-pdf-text");
        text = await extractPDFText(bytes);
      } catch {
        return NextResponse.json(
          { error: "无法解析该 PDF 文件，请确认文件是文本型 PDF（非扫描图片）" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "请上传 PDF 文件" },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "该 PDF 中未检测到文字，可能是扫描图片。请使用 OCR 工具或尝试其他文件。" },
        { status: 400 }
      );
    }

    // 取前 MAX_TEXT_LENGTH 字符
    const truncated = text.slice(0, MAX_TEXT_LENGTH);
    const truncatedHint =
      text.length > MAX_TEXT_LENGTH
        ? `（注意：原文共 ${text.length.toLocaleString()} 字符，仅分析了前 ${MAX_TEXT_LENGTH.toLocaleString()} 字符）`
        : "";

    // ---- 调用 OpenAI ----
    const apiKey = userKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "未配置 API Key，请在页面中输入您的 OpenAI API Key" },
        { status: 401 }
      );
    }

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "你是一个专业的文档分析助手。请用中文总结以下 PDF 文档内容，包括：1) 文档主题 2) 关键要点（3-5 条）3) 一句话总结。格式清晰，使用 Markdown。",
        },
        {
          role: "user",
          content: `请总结以下文档内容：\n\n${truncated}`,
        },
      ],
    });

    const summary = completion.choices[0]?.message?.content || "（未能生成总结）";

    return NextResponse.json({
      summary,
      textLength: text.length,
      truncated: text.length > MAX_TEXT_LENGTH,
      hint: truncatedHint,
    });
  } catch (err) {
    console.error("AI 总结失败:", err);
    const message =
      err instanceof Error ? err.message : "未知错误";
    // 不暴露内部错误细节给前端
    if (message.includes("401") || message.includes("Incorrect API key")) {
      return NextResponse.json(
        { error: "API Key 无效，请检查后重试" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: `AI 总结失败：${message}` },
      { status: 500 }
    );
  }
}
