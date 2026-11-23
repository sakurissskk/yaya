// IndexedDB 数据层：duties（记录）/ settings（设置）/ photos（照片）
const DB_NAME = 'makeup-ledger';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const t = e.target.transaction;
      if (!db.objectStoreNames.contains('duties')) {
        const s = db.createObjectStore('duties', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      let ps;
      if (!db.objectStoreNames.contains('photos')) {
        ps = db.createObjectStore('photos', { keyPath: 'id' });
      } else {
        ps = t.objectStore('photos');
      }
      if (!ps.indexNames.contains('dutyId')) ps.createIndex('dutyId', 'dutyId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s, t); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
function req(store, method, ...args) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const r = t.objectStore(store)[method](...args);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

const byDateDesc = (a, b) => {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.start || '').localeCompare(a.start || '');
};

export const duties = {
  // 默认只返回未删除的
  async all() {
    const list = await req('duties', 'getAll');
    return (list || []).filter((d) => !d.deletedAt).sort(byDateDesc);
  },
  async allWithTrash() {
    return (await req('duties', 'getAll')) || [];
  },
  async trashed() {
    const list = await req('duties', 'getAll');
    return (list || []).filter((d) => d.deletedAt)
      .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  },
  async get(id) { return req('duties', 'get', id); },
  async put(duty) { return tx('duties', 'readwrite', (s) => s.put(duty)); },
  async del(id) { return tx('duties', 'readwrite', (s) => s.delete(id)); },
  // 软删除：进回收站
  async trash(id, when = Date.now()) {
    const d = await req('duties', 'get', id);
    if (!d) return;
    d.deletedAt = when;
    return tx('duties', 'readwrite', (s) => s.put(d));
  },
  async restore(id) {
    const d = await req('duties', 'get', id);
    if (!d) return;
    delete d.deletedAt;
    return tx('duties', 'readwrite', (s) => s.put(d));
  },
  async byDate(dateKey) {
    const list = await req('duties', 'getAll');
    return (list || []).filter((d) => !d.deletedAt && d.date === dateKey)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  },
  async byMonth(mk) {
    const list = await req('duties', 'getAll');
    return (list || []).filter((d) => !d.deletedAt && d.date.startsWith(mk))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  },
  async bulkPut(arr) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('duties', 'readwrite');
      const s = t.objectStore('duties');
      arr.forEach((d) => s.put(d));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
  async clear() { return tx('duties', 'readwrite', (s) => s.clear()); }
};

export const settings = {
  async get(key, fallback = null) {
    const r = await req('settings', 'get', key);
    return r ? r.value : fallback;
  },
  async set(key, value) {
    return tx('settings', 'readwrite', (s) => s.put({ key, value }));
  },
  async all() {
    const list = await req('settings', 'getAll');
    const obj = {};
    (list || []).forEach((r) => { obj[r.key] = r.value; });
    return obj;
  }
};

export const photos = {
  async put(rec) { return tx('photos', 'readwrite', (s) => s.put(rec)); },
  async get(id) { return req('photos', 'get', id); },
  async del(id) { return tx('photos', 'readwrite', (s) => s.delete(id)); },
  async all() { return (await req('photos', 'getAll')) || []; },
  async clear() { return tx('photos', 'readwrite', (s) => s.clear()); },
  async byDuty(dutyId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('photos', 'readonly');
      const idx = t.objectStore('photos').index('dutyId');
      const r = idx.getAll(dutyId);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },
  async bulkPut(arr) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      if (!arr.length) return resolve();
      const t = db.transaction('photos', 'readwrite');
      const s = t.objectStore('photos');
      arr.forEach((p) => s.put(p));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
  async delByDuty(dutyId) {
    const list = await photos.byDuty(dutyId);
    for (const p of list) await photos.del(p.id);
  }
};

export async function estimateUsage() {
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch { return { usage: 0, quota: 0 }; }
}
