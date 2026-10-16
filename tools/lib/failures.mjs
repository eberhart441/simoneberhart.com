// Collects what a check must fail on while a page loads: uncaught page errors and failed requests of our own origin.
// Returns the live list; the caller throws if it is non-empty at the end.
export function watchPage(page, baseOrigin) {
  const problems = [];
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', r => {
    const url = r.url(), why = r.failure()?.errorText;
    if (!url.startsWith(baseOrigin)) return;                              // fonts etc.: not ours, and offline must not block publishing
    if (/\.webm(\?|$)/.test(url) && why === 'net::ERR_ABORTED') return;   // deliberate: videos cancel on fast scrolling
    problems.push(`request failed: ${url} (${why})`);
  });
  page.on('response', r => { if (r.url().startsWith(baseOrigin) && r.status() >= 400) problems.push(`request failed: ${r.url()} (HTTP ${r.status()})`); });
  return problems;
}
