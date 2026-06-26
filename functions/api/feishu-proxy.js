export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, config, record, count } = body;

    const accessToken = await getAccessTokenFromSession(request, env);
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

    const sheetInfo = await getSheetInfo(accessToken, meta.spreadsheetToken, meta.sheetId);
    const sheetId = sheetInfo.sheetId;
    if (!sheetId) return json({ ok:false, message:"无法获取工作表 sheetId" }, 400);

    if (action === "get") {
      const { headers, rows } = await readAll(accessToken, meta.spreadsheetToken, sheetId);
      return json({ ok:true, headers, rows, parsed:meta });
    }

    if (action === "getPage") {
      const start = Math.max(2, Number(body.start || 2));
      const pageSize = Math.max(500, Math.min(5000, Number(body.pageSize || 4000)));
      const page = await readPage(accessToken, meta.spreadsheetToken, sheetId, start, pageSize);
      return json({ ok:true, ...page, totalRows:sheetInfo.rowCount || 0, parsed:meta });
    }

    if (action === "getDynamicPage") {
      const start = Math.max(2, Number(body.start || 2));
      const pageSize = Math.max(500, Math.min(5000, Number(body.pageSize || 4000)));
      const page = await readDynamicPage(accessToken, meta.spreadsheetToken, sheetId, start, pageSize, sheetInfo.rowCount || 0);
      return json({ ok:true, ...page, totalRows:sheetInfo.rowCount || 0, parsed:meta });
    }

    if (action === "claim") {
      const result = await claimRows(accessToken, meta.spreadsheetToken, sheetId, config.handlerName || "", Number(count || 20), Math.max(500, Math.min(5000, Number(body.pageSize || 4000))));
      return json({ ok:true, count:result.rows.length, rows:result.rows });
    }

    if (action === "update") {
      const rowIndex = getRecordRowIndex(record);
      if (!rowIndex) throw new Error("缺少原始行号，请先点击“同步数据源”后再审核");

      const { headers } = await readHeaders(accessToken, meta.spreadsheetToken, sheetId);
      await ensureHeaderRow(accessToken, meta.spreadsheetToken, sheetId, headers, ["处理人", "审核状态", "审核备注", "审核时间"]);

      const valueRanges = buildReviewValueRanges(sheetId, headers, record, config);
      await batchUpdateValues(accessToken, meta.spreadsheetToken, valueRanges);
      return json({ ok:true, rowIndex });
    }

    if (action === "batchUpdateReviews") {
      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length) return json({ ok:true, count:0 });

      const { headers } = await readHeaders(accessToken, meta.spreadsheetToken, sheetId);
      await ensureHeaderRow(accessToken, meta.spreadsheetToken, sheetId, headers, ["处理人", "审核状态", "审核备注", "审核时间"]);

      const valueRanges = [];
      const rowSet = new Set();

      for (const item of records) {
        const rowIndex = getRecordRowIndex(item);
        if (!rowIndex || rowSet.has(rowIndex)) continue;
        rowSet.add(rowIndex);
        valueRanges.push(...buildReviewValueRanges(sheetId, headers, item, config));
      }

      if (valueRanges.length) {
        await batchUpdateValues(accessToken, meta.spreadsheetToken, valueRanges);
      }

      return json({ ok:true, count:rowSet.size });
    }

    return json({ ok:false, message:"未知 action" }, 400);
  } catch (e) {
    return json({ ok:false, message:e.message || String(e) }, e.status || 500);
  }
}

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "Content-Type":"application/json; charset=utf-8" }
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

async function getAccessTokenFromSession(request, env) {
  if (!env.FEISHU_KV) throw new Error("缺少 KV 绑定 FEISHU_KV");

  const sessionId = getCookie(request, "feishu_session");
  if (!sessionId) {
    const err = new Error("未登录飞书，请先点击“飞书登录”");
    err.status = 401;
    throw err;
  }

  const key = `session:${sessionId}`;
  const text = await env.FEISHU_KV.get(key);
  if (!text) {
    const err = new Error("飞书登录已失效，请重新登录");
    err.status = 401;
    throw err;
  }

  let session;
  try {
    session = JSON.parse(text);
  } catch (e) {
    const err = new Error("飞书登录信息损坏，请重新登录");
    err.status = 401;
    throw err;
  }

  let token = session.token || session;
  const access = token.user_access_token || token.access_token;
  if (access && token.expires_at && Date.now() < token.expires_at) {
    return access;
  }

  if (!token.refresh_token) {
    if (access) return access;
    const err = new Error("飞书 token 缺失，请重新登录");
    err.status = 401;
    throw err;
  }

  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET");
  }

  const refreshed = await refreshUserToken(env, token.refresh_token);
  const nextToken = { ...token, ...refreshed };
  const expiresIn = Number(nextToken.expires_in || nextToken.expire || 7200);
  nextToken.expires_at = Date.now() + Math.max(60, expiresIn - 120) * 1000;

  session.token = nextToken;
  session.updated_at = Date.now();

  await env.FEISHU_KV.put(key, JSON.stringify(session), {
    expirationTtl: 60 * 60 * 24 * 30
  });

  return nextToken.user_access_token || nextToken.access_token;
}

async function refreshUserToken(env, refreshToken) {
  const res = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method:"POST",
    headers:{ "Content-Type":"application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type:"refresh_token",
      client_id:env.FEISHU_APP_ID,
      client_secret:env.FEISHU_APP_SECRET,
      refresh_token:refreshToken
    })
  });
  const raw = await res.json();
  const data = raw.data || raw;
  if (!res.ok || raw.error || raw.code) {
    throw new Error(raw.error_description || raw.message || raw.msg || `刷新飞书 token 失败：${res.status}`);
  }
  return data;
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

async function getSheetInfo(accessToken, spreadsheetToken, preferredSheetId){
  const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取工作表失败：${data.msg || data.code}`);

  const sheets = data.data?.sheets || [];
  const sheet = (preferredSheetId ? sheets.find(item =>
    item.sheet_id === preferredSheetId || item.sheetId === preferredSheetId
  ) : null) || sheets[0] || {};

  const grid = sheet.grid_properties || sheet.gridProperties || {};
  const rowCount = Number(grid.row_count || grid.rowCount || sheet.row_count || sheet.rowCount || 0) || 0;

  return {
    sheetId: sheet.sheet_id || sheet.sheetId || preferredSheetId || "",
    rowCount
  };
}

async function getFirstSheetId(accessToken, spreadsheetToken){
  const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`, {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取工作表失败：${data.msg || data.code}`);
  return data.data?.sheets?.[0]?.sheet_id || data.data?.sheets?.[0]?.sheetId || "";
}

function normalizeCellValue(cell){
  if (cell == null) return "";
  if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (Array.isArray(cell)) return cell.map(normalizeCellValue).filter(Boolean).join("\n");
  if (typeof cell === "object") {
    const parts = [];
    for (const key of ["text", "value", "url", "href", "link", "image_url", "imageUrl", "src"]) {
      if (cell[key] != null) parts.push(normalizeCellValue(cell[key]));
    }
    if (parts.length) return parts.filter(Boolean).join(" ");
    try { return JSON.stringify(cell); } catch(e) { return String(cell); }
  }
  return String(cell);
}

async function readHeaders(accessToken, spreadsheetToken, sheetId){
  const range = `${sheetId}!A1:ZZ1`;
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`读取表头失败：${data.msg || data.code}`);
  const values = data.data?.valueRange?.values || [];
  return { headers:(values[0] || []).map(v => normalizeCellValue(v).trim()) };
}

async function readRangeWithRetry(accessToken, spreadsheetToken, range, pageSizeRef){
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
    const data = await res.json();
    const msg = String(data.msg || data.message || "");

    if (data.code === 0) return { retry:false, values:data.data?.valueRange?.values || [] };

    if (/exceeded|10485760|too large/i.test(msg) && pageSizeRef.value > 500) {
      pageSizeRef.value = Math.max(500, Math.floor(pageSizeRef.value / 2));
      return { retry:true };
    }

    if (attempt < 3 && isRateLimitedResponse(res, data)) {
      await workerSleep(800 * attempt);
      continue;
    }

    throw new Error(`读取表格失败：${data.msg || data.code}`);
  }
}

async function readAll(accessToken, spreadsheetToken, sheetId){
  const headerResult = await readHeaders(accessToken, spreadsheetToken, sheetId);
  const headers = headerResult.headers || [];
  const rows = [];
  let start = 2;
  const pageSizeRef = { value:4000 };
  let emptyBlocks = 0;

  while (true) {
    const end = start + pageSizeRef.value - 1;
    const range = `${sheetId}!A${start}:ZZ${end}`;
    const result = await readRangeWithRetry(accessToken, spreadsheetToken, range, pageSizeRef);
    if (result.retry) continue;

    const values = result.values || [];
    const nonEmptyRows = [];

    values.forEach((r, i) => {
      const normalized = (r || []).map(normalizeCellValue);
      const hasContent = normalized.some(cell => String(cell ?? "").trim() !== "");
      if (!hasContent) return;
      const obj = { __rowIndex:start + i };
      headers.forEach((h, idx)=>{ if(h) obj[h] = normalized[idx] ?? ""; });
      nonEmptyRows.push(obj);
    });

    if (!nonEmptyRows.length) {
      emptyBlocks++;
      if (emptyBlocks >= 2) break;
    } else {
      emptyBlocks = 0;
      rows.push(...nonEmptyRows);
    }

    if (values.length < pageSizeRef.value) break;
    start += pageSizeRef.value;

    if (start > 200000) {
      throw new Error("读取行数超过 200000，请检查表格是否存在大量空白格式区域");
    }
  }

  return { headers, rows };
}


async function readPage(accessToken, spreadsheetToken, sheetId, start, pageSize){
  const headerResult = await readHeaders(accessToken, spreadsheetToken, sheetId);
  const headers = headerResult.headers || [];
  const pageSizeRef = { value:pageSize };

  while (true) {
    const end = start + pageSizeRef.value - 1;
    const range = `${sheetId}!A${start}:ZZ${end}`;
    const result = await readRangeWithRetry(accessToken, spreadsheetToken, range, pageSizeRef);
    if (result.retry) continue;

    const values = result.values || [];
    const rows = [];

    values.forEach((r, i) => {
      const normalized = (r || []).map(normalizeCellValue);
      const hasContent = normalized.some(cell => String(cell ?? "").trim() !== "");
      if (!hasContent) return;
      const obj = { __rowIndex:start + i };
      headers.forEach((h, idx)=>{ if(h) obj[h] = normalized[idx] ?? ""; });
      rows.push(obj);
    });

    const done = values.length < pageSizeRef.value || !values.length;
    return {
      headers,
      rows,
      start,
      pageSize:pageSizeRef.value,
      nextStart:start + pageSizeRef.value,
      done,
      scanned:values.length
    };
  }
}


async function readColumnValues(accessToken, spreadsheetToken, sheetId, colIndex, start, end){
  if (!colIndex) return [];
  const col = colName(colIndex);
  const range = `${sheetId}!${col}${start}:${col}${end}`;
  const pageSizeRef = { value:Math.max(1, end - start + 1) };
  while (true) {
    const result = await readRangeWithRetry(accessToken, spreadsheetToken, range, pageSizeRef);
    if (!result.retry) {
      return (result.values || []).map(row => normalizeCellValue((row || [])[0] || ""));
    }
  }
}

async function readDynamicPage(accessToken, spreadsheetToken, sheetId, start, pageSize, totalRows){
  const { headers } = await readHeaders(accessToken, spreadsheetToken, sheetId);
  const fields = ["处理人", "审核状态", "审核备注", "审核时间"];
  const colMap = {};
  fields.forEach(name => {
    const idx = headers.indexOf(name);
    colMap[name] = idx >= 0 ? idx + 1 : 0;
  });

  const lastRow = totalRows ? Math.min(totalRows, start + pageSize - 1) : start + pageSize - 1;
  const count = Math.max(0, lastRow - start + 1);
  const rows = Array.from({ length:count }, (_, i) => ({ __rowIndex:start + i }));

  for (const name of fields) {
    if (!colMap[name]) continue;
    const values = await readColumnValues(accessToken, spreadsheetToken, sheetId, colMap[name], start, lastRow);
    for (let i = 0; i < count; i++) {
      rows[i][name] = values[i] || "";
    }
  }

  const done = totalRows ? lastRow >= totalRows : count < pageSize;
  return {
    headers:fields,
    rows,
    start,
    pageSize,
    nextStart:lastRow + 1,
    done,
    scanned:count
  };
}

async function claimRows(accessToken, spreadsheetToken, sheetId, handlerName, count, claimPageSize = 4000){
  if (!handlerName) throw new Error("处理人姓名不能为空");

  const { headers } = await readHeaders(accessToken, spreadsheetToken, sheetId);
  await ensureHeaderRow(accessToken, spreadsheetToken, sheetId, headers, ["处理人", "审核状态"]);

  const handlerCol = ensureHeader(headers, "处理人");
  const statusCol = ensureHeader(headers, "审核状态");
  const claimed = [];
  const valueRanges = [];

  let start = 2;
  const pageSizeRef = { value:claimPageSize };
  let emptyBlocks = 0;

  while (claimed.length < count) {
    const end = start + pageSizeRef.value - 1;
    const range = `${sheetId}!A${start}:ZZ${end}`;
    const result = await readRangeWithRetry(accessToken, spreadsheetToken, range, pageSizeRef);
    if (result.retry) continue;

    const values = result.values || [];
    let blockHasContent = false;

    for (let i = 0; i < values.length && claimed.length < count; i++) {
      const rowIndex = start + i;
      const normalized = (values[i] || []).map(normalizeCellValue);
      const hasContent = normalized.some(cell => String(cell ?? "").trim() !== "");
      if (!hasContent) continue;

      blockHasContent = true;
      const handler = String(normalized[handlerCol - 1] || "").trim();
      const status = String(normalized[statusCol - 1] || "").trim();

      if (!handler && (!status || status === "待审核" || status === "未复审")) {
        valueRanges.push({
          range:`${sheetId}!${colName(handlerCol)}${rowIndex}:${colName(handlerCol)}${rowIndex}`,
          values:[[handlerName]]
        });
        valueRanges.push({
          range:`${sheetId}!${colName(statusCol)}${rowIndex}:${colName(statusCol)}${rowIndex}`,
          values:[[status || "待审核"]]
        });
        claimed.push(rowIndex);
      }
    }

    if (!blockHasContent) {
      emptyBlocks++;
      if (emptyBlocks >= 2) break;
    } else {
      emptyBlocks = 0;
    }

    if (values.length < pageSizeRef.value) break;
    start += pageSizeRef.value;
    if (start > 200000) break;
  }

  if (valueRanges.length) {
    await batchUpdateValues(accessToken, spreadsheetToken, valueRanges);
  }

  return { rows:claimed };
}

function normalizeReviewStatus(status){
  const text = String(status || "").trim();
  const compact = text.replace(/\s+/g, "").toLowerCase();
  if (["approved","approve","pass","passed","correct","true","yes","y","1","通过","已通过","审核通过","复审通过","是"].includes(compact)) return "通过";
  if (["rejected","reject","fail","failed","incorrect","false","no","n","0","不通过","未通过","已不通过","审核不通过","复审不通过","否","驳回","拒绝"].includes(compact)) return "不通过";
  if (/不通过|未通过|拒绝|驳回|reject|fail/i.test(text)) return "不通过";
  if (/通过|approved|approve|pass|correct/i.test(text)) return "通过";
  return text || "待审核";
}

function buildReviewValueRanges(sheetId, headers, record, config){
  const rowIndex = getRecordRowIndex(record);
  if (!rowIndex) return [];

  const status = normalizeReviewStatus(record?.reviewStatus);
  const handler = config?.handlerName || record?.handlerName || record?.raw?.["处理人"] || "";
  const reason = record?.reviewReason || "";
  const time = record?.reviewTime || "";

  const cols = {
    handler: ensureHeader(headers, "处理人"),
    status: ensureHeader(headers, "审核状态"),
    reason: ensureHeader(headers, "审核备注"),
    time: ensureHeader(headers, "审核时间")
  };

  return [
    { range:`${sheetId}!${colName(cols.handler)}${rowIndex}:${colName(cols.handler)}${rowIndex}`, values:[[handler]] },
    { range:`${sheetId}!${colName(cols.status)}${rowIndex}:${colName(cols.status)}${rowIndex}`, values:[[status]] },
    { range:`${sheetId}!${colName(cols.reason)}${rowIndex}:${colName(cols.reason)}${rowIndex}`, values:[[reason]] },
    { range:`${sheetId}!${colName(cols.time)}${rowIndex}:${colName(cols.time)}${rowIndex}`, values:[[time]] }
  ];
}

function getRecordRowIndex(record){
  const candidates = [
    record?.remoteRowIndex,
    record?._rowIndex,
    record?.__rowIndex,
    record?.raw?.__rowIndex
  ];
  for (const item of candidates) {
    const n = Number(item);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const rowIndex = Number(record?.rowIndex);
  if (Number.isFinite(rowIndex) && rowIndex >= 0) return rowIndex + 2;
  return 0;
}

function ensureHeader(headers, name){
  let idx = headers.indexOf(name);
  if (idx === -1) {
    headers.push(name);
    idx = headers.length - 1;
  }
  return idx + 1;
}

async function ensureHeaderRow(accessToken, spreadsheetToken, sheetId, headers, names){
  const cells = {};
  for (const name of names) {
    const existed = headers.includes(name);
    const col = ensureHeader(headers, name);
    if (!existed) cells[col] = name;
  }
  if (Object.keys(cells).length) {
    await updateCells(accessToken, spreadsheetToken, sheetId, 1, cells);
  }
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

async function workerSleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitedResponse(res, data){
  const msg = String((data && (data.msg || data.message)) || "");
  return res.status === 429 || /too many|rate|频繁|请求过多|TooMany/i.test(msg);
}

async function batchUpdateValues(accessToken, spreadsheetToken, valueRanges){
  const chunks = [];
  for (let i = 0; i < valueRanges.length; i += 100) {
    chunks.push(valueRanges.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`, {
        method:"POST",
        headers:{ Authorization:`Bearer ${accessToken}`, "Content-Type":"application/json; charset=utf-8" },
        body: JSON.stringify({ valueRanges:chunk })
      });
      const data = await res.json();

      if (data.code === 0) break;

      if (attempt < 4 && isRateLimitedResponse(res, data)) {
        await workerSleep(900 * attempt);
        continue;
      }

      throw new Error(`批量写回表格失败：${data.msg || data.code}`);
    }
  }
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
