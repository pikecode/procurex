import { useState, type ReactNode } from 'react';
import { Alert, Button, Input, Select, Table, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { Plus, RotateCcw, Search } from 'lucide-react';

export interface BaseRow { id: string; name: string; status?: string }
export function ListPage<T extends BaseRow>({ title, rows, columns, loading, error, reload, create, tools, filters = [] }: {
  title: string; rows: T[]; columns: TableColumnsType<T>; loading: boolean; error: string; reload: () => void;
  create?: () => void; tools?: ReactNode;
  filters?: { key: keyof T; label: string; options: { value: string; label: string }[] }[];
}) {
  const [search, setSearch] = useState(''); const [values, setValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const filtered = rows.filter(row => Object.values(row).filter(value => typeof value === 'string').join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && filters.every(filter => !values[String(filter.key)] || row[filter.key] === values[String(filter.key)]));
  return <section className="list-page">
    <div className="page-heading"><h1>{title}</h1><div className="actions">{tools}
      <Tooltip title="刷新列表"><Button aria-label="刷新列表" icon={<RotateCcw size={16} />} onClick={reload} loading={loading} /></Tooltip>
      {create && <Button type="primary" icon={<Plus size={16} />} onClick={create}>新增</Button>}
    </div></div>
    <div className="filter-bar">
      <Input className="search-input" aria-label={`搜索${title}`} placeholder="名称、编号、联系人" prefix={<Search size={16} />} value={search} allowClear
        onChange={event => { setSearch(event.target.value); setPage(1); }} />
      {filters.map(filter => <Select key={String(filter.key)} aria-label={filter.label} placeholder={filter.label} allowClear value={values[String(filter.key)]}
        options={filter.options} onChange={value => { setValues(current => ({ ...current, [String(filter.key)]: value })); setPage(1); }} />)}
      <Tooltip title="重置筛选"><Button aria-label="重置筛选" icon={<RotateCcw size={16} />} onClick={() => { setSearch(''); setValues({}); setPage(1); }} /></Tooltip>
    </div>
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={reload}>重试</Button>} />}
    <Table<T> rowKey="id" size="small" loading={loading} columns={columns} dataSource={filtered} scroll={{ x: 900 }}
      pagination={{ current: Math.min(page, Math.max(1, Math.ceil(filtered.length / size))), pageSize: size, showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条`, onChange: (current, pageSize) => { setPage(pageSize !== size ? 1 : current); setSize(pageSize); } }} />
  </section>;
}
