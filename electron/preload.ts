/**
 * Electron preload script.
 *
 * Uses contextBridge to expose a safe `electronAPI` object to the renderer
 * process. Only whitelisted IPC channels are permitted.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Whitelisted channels ─────────────────────────────────────

/** Channels the renderer may send TO the main process. */
const SEND_CHANNELS = [
  'webviewReady',
  'openClaude',
  'focusAgent',
  'saveLayout',
  'saveAgentSeats',
  'exportLayout',
  'importLayout',
  'setSoundEnabled',
  'setWatchAllSessions',
  'setAlwaysShowLabels',
  'setHooksEnabled',
  'addExternalAssetDirectory',
  'removeExternalAssetDirectory',
  'setLastSeenVersion',
  'setHooksInfoShown',
  'closeAgent',
  'open-terminal',
  'pty-input',
  'close-terminal',
  'resize-pty',
  'open-plugin-panel',
  'openSessionsFolder',
  'setLocale',
] as const;

/** Channels the main process may send TO the renderer. */
const RECEIVE_CHANNELS = [
  'agentCreated',
  'agentClosed',
  'agentToolStart',
  'agentToolDone',
  'agentToolsClear',
  'agentStatus',
  'agentSelected',
  'agentToolPermission',
  'agentToolPermissionClear',
  'existingAgents',
  'layoutLoaded',
  'settingsLoaded',
  'furnitureAssetsLoaded',
  'characterSpritesLoaded',
  'floorTilesLoaded',
  'wallTilesLoaded',
  'workspaceFolders',
  'externalAssetDirectoriesUpdated',
  'subagentToolStart',
  'subagentToolDone',
  'subagentClear',
  'subagentToolPermission',
  'agentTeamInfo',
  'agentTokenUsage',
  'pty-data',
  'monitor-update',
] as const;

/** Channels the renderer may invoke (request/response) on the main process. */
const INVOKE_CHANNELS = [
  'toggle-monitor',
  'get-summaries',
] as const;

const sendSet = new Set<string>(SEND_CHANNELS);
const receiveSet = new Set<string>(RECEIVE_CHANNELS);
const invokeSet = new Set<string>(INVOKE_CHANNELS);

// Map original callbacks to their IPC wrappers so removeListener can find the right function
const listenerMap = new WeakMap<(...args: unknown[]) => void, (...args: unknown[]) => void>();

// ── Expose API ───────────────────────────────────────────────

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Send a message from renderer to main.
   * Only whitelisted channels are forwarded.
   */
  send(channel: string, data: unknown): void {
    if (sendSet.has(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`[preload] Blocked send on unknown channel: ${channel}`);
    }
  },

  /**
   * Listen for messages from main to renderer.
   * Only whitelisted channels are permitted.
   */
  on(channel: string, callback: (...args: unknown[]) => void): void {
    if (receiveSet.has(channel)) {
      // Strip the IpcRendererEvent — renderer only cares about the data payload
      const wrapper = (_event: unknown, ...args: unknown[]) => callback(...args);
      listenerMap.set(callback, wrapper);
      ipcRenderer.on(channel, wrapper as Parameters<typeof ipcRenderer.on>[1]);
    } else {
      console.warn(`[preload] Blocked listener on unknown channel: ${channel}`);
    }
  },

  /**
   * Remove a previously-registered listener.
   */
  removeListener(channel: string, callback: (...args: unknown[]) => void): void {
    if (receiveSet.has(channel)) {
      const wrapper = listenerMap.get(callback);
      if (wrapper) {
        ipcRenderer.removeListener(channel, wrapper as Parameters<typeof ipcRenderer.removeListener>[1]);
        listenerMap.delete(callback);
      }
    }
  },

  /**
   * Invoke a handler on the main process and return the result.
   * Only whitelisted invoke channels are permitted.
   */
  invoke(channel: string, data?: unknown): Promise<unknown> {
    if (invokeSet.has(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    console.warn(`[preload] Blocked invoke on unknown channel: ${channel}`);
    return Promise.resolve(null);
  },
});
