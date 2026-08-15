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

## 重排规则

规则按 first-match-wins 自上而下匹配，顺序即优先级。页面提供两种重排方式：

- **上移 / 下移按钮**：每行操作列的 `↑` / `↓` 立即调整相邻位置并全量提交。
- **edit modal 的「位置 INDEX」字段**：填 1-based 位置（对应 `#` 列）后保存，规则会移动到该位置；留空 = 保持原位 / 追加到末尾。

重排会把**完整有效列表**通过 `PUT /admin/mappings` 提交，因此当前所有规则（含 base 默认）都会被「提升」为 runtime 覆盖。空 prefix（catch-all）始终固定在末尾。

## 固化配置（harden）

把当前有效规则固化成为 base 默认。固化弹窗顶部可切换两种导出格式：

- **appsettings.json**：生成 `ModelMapping:Rules` 片段，复制或下载 `.json`，粘贴进 `appsettings.json` 的 `ModelMapping` 段。
- **docker-compose env**：生成 `environment:` 环境变量片段（`ModelMapping__Rules__{i}__Prefix/Target/ProxyServer`），粘贴进服务的 `environment:` 段。环境变量按 index 覆盖 `ModelMapping:Rules`。

固化后重启网关/容器；随后可在面板「重置全部覆盖」清空 runtime，让 base 成为唯一来源。

## 行为说明与已知限制

- **target 可空**：空 `target` 表示"匹配该 prefix 但保持原模型名不变（不重写）"，`PATCH` / `PUT` 行为一致，非必填。
- **prefix 含 `/`**：请求路径已做 `encodeURIComponent`，无需手动处理。
- **空 prefix（catch-all）**：`PATCH` 路由不到，前端改走 `PUT` 全量提交；页面强制 catch-all 排在列表末尾（后端 first-match-wins）。
- **区分 base vs runtime**：后端 `GET /admin/mappings` 只返回合并视图，不标注来源。删除某规则后若它仍在列表里，说明它来自 `appsettings.json` 默认（已回退），页面会提示。
- **重排 / 填 index 会全量 PUT**：等于把当前完整列表（含 base）写入 runtime 覆盖；之后若再改 `appsettings.json` 的同名 base 规则会被 runtime 覆盖挡住，需「固化 + 重置全部覆盖」收口。
- **PUT 是替换而非合并**：重排、「重置全部覆盖」与「空 prefix」场景使用；单条普通编辑仍走 `PATCH`。

## 对接的后端契约

- `GET/PUT /admin/mappings`、`GET/PATCH/DELETE /admin/mappings/{prefix}`（需 `x-admin-key`）
- `GET /health`（免鉴权）
- 字段 camelCase：`prefix` / `target` / `proxyServer`
