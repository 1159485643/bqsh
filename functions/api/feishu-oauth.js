export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === "config") return json({ ok:true });

    const appId = body.appId || "";
    const appSecret = body.appSecret || "";

    if (!appId || !appSecret) {
      return json({ ok:false, message:"缺少 App ID 或 App Secret" }, 400);
    }

    if (action === "exchange") {
      if (!body.code) return json({ ok:false, message:"缺少授权 code" }, 400);
      const payload = {
        grant_type:"authorization_code",
        client_id:appId,
        client_secret:appSecret,
        code:body.code
      };
      if (body.redirectUri) payload.redirect_uri = body.redirectUri;
      const token = await tokenRequest(payload);
      return json({ ok:true, token });
    }

    if (action === "refresh") {
      if (!body.refreshToken) return json({ ok:false, message:"缺少 refresh_token" }, 400);
      const token = await tokenRequest({
        grant_type:"refresh_token",
        client_id:appId,
        client_secret:appSecret,
        refresh_token:body.refreshToken
      });
      return json({ ok:true, token });
    }

    return json({ ok:false, message:"未知 OAuth action" }, 400);
  } catch (e) {
    return json({ ok:false, message:e.message || String(e) }, 500);
  }
}

async function tokenRequest(payload){
  const res = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method:"POST",
    headers:{ "Content-Type":"application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || data.error || data.code) {
    throw new Error(data.error_description || data.message || data.msg || `OAuth token 接口失败：${res.status}`);
  }
  return data;
}

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}
