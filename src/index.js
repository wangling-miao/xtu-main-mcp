/**
 * 湘潭大学官网 MCP
 * Cloudflare Worker · Streamable HTTP（无状态 JSON-RPC）
 *
 * 数据源：湘潭大学官网 https://www.xtu.edu.cn/
 * 搜索：官方 Visual SiteBuilder/Lucene 全站搜索 qwssjg.jsp
 */

const DEFAULT_UUID = "1c608ca1-2b43-4492-9b78-f4c39e5a6923";
const XTU = "https://www.xtu.edu.cn";
const SEARCH_PATH = "/qwssjg.jsp?wbtreeid=1001";
const UA =
  "Mozilla/5.0 (compatible; XTU-MAIN-MCP/1.0; +https://www.xtu.edu.cn/)";
const PROTOCOL = "2025-03-26";

const SERVER_INFO = {
  name: "xtu-main-mcp",
  title: "湘潭大学官网检索",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "search_xtu",
    description:
      "检索湘潭大学官网（www.xtu.edu.cn）的公开内容。搜索结果可能链接到湘潭大学新闻网及其他 xtu.edu.cn 子域名。关键词走学校官方 Lucene 全站搜索。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，例如：推免、奖学金、招生、科研、校园活动",
        },
        page: {
          type: "integer",
          description: "页码，从 1 开始，默认 1",
          minimum: 1,
          default: 1,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_article",
    description:
      "读取湘潭大学官网或 xtu.edu.cn 子域名的一篇公开文章正文，并尽量提取附件。可传相对路径或完整 URL。",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "湘潭大学文章地址、xtu.edu.cn 子域名文章地址或官网相对路径",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "list_sections",
    description: "列出湘潭大学官网常用栏目入口。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

export default {
  async fetch(request, env) {
    const uuid = String(env.ACCESS_UUID || DEFAULT_UUID).toLowerCase();
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    if (
      request.method === "GET" &&
      parts.length === 1 &&
      parts[0].toLowerCase() === "health"
    ) {
      return cors(
        json({
          ok: true,
          service: SERVER_INFO.name,
          version: SERVER_INFO.version,
          source: XTU,
          hint: "MCP 地址是 /<ACCESS_UUID>/mcp，type 选 http / streamableHttp，不要选 sse",
        })
      );
    }

    if (parts[0]?.toLowerCase() !== uuid) {
      return new Response("Not Found", { status: 404 });
    }

    const rest = parts.slice(1).join("/") || "";
    const isMcpPath =
      rest === "" ||
      rest === "health" ||
      rest === "mcp" ||
      rest === "sse" ||
      rest === "message" ||
      rest === "messages" ||
      rest === "mcp/sse" ||
      rest === "mcp/message" ||
      rest === "mcp/messages";

    if (!isMcpPath) {
      return new Response("Not Found", { status: 404 });
    }

    if (
      request.method === "GET" &&
      (rest === "" || rest === "health") &&
      !acceptsEventStream(request)
    ) {
      return cors(
        json({
          ok: true,
          service: SERVER_INFO.name,
          version: SERVER_INFO.version,
          source: XTU,
          mcp: `/${uuid}/mcp`,
          hint: "type 选 streamableHttp / http，不要选 sse",
        })
      );
    }

    if (request.method === "GET") {
      return cors(
        new Response("Method Not Allowed. Use POST JSON-RPC (Streamable HTTP).", {
          status: 405,
          headers: {
            Allow: "POST, OPTIONS",
            "Content-Type": "text/plain; charset=utf-8",
          },
        })
      );
    }

    if (request.method === "DELETE") {
      return cors(
        new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } })
      );
    }

    if (request.method !== "POST") {
      return cors(new Response("Method Not Allowed", { status: 405 }));
    }

    return handleMcp(request);
  },
};

async function handleMcp(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors(
      json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400
      )
    );
  }

  if (Array.isArray(body)) {
    const out = [];
    for (const item of body) {
      const res = await dispatch(item);
      if (res) out.push(res);
    }
    return cors(json(out));
  }

  const res = await dispatch(body);
  if (!res) return cors(new Response(null, { status: 202 }));
  return cors(json(res));
}

async function dispatch(msg) {
  if (!msg || typeof msg !== "object") {
    return rpcError(null, -32600, "Invalid Request");
  }

  const { id, method, params } = msg;
  const isNotify = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "检索湘潭大学官网（www.xtu.edu.cn）。通常先用 search_xtu 找到文章，再用 get_article 读取正文和附件。搜索结果可能来自湘潭大学新闻网等 xtu.edu.cn 子域名。",
        });
      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
        return null;
      case "ping":
        return isNotify ? null : rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "tools/call":
        return rpcResult(id, await callTool(params || {}));
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      default:
        if (isNotify) return null;
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isNotify) return null;
    return rpcError(id, -32000, String(err?.message || err));
  }
}

async function callTool(params) {
  const name = params.name;
  const args = params.arguments || {};

  if (name === "search_xtu") {
    const query = String(args.query || "").trim();
    if (!query) return textResult("请提供 query。", true);
    const page = Math.max(1, Number(args.page || 1) || 1);
    const results = await searchXtu(query, page);
    return textResult(JSON.stringify(results, null, 2));
  }

  if (name === "get_article") {
    const raw = String(args.url || "").trim();
    if (!raw) return textResult("请提供 url。", true);
    const article = await getArticle(raw);
    return textResult(JSON.stringify(article, null, 2));
  }

  if (name === "list_sections") {
    return textResult(JSON.stringify(SECTIONS, null, 2));
  }

  return textResult(`未知工具: ${name}`, true);
}

const SECTIONS = {
  home: `${XTU}/`,
  overview: `${XTU}/xdgk.htm`,
  introduction: `${XTU}/xdgk/xxjj.htm`,
  leadership: `${XTU}/xdgk/xrld1.htm`,
  organization: `${XTU}/jgsz/jjjcjg.htm`,
  teaching_units: `${XTU}/jgsz/jxjg.htm`,
  education: `${XTU}/jyjx.htm`,
  undergraduate_education: `${XTU}/jyjx/bksjyjx.htm`,
  graduate_education: `${XTU}/jyjx/yjsjyjx.htm`,
  research: `${XTU}/kxyj.htm`,
  admissions_employment: `${XTU}/zsjy.htm`,
  cooperation: `${XTU}/hzjl.htm`,
  campus_life: `${XTU}/xysh.htm`,
  search: `${XTU}${SEARCH_PATH}`,
};

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function searchXtu(query, page) {
  const encoded = base64Utf8(query);
  let res;

  if (page <= 1) {
    const body = new URLSearchParams({
      lucenenewssearchkey: encoded,
      _lucenesearchtype: "1",
      searchScope: "0",
      x: "0",
      y: "0",
    });

    res = await fetch(`${XTU}${SEARCH_PATH}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: XTU,
        Referer: `${XTU}/`,
      },
      body,
      redirect: "follow",
    });
  } else {
    const u = new URL(`${XTU}/qwssjg.jsp`);
    u.searchParams.set("wbtreeid", "1001");
    u.searchParams.set("searchScope", "0");
    u.searchParams.set("currentnum", String(page));
    u.searchParams.set("newskeycode2", encoded);
    u.searchParams.set("order", "");
    u.searchParams.set("range", "");

    res = await fetch(u, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${XTU}${SEARCH_PATH}`,
      },
      redirect: "follow",
    });
  }

  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`);
  const html = await readSiteText(res);
  const items = parseSearchResults(html);
  const pager = parsePager(html);

  return {
    query,
    page,
    total: pager.total,
    totalPages: pager.totalPages,
    count: items.length,
    source: `${XTU}${SEARCH_PATH}`,
    items,
  };
}

function parseSearchResults(html) {
  const items = [];
  const seen = new Set();

  const box = html.match(
    /<div[^>]*class=["'][^"']*list_rsou[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  const chunk = box ? box[1] : html;
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let li;

  while ((li = liRe.exec(chunk))) {
    const block = li[1];
    const hrefM = block.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (!hrefM) continue;

    const href = decodeEntities(hrefM[1]).trim();
    let abs;
    try {
      abs = new URL(href, `${XTU}/`).href;
    } catch {
      continue;
    }

    if (!isXtuHost(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const titleM = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const dateM =
      block.match(/<i[^>]*>([\s\S]*?)<\/i>/i) ||
      block.match(/(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
    const pM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

    const title = strip(titleM ? titleM[1] : "").slice(0, 200);
    const date = normalizeDate(strip(dateM ? dateM[1] : ""));
    const snippet = strip(pM ? pM[1] : "").slice(0, 420);
    if (!title || title.length < 2) continue;

    items.push({
      title,
      date,
      snippet,
      url: abs,
      host: new URL(abs).hostname,
      path: abs.startsWith(`${XTU}/`) ? abs.slice(XTU.length + 1) : abs,
    });
  }

  return items.slice(0, 20);
}

function parsePager(html) {
  const m = html.match(
    /<div[^>]*class=["'][^"']*sspage[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  const text = strip(m ? m[1] : "");
  const totalM = text.match(/共有\s*(\d+)\s*条/);
  const pagesM = text.match(/共有\s*(\d+)\s*页/);
  return {
    total: totalM ? Number(totalM[1]) : null,
    totalPages: pagesM ? Number(pagesM[1]) : null,
  };
}

async function getArticle(input) {
  const target = normalizeArticleUrl(input);
  if (!isXtuHost(target)) {
    throw new Error("只允许读取 xtu.edu.cn 及其子域名页面");
  }

  const res = await fetch(target, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: `${XTU}/`,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);

  const html = await readSiteText(res);
  const title = extractTitle(html) || target;
  const text = extractMain(html);
  const attachments = extractAttachments(html, target);
  const meta = extractArticleMeta(html);

  return {
    title,
    url: target,
    host: new URL(target).hostname,
    publisher: meta.publisher,
    publishedAt: meta.publishedAt,
    chars: text.length,
    attachments,
    text: text.slice(0, 24000),
  };
}

function normalizeArticleUrl(input) {
  let target = input.trim();
  if (target.startsWith("/")) target = XTU + target;
  if (!/^https?:\/\//i.test(target)) {
    target = `${XTU}/${target.replace(/^\.\//, "")}`;
  }
  return target;
}

function isXtuHost(input) {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === "xtu.edu.cn" || host.endsWith(".xtu.edu.cn");
  } catch {
    return false;
  }
}

function extractTitle(html) {
  const og = html.match(
    /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  const articleH = html.match(
    /<(?:h1|h2)[^>]+class=["'][^"']*(?:title|bt|article)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h1|h2)>/i
  );
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const raw = strip(og?.[1] || articleH?.[1] || h1?.[1] || t?.[1] || "");
  return raw
    .replace(/\s*[-—_|]\s*湘潭大学(?:新闻网)?\s*$/i, "")
    .replace(/\s*湘潭大学\s*$/i, "")
    .trim();
}

function extractArticleMeta(html) {
  const plain = strip(html);

  const dateM =
    plain.match(/(?:发布时间|发布日期|时间|日期)[:：]?\s*(\d{4}[-年./]\d{1,2}[-月./]\d{1,2}日?)/) ||
    plain.match(/(\d{4}-\d{1,2}-\d{1,2})/);

  const publisherM =
    plain.match(/(?:来源|发布|作者|供稿)[:：]\s*([^\s]{1,40})/) || null;

  return {
    publisher: publisherM ? publisherM[1] : "",
    publishedAt: dateM ? normalizeDate(dateM[1]) : "",
  };
}

function extractAttachments(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]).trim();
    const label = strip(m[2]);
    const isFile =
      /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps|et|txt)(?:$|[?#])/i.test(href) ||
      /__local\//i.test(href) ||
      /\/system\/resource\/attach\//i.test(href);
    if (!isFile) continue;

    let abs;
    try {
      abs = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    if (!isXtuHost(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);

    out.push({
      name: label.slice(0, 160) || safeFilename(abs),
      url: abs,
    });
  }

  return out;
}

function extractMain(html) {
  let chunk = "";
  const candidates = [
    /<div[^>]+class=["'][^"']*v_news_content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<div[^>]+id=["']vsb_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*vsb_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*(?:article|content|news)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<td[^>]+class=["'][^"']*v_news_content[^"']*["'][^>]*>([\s\S]*?)<\/td>/i,
  ];

  for (const re of candidates) {
    const m = html.match(re);
    if (m?.[1] && strip(m[1]).length > 80) {
      chunk = m[1];
      break;
    }
  }

  if (!chunk) {
    chunk = html;
  }

  chunk = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(chunk)
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\u3000]+/g, " ").trim())
    .filter(Boolean);

  const drop = new Set([
    "首页",
    "湘大概况",
    "机构设置",
    "人才招聘",
    "教育教学",
    "科学研究",
    "招生就业",
    "合作交流",
    "校园生活",
    "考生",
    "校友",
    "捐赠",
    "信息公开",
    "信息门户",
    "English",
    "搜索结果",
  ]);

  const kept = [];
  let started = false;
  for (const line of lines) {
    if (drop.has(line)) continue;
    if (/^版权所有©?湘潭大学/.test(line)) break;
    if (/^地址：中国湖南湘潭/.test(line) && kept.length > 20) break;

    if (!started) {
      if (
        /发布时间|发布日期|来源|作者|供稿/.test(line) ||
        line.length >= 20
      ) {
        started = true;
      } else {
        continue;
      }
    }

    kept.push(line);
  }

  const result = kept.join("\n").trim();
  return result || strip(chunk);
}

async function readSiteText(response) {
  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const contentType = response.headers.get("content-type") || "";
  const headProbe = new TextDecoder().decode(
    bytes.slice(0, Math.min(bytes.length, 8192))
  );
  const declared = `${contentType} ${headProbe}`.match(
    /charset\s*=\s*["']?\s*(gb2312|gbk|gb18030|utf-8)/i
  )?.[1];

  const encoding = declared && !/^utf-8$/i.test(declared) ? "gb18030" : "utf-8";
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function normalizeDate(s) {
  const m = String(s || "").match(
    /(\d{4})[-年./](\d{1,2})[-月./](\d{1,2})/
  );
  if (!m) return String(s || "").trim();
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function safeFilename(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "附件");
  } catch {
    return "附件";
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = Number.parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    });
}

function strip(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id, code, message, status) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
  if (status) return json(payload, status);
  return payload;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function acceptsEventStream(request) {
  const accept = request.headers.get("Accept") || "";
  return /text\/event-stream/i.test(accept);
}

function cors(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID"
  );
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  return new Response(res.body, { status: res.status, headers });
}
