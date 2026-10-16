// 设计令牌的唯一来源。同��份数据驱动 antd 主题与 CSS 自定义属性，
// 避免「TS 里一个值、CSS 里另一个值」这种对不上的情况。
export const tokens = {
  // 品牌
  brand: '#147d64',
  brandHover: '#0f6853',
  brandSoft: '#e8f2ec',

  // 中性色。四级在白底与布局底上均过 WCAG AA（4.5:1）。
  // 原来的 #7c8790(3.67) / #7d8992(3.58) / #98a2b3(2.58) 都未达标，这里一并修正。
  ink1: '#26333c', // 标题、正文主色      12.95:1
  ink2: '#4b5563', // 次要正文             7.56:1
  ink3: '#667085', // 辅助说明             4.97:1
  ink4: '#66717c', // 占位、弱化信息       4.98:1

  // 背景
  surface: '#ffffff',
  canvas: '#f4f6f8', // 页面底
  sunken: '#f9fafb', // 凹陷底：筛选条、次级区块

  // 描边
  line: '#e1e6eb',
  lineSoft: '#edf0ee',

  // 语义色
  danger: '#b42318',
  dangerSoft: '#fef3f2',
  warn: '#b54708',
  warnSoft: '#fffaeb',

  // 尺度
  radius: 4,
  fontSize: 13,
  controlHeight: 34,
} as const;

/** 写成 :root 上的 CSS 自定义属性，供样式表消费。 */
export const tokenCssVars = `:root{
${Object.entries(tokens)
  .map(([key, value]) => `  --${key}:${value};`)
  .join('\n')}
}`;

/** 模态宽度收敛成四档：窄表单 / 标准 / 宽数据 / 全宽数据表。 */
export const modalWidth = {
  form: 520,
  standard: 720,
  wide: 960,
  full: 1200,
} as const;

export type ModalWidthName = keyof typeof modalWidth;