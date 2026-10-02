/* Project Scaffold —— 纯逻辑单元测试
 * 用法：node tools/test.mjs
 * 做法：拦截 require('obsidian')，注入最小桩，再加载 plugin/main.js 里导出的 __test。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---- obsidian 桩：只要能被 extends，不实现任何行为 ---- */
class Plugin {}
class PluginSettingTab {}
class Modal {}
class SuggestModal {}
class Setting {}
class Notice {}
class TFile {}
class TFolder {}
const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') {
    return { Plugin, PluginSettingTab, Setting, SuggestModal, Modal, Notice, TFile, TFolder, normalizePath };
  }
  return originalLoad.apply(this, arguments);
};

const { __test } = require('../main.js');
const {
  DEFAULT_SCAFFOLD,
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
} = __test;

/* ---- 迷你断言 ---- */
let pass = 0;
const fails = [];
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    pass++;
  } else {
    fails.push(`${label}\n    期望 ${b}\n    实际 ${a}`);
  }
};
const ok = (cond, label) => {
  if (cond) pass++;
  else fails.push(`${label}（断言为假）`);
};

const CAT_WORK = { key: '工作', root: 'F Craftlab/F2 项目', prefix: 'F', separator: '-' };
const CAT_LIFE = { key: '生活', root: 'E Yearify/E3 项目', prefix: 'E', separator: '-' };
const CAT_STUDY = { key: '学习', root: 'D Develo/D2 知识领域', prefix: 'D', separator: ' ' };

/* ============ 1. 命名生成 ============ */
eq(buildProjectName(CAT_WORK, '减速机半自动装配线', new Date(2026, 5, 3)), 'F.260603-减速机半自动装配线', '工作类命名');
eq(buildProjectName(CAT_LIFE, 'DIY电脑机箱设计', new Date(2025, 5, 1)), 'E.250601-DIY电脑机箱设计', '生活类命名');
eq(buildProjectName(CAT_STUDY, '数据库学习与实践', new Date(2026, 5, 1)), 'D.260601 数据库学习与实践', '学习类命名（空格分隔）');
eq(buildProjectName(CAT_WORK, 'a/b:c*name', new Date(2026, 0, 9)), 'F.260109-abcname', '非法字符被剔除');
eq(buildProjectName(CAT_WORK, '  前后空格  ', new Date(2026, 0, 9)), 'F.260109-前后空格', '首尾空格被剔除');

/* ============ 2. 识别既有格式（兼容历史） ============ */
eq(parseProjectFolderName('F.260603-减速机半自动装配线'), { prefix: 'F', stamp: '260603', separator: '-', title: '减速机半自动装配线' }, '识别工作类');
eq(parseProjectFolderName('F.180101-Odds and Ends').title, 'Odds and Ends', '识别含空格的英文名');
eq(parseProjectFolderName('E.200102-家庭数据中心设计与规划').stamp, '200102', '识别生活类日期');
eq(parseProjectFolderName('D.240301 数字花园学习与实践').title, '数字花园学习与实践', '识别学习类（空格分隔）');
eq(parseProjectFolderName('D.240301-数字花园学习与实践').separator, '-', '容忍用错分隔符');
eq(parseProjectFolderName('参考资料'), null, '非项目目录返回 null');
eq(parseProjectFolderName('01 管理'), null, '普通子目录返回 null');
eq(parseProjectFolderName('F.2606-太短'), null, '日期不足 6 位返回 null');

/* ============ 3. 路径工具 ============ */
ok(isUnder('F Craftlab/F2 项目', 'F Craftlab/F2 项目'), 'isUnder 把“等于”也算在范围内');
ok(!isUnder('F Craftlab/F3 资料/x', 'F Craftlab/F2 项目'), 'isUnder 不误判前缀相近目录');
eq(relativeDepth('F Craftlab/F2 项目', 'F Craftlab/F2 项目'), -1, 'relativeDepth 对 root 自身返回 -1');
eq(relativeDepth('F Craftlab/F2 项目/F.260603-x', 'F Craftlab/F2 项目'), 0, '项目层 depth=0');
eq(relativeDepth('F Craftlab/F2 项目/F.260603-x/04 研发/02 机械', 'F Craftlab/F2 项目'), 2, '两层子目录 depth=2');
eq(ancestorAtDepth('F Craftlab/F2 项目/F.260603-x/04 研发/02 机械', 'F Craftlab/F2 项目', 1), 'F Craftlab/F2 项目/F.260603-x', '定位所属项目');

/* ============ 4. 候选过滤 ============ */
const settings = {
  categories: [CAT_WORK, CAT_LIFE, CAT_STUDY],
  maxDepthBelowProject: 2,
  ignoreFolders: ['附件'],
};
const folders = [
  { path: 'F Craftlab/F2 项目', mtime: 1 },
  { path: 'F Craftlab/F2 项目/F.260603-减速机', mtime: 100 },
  { path: 'F Craftlab/F2 项目/F.260603-减速机/04 研发', mtime: 90 },
  { path: 'F Craftlab/F2 项目/F.260603-减速机/04 研发/02 机械', mtime: 80 },
  { path: 'F Craftlab/F2 项目/F.260603-减速机/04 研发/02 机械/更深一层', mtime: 70 },
  { path: 'F Craftlab/F2 项目/F.260603-减速机/附件', mtime: 60 },
  { path: 'E Yearify/E3 项目/E.250601-DIY机箱', mtime: 50 },
  { path: 'D Develo/D2 知识领域/D.240301 数字花园', mtime: 40 },
  { path: 'F Craftlab/F3 资料/某资料', mtime: 30 },
  { path: '1 Obsidian/模板', mtime: 20 },
];
const cands = listCandidateFolders(folders, settings);
eq(cands.length, 5, '候选数量（排除 root 自身/超深/附件/无关路径）');
ok(!cands.some((c) => c.path.includes('更深一层')), '超过最深层的被排除');
ok(!cands.some((c) => c.path.endsWith('附件')), '黑名单“附件”被排除');
ok(!cands.some((c) => c.path.startsWith('F Craftlab/F3')), '无关根目录被排除');
eq(cands.find((c) => c.path.endsWith('02 机械')).display, '[工作] F.260603-减速机/04 研发/02 机械', '展示名带类型前缀');
eq(cands.find((c) => c.path.endsWith('02 机械')).projectPath, 'F Craftlab/F2 项目/F.260603-减速机', '正确归属项目');

/* ============ 5. 排序：当前项目 → 最近用过 → 修改时间 ============ */
const ranked = rankCandidates(cands, {
  currentFile: 'E Yearify/E3 项目/E.250601-DIY机箱/01 设计标准/某笔记.md',
  recentProjects: ['F Craftlab/F2 项目/F.260603-减速机'],
  recentFolders: ['F Craftlab/F2 项目/F.260603-减速机/04 研发'],
});
eq(ranked[0].path, 'E Yearify/E3 项目/E.250601-DIY机箱', '当前笔记所在项目排第一');
eq(ranked[1].path, 'F Craftlab/F2 项目/F.260603-减速机/04 研发', '最近用过的具体路径紧随其后');
eq(ranked[2].path, 'F Craftlab/F2 项目/F.260603-减速机', '同项目内其余路径按修改时间（100 最大）');
eq(ranked[3].path, 'F Craftlab/F2 项目/F.260603-减速机/04 研发/02 机械', '继续按修改时间');
eq(ranked[4].path, 'D Develo/D2 知识领域/D.240301 数字花园', '无关新路径排最后');

const ranked2 = rankCandidates(cands, { currentFile: '', recentProjects: [], recentFolders: [] });
eq(ranked2[0].path, 'F Craftlab/F2 项目/F.260603-减速机', '没有上下文时按项目修改时间排第一');
eq(ranked2[1].path, 'F Craftlab/F2 项目/F.260603-减速机/04 研发', '同级再按时间');

/* ============ 6. 占位符 ============ */
eq(renderTemplate('# {{项目名}}', { 项目名: '减速机' }), '# 减速机', '替换单个占位符');
eq(renderTemplate('{{项目名}} / {{未知}}', { 项目名: 'A' }), 'A / {{未知}}', '未知占位符原样保留');
const vars = buildVars(CAT_WORK, 'F.260603-减速机', 'F Craftlab/F2 项目/F.260603-减速机', '系统设计', new Date(2026, 5, 3));
eq(vars.项目名, '减速机', 'vars.项目名');
eq(vars.项目编号, '260603', 'vars.项目编号');
eq(vars.日期, '2026-06-03', 'vars.日期');
eq(vars.类型, '工作', 'vars.类型');
eq(vars.文件名, '系统设计', 'vars.文件名');

/* ============ 6.5 模板引擎识别与排序（v1.1.0 新增） ============ */
eq(detectTemplateEngine('<% tp.date.now() %>', 'auto'), 'templater', 'auto：含 <% 判为 Templater');
eq(detectTemplateEngine('date: {{DATE}}', 'auto'), 'quickadd', 'auto：含 {{}} 判为 QuickAdd');
eq(detectTemplateEngine('普通文本', 'auto'), 'plain', 'auto：两者都没有则纯文本');
eq(detectTemplateEngine('普通文本', 'templater'), 'templater', '设置可强制指定引擎');
eq(detectTemplateEngine('<% x %>', 'plain'), 'plain', '强制 plain 时不再自动判断');
eq(detectTemplateEngine(null, 'auto'), 'plain', '空内容不炸');
const tpls = [
  { path: 'T/a.md', rel: 'a' },
  { path: 'T/b.md', rel: 'b' },
  { path: 'T/c.md', rel: 'c' },
];
eq(sortTemplates(tpls, ['T/c.md', 'T/a.md']).map((t) => t.rel), ['c', 'a', 'b'], '模板排序：最近用过在前，其余按名称');
eq(sortTemplates(tpls, []).map((t) => t.rel), ['a', 'b', 'c'], '没有最近记录时按名称');

/* ============ 7. 内置骨架与用户库实测一致 ============ */
eq(DEFAULT_SCAFFOLD['工作'].slice(0, 3), ['01 管理', '02 文档', '03 需求'], '内置工作骨架前三级');
ok(DEFAULT_SCAFFOLD['工作'].includes('04 研发/02 机械'), '内置工作骨架含 04 研发/02 机械');
eq(DEFAULT_SCAFFOLD['生活'].length, 0, '生活类默认不铺子目录（用户 2026-10-02 裁定，与学习类一致）');
eq(DEFAULT_SCAFFOLD['学习'].length, 0, '学习类默认不铺子目录（与库内实测一致）');
eq(DEFAULT_SCAFFOLD['工作'].length, 9, '工作类保留 9 条骨架路径（会展开成 10 个目录，含隐含的 04 研发）');

/* ---- 结果 ---- */
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  console.log('\n失败明细：');
  fails.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
  process.exit(1);
}
console.log('全部通过 ✓');
