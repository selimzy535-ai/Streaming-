
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const file_id = url.searchParams.get('file_id');
      const botId = url.searchParams.get('botId') || '0';

      if (!file_id) {
        return new Response(JSON.stringify({ error: 'file_id required' }), { status: 400 });
      }

      const BOT_TOKENS = (env.BOT_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!BOT_TOKENS.length) return new Response('BOT_TOKENS not set', { status: 500 });

      const botIndex = parseInt(botId) || 0;
      const token = BOT_TOKENS[botIndex] || BOT_TOKENS[0];

      // Cache file_path in KV for 3h to avoid getFile every time
      const kvKey = `tg_path:${file_id}`;
      let filePath = await env.STREAM_KV.get(kvKey);

      if (!filePath) {
        const tgInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);
        const tgInfo = await tgInfoRes.json();
        if (!tgInfo.ok) {
          return new Response(JSON.stringify({ error: 'Telegram file not found', details: tgInfo }), { status: 404 });
        }
        filePath = tgInfo.result.file_path;
        ctx.waitUntil(env.STREAM_KV.put(kvKey, filePath, { expirationTtl: 10800 }));
      }

      const tgFileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

      // Check if request is Android — we still proxy for all, but we cache differently
      const ua = request.headers.get('User-Agent') || '';
      const isAndroid = /android/i.test(ua);
      const range = request.headers.get('Range');

      // Try Cloudflare Cache API
      const cache = caches.default;
      // For Range requests, don't use cache match with range header
      let cachedRes = null;
      if (!range) {
        cachedRes = await cache.match(request);
        if (cachedRes) return cachedRes;
      }

      // Fetch from Telegram with Range forwarded
      const fetchHeaders = {};
      if (range) fetchHeaders['Range'] = range;

      const originRes = await fetch(tgFileUrl, { headers: fetchHeaders });

      if (!originRes.ok &&!originRes.status.toString().startsWith('2')) {
        // Fallback to B2 if you set B2 URL later
        if (env.B2_FALLBACK_URL) {
          return Response.redirect(`${env.B2_FALLBACK_URL}?file_id=${file_id}`, 302);
        }
        return new Response('Upstream fetch failed', { status: 502 });
      }

      const responseHeaders = new Headers();
      responseHeaders.set('Content-Type', originRes.headers.get('Content-Type') || 'video/mp4');
      responseHeaders.set('Accept-Ranges', 'bytes');
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Cache-Control', 'public, max-age=14400'); // 4h
      if (originRes.headers.get('Content-Length')) responseHeaders.set('Content-Length', originRes.headers.get('Content-Length'));
      if (originRes.headers.get('Content-Range')) responseHeaders.set('Content-Range', originRes.headers.get('Content-Range'));
      if (originRes.headers.get('Content-Type')) responseHeaders.set('Content-Type', originRes.headers.get('Content-Type'));

      const finalRes = new Response(originRes.body, {
        status: originRes.status,
        headers: responseHeaders
      });

      // Cache only full file, not range chunks
      if (!range && finalRes.status === 200) {
        ctx.waitUntil(cache.put(request, finalRes.clone()));
      }

      return finalRes;

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }
}
