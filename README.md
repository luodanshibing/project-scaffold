# Project Scaffold

[English](#english) · [简体中文](#简体中文)

---

## English

An Obsidian plugin for people whose projects live in **deep folder hierarchies** — engineers, not just note-takers.

**New project** → pick a category, type a name, and the whole folder skeleton is created for you.
**New project document** → a folder picker that lists *only* your project paths, ordered by what you actually use.

No databases, no proprietary formats, no sidecar files. It only ever **creates** — it never rewrites a note you already have.

### The problem it solves

Template plugins (QuickAdd, Templater) are great at "make a note from a template in folder X". They are not built for projects that *are* a folder tree:

- QuickAdd can create a note, and it can create the folders along that one file's path — but it **cannot scaffold a multi-level folder tree**, including empty folders.
- QuickAdd's `Ask for folder each time` shows **every folder in your vault**. The alternative, `In a specific folder` with several folders, is ordered by hand-dragging, not by what you used last.
- Neither knows that `F.260603-Worm-gear-assembly-line/04 R&D/02 Mechanical` is a *project document location* and `Templates/` is not.

Project Scaffold fills exactly that gap: a scaffolding step, and a project-aware folder picker.

### Commands

| Command | What it does |
|---|---|
| **New project (scaffold folders)** | Pick a category (Work / Life / Study) → type a project name → creates `F.260603-ProjectName` and copies the whole template tree `<scaffold root>/<category>/` into it |
| **New project document (pick project path)** | Opens a folder picker limited to your project roots, ranked by recency; then creates the note there |
| **Initialize / repair scaffold template folders** | Creates the missing empty folders of the built-in skeleton inside the vault |

Both creation flows can optionally hand the new note to **Templater** or **QuickAdd** — the engine is detected from the template body (`<%` → Templater, `{{ }}` → QuickAdd, otherwise plain text).

### How the folder picker ranks results

1. The project of the currently open note
2. Recently used projects
3. Recently used exact folders
4. Project folder modification time (newest project first)
5. Shallower before deeper (project root → first level → second level)
6. Then modification time, then path

The candidate list is limited to folders under your configured project roots, up to a configurable depth, minus an ignore list (e.g. `附件` / attachments). Nothing else from the vault ever appears.

### Data ownership

This is the design constraint the plugin was built around: **your data must not be bound to the software**.

| Thing | Where it lives | If you uninstall the plugin |
|---|---|---|
| The scaffold definition | **Real folders in your vault** (`1 Obsidian/项目脚手架/<category>/`) | Stays exactly as it is — edit it by hand any time |
| "Recently used" | `data.json` inside the plugin folder (plain JSON settings) | Only the ordering is lost |
| Notes you created | Ordinary Markdown | Untouched |

The plugin **only creates** folders and notes. If a target already exists it stops and tells you; it never overwrites.

### Install (manual)

1. Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/project-scaffold/`.
2. Reload Obsidian (`Ctrl+P` → *Reload app without saving*).
3. Enable **Project Scaffold** in *Settings → Community plugins*.

Not yet submitted to the community plugin list.

### Settings

Everything lives under *Settings → Project Scaffold*:

- **Scaffold** — template root folder, deepest folder level offered in the picker, folder names to exclude
- **Project types** — per type: display name, project root folder, filename prefix, separator, default template (with a live preview of the generated name)
- **Templates** — template folder, engine (auto / always Templater / always QuickAdd / always plain text), whether to ask for a template, whether to open the new note
- **About data** — the table above, in short

Defaults match a three-category setup: Work → `F Craftlab/F2 项目`, Life → `E Yearify/E3 项目`, Study → `D Develo/D2 知识领域`. Change them to whatever your vault uses — nothing in the code is specific to those paths.

### Placeholders (plain-text fallback)

If a template is not handled by Templater or QuickAdd, the plugin replaces these in both filenames and content:

`{{项目名}}` `{{项目文件夹}}` `{{项目编号}}` `{{类型}}` `{{日期}}` `{{日期紧凑}}` `{{项目路径}}` `{{文件名}}`

Files placed inside the scaffold tree are copied along with it, so you can ship a project home page with every new project.

### Development

```
project-scaffold/
├── main.js              plugin (single file, no bundler, no runtime dependencies)
├── manifest.json
├── styles.css
├── versions.json
├── tools/
│   ├── test.mjs         pure-logic unit tests        (node tools/test.mjs)
│   ├── test-flows.mjs   flow tests on an in-memory vault (node tools/test-flows.mjs)
│   ├── deploy.ps1       copy the plugin into a vault + create the scaffold tree
│   └── deploy.bat       double-click wrapper for deploy.ps1
└── .gitignore
```

```bash
node tools/test.mjs        # 52 assertions
node tools/test-flows.mjs  # 39 assertions, runs the real create flows against a fake vault
```

`main.js` is the source and the artifact at the same time — there is no build step.

### License

[MIT](LICENSE) © 2026 luodanshibing

---

## 简体中文

给**项目本身就是一棵文件夹树**的人用的 Obsidian 插件 —— 机械 / 自动化工程师，而不只是记笔记的人。

**新建项目**：选类型、输名字，整棵预置目录树自动铺好。
**新建项目文档**：弹出的目录选择器**只列你的项目路径**，并按你实际用过的顺序排。

没有数据库、没有专有格式、没有附属文件；**只新建，从不改写已有笔记**。

### 它解决什么问题

QuickAdd / Templater 擅长"在固定目录里照模板建一篇笔记"，但它们不是为"项目＝目录树"设计的：

- QuickAdd 能建笔记、也能顺带建这条文件路径上的目录，但**铺不出一棵多层的空目录树**；
- QuickAdd 的 `Ask for folder each time` 会把**全库文件夹**列出来；退而求其次的"指定多个文件夹"又只能靠手工拖拽排序，不看最近使用；
- 它们都不知道 `F.260603-减速机装配线/04 研发/02 机械` 是"项目文档存放位置"，而 `Templates/` 不是。

本插件补的就是这一格：**一次脚手架 + 一个懂项目的目录选择器**。

### 三条命令

| 命令 | 作用 |
|---|---|
| **新建项目（按脚手架铺目录）** | 选类型（工作/生活/学习）→ 输项目名 → 建出 `F.260603-项目名` 并复制 `<脚手架根>/<类型>/` 整棵树 |
| **新建项目文档（选择项目路径）** | 只列项目根目录下的路径并按最近使用排序，选定后在该目录建文档 |
| **初始化 / 修复脚手架模板目录** | 按内置骨架补齐缺失的空文件夹 |

两个创建流程都可以再选一份模板交给 **Templater** 或 **QuickAdd** 渲染（自动识别：正文含 `<%` → Templater，含 `{{ }}` → QuickAdd，都没有则按纯文本）。

### 排序规则

当前打开笔记所在的项目 → 最近用过的项目 → 最近用过的具体路径 → 项目文件夹新旧 → 层级浅→深 → 同层内修改时间与路径。

候选范围只包含你配置的项目根目录之下、指定深度以内的文件夹，并排除忽略名单（如"附件"）。库里其它路径永远不会出现在这个窗口里。

### 数据归属（本插件的设计前提）

| 东西 | 存在哪 | 卸载插件后 |
|---|---|---|
| 脚手架定义 | **库里的真实文件夹**（`1 Obsidian/项目脚手架/<类型>/`） | 原样保留，随时手改 |
| "最近使用" | 插件目录下的 `data.json`（纯 JSON 设置） | 只丢排序 |
| 你建的笔记 | 普通 Markdown | 不受影响 |

**只新建**：目标已存在就停下提示，不覆盖。

### 安装（手动）

1. 把 `main.js`、`manifest.json`、`styles.css` 复制到 `<你的库>/.obsidian/plugins/project-scaffold/`；
2. `Ctrl+P` →「重新加载应用而不保存」；
3. 设置 → 第三方插件 → 启用 **Project Scaffold**。

（暂未提交社区插件市场。）

### 开发

```bash
node tools/test.mjs        # 52 项纯逻辑单测
node tools/test-flows.mjs  # 39 项流程测试（内存假库，跑真实的建项目/建文档链路）
```

`main.js` 既是源码也是产物，**没有构建步骤**。`tools/deploy.ps1`（或双击 `deploy.bat`）会把插件复制进库并补齐脚手架目录。

### 许可证

[MIT](LICENSE) © 2026 luodanshibing

