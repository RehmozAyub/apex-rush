// Electron shell for APEX RUSH: serves the game from a privileged app:// protocol
// (ES modules don't load reliably from file://) and prefers the discrete GPU.
const { app, BrowserWindow, protocol, net, Menu, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// APEX_GAME_DIR lets a dev run point Electron at the live source folder
const GAME_DIR = path.resolve(process.env.APEX_GAME_DIR || path.join(__dirname, 'game'));

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  protocol.handle('app', async (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(GAME_DIR, p));
    if (!file.startsWith(GAME_DIR)) return new Response('Forbidden', { status: 403 });
    // local files: skip the HTTP cache so an updated game never runs stale modules
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  });

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#000000',
    title: 'APEX RUSH',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false },
  });
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.loadURL('app://game/index.html');
});

app.on('window-all-closed', () => app.quit());
