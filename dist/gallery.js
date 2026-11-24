function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Transacción interrumpida'));
  });
}
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export class Gallery {
  constructor() {
    this.items = new Map();
    this.ready = this.open();
  }
  async open() {
    try {
      const request = indexedDB.open('vicelens-capturas', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('tomas', { keyPath: 'id' });
      this.db = await requestValue(request);
      const records = await requestValue(this.db.transaction('tomas').objectStore('tomas').getAll());
      records.forEach(item => this.items.set(item.id, item));
    } catch {
      this.db = null;
    }
  }
  async add(take) {
    await this.ready;
    this.items.set(take.id, take);
    if (!this.db) return false;
    try {
      const tx = this.db.transaction('tomas', 'readwrite');
      const done = transactionDone(tx);
      tx.objectStore('tomas').put(take);
      await done;
      return true;
    } catch { return false; }
  }
  async remove(id) {
    await this.ready;
    if (this.db) {
      const tx = this.db.transaction('tomas', 'readwrite');
      const done = transactionDone(tx);
      tx.objectStore('tomas').delete(id);
      await done;
    }
    this.items.delete(id);
  }
  sorted() { return [...this.items.values()].sort((a, b) => b.created - a.created); }
}
