export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const { action, config, record, count, accessToken } = body;

    if (!accessToken) return json({ ok:false, message:"缺少 user_access_token，请先飞书授权登录" }, 401);
    if (!config?.feishuUrl) return json({ ok:false, message:"缺少飞书链接" }, 400);

    const meta = parseFeishuUrl(config.feishuUrl);
    if (!meta.spreadsheetToken) return json({ ok:false, message:"无法从链接解析 spreadsheet token，请确认是飞书 Sheets 链接" }, 400);

    const sheetId = meta.sheetId || await getFirstSheetId(accessToken, meta.spreadsheetToken);
    if (!sheetId) return json({ ok:false, message:"无法获取工作表 sheetId" }, 400);

    if (action === "get") {
      const { headers, rows } = await readAll(accessToken, meta.spreadsheetToken, sheetId, Number(config.maxRows || 5000));
      return json({ ok:true, headers, rows });
    }

    if (action === "claim") {
      const { headers, rows } = await readAll(accessToken, meta.spreadsheetToken, sheetId, Number(config.maxRows || 5000));
      const handlerField = config.handlerField || "处理人";
      const statusField = config.statusField || "审核状态";
      const handlerCol = ensureHeader(headers, handlerField);
      const statusCol = ensureHeader(headers, statusField);

      let claimed = 0;
      for (const row of rows) {
        if (claimed >= Number(count || 20)) break;
        const h = String(row[handlerField] || "").trim();
        const s = String(row[statusField] || "").trim();
        if (!h && (!s || s === "待审核" || s === "未复审")) {
          await updateCells(accessToken, meta.spreadsheetToken, sheetId, row.__rowIndex, {
            [handlerCol]: config.handlerName || "",
            [statusCol]: s || "待审核"
          });
          claimed++;
        }
      }
      return json({ ok:true, count:claimed });
    }

    if (action === "update") {
      const { headers } = await readAll(accessToken, meta.spreadsheetToken, sheetId, 5);
      const handlerField = config.handlerField || "处理人";
      const statusField = config.statusField || "审核状态";
      const reasonField = config.reasonField || "审核备注";
      const timeField = config.timeField || "审核时间";

      const cells = {};
      cells[ensureHeader(headers, handlerField)] = record.handler || config.handlerName || "";
      cells[ensureHeader(headers, statusField)] = record.status || "待审核";
      cells[ensureHeader(headers, reasonField)] = record.reason || "";
      cells[ensureHeader(headers, timeField)] = record.reviewTime || "";
      await updateCells(accessToken, meta.spreadsheetToken, sheetId, record._rowIndex, cells);
      return json({ ok:true });
    }

    return json({ ok:false, message:"未知 action" }, 400);
  } catch (e) {
    return json({ ok:false, message:e.message || String(e) }, 500);
  }
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}

function parseFeishuUrl(url){
  const s = String(url || "");
  const m = s.match(/\/sheets\/([A-Za-z0-9]+)/);
  let sheetId = "";
  try {
    const u = new URL(s);
    sheetId = u.searchParams.get("sheet") || u.searchParams.get("sheetId") || "";
  } catch(e){}
  return { spreadsheetToken: m ? m[1] : "", sheetId };
}

async function getFirstSheetId(accessToken, spreadsheetToken){
  const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取工作表失败：${data.msg || data.code}`);
  return data.data?.sheets?.[0]?.sheet_id || data.data?.sheets?.[0]?.sheetId || "";
}

async function readAll(accessToken, spreadsheetToken, sheetId, maxRows){
  const safeMax = Math.min(Math.max(Number(maxRows || 5000), 10), 50000);
  const range = `${sheetId}!A1:ZZ${safeMax}`;
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
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
  return idx + 1;
}

function colName(n){
  let s = "";
  while(n > 0){
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function updateCells(accessToken, spreadsheetToken, sheetId, rowIndex, colValueMap){
  if (!rowIndex) throw new Error("缺少行号，无法写回");
  const entries = Object.entries(colValueMap).map(([col, value]) => [Number(col), value]).filter(([col]) => col > 0);
  for (const [col, value] of entries) {
    const cell = `${sheetId}!${colName(col)}${rowIndex}:${colName(col)}${rowIndex}`;
    const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`, {
      method:"PUT",
      headers:{ Authorization:`Bearer ${accessToken}`, "Content-Type":"application/json; charset=utf-8" },
      body: JSON.stringify({ valueRange:{ range:cell, values:[[value]] } })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`写回表格失败：${data.msg || data.code}`);
  }
}
