'use strict';

/* ==========================================================================
 * Project Scaffold（项目脚手架）v1.1.0
 * --------------------------------------------------------------------------
 * 只做两件事，且只“新建”，从不改动任何已有笔记：
 *   ① 新建项目：把库内 <脚手架根>/<类型>/ 这棵真实目录树复制成新项目
 *   ② 新建项目文档：弹出“只列项目相关路径、按最近使用排序”的目录选择器
 * 两处都可再选一份模板，交给 Templater / QuickAdd 处理（自动识别引擎）。
 *
 * 数据归属（用户红线：数据不被软件绑定）
 *   - 脚手架定义 = 库内真实文件夹 → 纯文本、可手改、可版本管理、卸载插件后仍在
 *   - 最近使用   = data.json（纯 JSON 设置）→ 删掉只是顺序重置，不丢任何内容
 *   - 模板       = 你自己的模板文件，本插件只读不改
 * ========================================================================== */

const {
  Plugin,
  PluginSettingTab,
  Setting,
  SuggestModal,
  Modal,
  Notice,
  TFile,
  TFolder,
  normalizePath,
} = require('obsidian');

/* ============================== 默认值 ============================== */

// 反推自用户库内 121 个项目（44 个工作项目共用同一套骨架）
const DEFAULT_SCAFFOLD = {
  '工作': [
    '01 管理',
    '02 文档',
    '03 需求',
    '04 研发/01 系统',
    '04 研发/02 机械',
    '04 研发/03 电气',
    '04 研发/04 软件',
    '05 生产',
    '06 交付',
  ],
  '生活': [], // 2026-10-02 用户裁定：生活类不铺子目录，与学习类一致
  '学习': [],
};

const DEFAULT_SETTINGS = {
  scaffoldRoot: '1 Obsidian/项目脚手架',
  categories: [
    { key: '工作', root: 'F Craftlab/F2 项目', prefix: 'F', separator: '-', defaultTemplate: '' },
    { key: '生活', root: 'E Yearify/E3 项目', prefix: 'E', separator: '-', defaultTemplate: '' },
    { key: '学习', root: 'D Develo/D2 知识领域', prefix: 'D', separator: ' ', defaultTemplate: '' },
  ],
  maxDepthBelowProject: 2, // 0 = 项目文件夹本身，2 = 再往里两层（如 04 研发/02 机械）
  ignoreFolders: ['附件'],
  recentLimit: 40,
  templateFolder: '1 Obsidian/模板',
  templateEngine: 'auto', // auto | templater | quickadd | plain
  askTemplate: true,
  docTemplateFile: '',
  openNewDoc: true,
};

const NO_TEMPLATE = { path: '', name: '（不套模板）', rel: '' };

/* ============================== 纯函数（可单测） ============================== */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 目前只支持 YYMMDD 一种格式；留着这个函数是为了以后加 YYYYMMDD 之类 */
function formatDateToken(date, format) {
  const d = date instanceof Date ? date : new Date();
  switch (String(format || 'YYMMDD').toUpperCase()) {
    case 'YYYYMMDD':
      return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    case 'YYYY-MM-DD':
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    case 'YYMMDD':
    default:
      return `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }
}

/** 新建项目用：F.260603-减速机半自动装配线 */
function buildProjectName(category, title, date) {
  const clean = String(title == null ? '' : title).trim().replace(/[\\/:*?"<>|]/g, '');
  const stamp = formatDateToken(date, 'YYMMDD');
  const sep = category && category.separator !== undefined ? category.separator : '-';
  const prefix = (category && category.prefix) || '';
  return `${prefix}.${stamp}${sep}${clean}`;
}

/**
 * 识别已有项目文件夹名（兼容历史格式，不要求用户改名）。
 * 匹配：F.260603-减速机半自动装配线 / E.200102-家庭数据中心设计与规划 / D.240301 数字花园学习与实践
 */
function parseProjectFolderName(name) {
  const m = /^([A-Za-z])\.(\d{6})\s*([-\s])\s*(.+)$/.exec(String(name == null ? '' : name).trim());
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), stamp: m[2], separator: m[3], title: m[4] };
}

function toPosix(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '');
}

function isUnder(path, root) {
  const p = toPosix(path);
  const r = toPosix(root);
  if (!r) return false;
  return p === r || p.startsWith(`${r}/`);
}

function basename(path) {
  const p = toPosix(path);
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/** 相对 root 的层级：root 的直接子项 = 0 */
function relativeDepth(path, root) {
  const p = toPosix(path);
  const r = toPosix(root);
  if (!isUnder(p, r) || p === r) return -1;
  return p.slice(r.length + 1).split('/').length - 1;
}

/** 取 path 在 root 下第 n 层祖先（n=1 即项目文件夹） */
function ancestorAtDepth(path, root, n) {
  const p = toPosix(path);
  const r = toPosix(root);
  if (!isUnder(p, r) || p === r) return null;
  const parts = p.slice(r.length + 1).split('/');
  if (parts.length < n) return null;
  return `${r}/${parts.slice(0, n).join('/')}`;
}

/**
 * 从全部文件夹里挑出“相关路径”：
 * 只保留三个项目根目录之下的、深度不超过 maxDepthBelowProject 的文件夹，
 * 跳过黑名单（如“附件”）与点开头的目录。
 */
function listCandidateFolders(folders, settings) {
  const cats = (settings && settings.categories) || [];
  const maxDepth = Number.isFinite(settings && settings.maxDepthBelowProject)
    ? settings.maxDepthBelowProject
    : 2;
  const ignore = (settings && settings.ignoreFolders) || [];
  const mtimeByPath = new Map();
  for (const f of folders) {
    if (f && f.path) mtimeByPath.set(toPosix(f.path), Number(f.mtime) || 0);
  }
  const out = [];
  for (const cat of cats) {
    if (!cat || !cat.root) continue;
    for (const f of folders) {
      if (!f || !f.path) continue;
      const depth = relativeDepth(f.path, cat.root);
      if (depth < 0 || depth > maxDepth) continue;
      const base = basename(f.path);
      if (!base || base.startsWith('.')) continue;
      if (ignore.indexOf(base) !== -1) continue;
      const path = toPosix(f.path);
      const projectPath = depth === 0 ? path : ancestorAtDepth(f.path, cat.root, 1);
      out.push({
        path,
        category: cat,
        depth,
        mtime: Number(f.mtime) || 0,
        projectPath,
        // 项目文件夹自身的修改时间：用来把同一个项目的路径聚在一起，并让新项目整体靠前
        projectMtime: mtimeByPath.get(toPosix(projectPath)) || 0,
        display: `[${cat.key}] ${path.slice(toPosix(cat.root).length + 1)}`,
      });
    }
  }
  return out;
}

/**
 * 排序（越靠前越可能是你要的）：
 *   1. 当前打开笔记所在的项目
 *   2. 最近用过的项目
 *   3. 最近用过的具体路径
 *   4. 项目文件夹修改时间（新项目整体靠前）
 *   5. 层级浅→深（项目根 → 一级 → 二级，读起来符合直觉）
 *   6. 同层内按修改时间、再按路径
 */
function rankCandidates(candidates, ctx) {
  const c = ctx || {};
  const cur = toPosix(c.currentFile || '');
  const recentFolders = (c.recentFolders || []).map(toPosix);
  const recentProjects = (c.recentProjects || []).map(toPosix);
  const fIdx = new Map();
  recentFolders.forEach((p, i) => {
    if (!fIdx.has(p)) fIdx.set(p, i);
  });
  const pIdx = new Map();
  recentProjects.forEach((p, i) => {
    if (!pIdx.has(p)) pIdx.set(p, i);
  });
  const currentProject = cur
    ? (candidates.find((x) => isUnder(cur, x.projectPath)) || {}).projectPath
    : null;
  const MAX = Number.MAX_SAFE_INTEGER;

  return candidates.slice().sort((a, b) => {
    const aCur = currentProject && a.projectPath === currentProject ? 0 : 1;
    const bCur = currentProject && b.projectPath === currentProject ? 0 : 1;
    if (aCur !== bCur) return aCur - bCur;

    const aP = pIdx.has(a.projectPath) ? pIdx.get(a.projectPath) : MAX;
    const bP = pIdx.has(b.projectPath) ? pIdx.get(b.projectPath) : MAX;
    if (aP !== bP) return aP - bP;

    const aF = fIdx.has(a.path) ? fIdx.get(a.path) : MAX;
    const bF = fIdx.has(b.path) ? fIdx.get(b.path) : MAX;
    if (aF !== bF) return aF - bF;

    if ((a.projectMtime || 0) !== (b.projectMtime || 0)) return (b.projectMtime || 0) - (a.projectMtime || 0);
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.mtime !== b.mtime) return b.mtime - a.mtime;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** 把脚手架里的 {{占位符}} 换成实际值；不认识的占位符原样保留 */
function renderTemplate(content, vars) {
  return String(content == null ? '' : content).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, raw) => {
    const key = String(raw).trim();
    return Object.prototype.hasOwnProperty.call(vars || {}, key) ? String(vars[key]) : m;
  });
}

function buildVars(category, projectFolderName, projectPath, fileName, date) {
  const parsed = parseProjectFolderName(projectFolderName) || {};
  const d = date instanceof Date ? date : new Date();
  return {
    项目名: parsed.title || projectFolderName,
    项目文件夹: projectFolderName,
    项目编号: parsed.stamp || '',
    项目路径: projectPath,
    类型: (category && category.key) || '',
    日期: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    日期紧凑: formatDateToken(d, 'YYMMDD'),
    文件名: fileName || '',
  };
}

/**
 * 这份模板该由谁来渲染：
 *   - 设置里写死 templater / quickadd / plain 时照设置走
 *   - auto：正文含 <% 视为 Templater 模板；含 {{...}} 视为 QuickAdd 模板；都没有则纯文本
 */
function detectTemplateEngine(content, setting) {
  const mode = setting || 'auto';
  if (mode !== 'auto') return mode;
  const s = String(content == null ? '' : content);
  if (s.includes('<%')) return 'templater';
  if (/\{\{[^{}]+\}\}/.test(s)) return 'quickadd';
  return 'plain';
}

/** 模板清单排序：最近用过的在前，其余按相对路径字典序 */
function sortTemplates(templates, recents) {
  const idx = new Map();
  (recents || []).map(toPosix).forEach((p, i) => {
    if (!idx.has(p)) idx.set(p, i);
  });
  const MAX = Number.MAX_SAFE_INTEGER;
  return templates.slice().sort((a, b) => {
    const ai = idx.has(toPosix(a.path)) ? idx.get(toPosix(a.path)) : MAX;
    const bi = idx.has(toPosix(b.path)) ? idx.get(toPosix(b.path)) : MAX;
    if (ai !== bi) return ai - bi;
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
  });
}

/* ============================== UI：输入框 ============================== */

class TextPromptModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts || {};
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.opts.title || '输入' });
    if (this.opts.description) contentEl.createEl('p', { text: this.opts.description });
    const input = contentEl.createEl('input', { type: 'text', cls: 'project-scaffold-input' });
    input.value = this.opts.value || '';
    input.placeholder = this.opts.placeholder || '';
    const preview = contentEl.createEl('div', { cls: 'project-scaffold-preview' });
    const refresh = () => {
      let text = '';
      try {
        text = this.opts.preview ? this.opts.preview(input.value) : '';
      } catch (e) {
        text = '';
      }
      preview.setText(text || '');
    };
    input.addEventListener('input', refresh);
    refresh();
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      this.close();
      if (this.opts.onSubmit) this.opts.onSubmit(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    const bar = contentEl.createDiv({ cls: 'project-scaffold-buttons' });
    const ok = bar.createEl('button', { text: '确定', cls: 'mod-cta' });
    ok.addEventListener('click', submit);
    const cancel = bar.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ============================== UI：选择器 ============================== */

class SimpleSuggestModal extends SuggestModal {
  constructor(app, items, opts) {
    super(app);
    this.items = items;
    this.opts = opts || {};
    if (this.opts.placeholder) this.setPlaceholder(this.opts.placeholder);
    if (this.opts.emptyText) this.emptyStateText = this.opts.emptyText;
    if (this.opts.limit) this.limit = this.opts.limit;
  }

  getSuggestions(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return this.items;
    return this.items.filter((it) => (this.opts.searchText ? this.opts.searchText(it) : String(it))
      .toLowerCase()
      .includes(q));
  }

  renderSuggestion(item, el) {
    if (this.opts.render) {
      this.opts.render(item, el);
      return;
    }
    el.setText(String(item));
  }

  onChooseSuggestion(item) {
    if (this.opts.onChoose) this.opts.onChoose(item);
  }
}

/* ============================== 主插件 ============================== */

class ProjectScaffoldPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'new-project',
      name: '新建项目（按脚手架铺目录）',
      callback: () => this.newProjectFlow(),
    });

    this.addCommand({
      id: 'new-project-doc',
      name: '新建项目文档（选择项目路径）',
      callback: () => this.newDocFlow(),
    });

    this.addCommand({
      id: 'init-scaffold',
      name: '初始化 / 修复脚手架模板目录',
      callback: () => this.initScaffoldFlow(),
    });

    this.addSettingTab(new ProjectScaffoldSettingTab(this.app, this));
  }

  async loadSettings() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    this.settings.categories = (raw.settings && Array.isArray(raw.settings.categories)
      ? raw.settings.categories
      : DEFAULT_SETTINGS.categories
    ).map((c) => Object.assign({ defaultTemplate: '' }, c));
    this.recentFolders = Array.isArray(raw.recentFolders) ? raw.recentFolders : [];
    this.recentProjects = Array.isArray(raw.recentProjects) ? raw.recentProjects : [];
    this.recentTemplates = Array.isArray(raw.recentTemplates) ? raw.recentTemplates : [];
  }

  async saveSettings() {
    await this.saveData({
      settings: this.settings,
      recentFolders: this.recentFolders,
      recentProjects: this.recentProjects,
      recentTemplates: this.recentTemplates,
    });
  }

  rememberPath(folderPath, projectPath) {
    const uniq = (arr, p) => [toPosix(p)].concat(arr.filter((x) => x !== toPosix(p)))
      .slice(0, this.settings.recentLimit);
    if (folderPath) this.recentFolders = uniq(this.recentFolders, folderPath);
    if (projectPath) this.recentProjects = uniq(this.recentProjects, projectPath);
    void this.saveSettings();
  }

  rememberTemplate(templatePath) {
    if (!templatePath) return;
    const p = toPosix(templatePath);
    this.recentTemplates = [p]
      .concat(this.recentTemplates.filter((x) => x !== p))
      .slice(0, this.settings.recentLimit);
    void this.saveSettings();
  }

  /* ---------------- 文件夹工具 ---------------- */

  async ensureFolder(path) {
    const clean = toPosix(normalizePath(path));
    if (!clean) throw new Error('空路径');
    const parts = clean.split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(cur);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`路径被同名文件占用：${cur}`);
      try {
        await this.app.vault.createFolder(cur);
      } catch (e) {
        // 并发或已存在：复核一次，仍不存在就抛
        if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) throw e;
      }
    }
    return this.app.vault.getAbstractFileByPath(clean);
  }

  /* ---------------- 模板：识别 / 列表 / 渲染 ---------------- */

  getTemplater() {
    const p = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['templater-obsidian'];
    const t = p && p.templater;
    return t && typeof t.create_new_note_from_template === 'function' ? t : null;
  }

  getQuickAddApi() {
    const p = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['quickadd'];
    return (p && p.api) || null;
  }

  listTemplates() {
    const root = toPosix(this.settings.templateFolder || '');
    if (!root) return [];
    const src = this.app.vault.getAbstractFileByPath(root);
    if (!(src instanceof TFolder)) return [];
    const out = [];
    const walk = (folder) => {
      for (const c of folder.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') {
          out.push({
            path: toPosix(c.path),
            name: c.name.replace(/\.md$/, ''),
            rel: toPosix(c.path).slice(root.length + 1).replace(/\.md$/, ''),
            mtime: (c.stat && c.stat.mtime) || 0,
          });
        }
      }
    };
    walk(src);
    return sortTemplates(out, this.recentTemplates);
  }

  /** 弹模板选择器；allowSkip 为真时第一项是“不套模板” */
  pickTemplate(title, allowSkip, preselect, onPick) {
    const list = this.listTemplates();
    if (!list.length) {
      new Notice(`模板文件夹里没找到 .md 模板：${this.settings.templateFolder}`);
      onPick('');
      return;
    }
    const items = allowSkip ? [NO_TEMPLATE].concat(list) : list;
    const ordered = preselect
      ? items.slice().sort((a, b) => (a.path === preselect ? -1 : b.path === preselect ? 1 : 0))
      : items;
    new SimpleSuggestModal(this.app, ordered, {
      placeholder: '选择模板（可搜索，回车确认）…',
      emptyText: '没有匹配的模板',
      limit: 120,
      searchText: (t) => `${t.rel} ${t.name}`,
      render: (t, el) => {
        const top = el.createDiv({ cls: 'project-scaffold-row' });
        top.createDiv({ text: t.rel || t.name, cls: 'project-scaffold-title' });
        const flags = [];
        if (t.path && this.recentTemplates.indexOf(t.path) !== -1) flags.push('最近用过');
        if (t.path === preselect) flags.push('默认');
        if (!t.path) flags.push('只建文件夹，不生成文档');
        if (flags.length) top.createDiv({ text: flags.join(' · '), cls: 'project-scaffold-hint' });
      },
      onChoose: (t) => onPick(t.path || ''),
    }).open();
  }

  /**
   * 用模板在指定目录生成一份文档。
   * Templater 模板走 Templater 的 API（YAML 里的 <% %> 由它处理）；
   * QuickAdd 模板走 quickadd.api.format()；其余按纯文本 + {{占位符}} 处理。
   */
  async createFromTemplate(templatePath, folderPath, fileName, vars) {
    const tplFile = this.app.vault.getAbstractFileByPath(toPosix(templatePath));
    if (!(tplFile instanceof TFile)) {
      new Notice(`模板不存在，已跳过：${templatePath}`);
      return null;
    }
    const raw = await this.app.vault.read(tplFile);
    const engine = detectTemplateEngine(raw, this.settings.templateEngine);

    if (engine === 'templater') {
      const tp = this.getTemplater();
      if (tp) {
        try {
          await this.ensureFolder(folderPath);
          const folder = this.app.vault.getAbstractFileByPath(toPosix(folderPath));
          const file = await tp.create_new_note_from_template(
            tplFile,
            folder,
            fileName || '未命名',
            !!this.settings.openNewDoc
          );
          if (file) {
            this.rememberTemplate(templatePath);
            new Notice(`已用 Templater 生成：${file.path}`);
          }
          return file || null;
        } catch (e) {
          new Notice(`Templater 处理失败，改用纯文本：${e.message || e}`);
        }
      } else {
        new Notice('未检测到 Templater，该模板按纯文本处理（<% %> 会原样保留）');
      }
    }

    let body = raw;
    if (engine === 'quickadd') {
      const qa = this.getQuickAddApi();
      if (qa && typeof qa.format === 'function') {
        try {
          body = await qa.format(raw, Object.assign({}, vars));
        } catch (e) {
          new Notice(`QuickAdd 处理失败，改用纯文本：${e.message || e}`);
        }
      } else {
        new Notice('未检测到 QuickAdd，该模板按纯文本处理（{{ }} 会按本插件规则替换）');
      }
    }
    body = renderTemplate(body, vars || {});

    await this.ensureFolder(folderPath);
    const path = toPosix(`${folderPath}/${fileName || '未命名'}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`已存在，未覆盖：${fileName}.md`);
      return null;
    }
    const file = await this.app.vault.create(path, body);
    this.rememberTemplate(templatePath);
    if (this.settings.openNewDoc) await this.app.workspace.getLeaf(false).openFile(file);
    return file;
  }

  /* ---------------- ① 新建项目 ---------------- */

  newProjectFlow() {
    const cats = this.settings.categories || [];
    if (!cats.length) {
      new Notice('没有配置任何项目类型，请先到插件设置里添加。');
      return;
    }
    new SimpleSuggestModal(this.app, cats, {
      placeholder: '选择项目类型…',
      searchText: (c) => `${c.key} ${c.root}`,
      render: (cat, el) => {
        el.createDiv({ text: cat.key, cls: 'project-scaffold-title' });
        el.createDiv({ text: cat.root, cls: 'project-scaffold-hint' });
      },
      onChoose: (cat) => this.askProjectName(cat),
    }).open();
  }

  askProjectName(cat) {
    const today = new Date();
    new TextPromptModal(this.app, {
      title: `新建${cat.key}项目`,
      description: `将创建在：${cat.root}/`,
      placeholder: '项目名称（不含日期前缀）',
      preview: (v) => `文件夹名：${buildProjectName(cat, v, today)}`,
      onSubmit: (title) => this.askProjectTemplate(cat, title),
    }).open();
  }

  askProjectTemplate(cat, title) {
    if (!this.settings.askTemplate) {
      void this.createProject(cat, title, '');
      return;
    }
    this.pickTemplate(
      `为「${title}」选一份起始模板`,
      true,
      cat.defaultTemplate || '',
      (tpl) => void this.createProject(cat, title, tpl)
    );
  }

  async createProject(cat, title, templatePath) {
    const now = new Date();
    const folderName = buildProjectName(cat, title, now);
    const projectPath = toPosix(`${cat.root}/${folderName}`);
    if (this.app.vault.getAbstractFileByPath(projectPath)) {
      new Notice(`已存在，未做任何改动：${folderName}`);
      return;
    }
    try {
      await this.ensureFolder(projectPath);
      const res = await this.copyScaffold(cat, projectPath, folderName);
      this.rememberPath(projectPath, projectPath);
      const tail = res.missing
        ? `（未找到脚手架模板 ${this.settings.scaffoldRoot}/${cat.key}，只建了空项目文件夹）`
        : `（${res.folders} 个文件夹${res.files ? ` / ${res.files} 个文件` : ''}）`;
      new Notice(`已创建项目：${folderName} ${tail}`, 6000);

      if (templatePath) {
        const vars = buildVars(cat, folderName, projectPath, folderName, now);
        const file = await this.createFromTemplate(templatePath, projectPath, folderName, vars);
        if (!file && this.settings.openNewDoc && res.firstFile) {
          const f = this.app.vault.getAbstractFileByPath(res.firstFile);
          if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
        }
      } else if (this.settings.openNewDoc && res.firstFile) {
        const f = this.app.vault.getAbstractFileByPath(res.firstFile);
        if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
      }
    } catch (e) {
      new Notice(`创建失败：${e.message || e}`);
    }
  }

  /** 把 <脚手架根>/<类型>/ 整棵树复制到项目目录；文件名与内容里的 {{占位符}} 都会被替换 */
  async copyScaffold(cat, projectPath, folderName) {
    const srcRoot = toPosix(`${this.settings.scaffoldRoot}/${cat.key}`);
    const src = this.app.vault.getAbstractFileByPath(srcRoot);
    const res = { folders: 0, files: 0, missing: false, firstFile: null };
    if (!(src instanceof TFolder)) {
      res.missing = true;
      return res;
    }
    const walk = async (srcFolder, dstPath) => {
      const children = (srcFolder.children || []).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const child of children) {
        if (child.name.startsWith('.')) continue;
        const vars = buildVars(cat, folderName, projectPath, child.name, new Date());
        const name = renderTemplate(child.name, vars);
        const dst = toPosix(`${dstPath}/${name}`);
        if (child instanceof TFolder) {
          await this.ensureFolder(dst);
          res.folders++;
          await walk(child, dst);
        } else if (child instanceof TFile) {
          const body = await this.app.vault.read(child);
          const created = await this.app.vault.create(dst, renderTemplate(body, vars));
          res.files++;
          if (!res.firstFile && created instanceof TFile) res.firstFile = created.path;
        }
      }
    };
    await walk(src, projectPath);
    return res;
  }

  /* ---------------- ② 新建项目文档 ---------------- */

  collectCandidates() {
    const all = this.app.vault.getAllLoadedFiles() || [];
    const folders = [];
    for (const f of all) {
      if (f instanceof TFolder) {
        folders.push({ path: f.path, mtime: (f.stat && f.stat.mtime) || 0 });
      }
    }
    const cands = listCandidateFolders(folders, this.settings);
    const active = this.app.workspace.getActiveFile();
    return rankCandidates(cands, {
      currentFile: active ? active.path : '',
      recentFolders: this.recentFolders,
      recentProjects: this.recentProjects,
    });
  }

  newDocFlow() {
    const cands = this.collectCandidates();
    if (!cands.length) {
      new Notice('没有找到任何项目路径。先检查插件设置里的三个项目根目录是否正确。');
      return;
    }
    new SimpleSuggestModal(this.app, cands, {
      placeholder: '选择文档存放位置（最近使用在前）…',
      emptyText: '没有匹配的项目路径',
      limit: 200,
      searchText: (c) => `${c.display} ${c.path}`,
      render: (c, el) => {
        const top = el.createDiv({ cls: 'project-scaffold-row' });
        top.createDiv({ text: c.display, cls: 'project-scaffold-title' });
        const flags = [];
        if (c.depth === 0) flags.push('项目根');
        if (this.recentFolders.indexOf(c.path) !== -1) flags.push('用过');
        if (c.mtime) flags.push(new Date(c.mtime).toISOString().slice(0, 10));
        if (flags.length) top.createDiv({ text: flags.join(' · '), cls: 'project-scaffold-hint' });
      },
      onChoose: (c) => this.askDocTemplate(c),
    }).open();
  }

  askDocTemplate(cand) {
    if (!this.settings.askTemplate) {
      this.askDocName(cand, '');
      return;
    }
    this.pickTemplate(
      `为「${cand.display}」选一份文档模板`,
      true,
      '',
      (tpl) => this.askDocName(cand, tpl)
    );
  }

  askDocName(cand, templatePath) {
    new TextPromptModal(this.app, {
      title: '新建项目文档',
      description: `存放到：${cand.path}`,
      placeholder: '文件名（不含 .md）',
      preview: (v) => `将创建：${cand.path}/${v}.md`,
      onSubmit: (name) => void this.createDoc(cand, name, templatePath),
    }).open();
  }

  async createDoc(cand, name, templatePath) {
    const safe = String(name).trim().replace(/[\\/:*?"<>|]/g, '');
    if (!safe) return;
    const vars = buildVars(cand.category, basename(cand.projectPath), cand.projectPath, safe, new Date());

    if (templatePath) {
      await this.createFromTemplate(templatePath, cand.path, safe, vars);
      this.rememberPath(cand.path, cand.projectPath);
      return;
    }

    const path = toPosix(`${cand.path}/${safe}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`已存在，未覆盖：${safe}.md`);
      return;
    }
    try {
      let body = '';
      const tpl = this.settings.docTemplateFile && toPosix(this.settings.docTemplateFile);
      if (tpl) {
        const tplFile = this.app.vault.getAbstractFileByPath(tpl);
        if (tplFile instanceof TFile) {
          body = renderTemplate(await this.app.vault.read(tplFile), vars);
        } else {
          new Notice(`模板文件不存在，已创建空文档：${tpl}`);
        }
      }
      const file = await this.app.vault.create(path, body);
      this.rememberPath(cand.path, cand.projectPath);
      new Notice(`已创建：${cand.display}/${safe}.md`);
      if (this.settings.openNewDoc && file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
      }
    } catch (e) {
      new Notice(`创建失败：${e.message || e}`);
    }
  }

  /* ---------------- 脚手架模板目录初始化 ---------------- */

  initScaffoldFlow() {
    new TextPromptModal(this.app, {
      title: '初始化 / 修复脚手架模板目录',
      description: `将按内置骨架在“${this.settings.scaffoldRoot}”下补齐缺失的空文件夹。只新建，不删除、不改动已有内容。`,
      value: this.settings.scaffoldRoot,
      placeholder: '脚手架根目录',
      preview: (v) => `目标：${v}`,
      onSubmit: (root) => void this.initScaffold(root),
    }).open();
  }

  async initScaffold(root) {
    const scaffoldRoot = toPosix(root) || DEFAULT_SETTINGS.scaffoldRoot;
    let made = 0;
    try {
      await this.ensureFolder(scaffoldRoot);
      for (const [key, layers] of Object.entries(DEFAULT_SCAFFOLD)) {
        await this.ensureFolder(`${scaffoldRoot}/${key}`);
        made++;
        for (const layer of layers) {
          await this.ensureFolder(`${scaffoldRoot}/${key}/${layer}`);
          made++;
        }
      }
      this.settings.scaffoldRoot = scaffoldRoot;
      await this.saveSettings();
      new Notice(`脚手架就绪：${scaffoldRoot}（已确保 ${made} 个文件夹存在）`, 6000);
    } catch (e) {
      new Notice(`初始化失败：${e.message || e}`);
    }
  }
}

/* ============================== 设置页 ============================== */

class ProjectScaffoldSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    containerEl.empty();
    containerEl.addClass('project-scaffold-settings');

    /* ---- 脚手架 ---- */
    containerEl.createEl('h3', { text: '脚手架（新建项目时铺哪些文件夹）' });

    new Setting(containerEl)
      .setName('脚手架模板根目录')
      .setDesc('库里的真实目录。每个项目类型对应它下面一个同名子文件夹。想改层级，直接在这个目录里加/删文件夹即可。')
      .addText((t) =>
        t.setPlaceholder('1 Obsidian/项目脚手架').setValue(s.scaffoldRoot).onChange(async (v) => {
          s.scaffoldRoot = toPosix(v);
          await p.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('路径候选的最深层级')
      .setDesc('0 = 只列项目文件夹；1 = 再往里一层；2 = 两层（例如 04 研发/02 机械）。')
      .addText((t) =>
        t.setPlaceholder('2').setValue(String(s.maxDepthBelowProject)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.maxDepthBelowProject = Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : 2;
          await p.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('不进候选列表的文件夹名')
      .setDesc('逗号分隔，按文件夹名精确匹配。默认排除“附件”——它放素材，不是文档存放位置。')
      .addText((t) =>
        t.setPlaceholder('附件').setValue((s.ignoreFolders || []).join(',')).onChange(async (v) => {
          s.ignoreFolders = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
          await p.saveSettings();
        })
      );

    /* ---- 项目类型 ---- */
    containerEl.createEl('h3', { text: '项目类型（新建时怎么命名、放哪儿）' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '每个类型四个字段：显示名 / 建在哪个目录 / 文件名前缀 / 日期与名称之间的分隔符。改完即时生效，不用重启。',
    });

    s.categories.forEach((cat, i) => {
      containerEl.createEl('h4', { text: `类型 ${i + 1}：${cat.key || '（未命名）'}` });

      new Setting(containerEl)
        .setName('显示名')
        .setDesc('命令里让你选的那个名字，例如 工作 / 生活 / 学习。')
        .addText((t) =>
          t.setPlaceholder('工作').setValue(cat.key).onChange(async (v) => {
            cat.key = v.trim();
            await p.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('项目根目录')
        .setDesc('新项目文件夹建在这个目录下面；同时也是路径选择器的候选范围。')
        .addText((t) =>
          t.setPlaceholder('F Craftlab/F2 项目').setValue(cat.root).onChange(async (v) => {
            cat.root = toPosix(v);
            await p.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('文件名前缀')
        .setDesc('项目文件夹名最前面的字母，例如 F（工作）/ E（生活）/ D（学习）。')
        .addText((t) =>
          t.setPlaceholder('F').setValue(cat.prefix).onChange(async (v) => {
            cat.prefix = v.trim();
            await p.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('日期与名称的分隔符')
        .setDesc('工作与生活用 -（F.261002-减速机）；学习用空格（D.261002 数据库）。')
        .addText((t) =>
          t.setPlaceholder('-').setValue(cat.separator).onChange(async (v) => {
            cat.separator = v;
            await p.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('新建时的默认模板')
        .setDesc('填模板文件的库内路径（留空 = 每次弹窗询问）。在模板选择器里按“回车”预选它。')
        .addText((t) =>
          t.setPlaceholder('1 Obsidian/模板/【项目章程】….md').setValue(cat.defaultTemplate || '').onChange(async (v) => {
            cat.defaultTemplate = v.trim();
            await p.saveSettings();
          })
        );

      const previewEl = containerEl.createEl('p', { cls: 'setting-item-description' });
      previewEl.setText(`预览：新建「减速机」→ ${buildProjectName(cat, '减速机', new Date())}`);
    });

    /* ---- 模板 ---- */
    containerEl.createEl('h3', { text: '模板（交给 Templater / QuickAdd 渲染）' });

    const tp = p.getTemplater();
    const qa = p.getQuickAddApi();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: `检测结果：Templater ${tp ? '已安装 ✓' : '未检测到'} ；QuickAdd ${qa ? '已安装 ✓' : '未检测到'}。`,
    });

    new Setting(containerEl)
      .setName('模板文件夹')
      .setDesc('模板选择器会列出这个目录（含子目录）下的所有 .md。默认与 Templater 的设置一致。')
      .addText((t) =>
        t.setPlaceholder('1 Obsidian/模板').setValue(s.templateFolder || '').onChange(async (v) => {
          s.templateFolder = toPosix(v);
          await p.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('模板引擎')
      .setDesc('自动 = 正文含 <% 交给 Templater、含 {{ }} 交给 QuickAdd、都没有则纯文本。也可以强制指定一种。')
      .addDropdown((d) =>
        d
          .addOption('auto', '自动判断（推荐）')
          .addOption('templater', '总是用 Templater')
          .addOption('quickadd', '总是用 QuickAdd')
          .addOption('plain', '总是按纯文本处理')
          .setValue(s.templateEngine || 'auto')
          .onChange(async (v) => {
            s.templateEngine = v;
            await p.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('新建项目 / 文档时询问模板')
      .setDesc('关闭后不再弹模板选择器，直接用上面对应的默认模板（都没配就只建文件夹/空文档）。')
      .addToggle((t) =>
        t.setValue(!!s.askTemplate).onChange(async (v) => {
          s.askTemplate = v;
          await p.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('生成后打开新文档')
      .setDesc('新建的项目主页或项目文档，创建完成后直接在当前标签页打开。')
      .addToggle((t) =>
        t.setValue(!!s.openNewDoc).onChange(async (v) => {
          s.openNewDoc = v;
          await p.saveSettings();
        })
      );

    /* ---- 关于数据 ---- */
    containerEl.createEl('h3', { text: '关于数据' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '脚手架＝库里的真实文件夹，插件卸载后依然在；“最近用过”的记录存在插件自己的 data.json 里（纯 JSON，删了只丢顺序）。本插件只新建文件夹与文档，从不修改任何已有笔记；遇到同名文件一律停下提示，不覆盖。',
    });
  }
}

/* ============================== 导出 ============================== */

module.exports = ProjectScaffoldPlugin;
module.exports.__test = {
  DEFAULT_SCAFFOLD,
  DEFAULT_SETTINGS,
  NO_TEMPLATE,
  formatDateToken,
  buildProjectName,
  parseProjectFolderName,
  isUnder,
  relativeDepth,
  ancestorAtDepth,
  listCandidateFolders,
  rankCandidates,
  renderTemplate,
  buildVars,
  detectTemplateEngine,
  sortTemplates,
};
