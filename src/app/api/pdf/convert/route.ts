import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

// 动态加载 Node.js 原生模块，避免 Turbopack 静态分析警告
let _execSync: typeof import("child_process").execSync;
let _writeFileSync: typeof import("fs").writeFileSync;
let _readFileSync: typeof import("fs").readFileSync;
let _unlinkSync: typeof import("fs").unlinkSync;
let _tmpdir: typeof import("os").tmpdir;
let _join: typeof import("path").join;
let _randomUUID: typeof import("crypto").randomUUID;

function loadNodeModules() {
  if (!_execSync) {
    _execSync = require("child_process").execSync;
    _writeFileSync = require("fs").writeFileSync;
    _readFileSync = require("fs").readFileSync;
    _unlinkSync = require("fs").unlinkSync;
    _tmpdir = require("os").tmpdir;
    _join = require("path").join;
    _randomUUID = require("crypto").randomUUID;
  }
  return { _execSync, _writeFileSync, _readFileSync, _unlinkSync, _tmpdir, _join, _randomUUID };
}

const FORMATS: Record<string, { ext: string; mime: string }> = {
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
};

function hasLibreOffice(): boolean {
  try {
    const { _execSync: exec } = loadNodeModules();
    exec("soffice --version", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    try {
      const { _execSync: exec } = loadNodeModules();
      exec("libreoffice --version", { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const rl = rateLimit({ windowMs: 60 * 1000, max: 3, getKey: () => `convert:${ip}` });
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  if (!hasLibreOffice()) {
    return NextResponse.json({
      error: "服务器未安装 LibreOffice，此功能暂不可用。",
      installGuide: "VPS: sudo apt-get install libreoffice -y\nmacOS: brew install --cask libreoffice\nWindows: https://www.libreoffice.org/download/",
      tip: "当前部署在 Vercel（Serverless），不支持此功能。请迁移到 VPS 后使用。",
    }, { status: 503 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const targetFormat = (formData.get("format") as string) || "docx";

    if (!file) return NextResponse.json({ error: "请上传 PDF" }, { status: 400 });
    if (!FORMATS[targetFormat]) return NextResponse.json({ error: `不支持的格式: ${targetFormat}` }, { status: 400 });

    const { _execSync: exec, _writeFileSync: writeFile, _readFileSync: readFile, _unlinkSync: unlink, _tmpdir: tmpDirFn, _join: joinFn, _randomUUID: uuidFn } = loadNodeModules();

    const fmt = FORMATS[targetFormat];
    const tempDir = tmpDirFn();
    const inputId = uuidFn();
    const inputPath = joinFn(tempDir, `${inputId}.pdf`);
    const outputDir = joinFn(tempDir, inputId);
    const outputPath = joinFn(outputDir, `${inputId}.${fmt.ext}`);

    const bytes = await file.arrayBuffer();
    writeFile(inputPath, Buffer.from(bytes));

    exec(`soffice --headless --convert-to ${fmt.ext} --outdir "${outputDir}" "${inputPath}"`, { timeout: 60000 });

    const result = readFile(outputPath);
    try { unlink(inputPath); unlink(outputPath); } catch { /* ignore */ }

    return new NextResponse(result, {
      headers: {
        "Content-Type": fmt.mime,
        "Content-Disposition": `attachment; filename="converted.${fmt.ext}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: `转换失败：${msg}` }, { status: 500 });
  }
}
