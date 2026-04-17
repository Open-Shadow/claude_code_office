/**
 * Electron main process — creates the BrowserWindow, loads assets, handles IPC.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { SessionManager } from './sessionManager.js';
import { MonitorAgent } from './monitorAgent.js';

import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
} from './assetLoader.js';
import { LAYOUT_FILE_NAME } from './constants.js';
import { PluginLoader } from './pluginLoader.js';

// ── Simple JSON store ────────────────────────────────────────

interface SettingsData {
  soundEnabled: boolean;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  lastSeenVersion: string;
  externalAssetDirectories: string[];
  locale: string;
}

interface AgentsData {
  seats: Record<number, { palette: number; hueShift: number; seatId: string | null }>;
}

interface PersistedAgent {
  id: number;
  sessionId: string;
  workDir: string;
  projectName: string;
  palette: number;
  hueShift: number;
  seatId: string | null;
}

const PERSISTED_AGENTS_FILE = 'persisted-agents.json';

const SETTINGS_DEFAULTS: SettingsData = {
  soundEnabled: true,
  watchAllSessions: false,
  alwaysShowLabels: false,
  hooksEnabled: true,
  hooksInfoShown: false,
  lastSeenVersion: '',
  externalAssetDirectories: [],
  locale: 'en',
};

class JsonStore<T extends object> {
  private data: T;
  private filePath: string;

  constructor(name: string, defaults: T) {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${name}.json`);
    this.data = { ...defaults };
    try {
      if (fs.existsSync(this.filePath)) {
        const loaded = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<T>;
        this.data = { ...defaults, ...loaded };
      }
    } catch { /* use defaults */ }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value;
    this.save();
  }

  private save(): void {
    try {
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error(`[JsonStore] Error saving ${this.filePath}:`, err);
    }
  }
}

const store = new JsonStore<SettingsData>('settings', SETTINGS_DEFAULTS);
const agentStore = new JsonStore<AgentsData>('agents', {
  seats: {} as Record<number, { palette: number; hueShift: number; seatId: string | null }>,
});

// ── Session Manager ──────────────────────────────────────────

// Tracks which agent IDs currently have an open terminal (forwarding pty data)
const activeTerminals = new Set<number>();

const sessionManager = new SessionManager({
  dataDir: getDataDir(),
  onData: (agentId, data) => {
    if (!mainWindow || !activeTerminals.has(agentId)) return;
    mainWindow.webContents.send('pty-data', { agentId, data });
  },
  onExit: (agentId, _exitCode) => {
    activeTerminals.delete(agentId);
    if (mainWindow) {
      // Don't remove the agent (character) from the office — just mark it idle.
      // The agent can be reconnected later or manually closed by the user.
      // Send a status update + clear tools so the character goes to idle state.
      mainWindow.webContents.send('agentToolsClear', { type: 'agentToolsClear', id: agentId });
      mainWindow.webContents.send('agentStatus', { type: 'agentStatus', id: agentId, status: 'idle' });
    }
  },
});

// ── Monitor Agent ────────────────────────────────────────────

const monitorAgent = new MonitorAgent(
  () => process.env.ANTHROPIC_API_KEY ?? null,
  () => sessionManager.getAllSessions(),
  (summaries) => {
    if (mainWindow) {
      mainWindow.webContents.send('monitor-update', {
        type: 'monitor-update',
        summaries,
      });
    }
  },
);

// Initialize monitor agent locale from stored settings
monitorAgent.setLocale(store.get('locale'));

// ── Layout file I/O ──────────────────────────────────────────

function layoutFilePath(): string {
  return path.join(getDataDir(), LAYOUT_FILE_NAME);
}

function readLayoutFile(): Record<string, unknown> | null {
  const filePath = layoutFilePath();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    }
  } catch (err) {
    console.error('[Main] Error reading layout file:', err);
  }
  return null;
}

function writeLayoutFile(layout: Record<string, unknown>): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = layoutFilePath();
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(layout, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ── App root (for locating bundled assets) ───────────────────

function getAppRoot(): string {
  // In production the app is packaged; __dirname will be dist/electron/.
  // The project root (where assets/ lives) is two levels up.
  // In dev, __dirname is also dist/electron/ after tsc compile.
  return path.resolve(__dirname, '..', '..');
}

function getDataDir(): string {
  const dir = path.join(getAppRoot(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Plugin loader ────────────────────────────────────────────

const pluginLoader = new PluginLoader(getAppRoot());

// ── Persisted agents I/O ─────────────────────────────────────

function readPersistedAgents(): PersistedAgent[] {
  const filePath = path.join(getDataDir(), PERSISTED_AGENTS_FILE);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedAgent[];
    }
  } catch (err) {
    console.error('[Main] Error reading persisted agents:', err);
  }
  return [];
}

function writePersistedAgents(agents: PersistedAgent[]): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, PERSISTED_AGENTS_FILE);
  try {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(agents, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Main] Error writing persisted agents:', err);
  }
}

function removePersistedAgent(id: number): void {
  const agents = readPersistedAgents().filter((a) => a.id !== id);
  writePersistedAgents(agents);
}

function upsertPersistedAgent(agent: PersistedAgent): void {
  const agents = readPersistedAgents();
  const idx = agents.findIndex((a) => a.id === agent.id);
  if (idx >= 0) {
    agents[idx] = agent;
  } else {
    agents.push(agent);
  }
  writePersistedAgents(agents);
}

// ── Window ───────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'Claude Code Office',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev mode: load Vite dev server. Production: load built index.html.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const htmlPath = path.join(getAppRoot(), 'dist', 'renderer', 'index.html');
    mainWindow.loadFile(htmlPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Asset loading & sending ──────────────────────────────────

async function loadAndSendAssets(): Promise<void> {
  if (!mainWindow) return;
  const win = mainWindow;
  const root = getAppRoot();

  // Load all asset types in parallel
  const [charSprites, floorTiles, wallTiles, furnitureAssets] = await Promise.all([
    loadCharacterSprites(root),
    loadFloorTiles(root),
    loadWallTiles(root),
    loadFurnitureAssets(root),
  ]);

  // Send in the correct order expected by the webview:
  // characterSpritesLoaded -> floorTilesLoaded -> wallTilesLoaded -> furnitureAssetsLoaded -> layoutLoaded

  if (charSprites) {
    win.webContents.send('characterSpritesLoaded', {
      type: 'characterSpritesLoaded',
      characters: charSprites.characters,
    });
  }

  if (floorTiles) {
    win.webContents.send('floorTilesLoaded', {
      type: 'floorTilesLoaded',
      sprites: floorTiles.sprites,
    });
  }

  if (wallTiles) {
    win.webContents.send('wallTilesLoaded', {
      type: 'wallTilesLoaded',
      sets: wallTiles.sets,
    });
  }

  if (furnitureAssets) {
    // Load plugin furniture and merge with regular furniture
    pluginLoader.loadPlugins();
    const pluginCatalog = pluginLoader.getFurnitureEntries();
    const pluginSprites = pluginLoader.getAllSpriteData();

    // Convert sprites Map to plain object for serialization
    const spritesObj: Record<string, string[][]> = {};
    for (const [id, spriteData] of furnitureAssets.sprites) {
      spritesObj[id] = spriteData;
    }
    // Merge plugin sprites
    for (const [id, spriteData] of pluginSprites) {
      spritesObj[id] = spriteData;
    }

    win.webContents.send('furnitureAssetsLoaded', {
      type: 'furnitureAssetsLoaded',
      catalog: [...furnitureAssets.catalog, ...pluginCatalog],
      sprites: spritesObj,
    });
  }

  // Load and send layout
  let layout = readLayoutFile();
  let wasReset = false;
  const defaultLayout = loadDefaultLayout(root);
  const defaultRevision = (defaultLayout as Record<string, unknown> | null)?.layoutRevision as number | undefined ?? 0;

  if (!layout) {
    // No saved layout — use default
    layout = defaultLayout;
  } else {
    // Check if saved layout is outdated (lower revision than default)
    const savedRevision = (layout as Record<string, unknown>).layoutRevision as number | undefined ?? 0;
    if (savedRevision < defaultRevision) {
      console.log(`[Main] Saved layout revision ${savedRevision} < default ${defaultRevision}, upgrading to default layout`);
      layout = defaultLayout;
      wasReset = true;
      // Write the new default layout so it persists
      if (layout) {
        try { writeLayoutFile(layout); } catch { /* ignore */ }
      }
    }
  }

  win.webContents.send('layoutLoaded', {
    type: 'layoutLoaded',
    layout,
    wasReset,
  });
}

// ── IPC handlers ─────────────────────────────────────────────

function setupIpcHandlers(): void {
  ipcMain.on('webviewReady', () => {
    if (!mainWindow) return;

    // Send settings
    mainWindow.webContents.send('settingsLoaded', {
      type: 'settingsLoaded',
      soundEnabled: store.get('soundEnabled'),
      watchAllSessions: store.get('watchAllSessions'),
      alwaysShowLabels: store.get('alwaysShowLabels'),
      hooksEnabled: store.get('hooksEnabled'),
      hooksInfoShown: store.get('hooksInfoShown'),
      lastSeenVersion: store.get('lastSeenVersion'),
      extensionVersion: app.getVersion(),
      externalAssetDirectories: store.get('externalAssetDirectories'),
      locale: store.get('locale'),
    });

    // Load and send assets, then handle --dir CLI argument and restore persisted agents
    loadAndSendAssets().then(() => {
      if (!mainWindow) return;

      // Restore persisted agents from previous session
      const persisted = readPersistedAgents();
      if (persisted.length > 0) {
        const agentIds = persisted.map((a) => a.id);
        const agentMeta: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {};
        const folderNames: Record<number, string> = {};
        for (const a of persisted) {
          agentMeta[a.id] = { palette: a.palette, hueShift: a.hueShift, seatId: a.seatId ?? undefined };
          folderNames[a.id] = a.projectName;
        }
        // Ensure sessionManager.nextId won't collide with restored agent IDs
        const maxId = Math.max(...agentIds);
        sessionManager.ensureNextIdAbove(maxId);

        mainWindow.webContents.send('existingAgents', {
          type: 'existingAgents',
          agents: agentIds,
          agentMeta,
          folderNames,
        });
      }

      if (cliDir && mainWindow) {
        const resolvedDir = path.resolve(cliDir);
        if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
          const session = sessionManager.createSession({ workDir: resolvedDir });
          if (!session) {
            console.error('[Main] Failed to create session for --dir:', resolvedDir);
            return;
          }
          mainWindow.webContents.send('agentCreated', {
            type: 'agentCreated',
            id: session.id,
            folderName: session.projectName,
            sessionId: session.sessionId,
            workDir: session.workDir,
          });

          // Persist agent immediately
          const cliSeats = agentStore.get('seats');
          const cliSeat = cliSeats[session.id];
          upsertPersistedAgent({
            id: session.id,
            sessionId: session.sessionId,
            workDir: session.workDir,
            projectName: session.projectName,
            palette: cliSeat?.palette ?? 0,
            hueShift: cliSeat?.hueShift ?? 0,
            seatId: cliSeat?.seatId ?? null,
          });
        }
      }
    }).catch(console.error);
  });

  ipcMain.on('openSessionsFolder', () => {
    const dir = getDataDir();
    if (fs.existsSync(dir)) {
      shell.openPath(dir);
    }
  });

  ipcMain.on('openClaude', async (_event, msg: Record<string, unknown>) => {
    if (!mainWindow) return;

    let folderPath = msg?.folderPath as string | undefined;
    const resume = msg?.resume as boolean | undefined;
    const continueSession = msg?.continueSession as boolean | undefined;
    const bypassPermissions = msg?.bypassPermissions as boolean | undefined;

    // Only show the folder dialog when no folderPath was provided
    if (!folderPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select workspace folder for Claude Code',
      });
      if (!mainWindow) return;
      if (result.canceled || result.filePaths.length === 0) return;
      folderPath = result.filePaths[0];
    } else {
      // Validate renderer-supplied path
      const resolved = path.resolve(folderPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
      folderPath = resolved;
    }

    const session = sessionManager.createSession({
      workDir: folderPath,
      resume,
      continueSession,
      bypassPermissions,
    });
    if (!session) {
      dialog.showErrorBox('Failed to start session',
        'Could not start Claude Code. Make sure the "claude" CLI is installed and on your PATH.');
      return;
    }
    mainWindow.webContents.send('agentCreated', {
      type: 'agentCreated',
      id: session.id,
      folderName: session.projectName,
      sessionId: session.sessionId,
      workDir: session.workDir,
    });

    // Persist agent immediately so it survives app restart
    const seats = agentStore.get('seats');
    const seat = seats[session.id];
    upsertPersistedAgent({
      id: session.id,
      sessionId: session.sessionId,
      workDir: session.workDir,
      projectName: session.projectName,
      palette: seat?.palette ?? 0,
      hueShift: seat?.hueShift ?? 0,
      seatId: seat?.seatId ?? null,
    });
  });

  ipcMain.on('focusAgent', (_event, msg: Record<string, unknown>) => {
    console.log('[Main] focusAgent:', msg?.id);
  });

  ipcMain.on('closeAgent', (_event, msg: Record<string, unknown>) => {
    const id = msg?.id as number;
    if (id === undefined || id === null) return;
    sessionManager.destroySession(id);
    removePersistedAgent(id);
    if (mainWindow) {
      mainWindow.webContents.send('agentClosed', { type: 'agentClosed', id });
    }
  });

  ipcMain.on('saveLayout', (_event, msg: Record<string, unknown>) => {
    const layout = msg?.layout as Record<string, unknown> | undefined;
    if (layout) {
      try {
        writeLayoutFile(layout);
      } catch (err) {
        console.error('[Main] Error saving layout:', err);
      }
    }
  });

  ipcMain.on('saveAgentSeats', (_event, msg: Record<string, unknown>) => {
    const seats = msg?.seats as AgentsData['seats'] | undefined;
    if (seats) {
      agentStore.set('seats', seats);
    }
  });

  ipcMain.on('exportLayout', async () => {
    if (!mainWindow) return;
    const layout = readLayoutFile();
    if (!layout) return;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'pixel-agents-layout.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(layout, null, 2), 'utf-8');
    }
  });

  ipcMain.on('importLayout', async () => {
    if (!mainWindow) return;
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!mainWindow) return;
    if (result.canceled || result.filePaths.length === 0) return;
    try {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const imported = JSON.parse(content) as Record<string, unknown>;
      if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
        console.error('[Main] Invalid layout file');
        return;
      }
      writeLayoutFile(imported);
      mainWindow.webContents.send('layoutLoaded', {
        type: 'layoutLoaded',
        layout: imported,
        wasReset: false,
      });
    } catch (err) {
      console.error('[Main] Error importing layout:', err);
    }
  });

  // ── Settings persistence ───────────────────────────────────

  ipcMain.on('setSoundEnabled', (_event, msg: Record<string, unknown>) => {
    store.set('soundEnabled', Boolean(msg?.enabled ?? true));
  });

  ipcMain.on('setWatchAllSessions', (_event, msg: Record<string, unknown>) => {
    store.set('watchAllSessions', Boolean(msg?.enabled ?? false));
  });

  ipcMain.on('setAlwaysShowLabels', (_event, msg: Record<string, unknown>) => {
    store.set('alwaysShowLabels', Boolean(msg?.enabled ?? false));
  });

  ipcMain.on('setHooksEnabled', (_event, msg: Record<string, unknown>) => {
    store.set('hooksEnabled', Boolean(msg?.enabled ?? true));
  });

  ipcMain.on('setHooksInfoShown', () => {
    store.set('hooksInfoShown', true);
  });

  ipcMain.on('setLocale', (_event, msg: Record<string, unknown>) => {
    if (typeof msg?.locale === 'string') {
      store.set('locale', msg.locale);
      monitorAgent.setLocale(msg.locale);
    }
  });

  ipcMain.on('setLastSeenVersion', (_event, msg: Record<string, unknown>) => {
    if (typeof msg?.version === 'string') {
      store.set('lastSeenVersion', msg.version);
    }
  });

  ipcMain.on('addExternalAssetDirectory', async () => {
    if (!mainWindow) return;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select external asset directory',
    });
    if (!mainWindow) return;
    if (result.canceled || result.filePaths.length === 0) return;
    const dirs = store.get('externalAssetDirectories') as string[];
    const newDir = result.filePaths[0];
    if (!dirs.includes(newDir)) {
      dirs.push(newDir);
      store.set('externalAssetDirectories', dirs);
      mainWindow.webContents.send('externalAssetDirectoriesUpdated', {
        type: 'externalAssetDirectoriesUpdated',
        dirs,
      });
    }
  });

  ipcMain.on('removeExternalAssetDirectory', (_event, msg: Record<string, unknown>) => {
    if (!mainWindow) return;
    const removePath = msg?.path as string;
    if (!removePath) return;
    const dirs = (store.get('externalAssetDirectories') as string[]).filter((d) => d !== removePath);
    store.set('externalAssetDirectories', dirs);
    mainWindow.webContents.send('externalAssetDirectoriesUpdated', {
      type: 'externalAssetDirectoriesUpdated',
      dirs,
    });
  });

  // ── Plugin panel ─────────────────────────────────────────

  ipcMain.on('open-plugin-panel', (_event, msg: Record<string, unknown>) => {
    // Support both pluginId and furnitureId lookups
    let pluginId = msg?.pluginId as string | undefined;
    const furnitureId = msg?.furnitureId as string | undefined;

    // If furnitureId is provided, find the plugin that owns it
    if (!pluginId && furnitureId) {
      pluginId = pluginLoader.getPluginIdByFurnitureId(furnitureId);
    }
    if (!pluginId) return;

    const plugin = pluginLoader.getPlugin(pluginId);
    if (!plugin) {
      console.warn(`[Main] Plugin not found: ${pluginId}`);
      return;
    }

    const panelPath = pluginLoader.getPluginPanelPath(pluginId);
    if (!panelPath || !fs.existsSync(panelPath)) {
      console.warn(`[Main] Plugin panel not found: ${panelPath}`);
      return;
    }

    const size = plugin.manifest.panelSize ?? { width: 400, height: 500 };
    const panelWindow = new BrowserWindow({
      width: size.width,
      height: size.height,
      resizable: true,
      title: plugin.manifest.name,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    panelWindow.loadFile(panelPath);
  });

  // ── Terminal IPC ─────────────────────────────────────────

  ipcMain.on('open-terminal', (_event, msg: Record<string, unknown>) => {
    const id = msg?.agentId as number;
    if (id === undefined || id === null) return;
    activeTerminals.add(id);

    // If no active pty exists for this agent (persisted but not running), start a fresh session
    if (!sessionManager.hasSession(id)) {
      const persisted = readPersistedAgents();
      const agent = persisted.find((a) => a.id === id);
      if (agent) {
        // Start a brand new claude session (don't try to resume — the old pty is gone)
        const session = sessionManager.reconnectSession(id, agent.workDir);
        if (!session) {
          console.error('[Main] Failed to create session for agent:', id);
        }
      }
    }
  });

  ipcMain.on('pty-input', (_event, msg: Record<string, unknown>) => {
    const id = msg?.agentId as number;
    const data = msg?.data as string;
    if (id === undefined || id === null || data === undefined) return;
    sessionManager.writeToPty(id, data);
  });

  ipcMain.on('close-terminal', (_event, msg: Record<string, unknown>) => {
    const id = msg?.agentId as number;
    if (id === undefined || id === null) return;
    activeTerminals.delete(id);
  });

  ipcMain.on('resize-pty', (_event, msg: Record<string, unknown>) => {
    const id = msg?.agentId as number;
    const cols = msg?.cols as number;
    const rows = msg?.rows as number;
    if (id === undefined || id === null || !cols || !rows) return;
    sessionManager.resizePty(id, cols, rows);
  });

  // ── Monitor IPC ───────────────────────────────────────────

  ipcMain.handle('toggle-monitor', (_event, msg: Record<string, unknown> | undefined) => {
    const enable = msg?.enable as boolean | undefined;
    if (enable === false) {
      monitorAgent.stop();
    } else {
      monitorAgent.start();
    }
    return { running: enable !== false };
  });

  ipcMain.handle('get-summaries', () => {
    return monitorAgent.getSummaries();
  });
}

// ── CLI argument parsing ─────────────────────────────────────

function parseDirArg(): string | null {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && i + 1 < args.length) {
      return args[i + 1];
    }
    if (args[i].startsWith('--dir=')) {
      return args[i].slice('--dir='.length);
    }
  }
  return null;
}

const cliDir = parseDirArg();

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  monitorAgent.stop();

  // Update persisted agents with latest seat metadata before exiting.
  // We start from the already-persisted list (which was kept up-to-date via
  // upsertPersistedAgent / removePersistedAgent) and just refresh seat info
  // from the agent store so that palette/hue/seat changes made during this
  // session are saved.
  const existingPersisted = readPersistedAgents();
  const seats = agentStore.get('seats');
  const updatedPersisted = existingPersisted.map((a) => {
    const seat = seats[a.id];
    return {
      ...a,
      palette: seat?.palette ?? a.palette,
      hueShift: seat?.hueShift ?? a.hueShift,
      seatId: seat?.seatId ?? a.seatId,
    };
  });
  writePersistedAgents(updatedPersisted);

  // Send Ctrl+C to each pty before killing
  const allSessions = sessionManager.getAllSessions();
  for (const s of allSessions) {
    try { sessionManager.writeToPty(s.id, '\x03'); } catch { /* ignore */ }
  }
  sessionManager.destroyAll();

  if (process.platform !== 'darwin') app.quit();
});
