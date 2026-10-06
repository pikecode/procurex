import { regions } from '../../../web/product-app/address-regions.js';

interface Region { code: string; name: string; children?: Region[] }
interface Option { value: string; label: string; children?: Option[] }
const source: Region[] = regions;
const convert = (items: Region[]): Option[] => items.map(item => ({ value: item.code, label: item.name, ...(item.children ? { children: convert(item.children) } : {}) }));
export const regionOptions = convert(source);
export function splitAddress(address = '') {
  for (const province of source) for (const city of province.children || []) for (const district of city.children || []) {
    const prefix = `${province.name} / ${city.name} / ${district.name} / `;
    if (address.startsWith(prefix)) return { region: [province.code, city.code, district.code], detail: address.slice(prefix.length) };
  }
  return { region: undefined, detail: address };
}
export function composeAddress(region: string[] | undefined, detail: string, legacy = false) {
  const trimmed = detail.trim();
  if (!region?.length && legacy && trimmed) return trimmed;
  const province = source.find(item => item.code === region?.[0]);
  const city = province?.children?.find(item => item.code === region?.[1]);
  const district = city?.children?.find(item => item.code === region?.[2]);
  if (!district || !trimmed) throw new Error('请选择完整省市区并填写详细地址。');
  const result = `${province!.name} / ${city!.name} / ${district.name} / ${trimmed}`;
  if (result.length > 300) throw new Error('完整地址不能超过300字。');
  return result;
}
