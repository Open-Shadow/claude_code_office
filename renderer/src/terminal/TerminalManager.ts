import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';

const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as
  | { send(channel: string, data: unknown): void; on(channel: string, callback: (...args: unknown[]) => void): void }
  | undefined;

const TERMINAL_THEME = {
  background: '#1e1e2e',
  foreground: '#a6e3a1',
  cursor: '#a6e3a1',
  cursorAccent: '#1e1e2e',
  selectionBackground: '#a6e3a166',
  black: '#0a0a14',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#cdd6f4',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#cdd6f4',
};

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  /** The container element the terminal is currently attached to (null when detached). */
  container: HTMLElement | null;
}

export class TerminalManager {
  private terminals: Map<number, TerminalEntry> = new Map();

  /**
   * Create a new terminal for `agentId`, or re-attach an existing one to `container`.
   * Returns the Terminal instance (new or existing).
   */
  createTerminal(agentId: number, container: HTMLElement): Terminal {
    const existing = this.terminals.get(agentId);
    if (existing) {
      // Re-attach: move the xterm DOM into the new container
      const xtermEl = existing.terminal.element;
      if (xtermEl) {
        container.appendChild(xtermEl);
      }
      existing.container = container;

      // Re-fit after a frame
      requestAnimationFrame(() => {
        try {
          existing.fitAddon.fit();
          const dims = existing.fitAddon.proposeDimensions();
          if (dims) {
            electronAPI?.send('resize-pty', { agentId, cols: dims.cols, rows: dims.rows });
          }
        } catch { /* container might not be visible yet */ }
      });
      return existing.terminal;
    }

    const terminal = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Web links — make URLs clickable
    try {
      terminal.loadAddon(new WebLinksAddon());
    } catch (err) {
      console.warn('[TerminalManager] Failed to load WebLinksAddon:', err);
    }

    // Unicode11 — CJK and emoji wide-character support
    try {
      const unicode11 = new Unicode11Addon();
      terminal.loadAddon(unicode11);
      terminal.unicode.activeVersion = '11';
    } catch (err) {
      console.warn('[TerminalManager] Failed to load Unicode11Addon:', err);
    }

    // Search addon
    const searchAddon = new SearchAddon();
    try {
      terminal.loadAddon(searchAddon);
    } catch (err) {
      console.warn('[TerminalManager] Failed to load SearchAddon:', err);
    }

    const entry: TerminalEntry = { terminal, fitAddon, searchAddon, container };

    terminal.open(container);

    // Fit after a short delay so the container has layout dimensions.
    // Use setTimeout instead of requestAnimationFrame — rAF can fire before
    // the Electron compositor has finished layout, resulting in 0-size container.
    setTimeout(() => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          electronAPI?.send('resize-pty', { agentId, cols: dims.cols, rows: dims.rows });
        }
      } catch {
        // container might not be visible yet
      }
    }, 50);

    // Forward user input to the main process pty
    terminal.onData((data) => {
      electronAPI?.send('pty-input', { agentId, data });
    });

    // Notify main process of resize
    terminal.onResize(({ cols, rows }) => {
      electronAPI?.send('resize-pty', { agentId, cols, rows });
    });

    this.terminals.set(agentId, entry);
    return terminal;
  }

  /**
   * Detach the terminal DOM from its container without destroying the instance.
   * The terminal keeps running and buffering output.
   */
  detachTerminal(agentId: number): void {
    const entry = this.terminals.get(agentId);
    if (entry && entry.container) {
      const xtermEl = entry.terminal.element;
      if (xtermEl && xtermEl.parentElement === entry.container) {
        entry.container.removeChild(xtermEl);
      }
      entry.container = null;
    }
  }

  destroyTerminal(agentId: number): void {
    const entry = this.terminals.get(agentId);
    if (entry) {
      entry.terminal.dispose();
      this.terminals.delete(agentId);
    }
  }

  getTerminal(agentId: number): Terminal | undefined {
    return this.terminals.get(agentId)?.terminal;
  }

  getSearchAddon(agentId: number): SearchAddon | undefined {
    return this.terminals.get(agentId)?.searchAddon;
  }

  hasTerminal(agentId: number): boolean {
    return this.terminals.has(agentId);
  }

  writeToTerminal(agentId: number, data: string): void {
    const entry = this.terminals.get(agentId);
    if (entry) {
      entry.terminal.write(data);
    }
  }

  resizeTerminal(agentId: number): void {
    const entry = this.terminals.get(agentId);
    if (entry) {
      try {
        entry.fitAddon.fit();
      } catch {
        // ignore if container is not visible
      }
    }
  }
}
