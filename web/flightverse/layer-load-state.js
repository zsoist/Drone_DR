export function createLazyLayerLoader(load) {
  if (typeof load !== 'function') throw new TypeError('load debe ser una función');
  let state = 'deferred';
  let value = null;
  let error = null;
  let pending = null;

  return {
    get state() { return state; },
    get value() { return value; },
    get error() { return error; },
    ensure() {
      if (state === 'ready') return Promise.resolve(value);
      if (state === 'loading') return pending;
      if (state === 'error') return Promise.reject(error);
      state = 'loading';
      try {
        pending = Promise.resolve(load());
      } catch (reason) {
        pending = Promise.reject(reason);
      }
      pending = pending
        .then(result => {
          value = result;
          state = 'ready';
          return result;
        })
        .catch(reason => {
          error = reason;
          state = 'error';
          throw reason;
        });
      return pending;
    },
  };
}

export function markLoadStep(root, id) {
  const element = root?.querySelector?.(`#${id}`);
  if (!element) return false;
  element.classList.add('ok');
  return true;
}
