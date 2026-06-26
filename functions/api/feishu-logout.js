export async function onRequestPost({ request, env }) {
  try {
    const sessionId = getCookie(request, "feishu_session");
    if (sessionId && env.FEISHU_KV) {
      await env.FEISHU_KV.delete(`session:${sessionId}`);
    }
    return json({ ok:true }, 200, {
      "Set-Cookie": "feishu_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    });
  } catch (e) {
    return json({ ok:false, message:e.message || String(e) }, 500);
  }
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function json(data, status=200, extraHeaders={}){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "Content-Type":"application/json; charset=utf-8", ...extraHeaders }
  });
}
