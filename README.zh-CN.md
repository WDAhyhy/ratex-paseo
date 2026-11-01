# RaTeX for Paseo

[English](README.md) | [简体中文](README.zh-CN.md)

在 Paseo 对话中渲染 LaTeX 公式，支持查看和复制源码。

本分支为 **0.1.8-quote.5 兼容增强版**，包含网页 Quote 选区适配和 Android 原生公式图片。请使用 [GitHub 预发布包](https://github.com/WDAhyhy/ratex-paseo/releases/tag/v0.1.8-quote.5)，安装与回滚见 [COMPATIBILITY.md](COMPATIBILITY.md)。本版未发布 npm；下方 npm 和上游 Git 安装说明属于原版插件。

## 功能

- 自动渲染助手消息中的公式；用户消息保留 Paseo 原生右侧布局。
- 支持行内定界符 `$...$`、`\(...\)`，以及独立公式定界符 `$$...$$`、`\[...\]`。
- 跨公式划选复制时，保留公式原始的定界符、空格和换行。
- 双击公式，将其原位替换为 Markdown 风格的代码框；右上角的 **Copy** 用于复制，**Show formula** 用于切回公式。
- 支持键盘操作：聚焦公式后，按 **Enter** 或 **Space** 显示源码。
- 内嵌公式字体和 WASM 二进制，渲染时无需从 CDN 获取资源。
- 提供 **RaTeX** 侧栏试写面板和 **RaTeX formula** 工作区面板。
- Android 通过服务端透明 PNG 显示公式；轻点打开宿主源码面板，支持复制和返回，超宽公式局部横向滚动。
- 加载中或渲染失败时显示可选择的 TeX 源码。原生路径已用 Android App 模拟器验证，iOS 尚未验收。

插件的按钮、悬停提示和无障碍标签统一使用英语。当前使用的 Paseo 插件 SDK 未向插件暴露宿主语言设置。

公式消息使用 Paseo 默认的对话字号：网页端 15px，iOS 和 Android 16px。插件 SDK 未提供 **Settings → Appearance** 中的字号设置，修改这些设置后，公式消息仍使用默认字号。

## 环境要求

| 组件 | 要求 |
| --- | --- |
| Paseo | 插件声明兼容 `>=0.13.0`，不设上限（含测试版），开发使用的 SDK 为 `0.13.2`。Paseo 0.8 至 0.12 请安装 `ratex-math-render@0.1.6` |
| 客户端 | 网页 Canvas 与 Android 原生 PNG 渲染；iOS 真机待验证 |
| 开发环境 | 建议 Node.js 22.14+；已在 Node.js 22.21.1、npm 11.10.1 下验证 |
| 安装环境 | daemon 所在机器可运行 Node.js 和 npm；Paseo 版本需要支持 npm 插件来源 |

目标 daemon 需要已启用 Paseo 插件。插件作为可信代码在 daemon 和连接的客户端中运行。

## 安装此兼容版

在 daemon 所在主机执行；不要与另一个 RaTeX 同时启用。如果已从这个 fork 的 Git 来源安装同一 ID，用 `paseo plugin update ratex-formula --ref v0.1.8-quote.5` 更新。目录安装或上游来源不能用这条命令切换到本 fork。

```bash
paseo plugin install git:WDAhyhy/ratex-paseo --ref v0.1.8-quote.5 --id ratex-formula
paseo plugin ls ratex-formula
```

安卓手机和平板完全退出 Paseo App 后重新打开，以加载新的插件 bundle。无需清数据、重新配对或重启 daemon。只会渲染助手消息中的公式，用户消息保持原生布局和源码。

## 原版 npm 安装

在 Paseo daemon 所在机器安装已发布的 [ratex-math-render](https://www.npmjs.com/package/ratex-math-render)：

```bash
paseo plugin install npm:ratex-math-render
paseo plugin ls
```

也可以在 Paseo 的 **Settings → Plugins → Plugin source** 中填写 `npm:ratex-math-render`。Paseo 会下载包并安装依赖，无需额外执行 `npm install`。

安装指定版本：

```bash
paseo plugin install npm:ratex-math-render@0.1.0
```

npm 包名是 `ratex-math-render`，安装后的插件 ID 为 **`ratex-formula`**。更新时使用插件 ID：

```bash
paseo plugin update ratex-formula
```

安装完成后刷新网页客户端，加载公式界面。

## 从 GitHub 安装

```bash
paseo plugin add ZedRover/ratex-paseo --ref main
paseo plugin ls
```

如果仓库为私有，daemon 所在机器需要具备相应的 Git 访问权限。插件声明会在 Git 安装时执行 `npm ci --omit=dev`，同时生成内嵌资源。插件运行 ID 为 **`ratex-formula`**。

更新通过 Git 安装的插件：

```bash
paseo plugin update ratex-formula
```

## 本地开发

```bash
git clone https://github.com/ZedRover/ratex-paseo.git
cd ratex-paseo
npm ci
npm run typecheck
npm test
npm run render:launch
```

将当前目录安装到本地 daemon：

```bash
paseo plugin install "$PWD"
paseo plugin ls
```

修改源码后：

```bash
npm run typecheck
paseo plugin reload ratex-formula
```

如果网页仍显示旧界面，请刷新客户端。修改插件源码无需重启 daemon。

## 使用公式

例如，发送包含以下内容的消息：

```text
能量公式是 $E=mc^2$。

\[
a^2 + b^2 = c^2
\]
```

跨消息内容划选时，公式会以 TeX 源码形式进入剪贴板。双击任意公式，可在原位置显示代码框。复制按钮会复制包含定界符的完整公式源码。

试写面板可以从 **RaTeX** 侧栏入口、**RaTeX formula** 工作区面板，或 Command Center 中的 **Open RaTeX formula** 操作打开。

## 渲染原理

1. 客户端的时间线转换器识别消息中完整的公式。
2. 客户端通过插件 RPC 发送 TeX、显示模式和颜色。
3. daemon 中的 `ratex-wasm` 解析公式并完成排版，返回 DisplayList 绘制指令。
4. 网页端使用 Canvas 2D 和内嵌的 KaTeX 字体绘制公式。
5. 带源码位置的 Markdown AST 将 DOM 选区映射回消息原文；可选择的 TeX 同时支持浏览器纯文本回退。Canvas 使用实际字体墨迹边界和公式 depth 确定尺寸及基线。

服务端缓存同时限制条目数量和序列化大小，较大的结果不进入缓存。单个公式最多允许 4096 个字符。

## Markdown 行为与限制

不包含完整公式的消息继续使用 Paseo 内置的 Markdown 渲染器。包含公式的消息由本插件接管整条消息的渲染，支持标题、强调、删除线、行内代码、围栏和缩进代码块、链接、引用、列表、任务列表、管道表格及分隔线。

- 兼容版使用带源码 offset 的 CommonMark/GFM AST；图片仍以标签和 URL 展示，引用式链接与任意 HTML 不保证等同宿主渲染器。
- 图片显示为标签和 URL，不会加载图片内容。
- 指向本地文件的链接和行内代码（如 `client/message.tsx:105`）会像 Paseo 原生消息一样在工作区中打开（仅网页端）。行内代码里只有文件名（如 `message.tsx`）时仍显示为普通代码，因为插件无法使用 Paseo 的文件查找。
- 同一条 RaTeX 消息内的选区可恢复原始 Markdown 和 TeX；原生 copy 监听兼容 Quote 的合成剪贴板事件。见 [兼容版交付说明](COMPATIBILITY.md)。
- 原生客户端使用服务端 PNG，轻点打开 Paseo 源码面板；超长行内公式独占一行局部横向滚动。网页 Quote 选区能力不等于安卓原生选区能力。
- 不支持的公式会回退为源码显示。

## 自动生成的资源

`npm ci` 和 `npm install` 会执行 `prepare` 脚本，生成以下文件：

| 生成文件 | 对应命令 |
| --- | --- |
| `server/vendor/ratex-wasm-bytes.ts` | `npm run embed-wasm` |
| `client/vendor/fonts.ts` | `npm run embed-fonts` |
| `server/vendor/native-fonts.ts` | `node scripts/embed-native-fonts.mjs` |

这些文件由 Git 忽略，并根据锁定版本的 `ratex-wasm` 依赖重新生成。WASM 二进制先经 gzip 压缩再以内嵌 Base64 保存，服务端初始化时解压一次；测试会验证解压后的字节与上游二进制完全一致。如果安装时使用了 `--ignore-scripts`，需要随后手动执行 `npm run prepare`。`npm test` 会检查资源与依赖的一致性。

## 浏览器回归验证

浏览器验证使用实际组件、React Query 和服务端渲染函数，仅替换 Paseo 宿主钩子。在独立目录中安装浏览器测试工具：

```bash
mkdir -p /tmp/ratex-browser-tools
npm install --prefix /tmp/ratex-browser-tools \
  esbuild puppeteer-core@25.11.0 react@19.1.0 react-dom@19.1.0 react-native-web@0.21.2
```

指定已安装的 Chrome 或 Chromium 可执行文件，运行真实浏览器验证：

```bash
RATEX_BROWSER_DEPS=/tmp/ratex-browser-tools \
CHROME_BIN=/absolute/path/to/chrome \
npm run test:browser
```

如果 `PATH` 中已安装 `obscura`，也可以执行：

```bash
RATEX_BROWSER_DEPS=/tmp/ratex-browser-tools npm run test:browser -- --obscura
```

Chrome 验证覆盖真实鼠标拖选、剪贴板读写、行内和独立公式的原位源码框、右上角复制按钮、键盘操作、字体、加载状态、主题切换、错误回退、原生端回退和紧凑布局。Obscura 通过 Puppeteer/CDP 验证程序化 Range 选区，不用于证明原生鼠标选区或剪贴板行为。两个命令结束时都会关闭自己启动的测试服务与浏览器。

## 目录结构

```text
index.client.tsx       客户端注册与时间线转换器
index.server.ts       服务端 RPC 注册
client/               消息、公式、源码框和画布界面
server/               WASM 初始化、渲染和缓存
shared/               解析、布局和 RPC 契约
scripts/              内嵌资源生成与渲染冒烟检查
tests/                单元测试与浏览器回归验证
```

## 发布

npm 包名为 `ratex-math-render`。发布新版本前执行：

```bash
npm ci
npm run typecheck
npm test
npm run check:package
npm publish --access public
```

`files` 明确包含生成的 WASM、字体、中英文 README 和许可证声明。锁定版本的 `ratex-wasm` 依赖随包分发，保留渲染器与 WASM 绑定所需的内部路径。测试和开发工具不进入安装包。

Paseo 从 npm 安装时跳过生命周期脚本，因此发布包内已经包含可用资源。插件的准备命令会对带锁文件的 Git 检出执行 `npm ci --omit=dev`，对 npm 安装则检查随包资源。

### 通过 GitHub Actions 发布

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) 会检查推送到 `main` 的提交、PR 和手动触发的运行。发布**正式 GitHub Release** 后，工作流先执行检查，再使用 OIDC 发布到 npm 并附带来源证明。草稿和预发布版本不会上传 npm。Release 标签必须与 `package.json`、`package-lock.json` 中的版本一致，并带 `v` 前缀。

在 [npm 包设置](https://www.npmjs.com/package/ratex-math-render/access) 中配置一次可信发布者：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `ZedRover` |
| Repository | `ratex-paseo` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |
| Allowed actions | 启用直接 `npm publish` |

无需配置 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN` Secret。工作流仅为发布任务授予 `id-token: write`，并使用 GitHub 托管 runner。详见 [npm 可信发布文档](https://docs.npmjs.com/trusted-publishers/)。

从 `0.1.0` 发布下一个补丁版本时，在干净且已同步远端的 `main` 上执行：

```bash
npm version patch -m "chore(release): %s"
git push origin main --follow-tags
gh release create v0.1.1 --verify-tag --generate-notes
```

后续发布替换为新的版本标签。仅推送标签不会发布 npm，还需要发布 Release。可以在 GitHub Actions 中查看 **Check and publish** 的结果。发布失败时，按需修正 npm 可信发布配置后重新运行失败任务；已经发布的 npm 版本不能重复使用。

## 致谢

本插件建立在以下项目及其贡献者的工作之上：

- [RaTeX](https://github.com/erweixin/RaTeX)：通过 `ratex-wasm` 提供 Rust/WASM 数学公式解析与排版引擎，以及网页端 DisplayList 渲染器。
- [Paseo](https://github.com/getpaseo/paseo)：提供宿主应用、插件 SDK、时间线集成和客户端／服务端运行环境。
- [KaTeX](https://github.com/KaTeX/KaTeX)：提供由 `ratex-wasm` 附带并内嵌到本插件中的数学字体。

感谢这些项目的维护者和贡献者，让本插件的集成成为可能。

## 许可证与第三方声明

本项目的原创代码采用 [MIT 许可证](LICENSE)，版权所有 © 2026 ZedRover。

第三方代码和资源保留各自的许可证。RaTeX（`ratex-wasm`）采用 MIT 许可证；附带的 KaTeX 字体采用 SIL Open Font License 1.1。相关版权和许可证声明保留在 [client/vendor/FONT-LICENSE.txt](client/vendor/FONT-LICENSE.txt)。本项目的 MIT 许可证不会替代字体的 OFL 许可证或其他依赖的许可证。

分发包含这些第三方组件的插件时，应同时保留相关组件适用的版权和许可证声明，以及本项目的许可证。
