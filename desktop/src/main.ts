import { app, BrowserWindow, Menu, dialog, shell, type MenuItemConstructorOptions } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Agent Quest's desktop shell: one window onto the village, plus the server
 * that feeds it, started and stopped with the app.
 *
 * The server runs as a child process rather than inside Electron because it is
 * written against Bun (`Bun.serve`, `Bun.file`), which Electron's Node can't
 * host. Packaged, it is a `bun build --compile` binary, so the app needs no
 * Bun install; unpackaged (`bun run desktop`), it runs from source.
 *
 * The server also serves the built client, so the window loads everything
 * from one origin on :4444 and `client/src/config.ts` needs no special case.
 */

const PORT = 4444;
const ORIGIN = `http://localhost:${PORT}`;
const HEALTH_URL = `${ORIGIN}/api/health`;
const STARTUP_TIMEOUT_MS = 30_000;

/** Marker that the first-run login-item default has been applied. */
const LOGIN_DEFAULT_MARKER = 'login-item-default-applied';

let server: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

interface ServerLaunch {
  command: string;
  args: string[];
  clientDir: string;
  mapPath: string;
}

function serverLaunch(): ServerLaunch {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return {
      command: join(res, 'server', 'agent-quest-server'),
      args: [],
      clientDir: join(res, 'client'),
      mapPath: join(res, 'map', 'village.json'),
    };
  }
  const repo = resolve(__dirname, '..', '..');
  return {
    command: 'bun',
    args: ['run', join(repo, 'server', 'src', 'index.ts')],
    clientDir: join(repo, 'client', 'dist'),
    mapPath: join(repo, 'server', 'data', 'map', 'village.json'),
  };
}

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startServer(): void {
  const launch = serverLaunch();
  const logPath = join(app.getPath('logs'), 'server.log');
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} starting ${launch.command} ---\n`);

  server = spawn(launch.command, launch.args, {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLIENT_URL: ORIGIN,
      AGENT_QUEST_CLIENT_DIR: launch.clientDir,
      AGENT_QUEST_MAP_PATH: launch.mapPath,
      // Packaged, keep the Linear key with the user's app data — the app
      // bundle is read-only and replaced on every reinstall. From source,
      // keep sharing `server/data/` with `bun start`.
      ...(app.isPackaged ? { AGENT_QUEST_DATA_DIR: app.getPath('userData') } : {}),
      AGENT_QUEST_EXIT_WITH_PARENT: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on('exit', (code, signal) => {
    log.write(`--- server exited (code ${code}, signal ${signal}) ---\n`);
    server = null;
    if (!quitting) {
      dialog.showErrorBox(
        'Agent Quest server stopped',
        `The village server exited unexpectedly. Details are in:\n${logPath}`,
      );
      app.quit();
    }
  });
}

async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server === null) return false;
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Agent Quest',
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links out of the app (Linear projects, docs) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // On macOS, closing the window leaves the app (and server) running in the
  // dock, so reopening is instant and the village keeps its state.
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  void mainWindow.loadURL(ORIGIN);
}

function showWindow(): void {
  if (mainWindow === null) createWindow();
  else mainWindow.show();
}

/** Login items only make sense for the installed app, not a dev `electron .`. */
const canOpenAtLogin = (): boolean => app.isPackaged;

function openAtLogin(): boolean {
  return canOpenAtLogin() && app.getLoginItemSettings().openAtLogin;
}

function setOpenAtLogin(enabled: boolean): void {
  if (!canOpenAtLogin()) return;
  app.setLoginItemSettings({ openAtLogin: enabled });
  buildMenu();
}

/**
 * Turn "open at login" on the first time the installed app runs. After that
 * the menu item (or System Settings → Login Items) is the user's to change,
 * so this never re-enables it.
 */
function applyLoginItemDefault(): void {
  if (!canOpenAtLogin()) return;
  const marker = join(app.getPath('userData'), LOGIN_DEFAULT_MARKER);
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true });
  writeFileSync(marker, new Date().toISOString());
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Open at Login',
          type: 'checkbox',
          checked: openAtLogin(),
          enabled: canOpenAtLogin(),
          click: (item) => setOpenAtLogin(item.checked),
        },
        {
          label: 'Show Server Log',
          click: () => void shell.openPath(join(app.getPath('logs'), 'server.log')),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Village', accelerator: 'CmdOrCtrl+1', click: showWindow },
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('Agent Quest');
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    server?.kill();
  });

  void app.whenReady().then(async () => {
    applyLoginItemDefault();
    buildMenu();

    // Something already answering on :4444 is almost always `bun start` —
    // whose server doesn't serve the built client, and which would make
    // ours fail to bind. Say so instead of showing a blank window.
    if (await isServerUp()) {
      dialog.showErrorBox(
        'Port 4444 is in use',
        'Another Agent Quest server is already running (probably `bun start`). Stop it and open Agent Quest again.',
      );
      app.quit();
      return;
    }

    startServer();
    if (!(await waitForServer())) {
      if (!quitting) {
        dialog.showErrorBox(
          'Agent Quest server did not start',
          `See ${join(app.getPath('logs'), 'server.log')} for details.`,
        );
        app.quit();
      }
      return;
    }
    createWindow();
  });
}
