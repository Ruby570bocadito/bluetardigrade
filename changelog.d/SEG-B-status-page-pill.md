The console-service status page builds its engine-state pill from DOM
nodes (`replaceChildren` with a text node) instead of assigning an
`innerHTML` string, and a static regression guard holds the whole
inline script to the DOM-building API (no `innerHTML`,
`insertAdjacentHTML`, `document.write` or `eval`). Every call site
passed a constant string, so nothing was reachable; the change removes
the sink class from a page that renders engine-supplied values.
