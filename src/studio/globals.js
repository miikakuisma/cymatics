// The studio's components use two page globals for querying, which the
// standalone index.html defines inline. A host page may not, so the library
// defines them before any component module runs.
window.s ??= (selector) => document.querySelector(selector)
window.sAll ??= (selectors) => document.querySelectorAll(selectors)
