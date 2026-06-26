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

    // 飞书 OAuth 文档要求 scope 使用空格分隔；这里允许 Cloudflare 变量 FEISHU_OAUTH_SCOPE 覆盖。
    // 默认只请求本工具需要的用户身份权限。
    const scope = (env.FEISHU_OAUTH_SCOPE || "wiki:node:read sheets:spreadsheet").trim();
    if (scope) url.searchParams.set("scope", scope);

    const headers = new Headers();
    headers.set("Location", url.toString());
    headers.append("Set-Cookie", cookie("feishu_oauth_state", state, 600));

    return new Response(null, { status: 302, headers });
  } catch (e) {
    return text(e.message || String(e), 500);
  }
}

function getRedirectUri(request, env) {
  if (env.FEISHU_REDIRECT_URI) return env.FEISHU_REDIRECT_URI.trim();
  const u = new URL(request.url);
  return `${u.origin}/api/feishu-oauth-callback`;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function text(message, status=200) {
  return new Response(message, { status, headers:{ "Content-Type":"text/plain; charset=utf-8" } });
}
