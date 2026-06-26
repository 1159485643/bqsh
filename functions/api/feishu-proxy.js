const FEISHU_OPEN_API = 'https://open.feishu.cn/open-apis';

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      ...extraHeaders,
    },
  });
}

export async function onRequestOptions() {
  return jsonResponse({ ok: true });
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const path = String(payload.path || '');
    const method = String(payload.method || 'GET').toUpperCase();
    const body = payload.body;
    const inputHeaders = payload.headers || {};

    if (!path.startsWith('/')) {
      return jsonResponse({ code: -1, msg: '代理请求缺少合法 path，必须以 / 开头。', received: { path } }, 400);
    }

    // 只允许转发到飞书 open-apis，避免代理被滥用。
    const url = FEISHU_OPEN_API + path;

    const headers = new Headers();
    headers.set('content-type', 'application/json; charset=utf-8');
    const authorization = inputHeaders.Authorization || inputHeaders.authorization;
    if (authorization) headers.set('authorization', authorization);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
      init.body = JSON.stringify(body);
    }

    const upstream = await fetch(url, init);
    const text = await upstream.text();

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { code: -2, msg: '飞书接口返回非 JSON 内容', raw: text.slice(0, 1000) };
    }

    return jsonResponse(data, upstream.status, {
      'x-feishu-proxy-url': url,
      'x-feishu-proxy-status': String(upstream.status),
    });
  } catch (error) {
    return jsonResponse({
      code: -500,
      msg: 'Cloudflare 飞书代理执行失败',
      detail: error && error.message ? error.message : String(error),
    }, 500);
  }
}
