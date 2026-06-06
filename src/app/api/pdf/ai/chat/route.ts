import { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

const MAX_TEXT_LENGTH = 3000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 限流
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const limit = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    getKey: () => `ai-chat:${ip}`,
  });
  if (!limit.ok) {
    return new Response(JSON.stringify({ error: limit.message }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { context, message, apiKey: userKey } = body as {
      context: string;
      message: string;
      apiKey?: string;
    };

    if (!context || !message) {
      return new Response(
        JSON.stringify({ error: "缺少对话上下文或消息" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const truncated = context.slice(0, MAX_TEXT_LENGTH);

    const apiKey = userKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "未配置 API Key" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey });

    // ---- SSE 流式响应 ----
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await client.chat.completions.create({
            model: "gpt-3.5-turbo",
            temperature: 0.5,
            stream: true,
            messages: [
              {
                role: "system",
                content:
                  "你是一个专业的文档助手。根据用户提供的文档内容回答问题。请用中文。如果文档中没有相关信息，诚实地说你不知道。",
              },
              {
                role: "user",
                content: `以下是要参考的文档内容：\n\n${truncated}\n\n---\n用户问题：${message}`,
              },
            ],
          });

          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "未知错误";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("AI 对话失败:", err);
    return new Response(
      JSON.stringify({ error: "对话失败，请重试" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
