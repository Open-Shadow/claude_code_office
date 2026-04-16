import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

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
}

export class TerminalManager {
  private terminals: Map<number, TerminalEntry> = new Map();

  createTerminal(agentId: number, container: HTMLElement): Terminal {
    // If a terminal already exists for this agent, destroy it first
    if (this.terminals.has(agentId)) {
      this.destroyTerminal(agentId);
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

    terminal.open(container);

    // Fit after a frame so the container has layout dimensions
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        // Explicitly notify main process of actual terminal size after fit
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          electronAPI?.send('resize-pty', { agentId, cols: dims.cols, rows: dims.rows });
        }
      } catch {
        // container might not be visible yet
      }
    });

    // Forward user input to the main process pty
    terminal.onData((data) => {
      electronAPI?.send('pty-input', { agentId, data });
    });

    // Notify main process of resize
    terminal.onResize(({ cols, rows }) => {
      electronAPI?.send('resize-pty', { agentId, cols, rows });
    });

    this.terminals.set(agentId, { terminal, fitAddon });
    return terminal;
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
