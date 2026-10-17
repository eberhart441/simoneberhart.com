// Launches the browser the checks drive: Microsoft Edge with the GPU allowed (the glass needs WebGL2).
import {chromium} from 'playwright';

// `options` go to Playwright's launch (for example ignoreDefaultArgs: ['--hide-scrollbars'] to see classic scrollbars)
export const launch = (extraArgs = [], options = {}) => chromium.launch({channel: 'msedge', args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', ...extraArgs], ...options});
