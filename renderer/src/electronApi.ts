/**
 * Electron API bridge for the renderer process.
 *
 * Replaces the VS Code webview `vscodeApi` pattern. Incoming IPC messages are
 * re-dispatched as `window MessageEvent` so the existing
 * `useExtensionMessages.ts` hook works unchanged.
 */

interface ElectronAPI {
  send(channel: string, data: unknown): void;
  on(channel: string, callback: (...args: unknown[]) => void): void;
  removeListener(channel: string, callback: (...args: unknown[]) => void): void;
  invoke(channel: string, data?: unknown): Promise<unknown>;
}

const electronAPI: ElectronAPI | undefined = (window as unknown as Record<string, unknown>)
  .electronAPI as ElectronAPI | undefined;

// ── Incoming channels ────────────────────────────────────────
// All channels the main process may send to the renderer. When a message
// arrives on any of these, we dispatch a `MessageEvent` on `window` with
// `data = { type: channel, ...payload }` so that the existing React hook
// (`useExtensionMessages`) picks it up via `window.addEventListener('message')`.

const INCOMING_CHANNELS = [
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

if (electronAPI) {
  for (const channel of INCOMING_CHANNELS) {
    electronAPI.on(channel, (data: unknown) => {
      // The main process sends the full message object as the first argument.
      // We ensure `type` is present so the handler can switch on it.
      const payload =
        data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const message = { type: channel, ...payload };
      window.dispatchEvent(new MessageEvent('message', { data: message }));
    });
  }
}

// ── Outgoing (renderer → main) ───────────────────────────────

/**
 * Drop-in replacement for the VS Code `acquireVsCodeApi().postMessage()`.
 * The message `type` field is used as the IPC channel name.
 */
export const vscode = {
  postMessage(msg: { type: string; [key: string]: unknown }): void {
    if (electronAPI) {
      electronAPI.send(msg.type, msg);
    } else {
      console.warn('[electronApi] electronAPI not available — running outside Electron?');
    }
  },
  invoke(channel: string, data?: unknown): Promise<unknown> {
    if (electronAPI) {
      return electronAPI.invoke(channel, data);
    }
    console.warn('[electronApi] electronAPI not available — running outside Electron?');
    return Promise.resolve(null);
  },
};
