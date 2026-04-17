/**
 * SessionManager — manages Claude Code CLI sessions via node-pty.
 *
 * Each session spawns a pty running `claude --session-id <uuid>` in a given
 * working directory. Sessions are persisted to <appRoot>/data/sessions.json
 * so they can be listed on restart (though the pty processes themselves are
 * not restorable).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';

// ── Types ────────────────────────────────────────────────────

export interface CreateSessionOptions {
  workDir: string;
  resume?: boolean;
  continueSession?: boolean;
  sessionId?: string;
  bypassPermissions?: boolean;
}

export interface SessionInfo {
  id: number;
  sessionId: string;
  workDir: string;
  projectName: string;
}

interface SessionEntry extends SessionInfo {
  pty: pty.IPty;
}

interface PersistedSession {
  id: number;
  sessionId: string;
  workDir: string;
}

export interface SessionCallbacks {
  dataDir: string;
  onData: (agentId: number, data: string) => void;
  onExit: (agentId: number, exitCode: number, signal?: number) => void;
}

// ── Persistence path ─────────────────────────────────────────

const SESSIONS_FILE = 'sessions.json';

// ── SessionManager ───────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<number, SessionEntry>();
  private nextId = 1;
  private callbacks: SessionCallbacks;

  constructor(callbacks: SessionCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Create a new Claude Code session in the given working directory.
   * Spawns a pty running `claude` with appropriate flags.
   * Returns null if the pty could not be spawned.
   */
  createSession(opts: CreateSessionOptions): SessionInfo | null {
    const { workDir, resume, continueSession, bypassPermissions } = opts;
    const id = this.nextId++;
    const sessionId = opts.sessionId ?? crypto.randomUUID();
    const projectName = path.basename(workDir);

    // Build the claude CLI flags
    const claudeArgs: string[] = ['claude'];
    if (resume) {
      claudeArgs.push('--resume');
    } else if (continueSession) {
      claudeArgs.push('--continue');
    } else {
      claudeArgs.push('--session-id', sessionId);
    }
    if (bypassPermissions) {
      claudeArgs.push('--dangerously-skip-permissions');
    }

    // Determine shell and args per platform
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
    const shellArgs = isWindows
      ? ['/c', ...claudeArgs]
      : ['-c', claudeArgs.join(' ')];

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: workDir,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      console.error(`[SessionManager] Failed to spawn pty for ${workDir}:`, err);
      return null;
    }

    const entry: SessionEntry = {
      id,
      sessionId,
      workDir,
      projectName,
      pty: ptyProcess,
    };

    ptyProcess.onData((data: string) => {
      this.callbacks.onData(id, data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      // Only fire onExit callback if the session hasn't already been destroyed
      // (destroySession deletes the entry and sends its own agentClosed event)
      if (this.sessions.has(id)) {
        this.callbacks.onExit(id, exitCode, signal);
        this.sessions.delete(id);
        this.persist();
      }
    });

    this.sessions.set(id, entry);
    this.persist();

    return { id, sessionId, workDir, projectName };
  }

  /**
   * Kill and remove a session by agent id.
   */
  destroySession(id: number): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch {
      // pty may already be dead
    }
    this.sessions.delete(id);
    this.persist();
  }

  /**
   * Get info for a single session (without exposing the pty instance).
   */
  getSession(id: number): SessionInfo | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    return {
      id: entry.id,
      sessionId: entry.sessionId,
      workDir: entry.workDir,
      projectName: entry.projectName,
    };
  }

  /**
   * Get info for all active sessions.
   */
  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      workDir: e.workDir,
      projectName: e.projectName,
    }));
  }

  /**
   * Write data to a session's pty stdin.
   */
  writeToPty(id: number, data: string): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.pty.write(data);
  }

  /**
   * Resize a session's pty.
   */
  resizePty(id: number, cols: number, rows: number): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.pty.resize(cols, rows);
  }

  /**
   * Destroy all active sessions. Called on app exit.
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }

  /**
   * Check whether a session with the given id has an active pty.
   */
  hasSession(id: number): boolean {
    return this.sessions.has(id);
  }

  /**
   * Ensure nextId is above the given value to avoid ID collisions
   * with restored agents that don't have active pty sessions yet.
   */
  ensureNextIdAbove(id: number): void {
    if (id >= this.nextId) {
      this.nextId = id + 1;
    }
  }

  /**
   * Reconnect a persisted agent by spawning a new pty with `claude --continue`.
   * When originalSessionId is provided, uses `--continue --session-id` to resume the exact session.
   * Without originalSessionId, uses `--resume` to resume the most recent session.
   * Returns session info on success, null on failure.
   */
  reconnectSession(id: number, workDir: string, originalSessionId?: string): SessionInfo | null {
    // If a session with this id already exists, just return its info
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      return { id: existing.id, sessionId: existing.sessionId, workDir: existing.workDir, projectName: existing.projectName };
    }

    const projectName = path.basename(workDir);
    const sessionId = originalSessionId ?? crypto.randomUUID();

    const claudeArgs = originalSessionId
      ? ['claude', '--continue', '--session-id', originalSessionId]
      : ['claude', '--resume'];

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
    const shellArgs = isWindows
      ? ['/c', ...claudeArgs]
      : ['-c', claudeArgs.join(' ')];

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: workDir,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      console.error(`[SessionManager] Failed to spawn reconnect pty for ${workDir}:`, err);
      return null;
    }

    // Ensure nextId stays above this id to avoid collisions
    if (id >= this.nextId) {
      this.nextId = id + 1;
    }

    const entry: SessionEntry = {
      id,
      sessionId,
      workDir,
      projectName,
      pty: ptyProcess,
    };

    ptyProcess.onData((data: string) => {
      this.callbacks.onData(id, data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (this.sessions.has(id)) {
        this.callbacks.onExit(id, exitCode, signal);
        this.sessions.delete(id);
        this.persist();
      }
    });

    this.sessions.set(id, entry);
    this.persist();

    return { id, sessionId, workDir, projectName };
  }

  // ── Persistence ──────────────────────────────────────────

  private persist(): void {
    const data: PersistedSession[] = Array.from(this.sessions.values()).map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      workDir: e.workDir,
    }));
    const dir = this.callbacks.dataDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, SESSIONS_FILE);
    try {
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      console.error('[SessionManager] Error persisting sessions:', err);
    }
  }
}
