import { esc } from './ui.js';
import { regions } from './address-regions.js';

export function splitAddress(value = '') {
  // Only exact canonical prefixes are split; legacy free text stays intact.
  for (const province of regions) for (const city of province.children) for (const district of city.children || []) {
    const prefix = `${province.name} / ${city.name} / ${district.name} / `;
    if (value.startsWith(prefix)) return { province: province.code, city: city.code, district: district.code, detail: value.slice(prefix.length) };
  }
  return { province: '', city: '', district: '', detail: value };
}

export function composeAddress(data, name) {
  const codes = ['province', 'city', 'district'].map(key => String(data.get(`${name}_${key}`) || ''));
  const detail = String(data.get(name) || '').trim();
  if (codes.every(code => !code)) return detail;
  const province = regions.find(row => row.code === codes[0]);
  const city = province?.children.find(row => row.code === codes[1]);
  const district = city?.children?.find(row => row.code === codes[2]);
  if (!district || !detail) throw new Error('请选择完整省市区并填写详细地址。');
  const address = `${province.name} / ${city.name} / ${district.name} / ${detail}`;
  if (address.length > 300) throw new Error('完整地址不能超过300字。');
  return address;
}

const options = (rows, value, label) => `<option value="">${label}</option>` + rows.map(row => `<option value="${esc(row.code)}" ${row.code === value ? 'selected' : ''}>${esc(row.name)}</option>`).join('');

export function addressFields(name, label, value = '') {
  const initial = splitAddress(value || '');
  const province = regions.find(row => row.code === initial.province);
  const city = province?.children.find(row => row.code === initial.city);
  return `<div class="ws-wide ws-address" data-address="${name}"><span>${esc(label)}</span><div class="ws-address-regions">`
    + ['province', 'city', 'district'].map((key, index) => `<label>${['省份', '城市', '区县'][index]}<select name="${name}_${key}">${options([regions, province?.children || [], city?.children || []][index], initial[key], '请选择')}</select></label>`).join('')
    + `</div><label>详细地址<textarea name="${name}" required maxlength="300">${esc(initial.detail)}</textarea></label></div>`;
}

export function mountAddress(form, name, { legacy = false } = {}) {
  const selects = ['province', 'city', 'district'].map(key => form.elements[`${name}_${key}`]);
  let enabled = true;
  const sync = () => {
    const required = !legacy || selects.some(select => select.value);
    selects.forEach(select => { select.disabled = !enabled; select.required = enabled && required; });
    form.elements[name].disabled = !enabled;
    form.elements[name].required = enabled;
  };
  selects[0].onchange = () => {
    selects[1].innerHTML = options(regions.find(row => row.code === selects[0].value)?.children || [], '', '请选择');
    selects[2].innerHTML = options([], '', '请选择'); sync();
  };
  selects[1].onchange = () => {
    const province = regions.find(row => row.code === selects[0].value);
    selects[2].innerHTML = options(province?.children.find(row => row.code === selects[1].value)?.children || [], '', '请选择'); sync();
  };
  sync();
  return { setEnabled(value) { enabled = value; sync(); } };
}
