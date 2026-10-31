# RaTeX / Quote 兼容增强版

版本：`ratex-math-render@0.1.8-quote.1`。本地分支：`compat/quote-selection`。未发布 npm / GitHub，未改动现有 Paseo 安装或用户数据。

## 固定源码与宿主合同

- RaTeX：`ZedRover/ratex-paseo`，`10af57fa2733a31387b5c6a8e0fec7ea45cd2be3`（0.1.8）。
- Quote：`keefeere/paseo-quote`，`f6484cb4047b7393d12e86b512d897ff548c4f76`（0.1.1），整个工作树只读且保持干净。
- Paseo SDK / 官方编译器：0.13.2；参考宿主 `v0.13.2`，commit `d2941157a8f91512daf54fc688241d416e8f5ebd`。
- Node 22.22.3 / npm 10.9.8；真实 Chromium 运行测试，宿主 API 使用有界 fixture，没有建立实际 Agent 或 Session。

## 关键设计

### 一次框选混合 Markdown / TeX

生产消息渲染器改用 `shared/source-markdown.ts`。复用原公式扫描器，将公式按相同 UTF-16 长度遮罩后解析 CommonMark/GFM；记录原始消息、节点 offset、公式完整定界符、文本边界映射。DOM 叶子节点标注 source ID，不从 Canvas 视觉文本猜公式。选区内部所有内容直接切原消息，起止普通文字精确到字符；公式一旦被部分覆盖即作为完整原子单元。完整标题、强调、链接、列表、表格恢复外围标记。

每条消息根节点安装一个原生冒泡 `copy` 监听器，卸载及原文变化时清理。仅处理两个端点都在本消息内的单 Range；有结果且有 clipboardData 才写 `text/plain` 并 preventDefault。已被处理的事件不覆盖。不注册全局 copy 监听，不修改 Selection / 系统剪贴板 API。非 Web 不执行 DOM 代码。

Quote `client/web.ts` 的实际链路：`pointerup -> setTimeout(sync,0) -> readSnapshot -> readSource -> hostMarkdown(start)`。它创建私有 DataTransfer 和可取消、冒泡的 ClipboardEvent，从有序 Range 起点元素 dispatch；要求 defaultPrevented 后才读取 text/plain。该过程发生在选区仍存活时；后续 Quote/Reply/Side Chat/Copy 使用快照，不会因文本框聚焦丢失引用。Quote 在工具栏 mousedown preventDefault 保留页面选区。测试直接打包该版本原始 `client/web.ts`、`actions.ts`、`format.ts`，未复制修改其逻辑。

### 用户消息布局

只注册 `assistant_message` Transformer。SDK 的 PluginTimelineItemProps 只提供 `type:plugin`，没有原用户消息容器和角色布局。宿主 `message.tsx:291` 的 UserMessage 才持有 flex-end 容器和气泡；插件视图不包这个容器。因此默认不替换用户消息，而不是给全部消息强行加右对齐。

### 偶发公式显示不完整 / 遮挡

- WASM height / depth 描述排版尺寸；Canvas fillText 实际字体墨迹可能超出 advance/layout box。复用原 renderer 的字体选择及排版指令做 measureText，按真实 boundingBox 调整必要尺寸和原点，仍由原 WASM/renderer 绘制。没有给生产画布加巨大 padding。
- 行内 Canvas 依据 `height + depth` 和实际补偿计算基线，不把画布底边当作文字基线。普通段落明确允许可见 overflow；高分数由真实行盒撑开，不和上下文重叠。
- 块公式使用原始字号和完整逻辑/设备像素尺寸；容器横向滚动，不再把长公式缩到很小。flex minWidth=0，Canvas 不收缩。
- 字体加载完成后重新测量；ResizeObserver/窗口 resize 处理 DPR，单纯宽度改变不替换 Canvas，以免干扰选区。所有组件监听均清理。
- 浏览器校验墨迹边缘不是透明截断；六类复杂公式的墨迹宽高与宽裕参考画布完全一致；另检查行内高分数和表格求和的各层 clipping ancestor。

## 验证命令

```bash
npm ci
npm run typecheck
npm test
npm run render:launch
npm run check:package

# 浏览器工具独立安装，不是插件运行时依赖
npm install --prefix /tmp/ratex-browser-tools \
  esbuild puppeteer-core@25.11.0 react@19.1.0 react-dom@19.1.0 react-native-web@0.21.2
export RATEX_BROWSER_DEPS=/tmp/ratex-browser-tools
export CHROME_BIN=/absolute/path/to/chromium
npm run test:browser

# Quote 仓库只读；固定 commit 后执行
# git clone https://github.com/keefeere/paseo-quote.git ../quote
# git -C ../quote checkout f6484cb4047b7393d12e86b512d897ff548c4f76
QUOTE_SOURCE="$(realpath ../quote)" npm run test:quote
```

`test:quote` 加载生产 RaTeX 组件、React Native Web、真实服务端 WASM 和未改动 Quote。含真实鼠标拖选点击、合成 copy 数据严格比较、最终 composer 文本、Reply/Add/Send、Side Chat API payload、纯公式部分选区、反向选区、跨段落、GFM、不同消息不拦截、反复卸载、独立工作、复杂公式主题/DPR/窄屏和截图。测试证据由 `RATEX_EVIDENCE` 指定，默认仓库同级 evidence。支持 `RATEX_CLIENT_BUNDLE=/absolute/path/clientBundle.js` 与 `RATEX_RENDER_SERVER=file:///absolute/path/server-adapter.mjs` 加载官方编译后的实际 client/server bundle；交付包的该路径也已跑过全部 20 组测试。用户气泡位置的浏览器断言使用按宿主容器合同搭建的 fixture，结合真实注册结果验证用户 Transformer 未注册，并非完整宿主截图。

`npm audit --omit=dev` 检查结果为 0 个生产依赖漏洞。完整 `npm ci` 报告 14 个开发依赖链漏洞（12 moderate / 1 high / 1 critical，来自上游工具链）；未擅自进行可能破坏 SDK 兼容性的全量依赖升级。生产安装包只捆绑运行时依赖。

`test:browser` 是上游现有回归；保留全部重要断言，仅调整代码 span 选择器去匹配新增源码映射包装内的实际代码节点。单测保留原有测试并新增 source-position 测试。详细最终计数、日志、官方编译器构建及安装包校验记录放在交付目录的 `DELIVERY.md` / `evidence/`。

## 安装与切换

本包保持原插件 ID **`ratex-formula`**，因此不能与原版以同一运行时 ID 并存。为避免隐式覆盖，建议安装为独立运行时 ID，但任意时刻只启用一个 RaTeX。Quote 无需操作。

先在 daemon 主机解压交付的 **install-ready.tar.gz** 到持久目录，例如 `/opt/paseo-plugins/ratex-quote`。这个目录已包含嵌入字体、WASM 和捆绑生产依赖，无需额外兼容插件。

```bash
paseo plugin ls
# 先停原版；保留其配置和文件，可快速回滚
paseo plugin disable ratex-formula
# source 是 daemon 主机上的绝对路径，不是客户端本机路径
paseo plugin install /opt/paseo-plugins/ratex-quote --id ratex-formula-quote
paseo plugin ls ratex-formula-quote
```

然后刷新 Web / Desktop 客户端。Linux AppImage 如将目录参数解释为打开项目，可用：

```bash
paseo plugin install /opt/paseo-plugins:ratex-quote --id ratex-formula-quote
```

开发源码安装：解压完整 source 包，`npm ci` 后用同样目录命令安装。本地目录源码更新后执行 `paseo plugin reload ratex-formula-quote`，刷新客户端。不要对该目录安装执行远端 update 来切回上游；需要兼容版更新时换入已验证的本地目录后 reload。无需 daemon 重启。

### 回滚

```bash
paseo plugin disable ratex-formula-quote
paseo plugin enable ratex-formula
paseo plugin ls
```

刷新客户端即可恢复原版。未删除数据；兼容版文件和配置可保留。如果本来没有安装原版，可按上游方式安装固定版本：`paseo plugin install npm:ratex-math-render@0.1.8`，确保兼容版已停用。不要同时启用两个 runtime ID 的 RaTeX。

## 已知限制与验收边界

- 用户消息保持原生右侧布局，里面的 TeX 保留源码，不再由 RaTeX 渲染；这是 SDK 缺少原生气泡内扩展点时的明确取舍。
- 不跨多个消息接管复制，也不替其它插件序列化选区；这类情况保留宿主/浏览器回退。
- 部分代码 span/代码块选区目前按原子单元恢复完整源码；部分强调/链接选区只保留所选源码，不保证外围标记自动闭合。表格部分选区不补齐未选单元格。完整跨块选区保留原文。
- 纯公式通过其 selectable TeX 文本选区可引用完整源码。只选中 Canvas 元素但没有任何文本的 Range 时，原版 Quote 的 `selection.toString().trim()` 前置检查会拒绝显示工具栏；RaTeX 不全局篡改 Selection 来绕过它。跨文字拖选正常。
- 实际鼠标拖选、原版 Quote 工具栏/写入 composer、浏览器原生剪贴板已在 Chromium fixture 验证；Reply/Side Chat 的网络侧是 host API fixture，不是已部署 daemon 的真实 Agent。没有声称已在用户当前 Paseo 安装上验收。
- 未运行 Safari/Firefox、真机 iOS/Android；非 Web 沿用源码退化行为，已有浏览器测试覆盖 native 平台不发 Canvas RPC。Obscura 非必需且未运行。
- 新 Markdown AST 支持常用 GFM，但不是 Paseo 完整渲染器的完全替代。图片仍为标签和 URL，HTML 作为安全文本，不支持完整 reference-link 宿主交互；文件链接和代码位置跳转保留。
- 公式引擎仍为固定 ratex-wasm 0.1.14，单公式 4096 字符上限、原缓存及错误源码回退不变。超长行内公式不强行断开 TeX；推荐模型输出块级公式。字体默认尺寸与上游相同，不读取 Paseo Appearance 自定义字号。
