/**
 * Runtime detection for Electron vs plain browser.
 *
 * When the Electron preload script runs, `window.electronAPI` is defined.
 * In a regular browser (dev mode without Electron, or static dist opened
 * directly), it is undefined.
 */
export const isBrowserRuntime = !(window as unknown as Record<string, unknown>).electronAPI;
