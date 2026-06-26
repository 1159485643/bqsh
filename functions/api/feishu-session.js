export async function onRequestGet({ request, env }) {
  try {
    if (!env.FEISHU_KV) return json({ ok:false, loggedIn:false, message:"缺少 KV 绑定 FEISHU_KV" }, 500);

    const sessionId = getCookie(request, "feishu_session");
    if (!sessionId) return json({ ok:true, loggedIn:false });

    const session = await getSession(env, sessionId);
    if (!session) return json({ ok:true, loggedIn:false });

    return json({
      ok:true,
      loggedIn:true,
      userId: session.user_id || session.token?.open_id || session.token?.user_id || "",
      userName: session.user_name || session.token?.name || ""
    });
  } catch (e) {
    return json({ ok:false, loggedIn:false, message:e.message || String(e) }, 500);
  }
}

async function getSession(env, sessionId) {
  const text = await env.FEISHU_KV.get(`session:${sessionId}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch(e) { return null; }
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}
