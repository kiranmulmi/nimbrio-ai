// Runs in the window before the page (sandboxed, so CommonJS). It only tells the page it's in the
// desktop app and on which platform; public/theme-init.js in the web app reads it and sets
// data-desktop on <html>, which makes room for the window buttons (there's no title bar).
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('nimbrioDesktop', { platform: process.platform });
