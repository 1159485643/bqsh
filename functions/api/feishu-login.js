export async function onRequestGet({ request, env }) {
  try {
    const appId = env.FEISHU_APP_ID;
    if (!appId) return text("缺少 FEISHU_APP_ID", 500);

    const redirectUri = getRedirectUri(request, env);
    const state = crypto.randomUUID();

    const url = new URL("https://open.feishu.cn/open-apis/authen/v1/authorize");
    url.searchParams.set("app_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "wiki:node:read sheets:spreadsheet");

    return new Response(null, {
      status: 302,
      headers: {
        "Location": url.toString(),
        "Set-Cookie": cookie("feishu_oauth_state", state, 600)
      }
    });
  } catch (e) {
    return text(e.message || String(e), 500);
  }
}

function getRedirectUri(request, env) {
  if (env.FEISHU_REDIRECT_URI) return env.FEISHU_REDIRECT_URI;
  const u = new URL(request.url);
  return `${u.origin}/api/feishu-oauth-callback`;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function text(message, status=200) {
  return new Response(message, { status, headers:{ "Content-Type":"text/plain; charset=utf-8" } });
}
