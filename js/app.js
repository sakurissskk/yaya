// 妆娘账本 · 应用主逻辑
import * as U from './util.js';
import { duties, settings, photos } from './db.js';

const state = {
  page: 'today',
  param: '',
  makeupTypes: [...U.DEFAULT_MAKEUP_TYPES],
  sources: [...U.SOURCES],
  sheet: null,          // { mode, duty, photos: [{id, kind, data}] }
  calMonth: null,
  statsMonth: null,
  listFilter: 'all',
  search: ''
};

/* ============ 启动 ============ */
boot();

async function boot() {
  const saved = await settings.get('makeupTypes', null);
  if (Array.isArray(saved) && saved.length) state.makeupTypes = U.mergeList(U.DEFAULT_MAKEUP_TYPES, saved);
  const savedSrc = await settings.get('sources', null);
  if (Array.isArray(savedSrc) && savedSrc.length) state.sources = U.mergeList(U.SOURCES, savedSrc);
  state.calMonth = U.monthKey(U.todayKey());
  state.statsMonth = U.monthKey(U.todayKey());

  bindGlobal();
  window.addEventListener('hashchange', onHash);
  onHash(true);
  cleanTrash();
  registerSW();
}

async function cleanTrash() {
  try {
    const list = await duties.trashed();
    const cut = Date.now() - 30 * 864e5;
    for (const d of list) {
      if (d.deletedAt && d.deletedAt < cut) {
        await photos.delByDuty(d.id);
        await duties.del(d.id);
      }
    }
  } catch {}
}

function parseRoute() {
  const raw = (location.hash || '#/today').replace(/^#\/?/, '') || 'today';
  const i = raw.indexOf('/');
  const page = i < 0 ? raw : raw.slice(0, i);
  const param = i < 0 ? '' : decodeURIComponent(raw.slice(i + 1));
  state.page = ['today', 'list', 'calendar', 'stats', 'me', 'client', 'trash'].includes(page) ? page : 'today';
  state.param = param;
}

function onHash(first) {
  parseRoute();
  render(!first);
}

/* ============ 渲染 ============ */
async function render(scrollTop = true) {
  const view = document.getElementById('view');
  const searchHadFocus = document.activeElement && document.activeElement.id === 'searchInput';
  const caret = searchHadFocus ? document.activeElement.selectionStart : null;

  const tabOf = { today: 'today', list: 'list', calendar: 'calendar', stats: 'stats', me: 'me', client: 'me', trash: 'me' }[state.page] || 'today';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.route === tabOf));
  document.getElementById('tabbar').hidden = false;

  let html = '';
  if (state.page === 'today') html = await viewToday();
  else if (state.page === 'list') html = await viewList();
  else if (state.page === 'calendar') html = await viewCalendar();
  else if (state.page === 'stats') html = await viewStats();
  else if (state.page === 'client') html = await viewClient(state.param);
  else if (state.page === 'trash') html = await viewTrash();
  else html = await viewMe();

  view.innerHTML = html;
  if (searchHadFocus) {
    const si = document.getElementById('searchInput');
    if (si) { si.focus(); const n = caret ?? si.value.length; try { si.setSelectionRange(n, n); } catch {} }
  }
  if (scrollTop) window.scrollTo(0, 0);
}

/* ============ 今日 ============ */
async function viewToday() {
  const today = U.todayKey();
  const tomorrow = U.addDays(today, 1);
  const all = await duties.all();
  const thisMonth = all.filter((d) => U.monthKey(d.date) === U.monthKey(today));
  const monthReceived = thisMonth.reduce((s, d) => s + U.deriveStatus(d).received, 0);
  const monthRemain = thisMonth.reduce((s, d) => s + U.deriveStatus(d).remain, 0);
  const monthQuote = thisMonth.filter((d) => !d.abandoned).reduce((s, d) => s + (Number(d.price) || 0), 0);
  const monthAbandoned = thisMonth.filter((d) => d.abandoned);

  const tDone = all.filter((d) => d.date === today);
  const tNext = all.filter((d) => d.date === tomorrow);
  const unpaid = all.filter((d) => {
    const st = U.deriveStatus(d).status;
    return st !== 'paid' && st !== 'abandoned';
  }).sort((a, b) => a.date.localeCompare(b.date));
  const unpaidSum = unpaid.reduce((s, d) => s + U.deriveStatus(d).remain, 0);
  const recent = all.slice(0, 4);

  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">饭粒工作室 · ${U.fmtDateCN(today)}</div>
      <h1>凡凡子，今天好呀</h1>
    </div>
    <div class="head-actions">
      <button class="icon-btn" data-action="goto" data-route="me" aria-label="我的">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>
      </button>
    </div>
  </div>

  <div class="hero">
    <div class="h-label">本月实收 · ${U.fmtMonthCN(U.monthKey(today))}</div>
    <div class="h-amount">¥${U.money(monthReceived)}</div>
    <div class="h-meta">
      <div>报价合计<b>¥${U.money(monthQuote)}</b></div>
      <div>未收<b>¥${U.money(monthRemain)}</b></div>
      <div>单数<b>${thisMonth.length} 单</b></div>
      <div>跑单<b>${monthAbandoned.length} 单</b></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h3>今日安排</h3><span class="more" data-action="goto" data-route="calendar">日历</span></div>
    ${tDone.length ? tDone.map(todoRow).join('') : emptyRow('凡凡子今天没有活，好好休息～')}
  </div>

  ${unpaid.length ? `<div class="card">
    <div class="card-head"><h3>还没收到钱</h3><span class="more">${unpaid.length} 单 · ¥${U.money(unpaidSum)}</span></div>
    ${unpaid.slice(0, 6).map((d) => {
      const st = U.deriveStatus(d);
      return `<div class="unpaid-row" data-action="copy-dun" data-id="${d.id}">
        <div class="u-main"><b>${U.escapeHTML(d.clientName || '未填客户')}</b><i>${U.relDay(d.date)} · ${U.escapeHTML((d.makeupTypes || []).join('·') || '未选妆容')}</i></div>
        <div class="u-right"><span class="u-amt">¥${U.money(st.remain)}</span><span class="u-tip">点一下复制催款</span></div>
      </div>`;
    }).join('')}
  </div>` : ''}

  ${tNext.length ? `<div class="card">
    <div class="card-head"><h3>明天预告</h3><span class="more">${tNext.length} 单</span></div>
    ${tNext.map(todoRow).join('')}
  </div>` : ''}

  <div class="section-title">最近记录</div>
  ${recent.length ? recent.map(recCard).join('') : `
    <div class="card empty">
      <div class="e-ico">🪞</div>
      <p>还没有记录，点右下角 ＋ 记第一笔吧</p>
    </div>`}

  <button class="fab" data-action="new" aria-label="记一笔">
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
  </button>
  <div class="love-note">小雅雅最棒了～mua</div>`;
}

function emptyRow(text) {
  return `<div style="padding:22px 0;text-align:center;color:var(--ink-3);font-size:14px">${text}</div>`;
}

function todoRow(d) {
  const st = U.deriveStatus(d);
  const meta = U.STATUS_META[st.status];
  return `<div class="todo-item" data-action="edit" data-id="${d.id}">
    <div class="todo-time"><b>${d.start || '--:--'}</b><span>${d.end || ''}</span></div>
    <div class="todo-main">
      <div class="t-name">${U.escapeHTML(d.clientName || '未填客户')}
        <span class="badge ${meta.cls}">${meta.label}</span>
      </div>
      <div class="t-sub">${U.escapeHTML((d.makeupTypes || []).join('·') || '未选妆容')}${d.location ? ' · ' + U.escapeHTML(d.location) : ''}</div>
    </div>
    <div class="r-price ${d.abandoned ? 'muted' : ''}">${d.abandoned ? `¥${U.money(st.received)}<s>¥${U.money(d.price || 0)}</s>` : '¥' + U.money(d.price || 0)}</div>
  </div>`;
}

function recCard(d) {
  const st = U.deriveStatus(d);
  const meta = U.STATUS_META[st.status];
  return `<div class="rec" data-action="edit" data-id="${d.id}">
    <span class="r-dot s-${st.status}"></span>
    <div class="r-main">
      <div class="r-top">${U.escapeHTML(d.clientName || '未填客户')}
        <span class="badge ${meta.cls}">${meta.label}</span>
      </div>
      <div class="r-sub">${U.relDay(d.date)} ${d.start || ''}${(d.makeupTypes || []).length ? ' · ' + U.escapeHTML(d.makeupTypes.join('·')) : ''}${d.location ? ' · ' + U.escapeHTML(d.location) : ''}</div>
    </div>
    <div class="r-right">
      <div class="r-price ${d.abandoned || !st.received ? 'muted' : ''}">${d.abandoned ? `¥${U.money(st.received)}<s>¥${U.money(d.price || 0)}</s>` : '¥' + U.money(d.price || 0)}</div>
    </div>
  </div>`;
}

/* ============ 记录列表 ============ */
async function viewList() {
  let all = await duties.all();
  if (state.listFilter === 'unpaid') all = all.filter((d) => {
    const st = U.deriveStatus(d).status;
    return st !== 'paid' && st !== 'abandoned';
  });
  if (state.listFilter === 'month') all = all.filter((d) => U.monthKey(d.date) === U.monthKey(U.todayKey()));
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    all = all.filter((d) => [d.clientName, d.clientContact, d.location, d.note, (d.makeupTypes || []).join(' '), d.source]
      .join(' ').toLowerCase().includes(q));
  }

  const groups = new Map();
  all.forEach((d) => {
    if (!groups.has(d.date)) groups.set(d.date, []);
    groups.get(d.date).push(d);
  });

  const totalPrice = all.filter((d) => !d.abandoned).reduce((s, d) => s + (Number(d.price) || 0), 0);
  const totalReceived = all.reduce((s, d) => s + U.deriveStatus(d).received, 0);

  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">共 ${all.length} 单 · 报价 ¥${U.money(totalPrice)} · 实收 ¥${U.money(totalReceived)}</div>
      <h1>记录</h1>
    </div>
  </div>
  <div style="margin-bottom:14px">
    <input class="control" id="searchInput" type="search" placeholder="搜客户 / 地点 / 备注 / 妆容" value="${U.escapeHTML(state.search)}">
  </div>
  <div class="seg" style="margin-bottom:16px" data-action="filter">
    <button class="${state.listFilter === 'all' ? 'on' : ''}" data-filter="all">全部</button>
    <button class="${state.listFilter === 'unpaid' ? 'on' : ''}" data-filter="unpaid">未结清</button>
    <button class="${state.listFilter === 'month' ? 'on' : ''}" data-filter="month">本月</button>
  </div>
  ${all.length ? [...groups.entries()].map(([date, arr]) => `
    <div class="list-group">
      <div class="g-head"><b>${U.relDay(date)}</b><span>${arr.length} 单 · ¥${U.money(arr.reduce((s, d) => s + (Number(d.price) || 0), 0))}</span></div>
      ${arr.map(recCard).join('')}
    </div>`).join('') : `
    <div class="card empty"><div class="e-ico">🔍</div><p>没有找到符合条件的记录</p></div>`}
  <button class="fab" data-action="new" aria-label="记一笔"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
}

/* ============ 日历 ============ */
async function viewCalendar() {
  const mk = state.calMonth;
  const [y, m] = mk.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startWeek = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const all = await duties.byMonth(mk);
  const byDay = {};
  all.forEach((d) => {
    byDay[d.date] = byDay[d.date] || { count: 0, amount: 0 };
    byDay[d.date].count++;
    byDay[d.date].amount += Number(d.price) || 0;
  });

  const cells = [];
  for (let i = 0; i < startWeek; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${mk}-${U.pad(d)}`;
    const info = byDay[key];
    const isToday = key === U.todayKey();
    cells.push(`<div class="cal-cell ${info ? 'has' : ''} ${isToday ? 'today' : ''}" data-action="calday" data-key="${key}">
      <span class="d">${d}</span>
      ${info ? `<span class="amt">${info.count}单</span>` : ''}
    </div>`);
  }

  const monthSum = all.reduce((s, d) => s + (Number(d.price) || 0), 0);

  return `
  <div class="page-head">
    <div><div class="eyebrow">${U.fmtMonthCN(mk)} · ${all.length} 单</div><h1>档期</h1></div>
    <div class="head-actions">
      <button class="icon-btn" data-action="cal-prev"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="icon-btn" data-action="cal-next"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
  </div>
  <div class="card">
    <div class="cal-week">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div style="text-align:center;padding-top:10px;color:var(--ink-3);font-size:12.5px">本月报价合计 ¥${U.money(monthSum)}</div>
  </div>
  <div class="section-title">本月记录</div>
  ${all.length ? all.map(recCard).join('') : `<div class="card empty"><div class="e-ico">📅</div><p>这个月还没有排单</p></div>`}`;
}

/* ============ 统计 ============ */
async function viewStats() {
  const mk = state.statsMonth;
  const all = await duties.byMonth(mk);
  const received = all.reduce((s, d) => s + U.deriveStatus(d).received, 0);
  const remain = all.reduce((s, d) => s + U.deriveStatus(d).remain, 0);
  const abandonedList = all.filter((d) => d.abandoned);
  const abandonedDeposit = abandonedList.reduce((s, d) => s + (Number(d.deposit) || 0), 0);
  const eff = (d) => (d.abandoned ? U.deriveStatus(d).received : (Number(d.price) || 0));
  const price = all.filter((d) => !d.abandoned).reduce((s, d) => s + (Number(d.price) || 0), 0);

  const byType = {};
  const bySource = {};
  const byClient = {};
  all.forEach((d) => {
    (d.makeupTypes && d.makeupTypes.length ? d.makeupTypes : ['未分类']).forEach((t) => {
      byType[t] = byType[t] || { n: 0, amt: 0 };
      byType[t].n++;
      byType[t].amt += eff(d);
    });
    const s = d.source || '未填';
    bySource[s] = bySource[s] || { n: 0, amt: 0 };
    bySource[s].n++;
    bySource[s].amt += eff(d);
    const c = d.clientName || '未填客户';
    byClient[c] = byClient[c] || { n: 0, amt: 0 };
    byClient[c].n++;
    byClient[c].amt += eff(d);
  });
  const top = (obj, k = 5) => Object.entries(obj).sort((a, b) => b[1].amt - a[1].amt).slice(0, k);
  const maxAmt = Math.max(1, ...Object.values(byType).map((v) => v.amt));
  const maxSrc = Math.max(1, ...Object.values(bySource).map((v) => v.amt));

  return `
  <div class="page-head">
    <div><div class="eyebrow">${U.fmtMonthCN(mk)}</div><h1>统计</h1></div>
    <div class="head-actions">
      <button class="icon-btn" data-action="stat-prev"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="icon-btn" data-action="stat-next"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
  </div>
  <div class="hero">
    <div class="h-label">本月实收 · ${U.fmtMonthCN(mk)}</div>
    <div class="h-amount">¥${U.money(received)}</div>
    <div class="h-meta">
      <div>报价合计<b>¥${U.money(price)}</b></div>
      <div>未收<b>¥${U.money(remain)}</b></div>
      <div>单数<b>${all.length} 单</b></div>
      <div>跑单<b>${abandonedList.length} 单</b></div>
    </div>
  </div>
  ${abandonedList.length ? `<div class="hero-note">其中跑单 ${abandonedList.length} 单，未化妆、只收定金 <b>¥${U.money(abandonedDeposit)}</b></div>` : ''}
  <div class="card stat-card">
    <div class="stat-block">
      <div class="stat-title">妆容类型</div>
      ${Object.keys(byType).length ? top(byType, 8).map(([k, v]) => `
        <div class="bar-row">
          <span class="b-label">${U.escapeHTML(k)}</span>
          <span class="b-track"><i style="width:${Math.round(v.amt / maxAmt * 100)}%"></i></span>
          <span class="b-val">¥${U.money(v.amt)}</span>
        </div>`).join('') : emptyRow('本月还没有数据')}
    </div>
    <div class="stat-block">
      <div class="stat-title">客户来源</div>
      ${Object.keys(bySource).length ? top(bySource, 6).map(([k, v]) => `
        <div class="bar-row">
          <span class="b-label">${U.escapeHTML(k)}</span>
          <span class="b-track"><i class="gold" style="width:${Math.round(v.amt / maxSrc * 100)}%"></i></span>
          <span class="b-val">${v.n} 单</span>
        </div>`).join('') : emptyRow('暂无')}
    </div>
    <div class="stat-block">
      <div class="stat-title">客户排行</div>
      ${Object.keys(byClient).length ? top(byClient, 5).map(([k, v], i) => `
        <div class="rank-row" data-action="client" data-name="${U.escapeHTML(k)}">
          <span class="rk ${i < 3 ? 'top' : ''}">${i + 1}</span>
          <span class="rk-name">${U.escapeHTML(k)}</span>
          <span class="rk-meta">${v.n} 单</span>
          <span class="rk-amt">¥${U.money(v.amt)}</span>
        </div>`).join('') : emptyRow('暂无')}
    </div>
  </div>`;
}

/* ============ 客户档案 ============ */
async function viewClient(name) {
  const all = await duties.all();
  const list = all.filter((d) => (d.clientName || '未填客户') === name);
  const total = list.reduce((s, d) => s + (Number(d.price) || 0), 0);
  const remain = list.reduce((s, d) => s + U.deriveStatus(d).remain, 0);
  const contact = list.find((d) => d.clientContact)?.clientContact || '';
  const last = list[0];

  return `
  <div class="page-head">
    <div class="head-actions" style="margin-right:auto">
      <button class="icon-btn" data-action="back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
    </div>
  </div>
  <div class="card client-hero">
    <span class="c-avatar big">${U.escapeHTML((name || '?').slice(0, 1))}</span>
    <div class="ch-name">${U.escapeHTML(name)}</div>
    ${contact ? `<div class="ch-contact">${U.escapeHTML(contact)}</div>` : ''}
    <div class="ch-stats">
      <div><b>${list.length}</b><span>单数</span></div>
      <div><b>¥${U.money(total)}</b><span>总消费</span></div>
      <div><b>¥${U.money(remain)}</b><span>未收</span></div>
    </div>
    ${last ? `<div class="ch-last">上次：${U.relDay(last.date)} · ${U.escapeHTML((last.makeupTypes || []).join('·') || '未选妆容')}</div>` : ''}
    <button class="btn-mini copy-btn" data-action="copy-client" data-name="${U.escapeHTML(name)}">复制客户信息（微信 / 电话 / 地址）</button>
  </div>
  <div class="section-title">全部记录</div>
  ${list.length ? list.map(recCard).join('') : `<div class="card empty"><div class="e-ico">👛</div><p>还没有记录</p></div>`}`;
}

/* ============ 回收站 ============ */
async function viewTrash() {
  const list = await duties.trashed();
  const dayLeft = (t) => Math.max(0, Math.ceil((t + 30 * 864e5 - Date.now()) / 864e5));
  return `
  <div class="page-head">
    <div class="head-actions" style="margin-right:auto">
      <button class="icon-btn" data-action="back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
    </div>
  </div>
  <div class="page-head" style="margin-top:-8px">
    <div><div class="eyebrow">删除后保留 30 天</div><h1>回收站</h1></div>
  </div>
  ${list.length ? list.map((d) => `
    <div class="trash-item">
      <div class="tr-main">
        <div class="tr-top">${U.escapeHTML(d.clientName || '未填客户')} · ¥${U.money(d.price || 0)}</div>
        <div class="tr-sub">${U.relDay(d.date)} ${d.start || ''} · ${U.escapeHTML((d.makeupTypes || []).join('·') || '未选妆容')}</div>
        <div class="tr-sub">还有 ${dayLeft(d.deletedAt)} 天彻底删除</div>
      </div>
      <div class="tr-actions">
        <button class="btn-mini" data-action="restore" data-id="${d.id}">恢复</button>
        <button class="btn-mini danger" data-action="purge" data-id="${d.id}">彻底删</button>
      </div>
    </div>`).join('') : `<div class="card empty"><div class="e-ico">🗑️</div><p>回收站是空的</p></div>`}`;
}

/* ============ 我的 ============ */
async function viewMe() {
  const all = await duties.all();
  const trash = await duties.trashed();
  const clients = {};
  all.forEach((d) => {
    const k = d.clientName || '未填客户';
    clients[k] = clients[k] || { n: 0, amt: 0, last: '' };
    clients[k].n++;
    clients[k].amt += Number(d.price) || 0;
    if (d.date > clients[k].last) clients[k].last = d.date;
  });
  const clientList = Object.entries(clients).sort((a, b) => b[1].last.localeCompare(a[1].last));

  return `
  <div class="page-head"><div><div class="eyebrow">饭粒工作室 · 共 ${all.length} 单 · ${clientList.length} 位客户</div><h1>凡凡子</h1></div></div>

  <div class="card card-tight">
    <div class="menu-row" data-action="goto" data-route="stats">
      <span class="m-ico">📊</span><span class="m-txt">收入统计</span><span class="m-arrow">›</span>
    </div>
    <div class="menu-row" data-action="goto" data-route="trash">
      <span class="m-ico">🗑️</span><span class="m-txt">回收站</span><span class="m-sub">${trash.length} 条</span><span class="m-arrow">›</span>
    </div>
    <div class="menu-row" data-action="backup">
      <span class="m-ico">💾</span><span class="m-txt">导出备份</span><span class="m-sub">JSON</span><span class="m-arrow">›</span>
    </div>
    <div class="menu-row" data-action="import-file">
      <span class="m-ico">📥</span><span class="m-txt">导入恢复</span><span class="m-arrow">›</span>
    </div>
    <div class="menu-row" data-action="export-csv">
      <span class="m-ico">📄</span><span class="m-txt">导出表格</span><span class="m-sub">CSV</span><span class="m-arrow">›</span>
    </div>
  </div>

  <div class="section-title">客户档案</div>
  ${clientList.length ? clientList.map(([name, c]) => `
    <div class="client-row" data-action="client" data-name="${U.escapeHTML(name)}">
      <span class="c-avatar">${U.escapeHTML((name || '?').slice(0, 1))}</span>
      <span class="c-main"><b>${U.escapeHTML(name)}</b><i>最近 ${U.relDay(c.last)} · ${c.n} 单</i></span>
      <span class="c-amt">¥${U.money(c.amt)}</span>
    </div>`).join('') : `<div class="card empty"><div class="e-ico">👛</div><p>还没有客户记录</p></div>`}

  <div class="section-title">关于</div>
  <div class="card" style="font-size:13px;color:var(--ink-2);line-height:1.7">
    <b style="color:var(--ink)">雅雅最棒棒 v0.2</b> · 饭粒工作室 · 凡凡子<br>
    数据只存在这台手机本地，不上传任何服务器。<br>
    删除的记录会在回收站保留 30 天。<br>
    建议每周导出一次备份，防止系统清理网页数据。
    <div class="love-note in-card">小雅雅最棒了～mua</div>
  </div>`;
}

/* ============ 弹层表单 ============ */
function openSheet(mode, duty, existingPhotos = []) {
  state.sheet = { mode, duty, photos: existingPhotos.slice(), photosLoaded: mode === 'new' };
  document.getElementById('sheetTitle').textContent = mode === 'edit' ? '编辑记录' : '记一笔';
  document.getElementById('sheetBody').innerHTML = formHTML(duty, mode);
  document.getElementById('sheetMask').hidden = false;
  document.body.style.overflow = 'hidden';
  bindForm(duty);
  renderPhotoStrip();
  if (mode === 'edit') loadDutyPhotos(duty);
}

function closeSheet() {
  document.getElementById('sheetMask').hidden = true;
  document.body.style.overflow = '';
  state.sheet = null;
}

async function loadDutyPhotos(duty) {
  if (!duty.photos || !duty.photos.length) return;
  const recs = [];
  for (const p of duty.photos) {
    const id = typeof p === 'string' ? p : p.id;
    if (!id) continue;
    try {
      const rec = await photos.get(id);
      if (rec) recs.push({ id: rec.id, kind: rec.kind || 'before', data: rec.data });
    } catch {}
  }
  if (state.sheet && state.sheet.duty.id === duty.id) {
    state.sheet.photos = recs;
    state.sheet.photosLoaded = true;
    renderPhotoStrip();
  }
}

function blankDuty() {
  const now = new Date();
  return {
    id: U.uid(),
    date: U.todayKey(),
    start: U.pad(now.getHours()) + ':00',
    end: '',
    clientName: '', clientContact: '', source: '',
    location: '', locationType: '上门',
    makeupTypes: [], price: '', deposit: '', tail: '',
    note: '', photos: [],
    createdAt: Date.now(), updatedAt: Date.now()
  };
}

function formHTML(d, mode) {
  const st = U.deriveStatus(d);
  return `
  <div class="field">
    <label>日期</label>
    <input class="control" type="date" id="f-date" value="${d.date}">
  </div>
  <div class="row2">
    <div class="field"><label>开始时间</label><input class="control" type="time" id="f-start" value="${d.start || ''}"></div>
    <div class="field"><label>结束时间</label><input class="control" type="time" id="f-end" value="${d.end || ''}"></div>
  </div>
  <div class="row2">
    <div class="field"><label>客户称呼</label><input class="control" id="f-client" placeholder="例：小林" value="${U.escapeHTML(d.clientName || '')}"></div>
    <div class="field"><label>手机 / 微信</label><input class="control" id="f-contact" placeholder="可选" value="${U.escapeHTML(d.clientContact || '')}"></div>
  </div>
  <div class="field">
    <label>客户来源</label>
    <div class="chips" id="f-source">
      ${state.sources.map((s) => `<button type="button" class="chip ${d.source === s ? 'on' : ''}" data-v="${U.escapeHTML(s)}">${U.escapeHTML(s)}</button>`).join('')}
      <button type="button" class="chip add" id="f-add-source">＋ 自定义</button>
    </div>
  </div>
  <div class="field">
    <label>地点</label>
    <div class="seg" id="f-loc-type" style="margin-bottom:10px">
      ${U.LOCATION_TYPES.map((t) => `<button type="button" class="${(d.locationType || '上门') === t ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}
    </div>
    <input class="control" id="f-location" placeholder="客户给的地址 / 自己的店名，自己填" value="${U.escapeHTML(d.location || '')}">
  </div>
  <div class="field">
    <label>妆容类型 <span style="color:var(--ink-3);font-weight:500">可多选</span></label>
    <div class="chips" id="f-types">
      ${state.makeupTypes.map((t) => `<button type="button" class="chip ${(d.makeupTypes || []).includes(t) ? 'on' : ''}" data-v="${U.escapeHTML(t)}">${U.escapeHTML(t)}</button>`).join('')}
      <button type="button" class="chip add" id="f-add-type">＋ 自定义</button>
    </div>
  </div>
  <div class="row2">
    <div class="field"><label>报价</label><div class="money-wrap"><span class="yuan">¥</span><input class="control" type="number" inputmode="decimal" id="f-price" placeholder="0" value="${d.price !== '' && d.price !== undefined ? d.price : ''}"></div></div>
    <div class="field"><label>定金</label><div class="money-wrap"><span class="yuan">¥</span><input class="control" type="number" inputmode="decimal" id="f-deposit" placeholder="0" value="${d.deposit !== '' && d.deposit !== undefined ? d.deposit : ''}"></div></div>
  </div>
  <div class="field">
    <label>尾款已收</label>
    <div class="money-wrap"><span class="yuan">¥</span><input class="control" type="number" inputmode="decimal" id="f-tail" placeholder="0" value="${d.tail !== '' && d.tail !== undefined ? d.tail : ''}"></div>
    <div class="hint" id="f-status-hint">已收 ¥${U.money(st.received)} · ${st.label}${st.remain > 0 ? ' · 还差 ¥' + U.money(st.remain) : ''}</div>
  </div>

  <div class="field">
    <label>这单状态</label>
    <div class="seg" id="f-abandon">
      <button type="button" data-v="0" class="${d.abandoned ? '' : 'on'}">正常</button>
      <button type="button" data-v="1" class="${d.abandoned ? 'on' : ''}">跑单了</button>
    </div>
    <div class="hint" id="f-abandon-hint">${d.abandoned ? '跑单：只算定金，不再算未收' : ''}</div>
  </div>

  <div class="field">
    <label>妆前 / 妆后照片</label>
    <div class="photo-strip" id="f-photos"></div>
    <div class="photo-actions">
      <button type="button" class="photo-add" data-photo-kind="before">📷 妆前</button>
      <button type="button" class="photo-add" data-photo-kind="after">📷 妆后</button>
    </div>
    <input type="file" id="f-photo-input" accept="image/*" hidden>
  </div>

  <div class="field">
    <label>备注</label>
    <textarea class="control" id="f-note" placeholder="喜欢的风格、过敏提醒、注意事项…">${U.escapeHTML(d.note || '')}</textarea>
  </div>
  ${mode === 'edit' ? `<button class="btn danger" type="button" id="f-del">移到回收站</button>` : ''}
  `;
}

function renderPhotoStrip() {
  const strip = document.getElementById('f-photos');
  if (!strip || !state.sheet) return;
  const ph = state.sheet.photos;
  strip.innerHTML = ph.length
    ? ph.map((p, i) => `
      <div class="photo-item">
        <img src="${p.data}" alt="${p.kind === 'after' ? '妆后' : '妆前'}">
        <span class="p-tag">${p.kind === 'after' ? '妆后' : '妆前'}</span>
        <button type="button" class="p-del" data-photo-del="${i}">×</button>
      </div>`).join('')
    : `<div class="photo-empty">还没有照片</div>`;
}

async function compressImage(file, maxSide = 1200, quality = 0.78) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } catch {
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bindForm(duty) {
  const $ = (id) => document.getElementById(id);
  const syncStatus = () => {
    const d = readForm(duty);
    const st = U.deriveStatus(d);
    const hint = $('f-status-hint');
    if (hint) hint.textContent = d.abandoned
      ? `跑单：只算定金 ¥${U.money(st.received)}，不再算未收`
      : `已收 ¥${U.money(st.received)} · ${st.label}${st.remain > 0 ? ' · 还差 ¥' + U.money(st.remain) : ''}`;
    const ah = $('f-abandon-hint');
    if (ah) ah.textContent = d.abandoned ? `跑单：只算定金 ¥${U.money(st.received)}，不再算未收` : '';
  };
  ['f-price', 'f-deposit', 'f-tail'].forEach((id) => $(id)?.addEventListener('input', syncStatus));

  $('f-abandon')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...$('f-abandon').children].forEach((c) => c.classList.remove('on'));
    b.classList.add('on');
    syncStatus();
  });

  $('f-source')?.addEventListener('click', (e) => {
    const addBtn = e.target.closest('#f-add-source');
    if (addBtn) {
      const v = prompt('新的客户来源（例：视频号、闺蜜介绍）');
      if (v && v.trim()) {
        const t = v.trim();
        if (!state.sources.includes(t)) {
          state.sources.push(t);
          settings.set('sources', state.sources);
        }
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip on';
        chip.dataset.v = t;
        chip.textContent = t;
        [...$('f-source').querySelectorAll('.chip')].forEach((c) => c.classList.remove('on'));
        $('f-source').insertBefore(chip, addBtn);
      }
      return;
    }
    const b = e.target.closest('.chip');
    if (!b) return;
    const on = b.classList.contains('on');
    [...$('f-source').children].forEach((c) => c.classList.remove('on'));
    if (!on) b.classList.add('on');
  });
  $('f-loc-type')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...$('f-loc-type').children].forEach((c) => c.classList.remove('on'));
    b.classList.add('on');
  });
  $('f-types')?.addEventListener('click', (e) => {
    const addBtn = e.target.closest('#f-add-type');
    if (addBtn) {
      const v = prompt('新的妆容类型');
      if (v && v.trim()) {
        const t = v.trim();
        if (!state.makeupTypes.includes(t)) {
          state.makeupTypes.push(t);
          settings.set('makeupTypes', state.makeupTypes);
        }
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip on';
        chip.dataset.v = t;
        chip.textContent = t;
        $('f-types').insertBefore(chip, addBtn);
      }
      return;
    }
    const b = e.target.closest('.chip');
    if (b) b.classList.toggle('on');
  });

  // 照片
  let photoKind = 'before';
  document.querySelectorAll('.photo-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      photoKind = btn.dataset.photoKind;
      const input = $('f-photo-input');
      if (!input) return;
      input.value = '';
      input.click();
    });
  });
  $('f-photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !state.sheet) return;
    try {
      U.toast('正在处理照片…', 1000);
      const data = await compressImage(file);
      state.sheet.photos.push({ id: U.uid(), kind: photoKind, data });
      renderPhotoStrip();
      U.toast('照片已添加 ✓', 1200);
    } catch {
      U.toast('照片添加失败');
    }
  });
  $('f-photos')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-photo-del]');
    if (!del || !state.sheet) return;
    const i = Number(del.dataset.photoDel);
    state.sheet.photos.splice(i, 1);
    renderPhotoStrip();
  });

  $('f-del')?.addEventListener('click', async () => {
    if (!confirm('移到回收站？30 天内可以恢复。')) return;
    await duties.trash(duty.id);
    closeSheet();
    U.toast('已移到回收站');
    render(false);
  });
}

function readForm(duty) {
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const types = [...document.querySelectorAll('#f-types .chip.on')].map((c) => c.dataset.v);
  const src = document.querySelector('#f-source .chip.on')?.dataset.v || '';
  const locType = document.querySelector('#f-loc-type button.on')?.dataset.v || '上门';
  return {
    ...duty,
    date: val('f-date') || duty.date,
    start: val('f-start'),
    end: val('f-end'),
    clientName: val('f-client').trim(),
    clientContact: val('f-contact').trim(),
    source: src,
    locationType: locType,
    location: val('f-location').trim(),
    makeupTypes: types,
    price: val('f-price') === '' ? 0 : Number(val('f-price')),
    deposit: val('f-deposit') === '' ? 0 : Number(val('f-deposit')),
    tail: val('f-tail') === '' ? 0 : Number(val('f-tail')),
    abandoned: document.querySelector('#f-abandon button.on')?.dataset.v === '1',
    note: val('f-note').trim(),
    updatedAt: Date.now()
  };
}

/* ============ 保存（含照片） ============ */
async function saveSheet() {
  if (!state.sheet) return;
  const d = readForm(state.sheet.duty);
  if (!d.date) { U.toast('请选择日期'); return; }
  if (!d.clientName && !d.price) { U.toast('至少填客户或报价'); return; }

  const mode = state.sheet.mode;
  const pending = state.sheet.photos;
  const oldIds = (state.sheet.duty.photos || []).map((p) => (typeof p === 'string' ? p : p.id));

  for (const p of pending) {
    await photos.put({ id: p.id, dutyId: d.id, kind: p.kind, data: p.data, createdAt: Date.now() });
  }
  if (state.sheet.photosLoaded) {
    const keep = new Set(pending.map((p) => p.id));
    for (const id of oldIds) {
      if (!keep.has(id)) { try { await photos.del(id); } catch {} }
    }
    d.photos = pending.map((p) => p.id);
  } else {
    // 旧照片还没加载完就保存：保留原有照片，只追加新拍的
    const added = pending.filter((p) => !oldIds.includes(p.id)).map((p) => p.id);
    d.photos = [...oldIds, ...added];
  }

  // 撞单检查：同一天时间重叠时确认
  try {
    const sameDay = await duties.byDate(d.date);
    const clash = sameDay.filter((x) => x.id !== d.id && U.timeConflict(d, x));
    if (clash.length) {
      const desc = clash.map((x) => `${x.start || '?'} ${x.clientName || '未填客户'}`).join('、');
      if (!confirm(`这天 ${desc} 时间撞上了，确定还要存吗？`)) return;
    }
  } catch {}

  await duties.put(d);
  closeSheet();
  U.toast(mode === 'new' ? '记好了 ✓' : '已更新 ✓');
  render(false);
}

/* ============ 事件 ============ */
function bindGlobal() {
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    location.hash = '#/' + t.dataset.route;
  });

  document.getElementById('view').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;

    if (a === 'new') { U.haptic(); openSheet('new', blankDuty()); }
    else if (a === 'edit') {
      const d = await duties.get(el.dataset.id);
      if (d) { U.haptic(); openSheet('edit', d); }
    }
    else if (a === 'goto') { location.hash = '#/' + el.dataset.route; }
    else if (a === 'back') { if (history.length > 1) history.back(); else location.hash = '#/me'; }
    else if (a === 'filter') {
      const f = e.target.closest('[data-filter]');
      if (f) { state.listFilter = f.dataset.filter; render(false); }
    }
    else if (a === 'calday') {
      const key = el.dataset.key;
      const list = await duties.byDate(key);
      if (list.length === 1) { const d = await duties.get(list[0].id); openSheet('edit', d); }
      else if (!list.length) U.toast(`${U.fmtDateCN(key)} 没有排单`);
      else U.toast(`${U.fmtDateCN(key)} 共 ${list.length} 单`);
    }
    else if (a === 'cal-prev') { state.calMonth = U.addMonths(state.calMonth, -1); render(false); }
    else if (a === 'cal-next') { state.calMonth = U.addMonths(state.calMonth, 1); render(false); }
    else if (a === 'stat-prev') { state.statsMonth = U.addMonths(state.statsMonth, -1); render(false); }
    else if (a === 'stat-next') { state.statsMonth = U.addMonths(state.statsMonth, 1); render(false); }
    else if (a === 'client') { location.hash = '#/client/' + encodeURIComponent(el.dataset.name); }
    else if (a === 'restore') { await duties.restore(el.dataset.id); U.toast('已恢复 ✓'); render(false); }
    else if (a === 'purge') {
      if (!confirm('彻底删除后无法恢复，确定吗？')) return;
      await photos.delByDuty(el.dataset.id);
      await duties.del(el.dataset.id);
      U.toast('已彻底删除');
      render(false);
    }
    else if (a === 'copy-dun') {
      const d = await duties.get(el.dataset.id);
      if (!d) return;
      const okc = await U.copyText(U.dunText(d));
      U.toast(okc ? '催款话术已复制，粘到微信就行' : '复制失败，请手动选字', 2200);
    }
    else if (a === 'copy-client') {
      const name = el.dataset.name;
      const all = await duties.all();
      const list = all.filter((d) => (d.clientName || '未填客户') === name);
      const contact = list.find((d) => d.clientContact)?.clientContact || '';
      const addr = list.find((d) => d.location)?.location || '';
      const lines = [name];
      if (contact) lines.push('联系方式：' + contact);
      if (addr) lines.push('地址：' + addr);
      const okc = await U.copyText(lines.join('\n'));
      U.toast(okc ? '客户信息已复制' : '复制失败，请手动选字', 2000);
    }
    else if (a === 'backup') { exportBackup(); }
    else if (a === 'import-file') { importBackup(); }
    else if (a === 'export-csv') { exportCSV(); }
  });

  document.getElementById('view').addEventListener('input', (e) => {
    if (e.target.id === 'searchInput') {
      state.search = e.target.value;
      clearTimeout(bindGlobal._t);
      bindGlobal._t = setTimeout(() => render(false), 250);
    }
  });

  document.getElementById('sheetCancel').addEventListener('click', closeSheet);
  document.getElementById('sheetMask').addEventListener('click', (e) => {
    if (e.target.id === 'sheetMask') closeSheet();
  });
  document.getElementById('sheetSave').addEventListener('click', saveSheet);
}

/* ============ 备份 ============ */
async function exportBackup() {
  U.toast('正在打包…', 1200);
  const all = await duties.allWithTrash();
  const ph = await photos.all();
  const cfg = await settings.all();
  const data = { app: 'makeup-ledger', version: 2, exportedAt: new Date().toISOString(), settings: cfg, duties: all, photos: ph };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `雅雅账本-备份-${U.todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  await settings.set('lastBackup', Date.now());
  U.toast(`备份已导出（${all.length} 单 / ${ph.length} 张照片）`, 2500);
}

async function exportCSV() {
  const all = await duties.all();
  const head = ['日期', '开始', '结束', '客户', '联系方式', '来源', '地点类型', '地点', '妆容', '报价', '定金', '尾款', '已收', '状态', '备注'];
  const rows = all.map((d) => {
    const st = U.deriveStatus(d);
    return [d.date, d.start, d.end, d.clientName, d.clientContact, d.source, d.locationType, d.location,
      (d.makeupTypes || []).join('/'), d.price, d.deposit, d.tail, st.received, st.label, d.note]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  });
  const csv = '\uFEFF' + [head.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `雅雅账本-${U.todayKey()}.csv`;
  a.click();
  U.toast('表格已导出');
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.duties)) throw new Error('格式不对');
      if (!confirm(`将导入 ${data.duties.length} 条记录，覆盖现有数据？\n（选取消则不导入）`)) return;
      await duties.clear();
      await photos.clear();
      await duties.bulkPut(data.duties);
      if (Array.isArray(data.photos)) await photos.bulkPut(data.photos);
      if (data.settings) for (const k in data.settings) await settings.set(k, data.settings[k]);
      U.toast('导入完成');
      render(false);
    } catch (err) {
      U.toast('导入失败：文件格式不对');
    }
  };
  input.click();
}

/* ============ 离线 ============ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
