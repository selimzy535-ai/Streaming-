export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    try {
      const url = new URL(request.url);
      const file_id = url.searchParams.get('file_id');
      const botId = url.searchParams.get('botId') || '0';
      if (!file_id) return new Response(JSON.stringify({error:'file_id required'}), {status:400});

      const BOT_TOKENS = (env.BOT_TOKENS||'').split(',').map(s=>s.trim()).filter(Boolean);
      if (!BOT_TOKENS.length) return new Response('BOT_TOKENS not set', {status:500});

      const token = BOT_TOKENS[parseInt(botId)||0] || BOT_TOKENS[0];

      // KV cache file_path 3h
      const kvKey = `tg_path:${file_id}`;
      let filePath = await env.STREAM_KV.get(kvKey);
      if (!filePath) {
        const tgInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);
        const tgInfo = await tgInfoRes.json();
        if (!tgInfo.ok) return new Response(JSON.stringify(tgInfo), {status:404});
        filePath = tgInfo.result.file_path;
        ctx.waitUntil(env.STREAM_KV.put(kvKey, filePath, {expirationTtl:10800}));
      }

      const tgFileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const range = request.headers.get('Range');

      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}/cache/${file_id}`, request);

      // Only use cache for full file (no range)
      if (!range) {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
      }

      const originRes = await fetch(tgFileUrl, {
        headers: range? {Range: range} : {}
      });

      if (!originRes.ok) {
        // clear bad KV
        await env.STREAM_KV.delete(kvKey);
        return new Response('Upstream failed', {status:502});
      }

      const headers = new Headers();
      // Force mp4 so Android ExoPlayer understands
      headers.set('Content-Type', 'video/mp4');
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      headers.set('Cache-Control', 'public, max-age=14400');

      if (originRes.headers.get('Content-Length')) headers.set('Content-Length', originRes.headers.get('Content-Length'));
      if (originRes.headers.get('Content-Range')) headers.set('Content-Range', originRes.headers.get('Content-Range'));

      const res = new Response(originRes.body, {
        status: originRes.status, // 200 or 206
        headers
      });

      if (!range && originRes.status === 200) {
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      }

      return res;

    } catch(e){
      return new Response(JSON.stringify({error:e.message}), {status:500, headers:{'Access-Control-Allow-Origin':'*'}});
    }
  }
}