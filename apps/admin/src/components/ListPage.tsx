import { useState, type ReactNode } from 'react';
import { Alert, Button, Input, Select, Table, Tooltip } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { Plus, RotateCcw, Search } from 'lucide-react';

export interface BaseRow { id: string; name: string; status?: string }
export function ListPage<T extends BaseRow>({ title, rows, columns, loading, error, reload, create, tools, filters = [], rowSelection, searchPlaceholder = '名称、编号、联系人', emptyHint }: {
  title: string; rows: T[]; columns: TableColumnsType<T>; loading: boolean; error: string; reload: () => void;
  create?: () => void; tools?: ReactNode;
  searchPlaceholder?: string;
  /** 有筛选条件时的空态说明。默认的「暂无数据」不回答「是没数据还是筛没了」。 */
  emptyHint?: string;
  rowSelection?: TableProps<T>['rowSelection'];
  filters?: { key: keyof T; label: string; options: { value: string; label: string }[] }[];
}) {
  const [search, setSearch] = useState(''); const [values, setValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const filtered = rows.filter(row => Object.values(row).filter(value => typeof value === 'string').join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && filters.every(filter => !values[String(filter.key)] || row[filter.key] === values[String(filter.key)] as unknown as typeof row[typeof filter.key]));
  // scroll.x 写死会和实际列宽脱节：表格要么溢出容器，要么撑不到右边，固定列的行为随之失准。
  // 这里按显式列宽加未指定列的基准宽度算一个下限，保证容器永远装得下，固定右侧也才有意义。
  const explicit = columns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 0), 0);
  const flexible = columns.filter(column => typeof column.width !== 'number').length * 140;
  const scrollX = Math.max(900, explicit + flexible);
  // 筛选生效却查空，和根本没有数据，是两种完全不同的处境，文案要分开说。
  const filteredOut = Boolean(search.trim()) || filters.some(filter => values[String(filter.key)]);
  const emptyText = filteredOut
    ? (emptyHint ?? '没有符合筛选条件的记录')
    : `暂无${title.replace(/管理$|列表$/, '')}`;
  return <section className="list-page">
    <div className="page-heading"><h1>{title}</h1><div className="actions">{tools}
      <Tooltip title="刷新列表"><Button aria-label="刷新列表" icon={<RotateCcw size={16} />} onClick={reload} loading={loading} /></Tooltip>
      {create && <Button type="primary" icon={<Plus size={16} />} onClick={create}>新增</Button>}
    </div></div>
    <div className="filter-bar">
      <Input className="search-input" aria-label={`搜索${title}`} placeholder={searchPlaceholder} prefix={<Search size={16} />} value={search} allowClear
        onChange={event => { setSearch(event.target.value); setPage(1); }} />
      {filters.map(filter => <Select key={String(filter.key)} aria-label={filter.label} placeholder={filter.label} allowClear value={values[String(filter.key)]}
        options={filter.options} onChange={value => { setValues(current => ({ ...current, [String(filter.key)]: value })); setPage(1); }} />)}
      <Tooltip title="重置筛选"><Button aria-label="重置筛选" icon={<RotateCcw size={16} />} onClick={() => { setSearch(''); setValues({}); setPage(1); }} /></Tooltip>
    </div>
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={reload}>重试</Button>} />}
    {/* 首次加载时还没有任何行，表格只剩表头，数据到达后会突然长高。
       用等高的骨架行占位，避免这个高度跳变。已有数据时仍交给 antd 的 loading 指示。 */}
    {loading && !filtered.length && !error ? <div className="table-skeleton" aria-busy="true" aria-label="加载中">
      {Array.from({ length: Math.min(size, 8) }, (_, index) => <div className="table-skeleton-row" key={index}>
        <span className="table-skeleton-bar" style={{ width: `${28 + ((index * 13) % 22)}%` }} />
        <span className="table-skeleton-bar" style={{ width: `${12 + ((index * 7) % 10)}%` }} />
      </div>)}
    </div> : <Table<T> rowKey="id" size="small" loading={loading} columns={columns} dataSource={filtered} rowSelection={rowSelection} scroll={{ x: scrollX }}
      locale={{ emptyText: <div className="list-empty">
        <span>{emptyText}</span>
        {filteredOut ? <Button type="link" size="small" onClick={() => { setSearch(''); setValues({}); setPage(1); }}>清除筛选</Button> : null}
      </div> }}
      pagination={{ current: Math.min(page, Math.max(1, Math.ceil(filtered.length / size))), pageSize: size, showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条`, onChange: (current, pageSize) => { setPage(pageSize !== size ? 1 : current); setSize(pageSize); } }} />}
  </section>;
}
