const DEFAULT_ALLOWED_ORIGINS = [
  'https://famlykin.io.vn',
  'https://www.famlykin.io.vn',
  'https://famlykin.pages.dev',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

const PAGES_PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.famlykin\.pages\.dev$/i;

/**
 * Kiểm tra Origin có nằm trong danh sách domain được phép truy cập API hay không.
 */
export function isAllowedOrigin(origin?: string | null): boolean {
  if (!origin) return false;
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin) || PAGES_PREVIEW_ORIGIN_RE.test(origin)) {
    return true;
  }
  const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return extraOrigins.includes(origin);
}

/**
 * Tạo CORS headers an toàn cho Cloudflare Workers (không phản chiếu Origin lạ kèm credentials).
 */
export function buildCorsHeaders(origin?: string | null): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
