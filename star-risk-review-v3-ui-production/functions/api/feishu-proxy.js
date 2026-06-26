export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const { action, config, record, count } = body;
    if (!config?.appId || !config?.appSecret) return json({ ok:false, message:"缺少 App ID 或 App Secret" }, 400);
    if (!config?.feishuUrl) return json({ ok:false, message:"缺少飞书链接" }, 400);

    const meta = parseFeishuUrl(config.feishuUrl);
    if (!meta.spreadsheetToken) return json({ ok:false, message:"无法从链接解析 spreadsheet token，请确认是飞书 Sheets 链接" }, 400);

    const token = await getTenantToken(config.appId, config.appSecret);
    const sheetId = meta.sheetId || await getFirstSheetId(token, meta.spreadsheetToken);
    if (!sheetId) return json({ ok:false, message:"无法获取工作表 sheetId" }, 400);

    if (action === "get") {
      const { headers, rows } = await readAll(token, meta.spreadsheetToken, sheetId);
      return json({ ok:true, headers, rows });
    }

    if (action === "claim") {
      const { headers, rows } = await readAll(token, meta.spreadsheetToken, sheetId);
      const handlerField = config.handlerField || "处理人";
      const statusField = config.statusField || "审核状态";
      const handlerIdx = ensureHeader(headers, handlerField);
      const statusIdx = ensureHeader(headers, statusField);
      let claimed = 0;
      const updates = [];
      for (const row of rows) {
        if (claimed >= Number(count || 20)) break;
        const h = String(row[handlerField] || "").trim();
        const s = String(row[statusField] || "").trim();
        if (!h && (!s || s === "待审核" || s === "未复审")) {
          updates.push({ rowIndex: row.__rowIndex, values: { [handlerField]: config.handlerName, [statusField]: s || "待审核" } });
          claimed++;
        }
      }
      for (const u of updates) await updateRow(token, meta.spreadsheetToken, sheetId, headers, u.rowIndex, u.values);
      return json({ ok:true, count:claimed });
    }

    if (action === "update") {
      const { headers } = await readAll(token, meta.spreadsheetToken, sheetId);
      const handlerField = config.handlerField || "处理人";
      const statusField = config.statusField || "审核状态";
      const reasonField = config.reasonField || "审核备注";
      const timeField = config.timeField || "审核时间";
      const values = {};
      values[handlerField] = record.handler || config.handlerName || "";
      values[statusField] = record.status || "待审核";
      values[reasonField] = record.reason || "";
      values[timeField] = record.reviewTime || "";
      await updateRow(token, meta.spreadsheetToken, sheetId, headers, record._rowIndex, values);
      return json({ ok:true });
    }

    return json({ ok:false, message:"未知 action" }, 400);
  } catch (e) {
    return json({ ok:false, message:e.message || String(e) }, 500);
  }
}

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{ "Content-Type":"application/json; charset=utf-8" } }); }

async function getTenantToken(appId, appSecret){
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ app_id:appId, app_secret:appSecret })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取 tenant_access_token 失败：${data.msg || data.code}`);
  return data.tenant_access_token;
}

function parseFeishuUrl(url){
  const s = String(url || "");
  const m = s.match(/\/sheets\/([A-Za-z0-9]+)/);
  let sheetId = "";
  try { const u = new URL(s); sheetId = u.searchParams.get("sheet") || u.searchParams.get("sheetId") || ""; } catch(e){}
  return { spreadsheetToken: m ? m[1] : "", sheetId };
}

async function getFirstSheetId(token, spreadsheetToken){
  const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, {
    headers:{ Authorization:`Bearer ${token}` }
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取工作表失败：${data.msg || data.code}`);
  return data.data?.sheets?.[0]?.sheet_id || data.data?.sheets?.[0]?.sheetId || "";
}

async function readAll(token, spreadsheetToken, sheetId){
  const range = `${sheetId}!A1:ZZ5000`;
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`读取表格失败：${data.msg || data.code}`);
  const values = data.data?.valueRange?.values || [];
  const headers = (values[0] || []).map(v => String(v || "").trim());
  const rows = values.slice(1).map((r, i) => {
    const obj = { __rowIndex:i+2 };
    headers.forEach((h, idx)=>{ if(h) obj[h] = r[idx] ?? ""; });
    return obj;
  }).filter(row => Object.keys(row).some(k => k !== "__rowIndex" && String(row[k] || "").trim()));
  return { headers, rows };
}

function ensureHeader(headers, name){
  let idx = headers.indexOf(name);
  if (idx === -1) {
    headers.push(name);
    idx = headers.length - 1;
  }
  return idx;
}

function colName(n){
  let s = "";
  while(n > 0){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function updateRow(token, spreadsheetToken, sheetId, headers, rowIndex, valuesObj){
  if (!rowIndex) throw new Error("缺少行号，无法写回");
  const maxCol = Math.max(headers.length, ...Object.keys(valuesObj).map(k => {
    const idx = headers.indexOf(k);
    return idx >= 0 ? idx + 1 : headers.length + 1;
  }));
  const row = new Array(maxCol).fill("");
  for (const [k,v] of Object.entries(valuesObj)) {
    let idx = headers.indexOf(k);
    if (idx === -1) { headers.push(k); idx = headers.length - 1; }
    row[idx] = v;
  }
  const range = `${sheetId}!A${rowIndex}:${colName(maxCol)}${rowIndex}`;
  const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`, {
    method:"PUT",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
    body: JSON.stringify({ valueRange:{ range, values:[row] } })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`写回表格失败：${data.msg || data.code}`);
}
