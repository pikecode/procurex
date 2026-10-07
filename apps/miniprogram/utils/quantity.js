function units(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error('数量需为非负数字，最多六位小数');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('数量超出允许范围');
  return result;
}

function remaining(total, shipped) {
  const result = Math.max(0, units(total) - units(shipped));
  return (result / 1000000).toFixed(6).replace(/\.?0+$/, '');
}

function validate(value, options = {}) {
  const amount = units(value);
  if (!options.allowZero && amount === 0) throw new Error('数量必须大于零');
  if (options.max !== undefined && amount > units(options.max)) throw new Error('数量不能超过待处理数量');
  if (options.min !== undefined && amount < units(options.min)) throw new Error(`数量不能小于起订量 ${options.min}`);
  if (options.multiple !== undefined) {
    const multiple = units(options.multiple);
    if (multiple > 0 && amount % multiple !== 0) throw new Error(`数量必须为 ${options.multiple} 的倍数`);
  }
  return String(value).trim();
}

function sum(values) {
  const result = values.reduce((total, value) => total + units(value), 0);
  if (!Number.isSafeInteger(result)) throw new Error('数量超出允许范围');
  return (result / 1000000).toFixed(6).replace(/\.?0+$/, '');
}

function step(value, multiple = '1', min = '1', direction = 1) {
  const current = units(value || '0');
  const increment = units(multiple) || 1000000;
  const minimum = units(min);
  let result = direction > 0 ? (current === 0 ? Math.ceil(Math.max(minimum, increment) / increment) * increment : current + increment) : current - increment;
  if (result < minimum || result < 0) result = 0;
  if (!Number.isSafeInteger(result)) throw new Error('数量超出允许范围');
  return (result / 1000000).toFixed(6).replace(/\.?0+$/, '');
}

module.exports = { remaining, validate, sum, step };
