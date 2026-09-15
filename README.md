# dsh-web-search-nokey

**中文** · [English](README.en.md)

给 dsh 一个不用 API key 的搜索。

---

## 解决什么

如果你用积分把模型接进 dsh —— Trae 积分、WorkBuddy 积分，随便哪个 —— 那 `web_search` 大概率是这个报错：

```
DeepSeek API error (HTTP 401): Authentication Fails, Your api key: ****1b24 is invalid
```

聊天没事，只有搜索挂。原因是 dsh 的聊天和搜索走的不是同一条路：聊天走你的连接器，搜索是另一个内置模块，它只认 `DEEPSEEK_API_KEY`。

你没有那把 key，所以搜索就是死的。

装这个插件，搜索换成公开搜索引擎，不需要任何 key。

---

## 装

```bash
dsh plugin --profile web add github:a1435473620/dsh-web-search-nokey
```

发到 npm 之后也可以用短名字：

```bash
dsh plugin --profile web add dsh-web-search-nokey
```

装完就生效，不用改配置，也不用重启。

注意不是 `npm install -g` —— 这是 dsh 的插件，要装进 profile 才有用。

卸载：

```bash
dsh plugin --profile web remove dsh-web-search-nokey
```

---

## 为什么包里带了个 patch

dsh 的搜索后端同时只能选一个。不显式指定选哪个，它就会去数有几个能用的 —— 而内置那个后端永远说自己是能用的，于是两个一撞，直接报 `WEB_PROVIDER_AMBIGUOUS`，搜索反而彻底用不了。

所以插件里带了 `cordis.patch.yml`，把选择写死了。**别删它。**

---

## 怎么用

直接用，`web_search` 工具会走这里。

三个后端按顺序兜底，够条数就停：Bing 的 RSS、Bing 的网页、360。一次查询大概 200ms，返回 8 条带摘要的结果。

---

## 配置

改的是 profile 里的 `cordis.patch.yml`，一般不碰。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `engines` | `bing-rss, bing-html, so360` | 顺序就是兜底顺序 |
| `maxResults` | `8` | 单次上限 |
| `timeoutMs` | `12000` | 单个上游请求超时 |
| `proxy` | 空 | 走代理时填，比如 `http://127.0.0.1:7897` |
| `userAgent` | 桌面 Chrome | 这些搜索页会拦裸客户端 |

环境变量可以覆盖同样几项，前缀 `DSH_WEB_SEARCH_NOKEY_`。`HTTPS_PROXY` 也认。

---

## 已知问题

- **大部分结果没有日期。** Bing 的 RSS 给的是抓取时间不是发布时间，填进去会让旧页面看着像新的，所以干脆不填。
- **Bing RSS 一般只给 9 条**，所以要靠第二个后端补。
- **360 那个后端的链接是跳转壳**，点一下才到真实页面。它只是兜底。
- **用的是公开搜索页，不是官方接口。** 调用太频繁可能被限流，日志里会记 `engine=xxx failed`，这时它自己会往下换一个后端。
- **搜不到就返回空列表**，不报错。

---

## 兼容性

dsh 0.1.5-rc.2 上实测，web profile，Windows，Node 24 和 22 都跑过。

---

## License

MIT
