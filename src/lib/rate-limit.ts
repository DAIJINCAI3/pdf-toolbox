/**
 * 简易内存限流器（用于 Next.js API Routes）
 * 每个 IP 每分钟最多 N 次请求
 */

const store = new Map<string, { count: number; resetAt: number }>();

// 每 5 分钟清理一次过期条目
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export function rateLimit(opts: {
  windowMs: number; // 时间窗口（毫秒）
  max: number; // 窗口内最大请求数
  getKey: () => string; // 获取限流键的函数
}): { ok: boolean; message?: string } {
  const key = opts.getKey();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true };
  }

  if (entry.count >= opts.max) {
    const retrySec = Math.ceil((entry.resetAt - now) / 1000);
    return {
      ok: false,
      message: `请求过于频繁，请在 ${retrySec} 秒后重试`,
    };
  }

  entry.count++;
  return { ok: true };
}
