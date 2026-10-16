# tools

Checks and publishing for the site (see DEPLOYMENT.md). Node 22 and `npm install` (Playwright; the browser is the installed Edge).

- `npm run check`: syntax of every script, the drawing-player and drawing-asset checks, and the page and panel checks in a real browser.
- `npm run publish`: copies changed files from the working copy, commits, pushes and verifies the deploy.
- `npm run perf`: scroll frame times (warns when the numbers cannot be trusted).
- `npm run hooks`: installs the pre-push hook that runs the check.

## Check contract

`tools/check.mjs` runs every `tools/checks/*.mjs`. Each file default-exports `async function (ctx)` and throws (with a message naming what
failed) when its check fails. `ctx` = `{root, baseUrl, launch}`: the repository root, the URL of a running static server for it
(`tools/lib/serve.mjs`), and `launch()` from `tools/lib/browser.mjs`. A check that opens pages must fail on any uncaught page error and on any
failed request except the deliberate video cancellations (`net::ERR_ABORTED` on a `.webm`).
