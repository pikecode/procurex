import { useState } from 'react';
import { Alert, Button, Input, Popconfirm, Table, Tag, Tooltip } from 'antd';
import { Folder, FolderOpen, ListTree, Minimize2, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';

export interface CategoryRow { id: string; name: string; code?: string; parentId?: string | null; sortOrder?: number; version: number }
interface Node extends CategoryRow { children?: Node[] }
export function CategoryTree({ rows, loading, error, reload, writable, edit, remove }: {
  rows: CategoryRow[]; loading: boolean; error: string; reload: () => void; writable: boolean;
  edit: (row: CategoryRow | null, parentId?: string) => void; remove: (row: CategoryRow) => Promise<void>;
}) {
  const [search, setSearch] = useState(''); const [collapsed, setCollapsed] = useState<string[]>([]);
  const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const sorted = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'zh-CN'));
  const roots = sorted.filter(row => !row.parentId || !rows.some(parent => parent.id === row.parentId));
  const query = search.trim().toLocaleLowerCase();
  const tree: Node[] = roots.flatMap(root => {
    const allChildren = sorted.filter(row => row.parentId === root.id);
    const matches = root.name.toLocaleLowerCase().includes(query);
    const children = allChildren.filter(row => matches || row.name.toLocaleLowerCase().includes(query));
    return matches || children.length ? [{ ...root, ...(children.length ? { children } : {}) }] : [];
  });
  const expandable = tree.filter(row => row.children?.length).map(row => row.id);
  return <section className="list-page">
    <div className="page-heading"><h1>商品分类</h1><div className="actions">
      <Tooltip title="刷新列表"><Button aria-label="刷新列表" loading={loading} icon={<RotateCcw size={16} />} onClick={reload} /></Tooltip>
      {writable && <Button type="primary" icon={<Plus size={16} />} onClick={() => edit(null)}>新增</Button>}
    </div></div>
    <div className="filter-bar">
      <Input className="search-input" aria-label="搜索商品分类" placeholder="分类名称" prefix={<Search size={16} />} allowClear value={search} onChange={event => { setSearch(event.target.value); setPage(1); setCollapsed([]); }} />
      <Tooltip title="全部展开"><Button aria-label="全部展开" icon={<ListTree size={16} />} onClick={() => setCollapsed([])} /></Tooltip>
      <Tooltip title="全部收起"><Button aria-label="全部收起" icon={<Minimize2 size={16} />} onClick={() => setCollapsed(roots.map(row => row.id))} /></Tooltip>
    </div>
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={reload}>重试</Button>} />}
    <Table<Node> rowKey="id" size="small" loading={loading} dataSource={tree} scroll={{ x: 560 }}
      expandable={{ expandedRowKeys: expandable.filter(id => !collapsed.includes(id)), indentSize: 24,
        onExpand: (expanded, row) => setCollapsed(current => expanded ? current.filter(id => id !== row.id) : [...current, row.id]) }}
      pagination={{ current: Math.min(page, Math.max(1, Math.ceil(tree.length / size))), pageSize: size, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
        showTotal: total => `共 ${total} 个一级分类`, onChange: (current, nextSize) => { setPage(nextSize !== size ? 1 : current); setSize(nextSize); } }}
      columns={[
        { title: '分类名称', render: (_, row) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {row.parentId ? <Folder size={16} color="#8c8c8c" /> : <FolderOpen size={16} color="#1677ff" />}
          <span style={{ overflowWrap: 'anywhere' }}>{row.name}</span>
          {!!row.children?.length && <Tag>{row.children.length}</Tag>}
        </span> },
        ...(writable ? [{ title: '操作', width: 132, fixed: 'right' as const, render: (_: unknown, row: Node) => <div className="row-actions">
          {!row.parentId && <Tooltip title="新增子分类"><Button type="text" aria-label={`新增子分类${row.name}`} icon={<Plus size={16} />} onClick={() => edit(null, row.id)} /></Tooltip>}
          <Tooltip title="编辑"><Button type="text" aria-label={`编辑${row.name}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
          <Popconfirm title={`删除“${row.name}”？`} onConfirm={() => remove(row)}><Tooltip title="删除"><Button danger type="text" aria-label={`删除${row.name}`} icon={<Trash2 size={16} />} /></Tooltip></Popconfirm>
        </div> }] : []),
      ]} />
  </section>;
}
