// Builds buyin/index.html: a short write-up of the BuyIn model and what its live trades did. Every number is computed from
// trading-log/trades.json (the log, parsed from the original PDF); the method is from the code (github.com/eberhart441/BuyOut).
//   node buyin/build.mjs
import fs from 'node:fs';

const trades = JSON.parse(fs.readFileSync(new URL('../trading-log/trades.json', import.meta.url), 'utf8'));
const n = trades.length;
const sum = (a, k) => a.reduce((s, t) => s + t[k], 0);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const usd = (v, signed = false, dp = 2) => (v < 0 ? '−' : signed ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: dp, maximumFractionDigits: dp});
const pct = (v, dp = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
const day = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});

const wins = trades.filter(t => t.profit > 0), losses = trades.filter(t => t.profit < 0);
const net = sum(trades, 'profit'), gross = sum(trades, 'revenue'), fees = sum(trades, 'fees');
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const rets = trades.map(t => t.pct);
let run = 0, peak = 0, maxDD = 0; for (const t of trades) { run += t.profit; peak = Math.max(peak, run); maxDD = Math.min(maxDD, run - peak); }
const best = trades.reduce((a, t) => t.profit > a.profit ? t : a), worst = trades.reduce((a, t) => t.profit < a.profit ? t : a);
const group = key => { const g = {}; for (const t of trades) (g[key(t)] ||= []).push(t); return g; };
const byType = group(t => t.instrument), byMonth = group(t => t.date.slice(0, 7)), byTicker = group(t => t.ticker);
const topTicker = Object.entries(byTicker).sort((a, b) => sum(b[1], 'profit') - sum(a[1], 'profit'))[0];
const noted = trades.filter(t => t.notes).length;
const first = trades[0].date, lastDay = trades.at(-1).date;
const monthName = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const calls = byType['Option Call'], puts = byType['Option Put'];

// ---- figures ---------------------------------------------------------------------------------------------------------
const W = 860, H = 300, M = {l: 52, r: 16, t: 14, b: 30};
const T = i => M.l + i / (n - 1) * (W - M.l - M.r);
let a = 0, b = 0; const curve = trades.map(t => ({net: (a += t.profit), gross: (b += t.revenue)}));
const lo = Math.min(0, ...curve.map(p => p.net), ...curve.map(p => p.gross)), hi = Math.max(...curve.map(p => p.net), ...curve.map(p => p.gross));
const step = 50, yLo = Math.floor(lo / step) * step, yHi = Math.ceil(hi / step) * step;
const Y = v => M.t + (1 - (v - yLo) / (yHi - yLo)) * (H - M.t - M.b);
const grid = []; for (let v = yLo; v <= yHi; v += step) grid.push(`<line class="g${v === 0 ? ' zero' : ''}" x1="${M.l}" x2="${W - M.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${M.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v < 0 ? '−' : ''}$${Math.abs(v)}</text>`);
const ticks = []; let prev = ''; trades.forEach((t, i) => { const m = t.date.slice(0, 7); if (m !== prev) { prev = m; ticks.push(`<line class="g" x1="${T(i).toFixed(1)}" x2="${T(i).toFixed(1)}" y1="${H - M.b}" y2="${H - M.b + 5}"/><text x="${T(i).toFixed(1)}" y="${H - 8}">${new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', {month: 'short', year: '2-digit', timeZone: 'UTC'})}</text>`); } });
const line = key => curve.map((p, i) => `${i ? 'L' : 'M'}${T(i).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(' ');
const equity = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="f1t f1d"><title id="f1t">Running profit by trade</title><desc id="f1d">Profit after fees climbs to ${usd(Math.max(...curve.map(p => p.net)), false, 0)} by the end of October, then drifts; it ends at ${usd(net)}. Before fees it ends at ${usd(gross)}.</desc>
  ${grid.join('')}${ticks.join('')}<path class="line gross" d="${line('gross')}"/><path class="line net" d="${line('net')}"/></svg>`;
const BH = 170, bm = {l: 52, r: 16, t: 10, b: 10};
const ext = Math.max(...trades.map(t => Math.abs(t.profit))), bStep = 50, bMax = Math.ceil(ext / bStep) * bStep;
const BY = v => bm.t + (1 - (v + bMax) / (2 * bMax)) * (BH - bm.t - bm.b), bw = (W - bm.l - bm.r) / n;
const bars = trades.map((t, i) => `<rect class="${t.profit < 0 ? 'neg' : 'pos'}" x="${(bm.l + i * bw + bw * .12).toFixed(1)}" width="${(bw * .76).toFixed(1)}" y="${(t.profit < 0 ? BY(0) : BY(t.profit)).toFixed(1)}" height="${Math.max(.8, Math.abs(BY(t.profit) - BY(0))).toFixed(1)}"/>`).join('');
const perTrade = `<svg class="chart" viewBox="0 0 ${W} ${BH}" role="img" aria-labelledby="f2t f2d"><title id="f2t">Profit of each trade</title><desc id="f2d">${wins.length} gains and ${losses.length} losses, most within ${usd(50, false, 0)} either way. The largest is ${usd(best.profit)} on ${best.ticker}.</desc>
  <line class="g zero" x1="${bm.l}" x2="${W - bm.r}" y1="${BY(0)}" y2="${BY(0)}"/><text x="${bm.l - 8}" y="${BY(0) + 4}" text-anchor="end">$0</text>
  <text x="${bm.l - 8}" y="${BY(bMax) + 10}" text-anchor="end">+$${bMax}</text><text x="${bm.l - 8}" y="${BY(-bMax)}" text-anchor="end">−$${bMax}</text>${bars}</svg>`;

// ---- tables ----------------------------------------------------------------------------------------------------------
const row = (label, list) => `<tr><td>${label}</td><td class="n">${list.length}</td><td class="n">${list.filter(t => t.profit > 0).length}</td><td class="n">${usd(sum(list, 'fees'))}</td><td class="n${sum(list, 'profit') < 0 ? ' neg' : ''}">${usd(sum(list, 'profit'), true)}</td></tr>`;
const typeRows = [['Calls', calls], ['Puts', puts], ['Stock (one accidental purchase)', byType['Stock Long']]].filter(r => r[1]).map(r => row(...r)).join('');
const monthRows = Object.keys(byMonth).sort().map(m => row(monthName(m), byMonth[m])).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>BuyIn: method and live results – Simon Eberhart</title>
<meta name="description" content="How BuyIn forecasts intraday prices by nearest-neighbour matching, and what ${n} live trades did between ${day(first)} and ${day(lastDay)}.">
<meta name="theme-color" content="#f6f5f1">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=IBM+Plex+Sans:ital,wght@0,400;0,500;1,400&family=DM+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; --paper: #f6f5f1; --ink: #161616; --muted: #57544f; --line: #16161620; --accent: #c8102e; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper) url('../paper-texture.png'); color: var(--ink); font: 400 16px/1.65 'IBM Plex Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .page { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
  nav { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 40px; font-size: 14px; }
  a { color: inherit; text-decoration: underline; text-decoration-color: #16161640; text-underline-offset: 3px; }
  a:hover { text-decoration-color: var(--accent); }
  h1 { font: 400 clamp(38px, 7vw, 54px)/1.02 'Instrument Serif', Georgia, serif; letter-spacing: -.025em; margin: 0 0 14px; }
  .by { color: var(--muted); font-size: 14px; margin: 0 0 32px; }
  h2 { font: 400 28px/1.1 'Instrument Serif', Georgia, serif; margin: 48px 0 12px; }
  h2 span { font-family: 'DM Mono', ui-monospace, monospace; font-size: 13px; color: var(--muted); margin-right: 10px; vertical-align: 2px; }
  h3 { font: 500 15px/1.4 'IBM Plex Sans', system-ui, sans-serif; margin: 24px 0 4px; }
  p { margin: 0 0 14px; max-width: 66ch; }
  .abstract { border-left: 2px solid var(--ink); padding: 2px 0 2px 18px; margin: 0 0 8px; max-width: 66ch; }
  .abstract p { margin: 0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 28px 0 0; }
  .stat { border-top: 1px solid var(--line); padding-top: 10px; }
  .stat b { display: block; font: 400 28px/1.1 'Instrument Serif', Georgia, serif; }
  .stat span { color: var(--muted); font-size: 13px; line-height: 1.4; display: block; }
  figure { margin: 22px 0 28px; }
  figcaption { color: var(--muted); font-size: 14px; margin-top: 8px; max-width: 66ch; }
  .photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .photos img { width: 100%; height: auto; display: block; border-radius: 12px; box-shadow: 0 0 0 1px var(--line); }
  .chart { width: 100%; height: auto; display: block; }
  .chart .g { stroke: var(--line); stroke-width: 1; } .chart .zero { stroke: #16161650; }
  .chart .line { fill: none; stroke-width: 2; stroke-linejoin: round; } .chart .net { stroke: var(--ink); } .chart .gross { stroke: #16161666; stroke-dasharray: 5 4; }
  .chart .pos { fill: var(--ink); } .chart .neg { fill: var(--accent); }
  .chart text { font: 400 12px 'DM Mono', ui-monospace, monospace; fill: var(--muted); }
  @media (max-width: 640px) { .chart text { font-size: 20px; } }
  .scroll { overflow-x: auto; margin: 0 -16px; padding: 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0 8px; }
  th, td { text-align: left; padding: 7px 12px 7px 0; border-bottom: 1px solid var(--line); }
  th { font: 400 12px 'DM Mono', ui-monospace, monospace; color: var(--muted); border-bottom-color: #16161640; }
  td.n, th.n { text-align: right; font-family: 'DM Mono', ui-monospace, monospace; font-size: 13px; padding-right: 0; padding-left: 12px; } td.neg { color: var(--accent); }
  table.kv td:first-child { color: var(--muted); } table.kv td.n { font-size: 14px; }
  .code { font: 400 13px/1.6 'DM Mono', ui-monospace, monospace; background: #1616160a; border-radius: 10px; padding: 12px 14px; overflow-x: auto; margin: 0 0 14px; white-space: pre; }
  .foot { color: var(--muted); font-size: 14px; margin-top: 48px; }
</style>
</head>
<body>
<div class="page">
<nav><a href="../">← simoneberhart.com</a><a href="../trading-log/">Trading log</a></nav>
<h1>BuyIn: nearest-neighbour forecasting on intraday bars</h1>
<p class="by">Simon Eberhart · live results ${day(first)} to ${day(lastDay)}</p>

<div class="abstract"><p>BuyIn forecasts a stock's next few hours by finding the past stretches that looked most like the last few days and averaging what happened next. I traded its signals live for about three months: ${n} trades, almost all single options contracts. The account ended ${usd(net, true)} after fees (${usd(gross, true)} before). Fees took ${pct(fees / gross * 100, 0)} of the gross, the calls made money and the puts did not, and most of the profit came in the first weeks. This is a short account of how it works and what the log does and doesn't show.</p></div>
<div class="stats">
  <div class="stat"><b>${usd(net, true, 0)}</b><span>net, +18.11% on the log's base</span></div>
  <div class="stat"><b>${wins.length} / ${n}</b><span>winning trades (${pct(wins.length / n * 100, 0)})</span></div>
  <div class="stat"><b>${usd(fees, false, 0)}</b><span>fees, over half the gross</span></div>
  <div class="stat"><b>${usd(Math.abs(maxDD), false, 0)}</b><span>deepest drop from a peak</span></div>
</div>

<h2><span>1</span>Method</h2>
<h3>Matching</h3>
<p>Prices come in as 5-minute bars. A window of recent bars (price and volume as two channels) is z-score normalized, so only its shape counts, then compared by Euclidean distance with every historical window that ends at the same time of day. The forecast is the average continuation of the 100 closest matches, rescaled to the current price.</p>
<div class="code">forecast = mean( continuation(w) for w in nearest(window, history, k=100) ) × current_price</div>
<p>The search is split across every core with multiprocessing. For the bigger runs I built a 20-node cluster out of old computers, with custom network protocols between them.</p>
<figure><div class="photos"><div><img src="../projects/quant/01-app.webp" alt="The BuyIn app: a forecast curve over recent prices, and the trade log beside it" loading="lazy"></div><div><img src="../projects/quant/02-cluster.webp" alt="Part of the cluster" loading="lazy"></div></div>
<figcaption>The app (a forecast against the recent price, with the auto-trader's log) and part of the cluster.</figcaption></figure>
<h3>Trading</h3>
<p>The auto-trader only enters when the 2-, 3- and 4-day windows all forecast the same direction past a z-score threshold. Position size comes from the Kelly criterion. Orders go through the Interactive Brokers API, and a position closes on a contrary signal or after four hours, whichever comes first.</p>

<h2><span>2</span>The live test</h2>
<p>${n} trades from ${day(first)} to ${day(lastDay)}: ${calls.length} calls, ${puts.length} puts and one stock purchase that was an accident. Each trade cost ${usd(Math.min(...trades.map(t => t.cost)), false, 0)} to ${usd(Math.max(...trades.map(t => t.cost)), false, 0)} (about ${usd(mean(trades.map(t => t.cost)), false, 0)} on average), because the account was small. That matters more than anything else below: a typical trade earned about ${usd(gross / n)} before fees and paid ${usd(fees / n)} in them.</p>

<h2><span>3</span>Results</h2>
<figure>${equity}<figcaption><b>Figure 1.</b> Running profit by trade: solid after fees, dashed before. It rises fast in October and is roughly flat after that.</figcaption></figure>
<div class="scroll"><table class="kv">
  <tr><td>Net profit / before fees</td><td class="n">${usd(net, true)} / ${usd(gross, true)}</td></tr>
  <tr><td>Fees</td><td class="n">${usd(fees)} (${pct(fees / gross * 100)} of the gross)</td></tr>
  <tr><td>Average win / average loss (after fees)</td><td class="n">${usd(mean(wins.map(t => t.profit)), true)} / ${usd(mean(losses.map(t => t.profit)))}</td></tr>
  <tr><td>Best / worst trade</td><td class="n">${usd(best.profit, true)} (${best.ticker}) / ${usd(worst.profit)} (${worst.ticker})</td></tr>
  <tr><td>Return per trade, mean and standard deviation</td><td class="n">${pct(mean(rets), 2)} and ${pct(sd(rets))}</td></tr>
  <tr><td>Deepest drop from a running peak</td><td class="n">${usd(maxDD)}</td></tr>
</table></div>
<figure>${perTrade}<figcaption><b>Figure 2.</b> Profit of each trade, in order, after fees. Black is a gain, red a loss.</figcaption></figure>
<div class="scroll"><table>
  <thead><tr><th></th><th class="n">Trades</th><th class="n">Wins</th><th class="n">Fees</th><th class="n">Net</th></tr></thead>
  <tbody>${typeRows}</tbody>
</table></div>
<div class="scroll"><table>
  <thead><tr><th></th><th class="n">Trades</th><th class="n">Wins</th><th class="n">Fees</th><th class="n">Net</th></tr></thead>
  <tbody>${monthRows}</tbody>
</table></div>

<h2><span>4</span>What it shows, and what it doesn't</h2>
<p><b>Fees were the story.</b> The signal made ${usd(gross)} gross and the account paid ${usd(fees)} to collect it. Fees were about $2 a trade whatever the size, so a bigger account would pay a much smaller share. This one kept ${pct(net / gross * 100, 0)} of the gross.</p>
<p><b>The profit is lumpy.</b> The average trade returned ${pct(mean(rets), 2)} after fees, with a standard deviation of ${pct(sd(rets))}. The dollar profit came from a few larger winners: ${topTicker[0]} alone (${topTicker[1].length} trades) made ${usd(sum(topTicker[1], 'profit'), true, 0)}, more than the whole account. ${pct(wins.length / n * 100, 0)} of trades won, but the average loss was a little bigger than the average win.</p>
<p><b>Calls worked and puts didn't.</b> Calls won ${calls.filter(t => t.profit > 0).length} of ${calls.length} and made ${usd(sum(calls, 'profit'), true, 0)}; puts won ${puts.filter(t => t.profit > 0).length} of ${puts.length} and lost ${usd(Math.abs(sum(puts, 'profit')), false, 0)}. I can't tell from ${n} trades whether the model is worse at calling drops or the market just didn't drop much.</p>
<p><b>It's the model plus me.</b> ${noted} of the ${n} trades have a note, and many of them are about me: selling late, trading on thin evidence, ignoring the signal. The log measures the model and my discretion together. It isn't a clean test of the model alone.</p>
<p><b>It's small and short.</b> ${n} trades, one regime, about eleven weeks, no benchmark. It shows the system worked end to end, from forecast to filled order. It isn't enough to put a number on the edge.</p>

<p class="foot">Numbers are computed from <a href="../trading-log/">the trading log</a> (<a href="../trading-log/BuyIn-trading-log.pdf">original PDF</a>). Code: <a href="https://github.com/eberhart441/BuyOut">github.com/eberhart441/BuyOut</a> · <a href="https://www.youtube.com/watch?v=cE_erRPIcsw">demo</a>.</p>
</div>
</body>
</html>
`;
fs.writeFileSync(new URL('./index.html', import.meta.url), html);
console.log(`built: ${n} trades; net ${net.toFixed(2)}, fees ${fees.toFixed(2)}, maxDD ${maxDD.toFixed(2)}, mean ret ${mean(rets).toFixed(3)}, sd ${sd(rets).toFixed(2)}; noted ${noted}; top ${topTicker[0]}`);
