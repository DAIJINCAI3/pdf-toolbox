import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

const MAX_TEXT_LENGTH = 8000;

export async function POST(req: NextRequest) {
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
    const body = await req.json();
    const { text, apiKey: userKey } = body as { text: string; apiKey?: string };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "PDF 中未提取到文字" }, { status: 400 });
    }

    const truncated = text.slice(0, MAX_TEXT_LENGTH);
    const truncatedHint =
      text.length > MAX_TEXT_LENGTH
        ? `（原文共 ${text.length.toLocaleString()} 字符，仅分析了前 ${MAX_TEXT_LENGTH.toLocaleString()} 字符）`
        : "";

    const apiKey = userKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "未配置 API Key，请在页面中输入您的 DeepSeek API Key" },
        { status: 401 }
      );
    }

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });

    const completion = await client.chat.completions.create({
      model: "deepseek-chat",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "你是一个专业的文档分析助手。请用中文总结文档内容：1) 文档主题 2) 关键要点（3-5条）3) 一句话总结。格式清晰。",
        },
        { role: "user", content: `请总结：\n\n${truncated}` },
      ],
    });

    return NextResponse.json({
      summary: completion.choices[0]?.message?.content || "（未能生成总结）",
      textLength: text.length,
      truncated: text.length > MAX_TEXT_LENGTH,
      hint: truncatedHint,
    });
  } catch (err) {
    console.error("AI 总结失败:", err);
    const msg = err instanceof Error ? err.message : "未知错误";
    if (msg.includes("401") || msg.includes("Incorrect")) {
      return NextResponse.json({ error: "API Key 无效" }, { status: 401 });
    }
    return NextResponse.json({ error: `AI 总结失败：${msg}` }, { status: 500 });
  }
}
