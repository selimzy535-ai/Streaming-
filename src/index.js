export default {
  async fetch(request, env, ctx) {
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

      // KV cache file_path 3h - your logic good
      const kvKey = `tg_path:${file_id}`;
      let filePath = await env.STREAM_KV.get(kvKey);
      if (!filePath) {
        const tgInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(file_id)}`);
        const tgInfo = await tgInfoRes.json();
        if (!tgInfo.ok) {
          await env.STREAM_KV.delete(kvKey);
          return new Response(JSON.stringify(tgInfo), {status:404, headers:{'Access-Control-Allow-Origin':'*'}});
        }
        filePath = tgInfo.result.file_path;
        ctx.waitUntil(env.STREAM_KV.put(kvKey, filePath, {expirationTtl:10800}));
      }

      const tgFileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const range = request.headers.get('Range');

      const originRes = await fetch(tgFileUrl, {
        headers: range? {Range: range} : {}
      });

      if (!originRes.ok) {
        await env.STREAM_KV.delete(kvKey);
        return new Response('Upstream failed', {status:502, headers:{'Access-Control-Allow-Origin':'*'}});
      }

      const headers = new Headers();
      // FIX 1: keep original type, not force mp4
      const isImage = filePath.match(/\.(jpg|jpeg|png|webp)$/i);
      headers.set('Content-Type', isImage? (isImage[0]==='.webp'?'image/webp':'image/jpeg') : 'video/mp4');
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      headers.set('Cache-Control', 'no-store'); // FIX 2: no CF cache for video

      if (originRes.headers.get('Content-Length')) headers.set('Content-Length', originRes.headers.get('Content-Length'));
      if (originRes.headers.get('Content-Range')) headers.set('Content-Range', originRes.headers.get('Content-Range'));

      return new Response(originRes.body, {
        status: originRes.status,
        headers
      });

    } catch(e){
      return new Response(JSON.stringify({error:e.message}), {status:500, headers:{'Access-Control-Allow-Origin':'*'}});
    }
  }
}