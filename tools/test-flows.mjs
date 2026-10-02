/* Project Scaffold —— 流程集成测试（内存假库，不需要 Obsidian）
 * 用法：node tools/test-flows.mjs
 * 覆盖：createProject（复制脚手架/占位符替换/已存在不覆盖）、collectCandidates、createDoc
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- 断言 ---------------- */
let pass = 0;
const fails = [];
const ok = (cond, label) => {
  if (cond) pass++;
  else fails.push(label);
};
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);

/* ---------------- obsidian 桩（比单测强：带内存 vault） ---------------- */
const norm = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const base = (p) => {
  const i = norm(p).lastIndexOf('/');
  return i === -1 ? norm(p) : norm(p).slice(i + 1);
};

class FakeTFile {
  constructor(p, data) {
    this.path = norm(p);
    this.name = base(p);
    this.data = data == null ? '' : data;
    this.stat = { mtime: Date.now() };
  }
}
class FakeTFolder {
  constructor(p) {
    this.path = norm(p);
    this.name = base(p);
    this.children = [];
    this.stat = { mtime: Date.now() };
  }
}
class FakeVault {
  constructor() {
    this.root = new FakeTFolder('');
    this.map = new Map([['', this.root]]);
  }
  getAbstractFileByPath(p) {
    return this.map.get(norm(p)) || null;
  }
  getAllLoadedFiles() {
    return Array.from(this.map.values());
  }
  async createFolder(p) {
    const c = norm(p);
    if (this.map.has(c)) throw new Error(`Folder already exists: ${c}`);
    const parent = this.getAbstractFileByPath(c.split('/').slice(0, -1).join('/'));
    if (!parent) throw new Error(`Parent missing: ${c}`);
    const f = new FakeTFolder(c);
    this.map.set(c, f);
    parent.children.push(f);
    return f;
  }
  async create(p, data) {
    const c = norm(p);
    if (this.map.has(c)) throw new Error(`File already exists: ${c}`);
    const parent = this.getAbstractFileByPath(c.split('/').slice(0, -1).join('/'));
    if (!parent) throw new Error(`Parent missing: ${c}`);
    const f = new FakeTFile(c, data);
    this.map.set(c, f);
    parent.children.push(f);
    return f;
  }
  async read(file) {
    return file.data;
  }
}

const notices = [];
class Notice {
  constructor(msg) {
    notices.push(String(msg));
  }
}
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    return this._data || null;
  }
  async saveData(d) {
    this._data = d;
  }
  addCommand() {}
  addSettingTab() {}
}
class PluginSettingTab {}
class Modal {}
class SuggestModal {}
class Setting {}
const TFile = FakeTFile;
const TFolder = FakeTFolder;
const normalizePath = norm;

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'obsidian') {
    return { Plugin, PluginSettingTab, Setting, SuggestModal, Modal, Notice, TFile, TFolder, normalizePath };
  }
  return originalLoad.apply(this, arguments);
};

const ProjectScaffoldPlugin = require('../main.js');
const { __test } = ProjectScaffoldPlugin;

/* ---------------- 搭一个假库 ---------------- */
function buildVault() {
  const vault = new FakeVault();
  const seedFolder = (p) => {
    const parts = norm(p).split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!vault.map.has(cur)) {
        const parent = vault.getAbstractFileByPath(cur.split('/').slice(0, -1).join('/'));
        const f = new FakeTFolder(cur);
        vault.map.set(cur, f);
        parent.children.push(f);
      }
    }
  };
  // 三个项目根目录
  ['F Craftlab/F2 项目', 'E Yearify/E3 项目', 'D Develo/D2 知识领域'].forEach(seedFolder);
  // 脚手架模板树
  seedFolder('1 Obsidian/项目脚手架/工作/01 管理');
  seedFolder('1 Obsidian/项目脚手架/工作/04 研发/02 机械');
  seedFolder('1 Obsidian/项目脚手架/生活/01 设计标准');
  vault.map.set('1 Obsidian/项目脚手架/工作/01 管理/{{项目名}}说明.md.tpl', null); // 占位，稍后覆盖
  vault.map.delete('1 Obsidian/项目脚手架/工作/01 管理/{{项目名}}说明.md.tpl');
  // 模板文件（带占位符）
  const folder = vault.getAbstractFileByPath('1 Obsidian/项目脚手架/工作/04 研发/02 机械');
  const tpl = new FakeTFile('1 Obsidian/项目脚手架/工作/04 研发/02 机械/{{项目名}}-设计说明.md', '# {{项目名}}\n\n项目路径：{{项目路径}}\n建立日期：{{日期}}\n');
  folder.children.push(tpl);
  vault.map.set(tpl.path, tpl);
  // 文档模板
  const dt = new FakeTFile('1 Obsidian/模板/项目文档.md', '---\ntitle: {{文件名}}\nproject: {{项目名}}\n---\n\n## 1 说明\n');
  vault.map.get('1 Obsidian').children.push(dt);
  vault.map.set(dt.path, dt);
  // 已有项目（用于排序与当前项目判定）
  seedFolder('F Craftlab/F2 项目/F.260603-减速机半自动装配线/04 研发/02 机械');
  seedFolder('F Craftlab/F2 项目/F.260603-减速机半自动装配线/附件');
  seedFolder('D Develo/D2 知识领域/D.240301 数字花园学习与实践');
  seedFolder('F Craftlab/F3 资料/无关目录'); // 不该进候选
  // 当前打开的笔记（必须真实存在，否则拿不到 activeFile）
  const noteParent = vault.getAbstractFileByPath('F Craftlab/F2 项目/F.260603-减速机半自动装配线/04 研发/02 机械');
  const note = new FakeTFile('F Craftlab/F2 项目/F.260603-减速机半自动装配线/04 研发/02 机械/某笔记.md', '# 某笔记\n');
  noteParent.children.push(note);
  vault.map.set(note.path, note);
  return vault;
}

function makeApp(vault, activePath) {
  return {
    vault,
    plugins: { plugins: {} },
    workspace: {
      getActiveFile: () => (activePath ? vault.getAbstractFileByPath(activePath) : null),
      getLeaf: () => ({ openFile: async () => {} }),
    },
  };
}

/* ---------------- 跑 ---------------- */
const vault = buildVault();
const app = makeApp(vault, 'F Craftlab/F2 项目/F.260603-减速机半自动装配线/04 研发/02 机械/某笔记.md');
const plugin = new ProjectScaffoldPlugin(app, { id: 'project-scaffold' });

await plugin.onload();
ok(plugin.settings.scaffoldRoot === '1 Obsidian/项目脚手架', 'onload 后拿到默认设置');
ok(plugin.settings.categories.length === 3, 'onload 后有 3 个项目类型');

/* ---- 候选列表 ---- */
const cands = plugin.collectCandidates();
ok(cands.every((c) => !c.path.startsWith('F Craftlab/F3')), '无关根目录不进候选');
ok(cands.every((c) => !c.path.endsWith('附件')), '“附件”不进候选');
eq(cands[0].path, 'F Craftlab/F2 项目/F.260603-减速机半自动装配线', '当前笔记所在项目：项目根排第一');
eq(cands[1].path, 'F Craftlab/F2 项目/F.260603-减速机半自动装配线/04 研发', '同项目内按层级浅→深');
eq(cands.length, 4, `候选数量（F 项目 3 个 + D 项目 1 个，实际 ${cands.length}）`);

/* ---- 新建项目 ---- */
notices.length = 0;
await plugin.createProject(plugin.settings.categories[0], '测试项目');
const created = Array.from(vault.map.keys()).filter((k) => /^F Craftlab\/F2 项目\/F\.\d{6}-测试项目$/.test(k));
eq(created.length, 1, '新建出了 1 个项目文件夹');
const projPath = created[0];
ok(!!vault.getAbstractFileByPath(`${projPath}/01 管理`), '脚手架一级目录已复制');
ok(!!vault.getAbstractFileByPath(`${projPath}/04 研发/02 机械`), '脚手架二级目录已复制');
const copied = vault.getAbstractFileByPath(`${projPath}/04 研发/02 机械/测试项目-设计说明.md`);
ok(!!copied, '脚手架里的文件被复制，且文件名占位符已替换');
ok(copied && copied.data.includes('# 测试项目'), '文件内容占位符 {{项目名}} 已替换');
ok(copied && copied.data.includes(`项目路径：${projPath}`), '文件内容占位符 {{项目路径}} 已替换');
ok(notices.some((n) => n.includes('已创建项目')), '成功时给出提示');

/* ---- 重复新建不覆盖 ---- */
const before = vault.map.size;
notices.length = 0;
await plugin.createProject(plugin.settings.categories[0], '测试项目');
eq(vault.map.size, before, '同名项目再次新建时不产生任何新对象');
ok(notices.some((n) => n.includes('已存在')), '同名时提示已存在');

/* ---- 最近使用被记住 ---- */
ok(plugin.recentProjects.includes(projPath), '最近使用记录了新项目');
const cands2 = plugin.collectCandidates();
eq(cands2[0].path, 'F Craftlab/F2 项目/F.260603-减速机半自动装配线', '有打开笔记时：当前项目的根仍排第一（上下文优先于历史）');
eq(cands2[3].path, projPath, '刚建的项目紧随当前项目之后');
app.workspace.getActiveFile = () => null;
const cands3 = plugin.collectCandidates();
eq(cands3[0].path, projPath, '没有打开笔记时：最近使用过的新项目排第一');

/* ---- 新建文档：空模板 ---- */
const target = cands2.find((c) => c.path === `${projPath}/04 研发/02 机械`);
ok(!!target, '能在候选里找到刚建项目的深层目录');
notices.length = 0;
await plugin.createDoc(target, '系统设计');
const docPath = `${projPath}/04 研发/02 机械/系统设计.md`;
ok(!!vault.getAbstractFileByPath(docPath), '文档已创建到所选目录');
eq(vault.getAbstractFileByPath(docPath).data, '', '未配置模板时创建空文档');

/* ---- 已有同名文档不覆盖 ---- */
vault.getAbstractFileByPath(docPath).data = '原有内容';
notices.length = 0;
await plugin.createDoc(target, '系统设计');
eq(vault.getAbstractFileByPath(docPath).data, '原有内容', '同名文档不被覆盖');
ok(notices.some((n) => n.includes('已存在')), '同名文档给出提示');

/* ---- 新建文档：带模板 ---- */
plugin.settings.docTemplateFile = '1 Obsidian/模板/项目文档.md';
await plugin.createDoc(target, '需求说明');
const doc2 = vault.getAbstractFileByPath(`${projPath}/04 研发/02 机械/需求说明.md`);
ok(!!doc2, '带模板时也能创建');
ok(doc2 && doc2.data.includes('title: 需求说明'), '模板里 {{文件名}} 已替换');
ok(doc2 && doc2.data.includes('project: 测试项目'), '模板里 {{项目名}} 已替换');

/* ---- 模板集成：纯文本模板 ---- */
const tplPlain = new FakeTFile('1 Obsidian/模板/测试模板.md', '# {{项目名}}\n路径：{{项目路径}}\n');
vault.map.get('1 Obsidian').children.push(tplPlain);
vault.map.set(tplPlain.path, tplPlain);
const tplVars = __test.buildVars(plugin.settings.categories[0], 'F.261002-测试项目', projPath, '模板文档', new Date());
await plugin.createFromTemplate('1 Obsidian/模板/测试模板.md', `${projPath}/01 管理`, '模板文档', tplVars);
const tplDoc = vault.getAbstractFileByPath(`${projPath}/01 管理/模板文档.md`);
ok(!!tplDoc, '纯文本模板能生成文档');
ok(tplDoc && tplDoc.data.includes(`路径：${projPath}`), '模板里的 {{项目路径}} 被替换');
ok(tplDoc && tplDoc.data.includes('F.261002-测试项目'), '模板里的 {{项目名}} 被替换');
ok(plugin.recentTemplates.includes('1 Obsidian/模板/测试模板.md'), '模板使用记录被保存（下次排在前面）');

/* ---- 模板集成：QuickAdd 语法走 quickadd.api.format() ---- */
const tplQ = new FakeTFile('1 Obsidian/模板/Q模板.md', 'X={{Q}}');
vault.map.get('1 Obsidian').children.push(tplQ);
vault.map.set(tplQ.path, tplQ);
app.plugins.plugins.quickadd = { api: { format: async (s) => s.replace('{{Q}}', '已处理') } };
await plugin.createFromTemplate('1 Obsidian/模板/Q模板.md', `${projPath}/01 管理`, 'Q文档', {});
const qDoc = vault.getAbstractFileByPath(`${projPath}/01 管理/Q文档.md`);
ok(!!qDoc && qDoc.data === 'X=已处理', 'QuickAdd 语法模板被 quickadd.api.format() 处理');

/* ---- 模板集成：Templater 模板但没装 Templater → 纯文本回退 ---- */
delete app.plugins.plugins.quickadd;
const tplT = new FakeTFile('1 Obsidian/模板/T模板.md', 'T=<% tp.date.now() %>');
vault.map.get('1 Obsidian').children.push(tplT);
vault.map.set(tplT.path, tplT);
notices.length = 0;
await plugin.createFromTemplate('1 Obsidian/模板/T模板.md', `${projPath}/01 管理`, 'T文档', {});
const tDoc = vault.getAbstractFileByPath(`${projPath}/01 管理/T文档.md`);
ok(!!tDoc, '未装 Templater 时仍会生成文档（回退纯文本）');
ok(tDoc && tDoc.data.includes('<%'), '回退时 <% 原样保留');
ok(notices.some((n) => n.includes('未检测到 Templater')), '回退时给出明确提示');

/* ---- 模板集成：模板不存在时不炸、不留半成品 ---- */
notices.length = 0;
const beforeMissing = vault.map.size;
await plugin.createFromTemplate('1 Obsidian/模板/不存在.md', `${projPath}/01 管理`, '缺模板', {});
eq(vault.map.size, beforeMissing, '模板不存在时不产生任何文件');
ok(notices.some((n) => n.includes('模板不存在')), '模板不存在时给出提示');

/* ---- 一路没有被改动的既有文件 ---- */
eq(vault.getAbstractFileByPath('F Craftlab/F2 项目/F.260603-减速机半自动装配线/04 研发/02 机械') instanceof FakeTFolder, true, '既有项目结构未被破坏');

/* ---- 结果 ---- */
console.log(`\n流程集成测试：通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  console.log('\n失败明细：');
  fails.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
  process.exit(1);
}
console.log('全部通过 ✓');
