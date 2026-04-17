import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// ── Types ────────────────────────────────────────────────────

export interface SessionSummaryData {
  agentId: number;
  projectName: string;
  agentName?: string;
  summary: string;
  lastActive: number;
}

interface MonitorPanelProps {
  summaries: SessionSummaryData[];
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────

function statusColor(lastActive: number): string {
  const elapsed = Date.now() - lastActive;
  if (elapsed < 30_000) return '#50fa7b'; // green
  if (elapsed < 120_000) return '#f1fa8c'; // yellow
  return '#6272a4'; // gray
}

// ── Component ────────────────────────────────────────────────

export function MonitorPanel({ summaries, onClose }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  // Force re-render every 10s to update relative times
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Position & size state
  const [pos, setPos] = useState({ x: Math.round(window.innerWidth / 2 - 220), y: 12 });
  const [size, setSize] = useState({ w: 440, h: 520 });

  // Drag state (title bar)
  const isDragging = useRef(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  // Resize state (bottom-right corner)
  const isResizing = useRef(false);
  const resizeStart = useRef({ mouseX: 0, mouseY: 0, w: 0, h: 0 });

  const handleToggle = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  function relativeTime(timestamp: number): string {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return t('monitor.justNow');
    if (diff < 60) return t('monitor.secondsAgo', { count: diff });
    if (diff < 3600) return t('monitor.minutesAgo', { count: Math.floor(diff / 60) });
    return t('monitor.hoursAgo', { count: Math.floor(diff / 3600) });
  }

  // ── Drag handling ──
  const onTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
        const newW = Math.max(280, resizeStart.current.w + ev.clientX - resizeStart.current.mouseX);
        const newH = Math.max(200, resizeStart.current.h + ev.clientY - resizeStart.current.mouseY);
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

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        zIndex: 60,
        fontFamily: "'FS Pixel Sans', monospace",
        background: '#1e1e2e',
        border: '2px solid var(--pixel-border, #44475a)',
        imageRendering: 'pixelated',
      }}
    >
      {/* Title bar (draggable) */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          background: '#282a36',
          borderBottom: collapsed ? 'none' : '2px solid var(--pixel-border, #44475a)',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 16,
            color: '#bd93f9',
            letterSpacing: 1,
            cursor: 'pointer',
          }}
          onClick={handleToggle}
        >
          {collapsed ? '+ ' : '- '}{t('monitor.title')}
        </span>
        <button
          data-close-btn
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: 'none',
            border: '1px solid #ff5555',
            color: '#ff5555',
            fontSize: 12,
            cursor: 'pointer',
            padding: '2px 4px',
            fontFamily: 'inherit',
            lineHeight: 1,
          }}
        >
          X
        </button>
      </div>

      {/* Session list */}
      {!collapsed && (
        <div style={{ height: size.h - 40, overflowY: 'auto', padding: '6px 0' }}>
          {summaries.length === 0 ? (
            <div
              style={{
                padding: '12px 10px',
                fontSize: 13,
                color: '#6272a4',
                textAlign: 'center',
              }}
            >
              {t('monitor.noSessions')}
            </div>
          ) : (
            summaries.map((s) => (
              <div
                key={s.agentId}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid #333549',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {/* Status dot */}
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: 0,
                      background: statusColor(s.lastActive),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      color: '#f8f8f2',
                      fontWeight: 'bold',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {s.agentName || s.projectName}
                  </span>
                  <span style={{ fontSize: 11, color: '#6272a4', flexShrink: 0 }}>
                    {relativeTime(s.lastActive)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#ccc',
                    lineHeight: 1.4,
                    paddingLeft: 12,
                    wordBreak: 'break-word',
                  }}
                >
                  {s.summary}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Resize handle (bottom-right corner) */}
      {!collapsed && (
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
      )}
    </div>
  );
}
