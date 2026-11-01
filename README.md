# 笔记本 (Notebook)

DeepSeek Harness（DSH）插件：**工作区里的 markdown 笔记本** —— 目录树、所见即所得编辑、自动保存，右侧嵌着 AI 对话。

- **Host 半边**：一个认证过的 JSON 控制面（读树、读写文件、建文件/目录、打开资源管理器、写工作区 README）。
- **Client 半边**：侧边栏入口 + 三栏面板（目录 · 文档 · 对话）。
- **没有工具、没有 skill、没有渲染管线**：面板编辑的就是工作区里的真实文件，模型用自己的 `read`/`write` 工具读写同一批文件。

## 安装（npm）

发布到 npm 后，在 DSH 里安装这个 bundle：

```text
安装 @zmskco/dsh-notebook 这个插件
```

（等价于让插件管理把这个包加进 profile 的依赖与 bundle 列表。）要求：DSH `^0.2.2-alpha.2`、Node `>=20`，声明在 `package.json` 的 `engines` 里，版本不符会被管理工具拒绝安装。装好后侧边栏出现「笔记本」。

## 功能

| 区域 | 用法 |
| --- | --- |
| 目录区（左） | 工作区文件树：点文件夹展开/折叠，点文件在中间打开；行首是文件夹/文件图标 |
| 文档区（中） | 默认所见即所得；`写作` / `源码` 两个按钮切换；字数与保存状态在右端 |
| 对话区（右） | 当前会话的对话；可隐藏（标题行最右端），隐藏只是不绘制，不卸载 |

- **两个新建图标 + 刷新 + 打开资源管理器**在目录列标题行右端，紧挨对话开关：`new-dir` / `new-file` / `refresh` / `reveal`。
- 新建是**就地命名**：点图标后目标目录里出现一行空名字，回车创建；空名字回车或 Esc 取消；输入法组字时回车不误触发。
- **文件名就是输入的名字，不补 `.md`**：输「第一章」得到 `第一章`；输「素材.md」得到 `素材.md`。重名时在扩展名前加序号（`名-2.md`）。
- **首次打开写一份 `README.md` 到工作区根目录**（`op=ensure-readme`），内容固定，且**只写不覆盖**。
- **排版**：字体 `黑 / 宋 / 霞 / 阿`（本机字体栈，不打包字体文件）、字号 13–24、纸色 `简白 / 雅致 / 黑夜 / 绿荫`——**纸色作用于整个面板**（左栏、编辑区、对话区同一张纸），默认简白。
- **编辑器**：ProseMirror 内核；markdown ↔ 文档模型双向转换，schema 表达不了的块（front matter、表格）作为 raw 块逐字保留；**文件里单个换行在页面上就是换行**（写回为行尾两空格 + 换行）。
- **自动保存**：停笔 900ms 写盘，`Ctrl/Cmd+S` 立即保存；切换文件先把当前缓冲写掉。**没有保存按钮**。
- **目录树**：`node_modules` 与点开头条目不列出；大目录有 2000 条上限。

## 树根与权限

**树根 = 调用方 Session 的 `header.cwd`**，也就是操作者打开的工作区：

| 规则 | 触发条件 | 结果 |
| --- | --- | --- |
| `override` | profile 行里配了 `rootDir` | 用该目录 |
| `workspace` | 有 Session 且未配 `rootDir` | 该 Session 的工作区 |
| `fallback` | 无 Session、无 `rootDir` | 部署写边界，否则 `<DSH_HOME>/glimmer` |

每次调用都从调用方 Session 解析，所以写入天然落在该 Session 沙箱已允许的目录里；写盘带 `{ mode, workspaceRoot }` 盖章。`op=focus` 把会话工作目录对齐到同一目录，让模型的相对路径与面板一致。

## 配置

`cordis.patch.yml` 的 `notebook` 行只有一个字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `rootDir` | `null` | 面板的根目录；绝对路径，或相对工作区边界的相对路径。不设则跟随工作区 |

## HTTP 控制面

所有操作走 `/api/notebook?op=<动作>`，继承 Connection 的 Host/Origin 校验与浏览器认证。

| `op` | 参数 | 说明 |
| --- | --- | --- |
| `state` | — | 根目录、选择规则、沙箱报告 |
| `files` | `project=''` | 树的平铺清单（目录 + 文件） |
| `file` | `project=''`, `path` | 读一个文本文件 |
| `save-file` | `project=''`, `path`, `content` | 写一个文本文件 |
| `create-dir` | `project=''`, `name`, `dir` | 建目录（名字带分隔符 400，重名 409） |
| `create-file` | `project=''`, `title`, `dir` | 用输入的名字原样建文件；散文名带 `# 标题` |
| `focus` | `project=''` | 把调用方会话的工作目录切到工作区 |
| `reveal` | — | 用系统文件管理器打开工作区；`dryRun` 只回答会启动什么命令 |
| `ensure-readme` | — | 工作区 `README.md`：不存在则写（201），已存在则 `created:false`（200） |

`project` 只接受空串（工作区本身）；故事/分镜/设定集相关的操作在这次简化中全部移除。

## 开发

```powershell
pnpm install
pnpm run build      # host(tsc) + client(tsdown) + 产物契约检查
pnpm test           # 类型检查 + 沙箱 + Host 冒烟
npm pack --dry-run  # 看 tarball 内容
```

- `scripts/check-client.mjs`：产物是 lazy-CJS（`__ModuleLoader__.load`，只用 `react` 外部）；槽位注册、字典、树、布局、字体/纸色、编辑器往返、图标与样式契约、以及「故事机制零残留」。
- `scripts/smoke-host.mjs`：不用 DSH 进程即可驱动整个控制面（40 项断言）：建文件/目录、读写、路径逃逸、README、reveal、focus、写边界盖章。
- `scripts/check-sandbox.mjs`：写边界报告。

## 限制

- markdown 是子集：嵌套列表、HTML 块、引用式链接、脚注按普通文字处理；表格与 front matter 作为 raw 块保存，不在文档视图里做表格编辑。
- 不渲染 mermaid 之类的文本作图。
- 字体不打包，用本机字体栈；没装会退到同类系统字体。
- 重命名与删除请用系统资源管理器（标题行的「打开」）或让模型操作。

## 许可

MIT。内置图标来自 [Lucide](https://lucide.dev)（ISC）。
