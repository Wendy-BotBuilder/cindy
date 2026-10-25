/**
 * main/im/shared/permissionInputSummary.ts
 * ---------------------------------------------------------------------------
 * permission 授权卡的**正文摘要**: 把工具入参翻成用户看得懂的中文键值行。
 *
 * 卡片此前直接把入参 pretty-print 成 JSON 代码块。工具入参是给机器看的 ——
 * 英文 key、嵌套结构、还夹着审批信封自己的 message / toolDescription 全文;
 * 800 字上限一到就从尾部切, 用户看到一屏字段名, 真正要审的「这次到底要动什么」
 * 正好被切掉。
 *
 * 本模块只做纯函数转换, **不引入任何依赖**(可以脱离打包链直接跑): 截断函数由
 * 调用方注入(cardBuilders 传 interactionCardModel.truncateInline), 未知 key
 * 保留原名不猜, 行数与单行长度都有上限。
 */

/** 已知 key → 中文标签。未知 key 原样显示 —— 宁可露出原名, 也不要猜错。 */
const KEY_LABELS: Record<string, string> = {
  method: '操作',
  path: '路径',
  url: '地址',
  uri: '地址',
  command: '命令',
  cmd: '命令',
  script: '脚本',
  query: '查询',
  keyword: '关键词',
  pattern: '匹配',
  content: '内容',
  body: '内容',
  text: '文本',
  message: '内容',
  file_path: '文件',
  filePath: '文件',
  filename: '文件',
  directory: '目录',
  cwd: '目录',
  repo: '仓库',
  owner: '归属',
  branch: '分支',
  container_id: '会话',
  chat_id: '会话',
  open_id: '用户',
  user_id: '用户',
  issue_number: 'issue',
  pr_number: 'PR',
  page_size: '条数',
  limit: '条数',
  per_page: '条数',
  to: '收件人',
  subject: '主题',
  changes: '改动',
  grantRoot: '目录',
  remove: '移除',
  add: '新增',
};

/** 纯容器 key: 展开子项时只留子标签, 不写成「参数 · 会话」这种两层名。 */
const CONTAINER_KEYS = new Set(['params', 'args', 'options', 'input']);

/** 对「要不要放行」没有信息量的 key, 不上卡。 */
const SKIP_KEYS = new Set([
  'container_id_type',
  'sort_type',
  'sort',
  'direction',
  'display_name',
  'anonymize',
  'toolName',
  'serverName',
  'toolParamsDisplay',
]);

/** 行序: 先「动什么」, 再「范围/条件」。未列出的 key 排在后面, 保持原顺序。 */
const ROW_PRIORITY = [
  'path',
  'method',
  'changes',
  'command',
  'cmd',
  'script',
  'url',
  'query',
  'pattern',
  'keyword',
  'repo',
  'branch',
  'file_path',
  'cwd',
  'container_id',
  'chat_id',
  'to',
  'subject',
  'content',
  'body',
  'text',
];

/** 值单行截断上限: 一行读完, 不折行。 */
export const PERMISSION_ROW_VALUE_MAX = 60;
/** 卡片最多列几行; 多出来的在末行报数, 不静默丢。 */
export const PERMISSION_ROW_MAX = 6;
/** 单个数组最多展开几项(超出报数): 文件变更这类数组要能看见改哪些, 又不能挤爆卡片。 */
export const PERMISSION_ARRAY_ITEM_MAX = 3;

/**
 * 值的 Markdown 活性字符。命中即不能当普通 Markdown 文本拼进卡面 —— 反引号、
 * 括号、方括号、星号、感叹号等都会改变渲染结果(见 PermissionInputRow.literal)。
 */
const MARKDOWN_ACTIVE = /[`*_[\]()!|#>~\\]/;

/** file_change 审批的 changes: `[{ path, kind: { type: 'add'|'update'|'delete', move_path? } }]`。 */
const CHANGE_KIND_LABELS: Record<string, string> = { add: '新增', update: '修改', delete: '删除' };

/** HTTP 动作 → 中文动词。 */
const METHOD_VERBS: Record<string, string> = {
  GET: '读取',
  POST: '发送',
  PUT: '更新',
  PATCH: '更新',
  DELETE: '删除',
};

/** 路径里的资源词 → 中文宾语(只取第一处命中, 命中不了就退回路径本身)。 */
const RESOURCE_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/messages?\b/i, '消息'],
  [/chats?\b/i, '群信息'],
  [/files?\b/i, '文件'],
  [/documents?\b|docs?\b/i, '文档'],
  [/users?\b|members?\b/i, '成员'],
  [/events?\b/i, '日程'],
  [/issues?\b|pulls?\b/i, 'issue / PR'],
  [/tokens?\b/i, '令牌'],
];

export interface PermissionInputSummary {
  /** 副行用: 谁在调用(审批信封里带了 serverName 才给)。 */
  source: string | null;
  /** 标题用的人话动作; 推不出来时为 null, 调用方退回工具名。 */
  action: string | null;
  /** 正文行, 形如 `路径：/open-apis/im/v1/messages`。 */
  rows: PermissionInputRow[];
}

export interface PermissionInputRow {
  /** 整行文本。 */
  text: string;
  /**
   * true = 值里含 Markdown 活性字符, 必须**按字面**渲染。
   *
   * 卡面正文是 Markdown, 而渠道会真的按语法解析: 反引号被各渠道的
   * stripInlineCode / inline-code 处理吃掉、`![x](url)` 被图片提取器摘走、
   * `[名](https://真实地址)` 只留下"名"。允许一张"显示内容 ≠ 实际要批的内容"
   * 的确认卡等于让人盲签 —— 这类行由调用方用围栏代码块包住(围栏内容各渠道都
   * 保持原样), 不做转义猜测: 转义符在不同渠道的可见性不一致, 照样会失真。
   */
  literal: boolean;
}

type Truncate = (s: string, max: number) => string;

/**
 * Codex MCP 审批信封拆包: `{ serverName, message, toolName, toolParams,
 * toolParamsDisplay }`(同一形状见 main/messagePersistBroadcaster 的
 * redactToolInputForUntrustedBoundary)。浏览器信封同理, 真实参数在 toolParams
 * 这一层下面。非信封入参原样返回。
 */
export function unwrapMcpApprovalEnvelope(input: Record<string, unknown>): Record<string, unknown> {
  const { toolParams } = input;
  if (typeof input.serverName !== 'string' || typeof input.toolName !== 'string') return input;
  if (!toolParams || typeof toolParams !== 'object' || Array.isArray(toolParams)) return input;
  return toolParams as Record<string, unknown>;
}

/** 信封来源行; 不是信封时 null。 */
export function describePermissionSource(input: Record<string, unknown>): string | null {
  const { serverName, toolName } = input;
  if (typeof serverName !== 'string' || typeof toolName !== 'string') return null;
  return `${serverName} · ${toolName}`;
}

function pickResource(path: string): string | null {
  for (const [pattern, word] of RESOURCE_WORDS) {
    if (pattern.test(path)) return word;
  }
  return null;
}

/** 推得出「读取消息」「执行命令」这类短语就给一句, 推不出给 null。 */
function describeAction(params: Record<string, unknown>): string | null {
  const method = typeof params.method === 'string' ? params.method.toUpperCase() : '';
  const path = typeof params.path === 'string' ? params.path : '';
  if (method && path) {
    const verb = METHOD_VERBS[method] ?? method;
    const resource = pickResource(path);
    return resource ? `${verb}${resource}` : `${verb} ${path}`;
  }
  if (typeof params.command === 'string' || typeof params.cmd === 'string') return '执行命令';
  if (typeof params.script === 'string') return '运行脚本';
  return null;
}

function isMarkdownActive(text: string): boolean {
  return MARKDOWN_ACTIVE.test(text);
}

/**
 * 不可见字符 → 可见字面标记。
 *
 * 旧写法把连续空白压成一个空格: `echo safe\nrm -rf out` 会显示成
 * `echo safe rm -rf out` —— 两条命令被伪装成一条无害的 echo, 而这张卡正是用来
 * 决定放行的。换行 / 制表 / 其余控制字符一律标出来, 不抹平。
 */
function visibleControlChars(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ⏎ ')
    .replace(/\t/g, ' ⇥ ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (ch) => {
      const code = ch.charCodeAt(0).toString(16).padStart(2, '0');
      return `\\x${code}`;
    });
}

/** 标量 → 显示文本(控制字符已可见化, 多个空格合成一个)。 */
function scalarText(value: unknown, truncate: Truncate): { text: string; literal: boolean } | null {
  if (value === null || value === undefined) return null;
  const raw = visibleControlChars(String(value)).replace(/ {2,}/g, ' ').trim();
  if (raw === '') return null;
  return { text: truncate(raw, PERMISSION_ROW_VALUE_MAX), literal: isMarkdownActive(raw) };
}

/**
 * 数组 → 一行文本。
 *
 * 标量数组列出前几项(如 `remove: ['c1','c2']` —— 用户要知道移除哪些联系人),
 * 形状不认识才退回条数。**不静默丢**: 数组值在逐层展开里也必须有可见结果。
 */
function arrayText(value: unknown[], truncate: Truncate): { text: string; literal: boolean } | null {
  if (value.length === 0) return null;
  const scalars = value.filter((item) => item === null || typeof item !== 'object');
  if (scalars.length !== value.length) return { text: `[${value.length} 项]`, literal: false };
  const labels = scalars.map((item) => String(item).replace(/\s+/g, ' ').trim()).filter((item) => item !== '');
  if (labels.length === 0) return null;
  const shown = labels.slice(0, PERMISSION_ARRAY_ITEM_MAX);
  const suffix = labels.length > shown.length ? `、…还有 ${labels.length - shown.length} 个` : '';
  const text = truncate(`${shown.join('、')}${suffix}`, PERMISSION_ROW_VALUE_MAX);
  return { text, literal: isMarkdownActive(text) };
}

function formatValue(
  value: unknown,
  truncate: Truncate,
): { text: string; literal: boolean } | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return arrayText(value, truncate);
  if (typeof value === 'object') {
    // 再深一层就不猜内容了, 但也不能让它无声消失 —— 报字段数, 用户知道还有东西。
    const fields = Object.keys(value as Record<string, unknown>);
    return fields.length === 0 ? null : { text: `（${fields.length} 个字段）`, literal: false };
  }
  return scalarText(value, truncate);
}

/**
 * 数组值展开。
 *
 * 只认 file_change 审批的变更列表(元素带 `path`, 见 maker-core
 * agents/codex/index.ts 的 fileChangeApproval) —— 用户点「总是允许」前必须看见
 * 要改哪些文件, 只报 `[N 项]` 等于把要审的对象藏起来。形状不匹配才退回条数。
 */
function expandArrayRows(value: unknown[], label: string): PermissionInputRow[] | null {
  const items: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    if (path === '') return null;
    const kind =
      record.kind && typeof record.kind === 'object' && !Array.isArray(record.kind)
        ? (record.kind as Record<string, unknown>)
        : null;
    const type = typeof kind?.type === 'string' ? kind.type : '';
    const moveTo = typeof kind?.move_path === 'string' ? kind.move_path : '';
    const kindLabel = CHANGE_KIND_LABELS[type] ?? type;
    const suffix = moveTo ? `（${kindLabel} → ${moveTo}）` : kindLabel ? `（${kindLabel}）` : '';
    items.push(`${path}${suffix}`);
  }
  if (items.length === 0) return null;
  const shown = items.slice(0, PERMISSION_ARRAY_ITEM_MAX);
  const rows: PermissionInputRow[] = shown.map((text) => ({
    text: `${label}：${text}`,
    literal: isMarkdownActive(text),
  }));
  if (items.length > shown.length) {
    rows.push({ text: `…还有 ${items.length - shown.length} 个`, literal: false });
  }
  return rows;
}

/**
 * 入参 → 卡片正文行。
 *
 * 对象值只展开**一层**(再深就成 JSON 了); 标量原样; 数组按形状展开(见
 * expandArrayRows), 认不出来只报条数。每行 `标签：值`, 标签取中文映射, 未知 key
 * 用原名; 值里带 Markdown 活性字符的行标 literal, 由调用方按字面渲染。
 */
function collectRows(params: Record<string, unknown>, truncate: Truncate): PermissionInputRow[] {
  const rows: Array<{ key: string; row: PermissionInputRow }> = [];
  const pushRow = (key: string, row: PermissionInputRow): void => {
    rows.push({ key, row });
  };
  const push = (key: string, label: string, value: unknown): void => {
    const formatted = formatValue(value, truncate);
    if (formatted === null) return;
    pushRow(key, { text: `${label}：${formatted.text}`, literal: formatted.literal });
  };

  for (const [key, value] of Object.entries(params)) {
    if (SKIP_KEYS.has(key)) continue;
    const label = KEY_LABELS[key] ?? key;
    if (Array.isArray(value)) {
      const expanded = expandArrayRows(value, label);
      if (expanded) {
        expanded.forEach((row, index) => pushRow(`${key}.${index}`, row));
        continue;
      }
      // 不是变更列表: 交给 arrayText(标量数组列前几项, 其余报数)。
      push(key, label, value);
      continue;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (SKIP_KEYS.has(childKey)) continue;
        const childLabel = KEY_LABELS[childKey] ?? childKey;
        const combined = CONTAINER_KEYS.has(key) ? childLabel : `${label} · ${childLabel}`;
        // 嵌套数组也要有可见结果: 变更列表照旧展开, 标量数组列出成员。
        const nestedChanges = Array.isArray(childValue)
          ? expandArrayRows(childValue, combined)
          : null;
        if (nestedChanges) {
          nestedChanges.forEach((row, index) => pushRow(`${key}.${childKey}.${index}`, row));
          continue;
        }
        push(`${key}.${childKey}`, combined, childValue);
      }
      continue;
    }
    push(key, label, value);
  }

  const rank = (key: string): number => {
    const index = ROW_PRIORITY.indexOf(key);
    if (index !== -1) return index;
    const head = key.split('.')[0];
    const headIndex = ROW_PRIORITY.indexOf(head);
    return headIndex === -1 ? ROW_PRIORITY.length + 1 : headIndex;
  };

  rows.sort((a, b) => rank(a.key) - rank(b.key));
  if (rows.length <= PERMISSION_ROW_MAX) return rows.map((entry) => entry.row);
  const kept = rows.slice(0, PERMISSION_ROW_MAX - 1).map((entry) => entry.row);
  const dropped = rows.length - (PERMISSION_ROW_MAX - 1);
  return [
    ...kept,
    { text: `…还有 ${dropped} 项参数（可在电脑上查看完整入参）`, literal: false },
  ];
}

export function summarizePermissionInput(
  input: Record<string, unknown>,
  truncate: Truncate,
): PermissionInputSummary {
  const params = unwrapMcpApprovalEnvelope(input);
  return {
    source: describePermissionSource(input),
    action: describeAction(params),
    rows: collectRows(params, truncate),
  };
}

/** 摘要里可能出现比围栏更长的反引号串 —— 围栏必须更长, 否则会被提前闭合。 */
function longestBacktickRun(lines: readonly string[]): number {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  }
  return longest;
}

/**
 * 摘要行 → 卡片正文行。
 *
 * 只要有一行标了 literal, 就**整块**放进围栏代码块(顺序不变): 围栏内容各渠道
 * 都保持原样, 不必赌各家对反斜杠转义的处理是否一致。
 */
export function renderPermissionRows(rows: readonly PermissionInputRow[]): string[] {
  const lines = rows.map((row) => row.text);
  if (!rows.some((row) => row.literal)) return lines;
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(lines) + 1));
  return [`${fence}text`, ...lines, fence];
}
