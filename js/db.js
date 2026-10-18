/* IndexedDB 数据层：周期、票据/附件元数据与文件体、键值配置 */

const DB_NAME = 'piaoju-db';
const DB_VER = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('periods')) {
        const s = db.createObjectStore('periods', { keyPath: 'id' });
        s.createIndex('start', 'start');
      }
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('periodId', 'periodId');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    try {
      out = fn(...stores.map((s) => t.objectStore(s)));
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}

export function uid(prefix = '') {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of rnd) s += b.toString(16).padStart(2, '0');
  return prefix + Date.now().toString(36) + s;
}

export const repo = {
  /* ---------- 周期 ---------- */
  async periods() {
    const list = await tx(['periods'], 'readonly', (s) => s.getAll());
    return (list || []).sort((a, b) => (b.start || '').localeCompare(a.start || '') || (b.createdAt || 0) - (a.createdAt || 0));
  },
  async period(id) {
    return tx(['periods'], 'readonly', (s) => s.get(id));
  },
  async savePeriod(p) {
    const rec = { id: p.id || uid('p'), createdAt: p.createdAt || Date.now(), ...p };
    await tx(['periods'], 'readwrite', (s) => s.put(rec));
    return rec;
  },
  async deletePeriod(id) {
    const files = await tx(['files'], 'readonly', (s) => s.index('periodId').getAll(id));
    await tx(['files', 'blobs', 'periods'], 'readwrite', (s1, s2, s3) => {
      for (const f of files) { s1.delete(f.id); s2.delete(f.id); }
      s3.delete(id);
    });
    return files.length;
  },

  /* ---------- 文件 ---------- */
  async files(periodId, kind) {
    const all = await tx(['files'], 'readonly', (s) => s.index('periodId').getAll(periodId));
    const list = kind ? all.filter((f) => f.kind === kind) : all;
    return list.sort((a, b) => (b.shotAt || b.createdAt || 0) - (a.shotAt || a.createdAt || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  },
  async allFiles() {
    return (await tx(['files'], 'readonly', (s) => s.getAll())) || [];
  },
  async file(id) {
    return tx(['files'], 'readonly', (s) => s.get(id));
  },
  async data(id) {
    const rec = await tx(['blobs'], 'readonly', (s) => s.get(id));
    return rec ? rec.data : null;
  },
  async addFile(meta, data) {
    const record = { id: uid('f'), createdAt: Date.now(), ...meta };
    if (data) await tx(['blobs'], 'readwrite', (s) => s.put({ id: record.id, data }));
    await tx(['files'], 'readwrite', (s) => s.put(record));
    return record;
  },
  async saveFile(meta, data) {
    if (data) await tx(['blobs'], 'readwrite', (s) => s.put({ id: meta.id, data }));
    await tx(['files'], 'readwrite', (s) => s.put(meta));
    return meta;
  },
  async deleteFiles(ids) {
    await tx(['files', 'blobs'], 'readwrite', (s1, s2) => {
      for (const id of ids) { s1.delete(id); s2.delete(id); }
    });
  },
  async moveFiles(ids, periodId) {
    const files = await tx(['files'], 'readonly', (s) => s.getAll());
    const set = new Set(ids);
    await tx(['files'], 'readwrite', (s) => {
      for (const f of files) if (set.has(f.id)) s.put({ ...f, periodId });
    });
  },

  /* ---------- 配置 ---------- */
  async get(key, fallback = null) {
    const rec = await tx(['kv'], 'readonly', (s) => s.get(key));
    return rec ? rec.value : fallback;
  },
  async set(key, value) {
    await tx(['kv'], 'readwrite', (s) => s.put({ key, value }));
  },
  async del(key) {
    await tx(['kv'], 'readwrite', (s) => s.delete(key));
  },

  async wipe() {
    await tx(['periods', 'files', 'blobs', 'kv'], 'readwrite', (s1, s2, s3, s4) => {
      s1.clear(); s2.clear(); s3.clear(); s4.clear();
    });
  },

  async usage() {
    if (navigator.storage && navigator.storage.estimate) {
      try { return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
    }
    return null;
  },
};
