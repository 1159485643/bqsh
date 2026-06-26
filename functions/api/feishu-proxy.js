export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const { action, config, record, count, accessToken } = body;

    if (!accessToken) return json({ ok:false, message:"缺少 user_access_token，请先飞书授权登录" }, 401);
    if (!config?.feishuUrl) return json({ ok:false, message:"缺少飞书链接" }, 400);

    let meta = parseFeishuUrl(config.feishuUrl);

    if (!meta.spreadsheetToken && meta.wikiToken) {
      meta = await resolveWikiSheet(accessToken, meta);
    }

    if (!meta.spreadsheetToken) {
      let msg = "无法从链接解析 spreadsheet token，请确认是飞书 Sheets 链接。";
      if (meta.baseToken) msg = "当前链接是多维表格 Bitable 链接，不是飞书 Sheets 链接。";
      if (meta.docToken) msg = "当前链接是飞书文档链接，不是飞书 Sheets 链接。";
      if (meta.wikiToken) msg = "当前链接是知识库链接，但没有解析到电子表格对象 token。请确认知识库节点本身是电子表格。";
      return json({ ok:false, message:msg }, 400);
    }

    const sheetId = meta.sheetId || await getFirstSheetId(accessToken, meta.spreadsheetToken);
    if (!sheetId) return json({ ok:false, message:"无法获取工作表 sheetId" }, 400);

    if (action === "get") {
      const { headers, rows } = await readAll(accessToken, meta.spreadsheetToken, sheetId);
      return json({ ok:true, headers, rows, parsed:meta });
    }

    if (action === "claim") {
      const { headers, rows } = await readAll(accessToken, meta.spreadsheetToken, sheetId);
      const handlerCol = ensureHeader(headers, "处理人");
      const statusCol = ensureHeader(headers, "审核状态");

      let claimed = 0;
      for (const row of rows) {
        if (claimed >= Number(count || 20)) break;
        const h = String(row["处理人"] || "").trim();
        const s = String(row["审核状态"] || "").trim();
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
      const { headers } = await readHeaders(accessToken, meta.spreadsheetToken, sheetId);
      const cells = {};
      cells[ensureHeader(headers, "处理人")] = record.handler || config.handlerName || "";
      cells[ensureHeader(headers, "审核状态")] = record.status || "待审核";
      cells[ensureHeader(headers, "审核备注")] = record.reason || "";
      cells[ensureHeader(headers, "审核时间")] = record.reviewTime || "";
      await updateCells(accessToken, meta.spreadsheetToken, sheetId, record._rowIndex, cells);
      return json({ ok:true });
    }

    return json({ ok:false, message:"未知 action" }, 400);
  } catch (e) {
    return json({ ok:false, message:e.message || String(e) }, 500);
  }
}

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}

function cleanInput(input){
  let s = String(input || "").trim();
  const urlMatch = s.match(/https?:\/\/[^\s"'<>]+/);
  if (urlMatch) s = urlMatch[0];

  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch(e) { break; }
  }

  return s.replace(/&amp;/g, "&");
}

function parseFeishuUrl(rawUrl){
  const s = cleanInput(rawUrl);
  const meta = {
    original: String(rawUrl || ""),
    normalized: s,
    spreadsheetToken: "",
    sheetId: "",
    wikiToken: "",
    baseToken: "",
    docToken: ""
  };

  const sheetPatterns = [
    /\/sheets\/([A-Za-z0-9]+)/i,
    /\/sheet\/([A-Za-z0-9]+)/i,
    /\/spreadsheets\/([A-Za-z0-9]+)/i,
    /\/spreadsheet\/([A-Za-z0-9]+)/i
  ];
  for (const p of sheetPatterns) {
    const m = s.match(p);
    if (m) {
      meta.spreadsheetToken = m[1];
      break;
    }
  }

  try {
    const u = new URL(s);
    meta.sheetId = u.searchParams.get("sheet") || u.searchParams.get("sheetId") || u.searchParams.get("gid") || "";
    meta.spreadsheetToken = meta.spreadsheetToken ||
      u.searchParams.get("spreadsheet_token") ||
      u.searchParams.get("spreadsheetToken") ||
      u.searchParams.get("sheet_token") ||
      "";
    if (!meta.sheetId && u.hash) {
      const hash = u.hash.replace(/^#/, "");
      const hp = new URLSearchParams(hash.includes("?") ? hash.split("?").pop() : hash);
      meta.sheetId = hp.get("sheet") || hp.get("sheetId") || hp.get("gid") || "";
    }
    const nested = u.searchParams.get("url") || u.searchParams.get("redirect") || u.searchParams.get("target") || u.searchParams.get("link");
    if (nested && !meta.spreadsheetToken) {
      const nestedMeta = parseFeishuUrl(nested);
      meta.spreadsheetToken = nestedMeta.spreadsheetToken;
      meta.sheetId = meta.sheetId || nestedMeta.sheetId;
      meta.wikiToken = nestedMeta.wikiToken;
      meta.baseToken = nestedMeta.baseToken;
      meta.docToken = nestedMeta.docToken;
    }
  } catch(e) {}

  const wikiMatch = s.match(/\/wiki\/([A-Za-z0-9]+)/i);
  if (wikiMatch) meta.wikiToken = wikiMatch[1];

  const baseMatch = s.match(/\/base\/([A-Za-z0-9]+)/i);
  if (baseMatch) meta.baseToken = baseMatch[1];

  const docMatch = s.match(/\/(?:docx|docs|doc)\/([A-Za-z0-9]+)/i);
  if (docMatch) meta.docToken = docMatch[1];

  if (!meta.spreadsheetToken) {
    const bareSheet = s.match(/\b(sht[a-zA-Z0-9]{8,}|shtcn[a-zA-Z0-9]+)\b/);
    if (bareSheet) meta.spreadsheetToken = bareSheet[1];
  }
  if (!meta.wikiToken) {
    const bareWiki = s.match(/\b(wik[a-zA-Z0-9]{8,}|wikcn[a-zA-Z0-9]+)\b/);
    if (bareWiki) meta.wikiToken = bareWiki[1];
  }

  return meta;
}

async function resolveWikiSheet(accessToken, meta){
  const res = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(meta.wikiToken)}`, {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`解析知识库节点失败：${data.msg || data.code}`);
  }

  const node = data.data?.node || {};
  meta.wikiObjType = node.obj_type || "";
  meta.wikiObjToken = node.obj_token || "";

  if ((node.obj_type === "sheet" || node.obj_type === "sheets") && node.obj_token) {
    meta.spreadsheetToken = node.obj_token;
  }

  return meta;
}

async function getFirstSheetId(accessToken, spreadsheetToken){
  const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取工作表失败：${data.msg || data.code}`);
  return data.data?.sheets?.[0]?.sheet_id || data.data?.sheets?.[0]?.sheetId || "";
}

async function readHeaders(accessToken, spreadsheetToken, sheetId){
  const range = `${sheetId}!A1:ZZ1`;
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`读取表头失败：${data.msg || data.code}`);
  const values = data.data?.valueRange?.values || [];
  return { headers:(values[0] || []).map(v => String(v || "").trim()) };
}

async function readAll(accessToken, spreadsheetToken, sheetId){
  const pageSize = 500;
  let start = 1;
  let allValues = [];
  let emptyBlocks = 0;

  while (true) {
    const end = start + pageSize - 1;
    const range = `${sheetId}!A${start}:ZZ${end}`;
    const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;

    const res = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
    const data = await res.json();

    if (data.code !== 0) {
      throw new Error(`读取表格失败：${data.msg || data.code}`);
    }

    const values = data.data?.valueRange?.values || [];
    const hasContent = values.some(row =>
      (row || []).some(cell => String(cell ?? "").trim() !== "")
    );

    if (!hasContent) {
      emptyBlocks++;
      if (emptyBlocks >= 2) break;
    } else {
      emptyBlocks = 0;
      allValues = allValues.concat(values);
    }

    if (values.length < pageSize) break;
    start += pageSize;

    if (start > 200000) {
      throw new Error("读取行数超过 200000，请检查表格是否存在大量空白格式区域");
    }
  }

  const headers = (allValues[0] || []).map(v => String(v || "").trim());
  const rows = allValues.slice(1).map((r, i) => {
    const obj = { __rowIndex:i+2 };
    headers.forEach((h, idx)=>{ if(h) obj[h] = r[idx] ?? ""; });
    return obj;
  }).filter(row =>
    Object.keys(row).some(k =>
      k !== "__rowIndex" && String(row[k] || "").trim() !== ""
    )
  );

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
