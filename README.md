# Glint

An Obsidian desktop plugin that reads `.glintcapture.json` files from the Shortcuts iCloud inbox, organizes the content, and writes clean Markdown notes into your vault.

中文：这是一个 Obsidian 桌面插件，用于从 Shortcuts 的 iCloud 收件箱读取 `.glintcapture.json`，自动整理成标题、摘要、要点、分类和标签，并写入 Vault 中的 Markdown 文件。

## What it does

- Processes capture JSON files from the macOS Shortcuts iCloud inbox.
- Captures selected text, the current note, or clipboard text.
- Generates a title, category, tags, summary, key points, and entities.
- Writes a cleaner Obsidian note with a summary callout, key points, structured core note, and source section.
- Fetches readable page text for URL-only captures when URL content fetching is enabled.
- Reuses existing categories and tags found in the output folder.
- Writes Markdown with Obsidian-friendly YAML frontmatter.
- Stores notes in category subfolders so Obsidian's own search, tags, graph, and file explorer can manage them.
- Supports Chinese and English for settings, notices, Markdown section headings, and model output preference.
- Folder settings can be typed manually or selected from an in-vault folder picker.
- Adds a ribbon inbox status view with pending, processed, failed/invalid, diagnostics, and recent capture details.
- Queues manual processing, auto-processing, retries, and reprocessing through one processing lock to avoid duplicate work.
- Records failed JSON processing errors and offers single-item or bulk retry.
- Supports one-click reprocessing for processed JSON and a command to reprocess the current generated Glint note.
- Shows URL fetch quality warnings when content looks like a login page, anti-bot page, or is too short.
- Auto-processing can be switched on or off live from settings.
- Includes a provider test button for checking Ollama or OpenAI-compatible model settings.
- Includes settings buttons for copying two iOS Shortcuts: one for capturing a URL from the share sheet, and one for reading a URL from the clipboard.

## 功能

- 处理 Shortcuts iCloud 收件箱里的 `.glintcapture.json` 文件。
- 支持采集当前笔记、选中文本或剪贴板文本。
- 自动生成标题、分类、标签、摘要、关键要点和实体。
- 生成更适合 Obsidian 阅读的笔记版式，包括摘要卡片、关键要点、核心内容和来源区块。
- 当采集内容只有 URL 且开启 URL 正文抓取时，会自动访问网页并提取可读正文。
- 会复用输出目录里已有的分类和标签，避免重复标签膨胀。
- 写入带 YAML frontmatter 的 Obsidian 原生 Markdown。
- 按分类建立子文件夹，后续直接用 Obsidian 的搜索、标签、图谱和文件管理即可。
- 支持中文和英文，可在插件设置里切换。
- 文件夹设置既可以手动输入，也可以通过 Vault 内文件夹选择器直接选择。
- 增加左侧 ribbon 收件箱状态页，可查看待处理、已处理、失败/异常、诊断和最近采集详情。
- 手动处理、自动处理、重试和重新整理会进入同一个处理队列，避免重复整理同一个 JSON。
- JSON 处理失败时会记录错误原因，并支持单条重试或全部重试。
- 已处理 JSON 支持一键重新整理；当前已生成 Glint 笔记也可通过命令重新整理。
- URL 抓取疑似登录页、反爬页或内容过短时，会在收件箱状态里明确提示。
- 自动处理可以在设置中实时打开或关闭。
- 在分析方式设置中提供测试按钮，用于检查 Ollama 或 OpenAI-compatible 模型配置是否可用。
- 在设置中提供两个 iOS 快捷指令链接复制按钮：一个用于从共享表单采集 URL，一个用于从剪贴板读取 URL。

## Default folders

- Inbox: `~/Library/Mobile Documents/iCloud~is~workflow~my~workflows/Documents/Glint/Inbox`
- Output: `Glint/Notes`

Put `.glintcapture.json` files into the Shortcuts inbox, then run **Glint: Process inbox now**.

把 `.glintcapture.json` 放进 Shortcuts 收件箱，然后运行命令 **Glint: 立即处理 Glint 收件箱**。

Processed capture JSON files stay in the inbox. Glint marks the original JSON with `processed: true`, `processedAt`, and `processedNotePath` after the Markdown note is written. Failed captures keep `processingError`, `processingErrorAt`, and `retryCount` so they can be retried from the inbox status view.

已处理的采集 JSON 会留在 Inbox 原位置。Glint 在写入 Markdown 笔记后，会给原 JSON 增加 `processed: true`、`processedAt` 和 `processedNotePath` 字段。失败采集会保留 `processingError`、`processingErrorAt` 和 `retryCount`，可在收件箱状态页重试。

Important: the inbox can be an external absolute path. The default is the macOS iCloud Shortcuts path, because iPhone Shortcuts writes captures under the Shortcuts iCloud container. Organized Markdown notes are still written inside the current Obsidian vault.

注意：收件箱可以是外部绝对路径。默认使用 macOS 上 Shortcuts 的 iCloud 路径，因为 iPhone 快捷指令会把采集文件写到 Shortcuts 的 iCloud 容器里。整理后的 Markdown 仍然写入当前 Obsidian Vault。

## iOS Shortcuts

Glint provides two Shortcut import links in settings:

- Share sheet URL capture: <https://www.icloud.com/shortcuts/a00904e4a49e45fdabba559d406ca7df>
- Clipboard URL capture: <https://www.icloud.com/shortcuts/7d763259f8f04570bffb997e0c20f07f>

## iOS 快捷指令

Glint 在设置中提供两个快捷指令导入链接：

- 从共享表单中获取 URL：<https://www.icloud.com/shortcuts/a00904e4a49e45fdabba559d406ca7df>
- 从剪贴板中获取 URL：<https://www.icloud.com/shortcuts/7d763259f8f04570bffb997e0c20f07f>

## Analysis providers

The plugin defaults to a local heuristic organizer. You can also configure a local Ollama endpoint or an OpenAI-compatible endpoint in the plugin settings. URL content fetching is a separate setting and may still visit external pages.

默认使用本地规则整理；也可以在设置中配置 Ollama 或 OpenAI-compatible 接口。URL 正文抓取是独立设置，开启后会访问外部网页。中文模式下，插件会要求模型优先输出中文整理结果。

## Privacy and network access

Glint has no telemetry and does not send usage analytics.

- Local heuristic mode does not send capture content to any model service.
- Ollama mode sends capture text to the configured Ollama endpoint.
- OpenAI-compatible mode sends capture text to the configured endpoint and uses the API key stored in the plugin settings.
- URL content fetching visits captured URLs when enabled, then uses extracted page text for organization.
- The plugin is desktop-only because it reads the macOS Shortcuts iCloud folder through Node.js filesystem APIs.

## 隐私和网络访问

Glint 不包含遥测，也不会发送使用统计。

- 本地规则模式不会把采集内容发送给模型服务。
- Ollama 模式会把采集文本发送到你配置的 Ollama 接口。
- OpenAI-compatible 模式会把采集文本发送到你配置的接口，并使用保存在插件设置中的 API Key。
- 开启 URL 正文抓取后，插件会访问采集到的 URL，并使用提取出的网页正文进行整理。
- 插件使用 Node.js 文件系统 API 读取 macOS Shortcuts iCloud 文件夹，因此仅支持桌面端。

## Development

```bash
npm install
npm run build
```

For a release-ready package:

```bash
npm run package
```

This validates the manifest, `versions.json`, required release files, and then creates `dist/glint-capture-organizer-<version>.zip`.

## Official submission checklist

- Commit `README.md`, `LICENSE`, `manifest.json`, `versions.json`, source files, and package files to GitHub.
- Create a GitHub release whose tag exactly matches the `version` in `manifest.json`, for example `0.2.1`.
- Upload `main.js`, `manifest.json`, and `styles.css` from the project root as release assets.
- Submit the GitHub repository URL at <https://community.obsidian.md>.

If GitHub Actions is enabled, pushing a tag like `0.2.1` automatically builds the plugin and uploads the required release assets.
