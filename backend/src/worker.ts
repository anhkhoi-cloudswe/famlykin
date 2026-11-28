import http from 'http';
import { handleAsNodeRequest } from 'cloudflare:node';
import app from './index';
import { setWorkerEnv } from './services/email.service';
import { buildCorsHeaders } from './utils/cors';
import { createPrismaInstance } from './prisma';

let server: http.Server | null = null;
let serverPort = 8080;

function ensureServer(): number {
  if (!server) {
    server = http.createServer(app);
    server.listen(serverPort);
  }
  return serverPort;
}

// Cloudflare Workers fetch handler
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // Inject biến môi trường từ Cloudflare Workers runtime
    setWorkerEnv(env);
    if (env.DATABASE_URL) {
      process.env.DATABASE_URL = env.DATABASE_URL;
    }
    if (env.JWT_SECRET) {
      process.env.JWT_SECRET = env.JWT_SECRET;
    }

    const url = new URL(request.url);
    
    // Fallback response cho health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'FamilyTree Cloudflare Backend' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Xử lý CORS Preflight an toàn ở cấp Worker
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') {
      const corsHeaders = buildCorsHeaders(origin);
      return new Response(null, {
        status: Object.keys(corsHeaders).length > 0 ? 204 : 403,
        headers: corsHeaders,
      });
    }

    try {
      // Chuyển quyền xử lý cho Express qua Node HTTP bridge
      const port = ensureServer();
      const response = await handleAsNodeRequest(port, request, env, ctx);
      return response;
    } catch (err: any) {
      console.error('[Cloudflare Worker Error]:', err);
      return new Response(
        JSON.stringify({ error: err?.message || 'Đã xảy ra lỗi máy chủ nội bộ.' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
            ...buildCorsHeaders(origin),
          },
        }
      );
    }
  },

  // Cron Trigger giữ kết nối Supabase không bị pause (chạy mỗi 3 ngày lúc 03:00 UTC)
  async scheduled(_controller: ScheduledController, env: any, _ctx: ExecutionContext): Promise<void> {
    const connectionString = env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[KeepAlive] Thiếu biến môi trường DATABASE_URL trên Cloudflare Worker.');
    }

    const { prisma, cleanup } = createPrismaInstance(connectionString);
    const startedAt = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - startedAt;
      await prisma.systemHeartbeat.upsert({
        where: { id: 'supabase-keepalive' },
        update: {
          status: 'OK',
          lastSource: 'CRON',
          lastRunAt: new Date(),
          latencyMs,
          errorMessage: null,
          totalRuns: { increment: 1 },
        },
        create: {
          id: 'supabase-keepalive',
          status: 'OK',
          lastSource: 'CRON',
          lastRunAt: new Date(),
          latencyMs,
          errorMessage: null,
          totalRuns: 1,
        },
      });
      console.log(`[KeepAlive] Ping Supabase thành công lúc ${new Date().toISOString()} (${latencyMs}ms)`);
    } catch (err: any) {
      const latencyMs = Date.now() - startedAt;
      console.error('[KeepAlive] Ping Supabase thất bại:', err);
      try {
        await prisma.systemHeartbeat.upsert({
          where: { id: 'supabase-keepalive' },
          update: {
            status: 'ERROR',
            lastSource: 'CRON',
            lastRunAt: new Date(),
            latencyMs,
            errorMessage: String(err?.message || err).slice(0, 500),
            totalRuns: { increment: 1 },
          },
          create: {
            id: 'supabase-keepalive',
            status: 'ERROR',
            lastSource: 'CRON',
            lastRunAt: new Date(),
            latencyMs,
            errorMessage: String(err?.message || err).slice(0, 500),
            totalRuns: 1,
          },
        });
      } catch (recordErr) {
        console.warn('[KeepAlive] Không thể ghi trạng thái lỗi vào SystemHeartbeat:', recordErr);
      }
      throw err; // Để Cloudflare Workers đánh dấu cron run là Failed trên Dashboard
    } finally {
      try {
        await cleanup();
      } catch (cleanupErr) {
        console.warn('[KeepAlive] Lỗi khi đóng kết nối cleanup:', cleanupErr);
      }
    }
  },
};
