import '@xterm/xterm/css/xterm.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TerminalManager } from './TerminalManager.js';

const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as
  | {
      send(channel: string, data: unknown): void;
      on(channel: string, callback: (...args: unknown[]) => void): void;
      removeListener(channel: string, callback: (...args: unknown[]) => void): void;
    }
  | undefined;

interface TerminalDialogProps {
  agentId: number;
  projectName: string;
  status: string; // 'active' | 'waiting' | 'idle'
  visible: boolean;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#a6e3a1',
  waiting: '#f9e2af',
  idle: '#6c7086',
};

// Shared manager instance across all dialogs
const terminalManager = new TerminalManager();

// ── Context menu styles ──
const CONTEXT_MENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  zIndex: 200,
  background: '#181825',
  border: '2px solid #3a3a5c',
  boxShadow: '4px 4px 0px #0a0a14',
  padding: '4px 0',
  minWidth: 140,
  fontFamily: "'FS Pixel Sans', monospace",
  fontSize: 13,
  color: '#cdd6f4',
};

const CONTEXT_MENU_ITEM_STYLE: React.CSSProperties = {
  padding: '6px 16px',
  cursor: 'pointer',
  userSelect: 'none',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export { terminalManager };

export function TerminalDialog({ agentId, projectName, status, visible, onClose }: TerminalDialogProps) {
  const { t } = useTranslation();
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Position and size state
  const [pos, setPos] = useState({ x: Math.round(window.innerWidth / 2 - 400), y: Math.round(window.innerHeight / 2 - 250) });
  const [size, setSize] = useState({ w: 800, h: 500 });

  // Drag state (title bar)
  const isDragging = useRef(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  // Resize state (bottom-right corner)
  const isResizing = useRef(false);
  const resizeStart = useRef({ mouseX: 0, mouseY: 0, w: 0, h: 0 });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Search bar state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Set up terminal and IPC listener
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    // Always create a fresh terminal (destroy any stale cached instance first)
    terminalManager.destroyTerminal(agentId);

    // Delay terminal creation slightly so the container has settled its layout
    // dimensions. In Electron, the first paint sometimes happens before the
    // compositor finishes layout, causing xterm to open into a 0×0 area.
    const initTimer = setTimeout(() => {
      if (!terminalContainerRef.current) return;
      terminalManager.createTerminal(agentId, terminalContainerRef.current);

      // Tell main process to start sending pty data
      electronAPI?.send('open-terminal', { agentId });
    }, 30);

    // Listen for pty-data
    const handlePtyData = (data: unknown) => {
      const msg = data as { agentId?: number; data?: string };
      if (msg.agentId === agentId && msg.data) {
        terminalManager.writeToTerminal(agentId, msg.data);
      }
    };
    electronAPI?.on('pty-data', handlePtyData);

    return () => {
      clearTimeout(initTimer);
      electronAPI?.removeListener('pty-data', handlePtyData);
      electronAPI?.send('close-terminal', { agentId });
      terminalManager.detachTerminal(agentId);
    };
  }, [agentId]);

  // Re-fit terminal when dialog size changes or visibility changes
  useEffect(() => {
    if (!visible) return;
    // Delay a frame so the container has updated dimensions
    const raf = requestAnimationFrame(() => {
      terminalManager.resizeTerminal(agentId);
    });
    return () => cancelAnimationFrame(raf);
  }, [size, agentId, visible]);

  // Focus terminal when becoming visible
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        terminalManager.getTerminal(agentId)?.focus();
      });
    }
  }, [visible, agentId]);

  // Close context menu on any click outside
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener('click', dismiss, { once: true });
    return () => window.removeEventListener('click', dismiss);
  }, [contextMenu]);

  // Keyboard shortcut: Ctrl+Shift+F to toggle search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  // ── Context menu actions ──
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCopy = useCallback(() => {
    const terminal = terminalManager.getTerminal(agentId);
    if (terminal) {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
    setContextMenu(null);
  }, [agentId]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        electronAPI?.send('pty-input', { agentId, data: text });
      }
    } catch { /* clipboard access denied */ }
    setContextMenu(null);
  }, [agentId]);

  const handleSelectAll = useCallback(() => {
    const terminal = terminalManager.getTerminal(agentId);
    if (terminal) {
      terminal.selectAll();
    }
    setContextMenu(null);
  }, [agentId]);

  const handleSearchNext = useCallback(() => {
    if (!searchQuery) return;
    const addon = terminalManager.getSearchAddon(agentId);
    addon?.findNext(searchQuery);
  }, [agentId, searchQuery]);

  const handleSearchPrev = useCallback(() => {
    if (!searchQuery) return;
    const addon = terminalManager.getSearchAddon(agentId);
    addon?.findPrevious(searchQuery);
  }, [agentId, searchQuery]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handleSearchPrev();
      } else {
        handleSearchNext();
      }
    } else if (e.key === 'Escape') {
      setShowSearch(false);
      setSearchQuery('');
      terminalManager.getTerminal(agentId)?.focus();
    }
  }, [handleSearchNext, handleSearchPrev, agentId]);

  // ── Drag handling ──
  const onTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't start drag on the close button
      if ((e.target as HTMLElement).closest('[data-close-btn]')) return;
      if ((e.target as HTMLElement).closest('[data-search-btn]')) return;
      e.preventDefault();
      isDragging.current = true;
      dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, posX: pos.x, posY: pos.y };

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        setPos({
          x: dragStart.current.posX + ev.clientX - dragStart.current.mouseX,
          y: dragStart.current.posY + ev.clientY - dragStart.current.mouseY,
        });
      };
      const onUp = () => {
        isDragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [pos],
  );

  // ── Resize handling ──
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing.current = true;
      resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, w: size.w, h: size.h };

      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const newW = Math.max(400, resizeStart.current.w + ev.clientX - resizeStart.current.mouseX);
        const newH = Math.max(250, resizeStart.current.h + ev.clientY - resizeStart.current.mouseY);
        setSize({ w: newW, h: newH });
      };
      const onUp = () => {
        isResizing.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [size],
  );

  const handleClose = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
    onClose();
  }, [onClose]);

  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle;

  return (
    <div
      ref={dialogRef}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 100,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        border: '2px solid var(--pixel-border, #3a3a5c)',
        boxShadow: '4px 4px 0px #0a0a14',
        background: '#1e1e2e',
        borderRadius: 0,
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: '#181825',
          borderBottom: '2px solid var(--pixel-border, #3a3a5c)',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
          fontFamily: "'FS Pixel Sans', monospace",
          fontSize: 15,
          color: '#cdd6f4',
        }}
      >
        {/* Status dot */}
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: 0,
            background: statusColor,
            flexShrink: 0,
          }}
        />
        {/* Project name */}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName || t('common.agent', { id: agentId })}
        </span>
        {/* Search toggle button */}
        <button
          data-search-btn
          onClick={() => setShowSearch((v) => !v)}
          title="Search (Ctrl+Shift+F)"
          style={{
            background: 'none',
            border: '1px solid #585b70',
            color: '#cdd6f4',
            cursor: 'pointer',
            fontFamily: "'FS Pixel Sans', monospace",
            fontSize: 12,
            lineHeight: 1,
            padding: '2px 6px',
            flexShrink: 0,
          }}
        >
          {'\u{1F50D}'}
        </button>
        {/* Close button */}
        <button
          data-close-btn
          onClick={handleClose}
          style={{
            background: 'none',
            border: '1px solid #585b70',
            color: '#cdd6f4',
            cursor: 'pointer',
            fontFamily: "'FS Pixel Sans', monospace",
            fontSize: 12,
            lineHeight: 1,
            padding: '2px 6px',
            flexShrink: 0,
          }}
        >
          {t('terminal.close')}
        </button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: '#181825',
            borderBottom: '1px solid #3a3a5c',
            flexShrink: 0,
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            style={{
              flex: 1,
              background: '#1e1e2e',
              border: '1px solid #585b70',
              color: '#cdd6f4',
              fontFamily: "'Cascadia Code', 'Consolas', monospace",
              fontSize: 12,
              padding: '3px 8px',
              outline: 'none',
            }}
          />
          <button onClick={handleSearchPrev} style={searchBtnStyle} title="Previous (Shift+Enter)">&#x25B2;</button>
          <button onClick={handleSearchNext} style={searchBtnStyle} title="Next (Enter)">&#x25BC;</button>
          <button
            onClick={() => { setShowSearch(false); setSearchQuery(''); terminalManager.getTerminal(agentId)?.focus(); }}
            style={searchBtnStyle}
            title="Close search (Esc)"
          >
            &#x2715;
          </button>
        </div>
      )}

      {/* Terminal area */}
      <div
        ref={terminalContainerRef}
        onContextMenu={handleContextMenu}
        style={{
          flex: 1,
          overflow: 'hidden',
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
        }}
      />

      {/* Context menu */}
      {contextMenu && (
        <div style={{ ...CONTEXT_MENU_STYLE, left: contextMenu.x, top: contextMenu.y }}>
          <div
            style={CONTEXT_MENU_ITEM_STYLE}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#313244'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onClick={handleCopy}
          >
            <span>Copy</span>
            <span style={{ color: '#585b70', fontSize: 11 }}>Ctrl+C</span>
          </div>
          <div
            style={CONTEXT_MENU_ITEM_STYLE}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#313244'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onClick={handlePaste}
          >
            <span>Paste</span>
            <span style={{ color: '#585b70', fontSize: 11 }}>Ctrl+V</span>
          </div>
          <div style={{ height: 1, background: '#3a3a5c', margin: '4px 0' }} />
          <div
            style={CONTEXT_MENU_ITEM_STYLE}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#313244'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onClick={handleSelectAll}
          >
            <span>Select All</span>
            <span style={{ color: '#585b70', fontSize: 11 }}>Ctrl+A</span>
          </div>
        </div>
      )}

      {/* Resize handle (bottom-right corner) */}
      <div
        onMouseDown={onResizeMouseDown}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, #585b70 50%)',
        }}
      />
    </div>
  );
}

const searchBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #585b70',
  color: '#cdd6f4',
  cursor: 'pointer',
  fontSize: 11,
  lineHeight: 1,
  padding: '3px 6px',
  fontFamily: "'FS Pixel Sans', monospace",
};
