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
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#a6e3a1',
  waiting: '#f9e2af',
  idle: '#6c7086',
};

// Shared manager instance across all dialogs
const terminalManager = new TerminalManager();

export function TerminalDialog({ agentId, projectName, status, onClose }: TerminalDialogProps) {
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

  // Set up terminal and IPC listener
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    terminalManager.createTerminal(agentId, container);

    // Tell main process to start sending pty data
    electronAPI?.send('open-terminal', { agentId });

    // Listen for pty-data
    const handlePtyData = (data: unknown) => {
      const msg = data as { agentId?: number; data?: string };
      if (msg.agentId === agentId && msg.data) {
        terminalManager.writeToTerminal(agentId, msg.data);
      }
    };
    electronAPI?.on('pty-data', handlePtyData);

    return () => {
      electronAPI?.removeListener('pty-data', handlePtyData);
      electronAPI?.send('close-terminal', { agentId });
      terminalManager.destroyTerminal(agentId);
    };
  }, [agentId]);

  // Re-fit terminal when dialog size changes
  useEffect(() => {
    // Delay a frame so the container has updated dimensions
    const raf = requestAnimationFrame(() => {
      terminalManager.resizeTerminal(agentId);
    });
    return () => cancelAnimationFrame(raf);
  }, [size, agentId]);

  // ── Drag handling ──
  const onTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't start drag on the close button
      if ((e.target as HTMLElement).closest('[data-close-btn]')) return;
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
        display: 'flex',
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

      {/* Terminal area */}
      <div
        ref={terminalContainerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
        }}
      />

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
