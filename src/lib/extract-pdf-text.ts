/**
 * 用 pdf2json 提取 PDF 文本
 * 纯 Node.js，不依赖 Canvas/DOM，Vercel 兼容
 */
import PDFParser from "pdf2json";

export async function extractPDFText(buffer: ArrayBuffer): Promise<string> {
  const pdfParser = new PDFParser();

  return new Promise((resolve, reject) => {
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        const texts: string[] = [];

        for (const page of pdfData.Pages) {
          const pageTexts: string[] = [];

          for (const text of page.Texts) {
            // 每个 text 的 R 数组包含 [{T: "文字内容", ...}]
            const line = text.R
              .map((r) => decodeURIComponent(r.T))
              .filter((t) => t.trim())
              .join(" ");
            if (line.trim()) {
              pageTexts.push(line);
            }
          }

          texts.push(pageTexts.join("\n"));
        }

        resolve(texts.join("\n\n"));
      } catch (e) {
        reject(e);
      }
    });

    pdfParser.on("pdfParser_dataError", (err) => {
      const msg = (err as { parserError?: Error }).parserError?.message || "未知解析错误";
      reject(new Error(`PDF 解析失败: ${msg}`));
    });

    // 传入 Buffer
    const nodeBuffer = Buffer.from(buffer);
    pdfParser.parseBuffer(nodeBuffer);
  });
}
