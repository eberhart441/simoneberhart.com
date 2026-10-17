# Simon Eberhart portfolio

Static portfolio hosted by GitHub Pages. The main branch publishes from its root.

Edit the files here, preview locally, then commit and push to main to publish.
The .gitignore deliberately excludes local experiments, offline rendering tools,
and lossless video masters. Optimized videos and runtime assets are tracked.

Custom domain: simoneberhart.com. DNS is managed at GoDaddy.
The apex uses GitHub Pages' four A records, and www is a CNAME to
eberhart441.github.io. Other DNS records (including email) should be retained.

Hyalite's MIT license is included in vendor/LICENSE.

## Publishing (agents and humans)

Day to day the site is edited in the working copy (`physarum-redo/portfolio`, not a git clone you push from) and published
into this repository. Use the tools instead of copying by hand: `npm install` once, then

    npm run check                                              # before anything goes live
    node tools/publish.mjs -m "What changed" index.html liquid.mjs   # copy, bump caches, commit, push, verify the deploy
    npm run hooks                                              # optional: run the check before every push

Why each step exists:

- **Two clones.** `physarum-redo/portfolio` has its own stale `.git` (an old clone of this repo). Never run git there; a commit
  there goes nowhere. `publish` refuses to run unless it is in this clone, on `main`, with origin `eberhart441/simoneberhart.com`.
- **Carriage returns.** The working copy has Windows line endings; the repository does not. `publish` strips them from text files
  while copying, so a diff shows only real changes.
- **The whitelist.** `.gitignore` ignores everything (`/*`) and un-ignores only the published files. A new page, folder or file
  type is silently left out until it is whitelisted. `publish` stops and names any requested file git is ignoring; add its
  pattern to `.gitignore` and run it again.
- **Cache tags.** Browsers cache the glass engine, stylesheet and scripts, so a fix looks unchanged. The page loads them as
  `file?v=tag`; `publish` gives a changed file a new tag (a short hash of its content) in the same commit.
- **Verify the deploy.** After the push, `publish` waits for the GitHub Pages build of that exact commit, then fetches the live
  file and compares it with the local one. "Pushed" is not "live".
- **Battery.** On battery power Windows limits the browser to 30 fps, so `npm run perf` warns before printing numbers.

Options and prerequisites (ffmpeg, sharp) are in tools/README.md. In short: `publish` takes `--from <folder>` (or `$SITE_SOURCE`), `--dry-run`, `--no-push` and `-m`;
`npm run hooks` installs the pre-push check (`-- --uninstall` removes it; bypass once with `SKIP_CHECK=1 git push` or `git push --no-verify`).
Throwaway scripts belong in the session scratch folder, never in this project folder.

`npm run check` runs a syntax check of every script, the drawing-player and drawing-asset checks, a page load that fails on
any error, the panel behaviour, channel-bead and phone (touch) checks in a real browser.
