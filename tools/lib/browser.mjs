// Launches the browser the checks drive: Microsoft Edge with the GPU allowed (the glass needs WebGL2).
import {chromium} from 'playwright';

export const launch = (extraArgs = []) => chromium.launch({channel: 'msedge', args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', ...extraArgs]});
