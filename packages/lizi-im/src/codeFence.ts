/**
 * codeFence.ts — 围栏代码块的**长度感知**切分(单一出处)。
 * ---------------------------------------------------------------------------
 * 卡面正文是 Markdown, 而值里可能出现任意反引号串(命令、要写进文件的 Markdown)。
 * CommonMark 的围栏是「3 个及以上反引号开, 用**不短于**开围栏的串闭」; 只认固定
 * 三个反引号的切分(旧实现)会让值里的 ``` 提前闭合代码块, 后面的内容重新按 Markdown
 * 解释 —— 权限确认卡显示的内容就和实际要批的不一致, 而这张卡正是用来决定是否放行的。
 *
 * Telegram / Discord 的正文渲染与飞书的 inline-code 清理共用这一个切分器, 不再各持
 * 一份固定三反引号的实现。
 */

export interface CodeFenceSegment {
  kind: 'text' | 'code';
  /** 原文片段; kind === 'code' 时含开闭围栏本身。 */
  content: string;
  /** 仅 code: 开围栏的反引号串长度(>= 3)。 */
  fenceLength?: number;
  /** 仅 code: 开围栏同行的信息串(语言标记), 已 trim; 无则空串。 */
  info?: string;
  /** 仅 code: 围栏内容(不含开闭围栏; 未闭合时到文本末尾)。 */
  body?: string;
}

const RUN = /`{3,}/g;

/**
 * 按围栏切分文本。未闭合的围栏按「到文本末尾都是代码」处理, 与渲染侧一致; 文本里
 * 完全不出现 >=3 的反引号串时只有一段 text。
 */
export function splitByCodeFence(text: string): CodeFenceSegment[] {
  const segments: CodeFenceSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    RUN.lastIndex = cursor;
    const open = RUN.exec(text);
    if (open === null) break;
    const openEnd = open.index + open[0].length;
    const lineEnd = text.indexOf('\n', openEnd);
    const infoEnd = lineEnd === -1 ? text.length : lineEnd;
    const info = text.slice(openEnd, infoEnd).trim();
    const bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
    RUN.lastIndex = bodyStart;
    let close: RegExpExecArray | null = null;
    let candidate: RegExpExecArray | null;
    while ((candidate = RUN.exec(text)) !== null) {
      if (candidate[0].length >= open[0].length) {
        close = candidate;
        break;
      }
    }
    const bodyEnd = close ? close.index : text.length;
    const contentEnd = close ? close.index + close[0].length : text.length;
    if (open.index > cursor) {
      segments.push({ kind: 'text', content: text.slice(cursor, open.index) });
    }
    segments.push({
      kind: 'code',
      content: text.slice(open.index, contentEnd),
      fenceLength: open[0].length,
      info,
      body: text.slice(bodyStart, bodyEnd),
    });
    cursor = contentEnd;
  }
  if (cursor < text.length) segments.push({ kind: 'text', content: text.slice(cursor) });
  return segments;
}

