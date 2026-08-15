# AI Gateway · Runtime Mapping Console

纯静态管理页面，用于在运行时查看 / 新增 / 编辑 / 删除 AI Gateway 的模型映射规则。零依赖、无构建步骤，直接放进 Apache HTTPD 即可。

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 页面骨架 |
| `styles.css` | 「暗色·工业控制台」主题 |
| `app.js` | 逻辑（多网关管理、API 封装、CRUD） |

三个文件放到同一个目录即可，浏览器打开 `index.html`（或由 Apache 托管）。

## 部署步骤

### 1. 后端：启用 Admin API 并配置 CORS

页面默认**直连**网关后端（`http://localhost:4000`），是跨域请求，需要后端做两件事：

- **设置 `Admin__ApiKey`**（环境变量），否则 admin API 整体返回 404：

  ```bash
  # 示例（Linux/macOS）
  Admin__ApiKey=sk-admin-xxx dotnet run
  # Windows PowerShell
  # $env:Admin__ApiKey = "sk-admin-xxx"; dotnet run
  ```

- **把页面源加入 CORS 白名单**。页面由 Apache 托管在哪个源，就加哪个源（`appsettings.json` → `Cors:AllowedOrigins`）：

  ```json
  {
    "Cors": {
      "AllowedOrigins": [
        "https://pivot.claude.ai",
        "http://localhost:8080"
      ]
    }
  }
  ```

  改完重启网关。若从 `file://` 直接打开页面，源是 `null`，多数浏览器会被 CORS 拦截——请用 Apache 或任意本地 HTTP 服务托管后再访问。

### 2. Apache：托管静态文件

把三个文件复制到 Apache 的 `DocumentRoot`（如 `htdocs/`），无需任何额外模块或 `.htaccess` 配置，纯静态托管即可。

### 3. 使用

1. 打开页面，右上角「管理」→ 添加网关（名称 / Base URL / API Key）。
2. 选择当前网关，页面自动拉取 `/health` 与 `/admin/mappings`。
3. 增删改规则，改动即时生效并持久化到后端的 `mappings-runtime.json`。

## 多网关

- 网关列表（名称 / Base URL / API Key）保存在浏览器 `localStorage`（key：`aiGatewayAdmin.v1`），不会上传。
- 每个网关独立保存自己的 `x-admin-key`；切换网关即切换目标后端。

## 行为说明与已知限制

- **target 可空**：空 `target` 表示"匹配该 prefix 但保持原模型名不变（不重写）"，`PATCH` / `PUT` 行为一致，非必填。
- **prefix 含 `/`**：请求路径已做 `encodeURIComponent`，无需手动处理。
- **空 prefix（catch-all）**：`PATCH` 路由不到，前端改走 `PUT` 全量提交；请确保 catch-all 排在列表末尾（后端 first-match-wins）。
- **区分 base vs runtime**：后端 `GET /admin/mappings` 只返回合并视图，不标注来源。删除某规则后若它仍在列表里，说明它来自 `appsettings.json` 默认（已回退），页面会提示。
- **PUT 是替换而非合并**：仅「重置全部覆盖」与「空 prefix」场景使用，单条编辑走 `PATCH`。

## 对接的后端契约

- `GET/PUT /admin/mappings`、`GET/PATCH/DELETE /admin/mappings/{prefix}`（需 `x-admin-key`）
- `GET /health`（免鉴权）
- 字段 camelCase：`prefix` / `target` / `proxyServer`
