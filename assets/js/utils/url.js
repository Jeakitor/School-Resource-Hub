/** Read and write page state in the query string (shareable, back-button friendly). */

export function getParams(keys) {
  const p = new URLSearchParams(location.search);
  return Object.fromEntries(keys.map((k) => [k, p.get(k) ?? '']));
}

/** Merge values into the URL without reloading. Empty values are removed. */
export function setParams(values) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === null || v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
