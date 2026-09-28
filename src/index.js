// golviral-stream worker - new version
export default {
  async fetch(request, env) {
    const { searchParams } = new URL(request.url);
    let tgUrl = searchParams.get('src'); // direct https://api.telegram.org/file/bot.../path.mp4
    const file_id = searchParams.get('file_id');
    const botId = searchParams.get('botId') || '0';

    if (!tgUrl && file_id) {
      // fallback old way
      const token = env.BOT_TOKENS?.[parseInt(botId)] || env.BOT_TOKENS?.[0];
      if (!token) return new Response('BOT_TOKENS missing', {status:500});
      const info = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`).then(r=>r.json());
      if (!info.ok) return new Response(JSON.stringify(info), {status:502});
      tgUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    }
    if (!tgUrl) return new Response(JSON.stringify({error:'src or file_id required'}), {status:400});

    const range = request.headers.get('Range');
    const upstream = await fetch(tgUrl, { headers: range? {Range: range} : {} });

    const h = new Headers();
    h.set('Content-Type', 'video/mp4');
    h.set('Accept-Ranges', 'bytes');
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Headers', 'Range');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    h.set('Cache-Control', 'public, max-age=3600');
    if (upstream.headers.get('Content-Length')) h.set('Content-Length', upstream.headers.get('Content-Length'));
    if (upstream.headers.get('Content-Range')) h.set('Content-Range', upstream.headers.get('Content-Range'));

    return new Response(upstream.body, { status: upstream.status, headers: h });
  }
}