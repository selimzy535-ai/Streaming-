export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': 'https://golviral.com',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
        }
      });
    }

    const { searchParams } = new URL(request.url);
    let tgUrl = searchParams.get('src');
    const file_id = searchParams.get('file_id');
    const botId = searchParams.get('botId') || '0';

    if (!tgUrl && file_id) {
      const tokens = (env.BOT_TOKENS || '').split(',').map(s=>s.trim()).filter(Boolean);
      const token = tokens[parseInt(botId)] || tokens[0];
      if (!token) return new Response('BOT_TOKENS missing', {status:500});
      const info = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`).then(r=>r.json());
      if (!info.ok) return new Response(JSON.stringify(info), {status:502});
      tgUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    }
    if (!tgUrl) return new Response('src required', {status:400});

    const range = request.headers.get('Range');
    const upstream = await fetch(tgUrl, {
      headers: range? { Range: range } : {},
      cf: { cacheEverything: true, cacheTtl: 86400 } // cache at edge, fix your 3.84s delay
    });

    const h = new Headers();
    // THIS FIXES YOUR DOWNLOAD ISSUE
    h.set('Content-Type', 'video/mp4');
    h.set('Accept-Ranges', 'bytes');
    h.set('Content-Disposition', 'inline'); // not attachment
    h.set('Access-Control-Allow-Origin', 'https://golviral.com');
    h.set('Access-Control-Allow-Headers', 'Range');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
    h.set('Cache-Control', 'public, max-age=31536000');
    // Cloudflare cache but browser revalidates per postId
    if (upstream.headers.get('Content-Length')) h.set('Content-Length', upstream.headers.get('Content-Length'));
    if (upstream.headers.get('Content-Range')) h.set('Content-Range', upstream.headers.get('Content-Range'));

    return new Response(upstream.body, { status: upstream.status, headers: h });
  }
}