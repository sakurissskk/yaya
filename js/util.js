// 通用工具
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));

export const pad = (n) => String(n).padStart(2, '0');

export function toDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function todayKey() { return toDateKey(new Date()); }
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}
export function monthKey(dateKey) { return dateKey.slice(0, 7); }
export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function fmtDateCN(key) {
  const d = parseKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY[d.getDay()]}`;
}
export function fmtMonthCN(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${y}年${m}月`;
}
export function relDay(key) {
  const t = todayKey();
  if (key === t) return '今天';
  if (key === addDays(t, 1)) return '明天';
  if (key === addDays(t, -1)) return '昨天';
  return fmtDateCN(key);
}

export function money(n) {
  const v = Number(n) || 0;
  const fixed = Math.round(v * 100) / 100;
  return Number.isInteger(fixed) ? String(fixed) : fixed.toFixed(2);
}
export function moneyCN(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + '万';
  return money(v);
}

// 收款状态（自动派生）
export function deriveStatus(duty) {
  const price = Number(duty.price) || 0;
  const received = (Number(duty.deposit) || 0) + (Number(duty.tail) || 0);
  if (received <= 0) return { status: 'unpaid', received: 0, remain: price, label: '未收' };
  if (received >= price) return { status: 'paid', received, remain: Math.max(0, price - received), label: '已收' };
  return { status: 'partial', received, remain: price - received, label: '部分收' };
}

export const STATUS_META = {
  unpaid: { label: '未收', cls: 'unpaid' },
  partial: { label: '部分收', cls: 'partial' },
  paid: { label: '已收', cls: 'paid' }
};

export const SOURCES = ['小红书', '抖音', '朋友圈', '介绍人', '回头客', '闲鱼', '微博', '其他'];
export const LOCATION_TYPES = ['上门', '到店', '其他'];
export const DEFAULT_MAKEUP_TYPES = ['日常妆', '新娘妆', '汉服妆', '写真妆', '演出妆', '特效妆', '造型', '其他'];

// 合并默认列表与用户自定义列表（去重保序）
export function mergeList(base, extra) {
  const out = [...base];
  (extra || []).forEach((v) => { if (v && !out.includes(v)) out.push(v); });
  return out;
}

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, ms = 1800) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// 催款话术
export function dunText(duty) {
  const st = deriveStatus(duty);
  const name = duty.clientName ? duty.clientName + '，' : '';
  const [, m, dd] = duty.date.split('-');
  const dateStr = `${Number(m)}月${Number(dd)}日`;
  const what = (duty.makeupTypes || []).join('·') || '那单妆';
  if (st.received > 0 && st.remain > 0) {
    return `${name}${dateStr}的${what}尾款还差 ¥${money(st.remain)} 哦，方便的时候结一下～`;
  }
  return `${name}${dateStr}的${what}妆费 ¥${money(st.remain)} 还没结哦，方便的时候结一下～`;
}

// 两个时间段是否重叠（都缺结束时间时按开始时间 30 分钟内算接近）
export function timeConflict(a, b) {
  const s1 = a.start || '', e1 = a.end || '';
  const s2 = b.start || '', e2 = b.end || '';
  if (!s1 || !s2) return false;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  if (e1 && e2) return s1 < e2 && s2 < e1;
  return Math.abs(toMin(s1) - toMin(s2)) < 30;
}

export function haptic(ms = 8) {
  if (navigator.vibrate) navigator.vibrate(ms);
}
