import { Form, InputNumber, Select } from 'antd';

export function PurchaseUnitFields({ units, salesUnitId }: { units: { id: string; name: string }[]; salesUnitId?: string }) {
  return <Form.Item noStyle shouldUpdate>{({ getFieldValue, setFieldsValue }) => {
    const salesId = salesUnitId || getFieldValue('baseUnitId'); const purchaseId = getFieldValue('purchaseUnitId');
    const salesName = units.find(unit => unit.id === salesId)?.name || '销售单位';
    const purchaseName = units.find(unit => unit.id === purchaseId)?.name || '采购单位';
    return <>
      <Form.Item name="purchaseUnitId" label="采购单位" rules={[{ validator: async (_, value) => { if (value && value === salesId) throw new Error('采购单位不能与销售单位相同'); } }]}>
        <Select allowClear showSearch optionFilterProp="label" placeholder="不选" disabled={!salesId ? true : undefined} options={units.filter(unit => unit.id !== salesId).map(unit => ({ value: unit.id, label: unit.name }))} onChange={() => setFieldsValue({ salesUnitsPerPurchaseUnit: undefined })} />
      </Form.Item>
      {purchaseId && <Form.Item name="salesUnitsPerPurchaseUnit" label={<span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>1{purchaseName} = X{salesName}</span>} rules={[{ required: true, message: '请填写换算数量' }, { validator: async (_, value) => {
        if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,8})?$/.test(value) || Number(value) <= 0 || Number(value) >= 1000000000000) throw new Error('换算数量须为正数，小于1万亿，最多8位小数');
      } }]}>
        <InputNumber aria-label="每采购单位对应销售单位数量" stringMode precision={8} style={{ width: '100%' }} />
      </Form.Item>}
    </>;
  }}</Form.Item>;
}
