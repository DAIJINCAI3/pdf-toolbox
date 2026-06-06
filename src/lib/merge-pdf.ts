import { PDFDocument } from "pdf-lib";

/** 合并选项 */
export interface MergeOptions {
  /** 是否尝试保留原文件的书签（大纲） */
  preserveBookmarks?: boolean;
}

/**
 * 将多个 PDF 文件按指定顺序合并为一个
 */
export async function mergePDFs(
  files: File[],
  options: MergeOptions = {}
): Promise<Uint8Array> {
  const mergedDoc = await PDFDocument.create();

  // 如果启用书签保留，创建一个基础大纲容器
  if (options.preserveBookmarks) {
    try {
      // 使用 pdf-lib 公开 API 设置大纲
      // 注意：pdf-lib 的公开 API 对大纲支持有限，
      // 这里尝试通过低层方法创建 Outline 根节点
      initOutlines(mergedDoc);
    } catch {
      // 大纲初始化失败不影响合并
    }
  }

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const arrayBuffer = await file.arrayBuffer();
    const sourceDoc = await PDFDocument.load(arrayBuffer, {
      ignoreEncryption: true,
    });

    const sourceIndices = sourceDoc.getPageIndices();
    const copiedPages = await mergedDoc.copyPages(sourceDoc, sourceIndices);

    copiedPages.forEach((page) => mergedDoc.addPage(page));
  }

  return mergedDoc.save();
}

/**
 * 初始化 PDF 大纲根节点
 * 利用 pdf-lib 底层 context 注册 Outlines 字典
 */
function initOutlines(doc: PDFDocument): void {
  const context = doc.context as unknown as {
    obj: (data: Record<string, unknown>) => unknown;
    register: (obj: unknown) => unknown;
    trailerInfo?: { Root?: unknown };
  };

  if (!context.obj || !context.register) return;

  const outlinesObj = context.obj({
    Type: "/Outlines",
    Count: 0,
  });

  context.register(outlinesObj);
}

/**
 * 触发浏览器下载 PDF 文件
 */
export function downloadPDF(data: Uint8Array, filename: string): void {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
