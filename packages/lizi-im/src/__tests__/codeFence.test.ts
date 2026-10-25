import { describe, expect, it } from 'vitest';

import { splitByCodeFence } from '../codeFence.js';

describe('splitByCodeFence', () => {
  it('没有围栏时只有一段文本', () => {
    expect(splitByCodeFence('普通文本')).toEqual([{ kind: 'text', content: '普通文本' }]);
  });

  it('三反引号围栏: 前后文本与信息串', () => {
    const segments = splitByCodeFence('前\n```ts\nconst a = 1;\n```\n后');
    expect(segments.map((s) => s.kind)).toEqual(['text', 'code', 'text']);
    expect(segments[0].content).toBe('前\n');
    expect(segments[1].info).toBe('ts');
    expect(segments[1].fenceLength).toBe(3);
    expect(segments[1].body).toBe('const a = 1;\n');
    expect(segments[2].content).toBe('\n后');
  });

  it('四反引号围栏: 内层三反引号不会提前闭合', () => {
    const segments = splitByCodeFence('````text\nA\n```\n**B**\n````');
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('code');
    expect(segments[0].fenceLength).toBe(4);
    expect(segments[0].body).toBe('A\n```\n**B**\n');
  });

  it('未闭合围栏: 到文本末尾都算代码', () => {
    const segments = splitByCodeFence('```\nabc');
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('code');
    expect(segments[0].body).toBe('abc');
  });
});

