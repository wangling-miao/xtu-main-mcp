# 湘潭大学官网 MCP

Cloudflare Worker 上的远程 MCP，用于检索湘潭大学官网：<https://www.xtu.edu.cn/>。

基于学校官网官方 Visual SiteBuilder / Lucene 全站搜索，不需要登录，也不会使用或保存浏览器 Cookie。

## 工具

| 工具 | 作用 |
|---|---|
| `search_xtu` | 搜索湘潭大学官网公开内容，支持分页 |
| `get_article` | 读取官网或 `*.xtu.edu.cn` 子域名文章正文，并提取附件链接 |
| `list_sections` | 返回学校官网常用栏目入口 |

## 已适配的搜索请求

- 第 1 页：`POST /qwssjg.jsp?wbtreeid=1001`
- 参数：`lucenenewssearchkey=<UTF-8 Base64>`、`_lucenesearchtype=1`、`searchScope=0`
- 第 2 页及以后：`GET /qwssjg.jsp?...&currentnum=N&newskeycode2=<Base64>&order=&range=`
- 结果列表：`div.list_rsou > ul > li`
- 分页：`div.sspage`
- 搜索结果允许来自 `www.xtu.edu.cn`、`news.xtu.edu.cn` 以及其他 `*.xtu.edu.cn` 子域名

## 部署

```bash
npm i
npx wrangler login
npx wrangler deploy
```

当前包预生成的 `ACCESS_UUID`：

```text
1c608ca1-2b43-4492-9b78-f4c39e5a6923
```

MCP 地址：

```text
https://xtu-main-mcp.<你的账号>.workers.dev/1c608ca1-2b43-4492-9b78-f4c39e5a6923/mcp
```

如修改 `wrangler.toml` 中的 `ACCESS_UUID`，客户端地址也要同步修改。

## 客户端配置

```json
{
  "mcpServers": {
    "xtu-main": {
      "type": "http",
      "url": "https://xtu-main-mcp.<你的账号>.workers.dev/1c608ca1-2b43-4492-9b78-f4c39e5a6923/mcp"
    }
  }
}
```

Streamable HTTP 客户端不要配置成传统 SSE。

## 自测

```bash
UUID=1c608ca1-2b43-4492-9b78-f4c39e5a6923
BASE=https://xtu-main-mcp.<你的账号>.workers.dev

curl -s "$BASE/health"

curl -s "$BASE/$UUID/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

curl -s "$BASE/$UUID/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_xtu","arguments":{"query":"推免","page":1}}}'
```

## 说明

- 你抓包中的 `JSESSIONID` 没有写入项目，公开搜索不需要它。
- 搜索结果返回标题、日期、摘要、文章 URL、来源主机，并解析总结果数与总页数。
- `get_article` 只允许读取 `xtu.edu.cn` 及其子域名，避免把 Worker 变成任意 URL 抓取代理。
- 保留 GB2312 / GBK 兼容解码，方便读取学校部分旧站点和子站。
