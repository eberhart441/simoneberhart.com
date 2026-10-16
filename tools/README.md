# tools

Checks and publishing for the site (see DEPLOYMENT.md). Node 22 and `npm install` (Playwright; the browser is the installed Edge).

- `npm run check`: syntax of every script, the drawing-player and drawing-asset checks, and the page and panel checks in a real browser.
- `npm run publish`: copies changed files from the working copy, commits, pushes and verifies the deploy.
- `npm run perf`: scroll frame times (warns when the numbers cannot be trusted).
- `npm run hooks`: installs the pre-push hook that runs the check.

## Options

- `check`: `--root <dir>` checks another folder (default: this repository); `--url <url>` uses a server that is already running instead of starting one.
  It runs `syntax` first and stops there if that fails; otherwise every check runs and all failures are listed together. It prints the elapsed time and warns past 5 minutes.
- `publish`: `npm run publish -- [--from <folder>] [--dry-run] [--no-push] -m "message" file...`
  `--from` is the folder to copy from (else `$SITE_SOURCE`, else the old working copy); `--dry-run` stops after staging, before the commit; `--no-push` commits but does not push.
  It also stops, before committing, when anything beyond the listed files (and index.html, if a cache tag changed) is staged.
- `hooks`: `npm run hooks` installs the pre-push hook; `npm run hooks -- --uninstall` removes it. Bypass it once with `SKIP_CHECK=1 git push` or `git push --no-verify`.

## Prerequisites beyond `npm install`

The drawing-asset check needs **ffmpeg and ffprobe** (on PATH, or in the folder named by `FFMPEG_DIR`, or the winget install) and **sharp** (the folder named by `SHARP_DIR`, or the copy in the codex runtime).
When either is missing the check fails with one sentence naming it and the variable to set.

## Check contract

`tools/check.mjs` runs every `tools/checks/*.mjs`. Each file default-exports `async function (ctx)` and throws (with a message naming what
failed) when its check fails. `ctx` = `{root, baseUrl, launch}`: the repository root, the URL of a running static server for it
(`tools/lib/serve.mjs`), and `launch()` from `tools/lib/browser.mjs`. A check that opens pages must fail on any uncaught page error and on any
failed request except the deliberate video cancellations (`net::ERR_ABORTED` on a `.webm`).
