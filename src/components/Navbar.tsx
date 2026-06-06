"use client";

import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold text-gray-900 no-underline"
        >
          📄 PDF工具箱
        </Link>
        <div className="flex gap-4 text-sm">
          <Link
            href="/"
            className="text-gray-600 no-underline hover:text-blue-600"
          >
            首页
          </Link>
          <Link
            href="/tools/ai"
            className="text-gray-600 no-underline hover:text-blue-600"
          >
            AI
          </Link>
          <Link
            href="/tools/convert"
            className="text-gray-600 no-underline hover:text-blue-600"
          >
            转换
          </Link>
          <Link
            href="/pricing"
            className="text-gray-600 no-underline hover:text-blue-600"
          >
            付费套餐
          </Link>
        </div>
      </div>
    </nav>
  );
}
