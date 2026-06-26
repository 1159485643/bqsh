export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = url.origin;

  try {
    if (!env.FEISHU_KV) throw new Error("缺少 KV 绑定 FEISHU_KV");
    if (!env.FEISHU_APP_ID) throw new Error("缺少 FEISHU_APP_ID");
    if (!env.FEISHU_APP_SECRET) throw new Error("缺少 FEISHU_APP_SECRET");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const savedState = getCookie(request, "feishu_oauth_state");

    if (!code) {
      throw new Error("缺少授权 code：请从页面点击“飞书登录”，不要直接打开 callback 地址");
    }
    if (!state || !savedState || state !== savedState) {
      throw new Error("OAuth state 校验失败，请重新点击“飞书登录”");
    }

    const redirectUri = (env.FEISHU_REDIRECT_URI || `${origin}/api/feishu-oauth-callback`).trim();
    const token = await tokenRequest({
      grant_type: "authorization_code",
      client_id: env.FEISHU_APP_ID,
      client_secret: env.FEISHU_APP_SECRET,
      code,
      redirect_uri: redirectUri
    });

    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const expiresIn = Number(token.expires_in || token.expire || 7200);
    token.expires_at = now + Math.max(60, expiresIn - 120) * 1000;

    const session = {
      token,
      created_at: now,
      updated_at: now,
      user_id: token.open_id || token.user_id || token.union_id || "",
      user_name: token.name || token.en_name || ""
    };

    await env.FEISHU_KV.put(`session:${sessionId}`, JSON.stringify(session), {
      expirationTtl: 60 * 60 * 24 * 30
    });

    const headers = new Headers();
    headers.set("Location", `${origin}/?feishu_login=success`);
    headers.append("Set-Cookie", clearCookie("feishu_oauth_state"));
    headers.append("Set-Cookie", cookie("feishu_session", sessionId, 60 * 60 * 24 * 30));

    return new Response(null, { status: 302, headers });
  } catch (e) {
    const msg = encodeURIComponent(e.message || String(e));
    const headers = new Headers();
    headers.set("Location", `${origin}/?feishu_error=${msg}`);
    headers.append("Set-Cookie", clearCookie("feishu_oauth_state"));
    return new Response(null, { status: 302, headers });
  }
}

async function tokenRequest(payload) {
  const res = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const raw = await res.json().catch(() => ({}));
  const data = raw.data || raw;
  if (!res.ok || raw.error || raw.code) {
    throw new Error(raw.error_description || raw.message || raw.msg || `OAuth token 接口失败：${res.status}`);
  }
  return data;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
