(() => {
  const pending = new Map(),
    listeners = new Map();
  let sequence = 0;
  window.native = {
    call(action, params = {}) {
      const id = "n" + ++sequence;
      const p = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.native.postMessage({
          id,
          action,
          params,
        });
      });
      p.id = id;
      return p;
    },
    receive({ id, value, error }) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(value);
    },
    event({ name, value }) {
      for (const fn of listeners.get(name) || []) fn(value);
    },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
  };
})();
