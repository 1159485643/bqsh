export async function onRequestPost({ request, env }) {
  return new Response(JSON.stringify({
    ok:false,
    message:"当前版本已切换为 SaaS 飞书登录，请使用 /api/feishu-login"
  }), {
    status: 400,
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok:true,
    mode:"saas",
    hasAppId:!!env.FEISHU_APP_ID,
    hasSecret:!!env.FEISHU_APP_SECRET,
    hasKv:!!env.FEISHU_KV
  }), {
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}
