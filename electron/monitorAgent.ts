/**
 * MonitorAgent — reads Claude Code session logs and generates brief summaries
 * using the Claude API (claude-3-5-haiku) for each active session.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { SessionInfo } from './sessionManager.js';

// ── Types ────────────────────────────────────────────────────

export interface SessionSummary {
  agentId: number;
  projectName: string;
  summary: string;
  lastActive: number;
}

// ── MonitorAgent ─────────────────────────────────────────────

export class MonitorAgent {
  private interval: NodeJS.Timeout | null = null;
  private summaries = new Map<number, { projectName: string; summary: string; lastActive: number }>();
  private currentLocale: string = 'en';

  constructor(
    private getApiKey: () => string | null,
    private getSessions: () => SessionInfo[],
    private onUpdate?: (summaries: SessionSummary[]) => void,
  ) {}

  /** Update the locale used for generating summaries. */
  setLocale(locale: string): void {
    this.currentLocale = locale;
  }

  /** Start polling at the given interval (default 30 seconds). */
  start(intervalMs = 30_000): void {
    if (this.interval) return;
    // Run immediately, then on interval
    this.poll().catch(console.error);
    this.interval = setInterval(() => {
      this.poll().catch(console.error);
    }, intervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Return the current summaries snapshot. */
  getSummaries(): SessionSummary[] {
    return Array.from(this.summaries.entries()).map(([agentId, data]) => ({
      agentId,
      projectName: data.projectName,
      summary: data.summary,
      lastActive: data.lastActive,
    }));
  }

  // ── Private ──────────────────────────────────────────────

  private async poll(): Promise<void> {
    const sessions = this.getSessions();
    if (sessions.length === 0) return;

    const apiKey = this.resolveApiKey();

    // Clean up summaries for sessions that no longer exist
    const activeIds = new Set(sessions.map((s) => s.id));
    for (const id of this.summaries.keys()) {
      if (!activeIds.has(id)) this.summaries.delete(id);
    }

    for (const session of sessions) {
      try {
        const logExcerpt = this.readSessionLog(session);
        if (!logExcerpt) {
          this.summaries.set(session.id, {
            projectName: session.projectName,
            summary: 'No log data available',
            lastActive: Date.now(),
          });
          continue;
        }

        if (!apiKey) {
          this.summaries.set(session.id, {
            projectName: session.projectName,
            summary: 'API key not configured',
            lastActive: Date.now(),
          });
          continue;
        }

        const summary = await this.generateSummary(apiKey, logExcerpt);
        this.summaries.set(session.id, {
          projectName: session.projectName,
          summary,
          lastActive: Date.now(),
        });
      } catch (err) {
        console.error(`[MonitorAgent] Error polling session ${session.id}:`, err);
        // Don't crash — keep existing summary or set a fallback
        if (!this.summaries.has(session.id)) {
          this.summaries.set(session.id, {
            projectName: session.projectName,
            summary: 'Error reading session',
            lastActive: Date.now(),
          });
        }
      }
    }

    // Notify listener
    if (this.onUpdate) {
      this.onUpdate(this.getSummaries());
    }
  }

  /** Resolve API key from env, then from ~/.claude/.credentials. */
  private resolveApiKey(): string | null {
    // Prefer constructor-provided getter
    const fromGetter = this.getApiKey();
    if (fromGetter) return fromGetter;

    // Env var
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

    // ~/.claude/.credentials
    try {
      const credPath = path.join(os.homedir(), '.claude', '.credentials');
      if (fs.existsSync(credPath)) {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8')) as Record<string, unknown>;
        if (typeof creds.api_key === 'string' && creds.api_key) return creds.api_key;
        if (typeof creds.oauth_token === 'string' && creds.oauth_token) return creds.oauth_token;
      }
    } catch {
      // Ignore credential read errors
    }

    return null;
  }

  /**
   * Read the last ~50 lines of a session's .jsonl log file.
   * Claude stores logs at ~/.claude/projects/<project-hash>/<session-id>.jsonl
   * where project-hash is the workDir with :, \, / replaced by -.
   */
  private readSessionLog(session: SessionInfo): string | null {
    try {
      const projectHash = session.workDir.replace(/[:\\/]/g, '-');
      const logPath = path.join(
        os.homedir(),
        '.claude',
        'projects',
        projectHash,
        `${session.sessionId}.jsonl`,
      );

      if (!fs.existsSync(logPath)) return null;

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const lastLines = lines.slice(-50);

      // Extract relevant info from JSONL entries
      const excerpts: string[] = [];
      for (const line of lastLines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          // Extract tool use info and text content
          if (entry.type === 'assistant' && entry.message) {
            const msg = entry.message as Record<string, unknown>;
            if (Array.isArray(msg.content)) {
              for (const block of msg.content as Array<Record<string, unknown>>) {
                if (block.type === 'tool_use') {
                  excerpts.push(`Tool: ${block.name as string}`);
                } else if (block.type === 'text' && typeof block.text === 'string') {
                  // Truncate long text
                  const text = block.text.length > 200 ? block.text.slice(0, 200) + '...' : block.text;
                  excerpts.push(text);
                }
              }
            }
          } else if (entry.type === 'tool_result') {
            const status = (entry as Record<string, unknown>).is_error ? 'failed' : 'ok';
            excerpts.push(`Tool result: ${status}`);
          }
        } catch {
          // Skip unparseable lines
        }
      }

      if (excerpts.length === 0) return null;
      // Take last 10 excerpts to keep the prompt small
      return excerpts.slice(-10).join('\n');
    } catch {
      return null;
    }
  }

  /** Call Claude API to generate a one-line summary in the user's language. */
  private async generateSummary(apiKey: string, logExcerpt: string): Promise<string> {
    try {
      const langMap: Record<string, string> = { en: 'English', zh: '中文', ja: '日本語' };
      const lang = langMap[this.currentLocale] ?? 'English';

      // @anthropic-ai/sdk is ESM-only, use dynamic import in CommonJS
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Summarize what this Claude Code session is doing in one short sentence (max 15 words) in ${lang}:\n\n${logExcerpt}`,
          },
        ],
      });

      // Extract text from response
      for (const block of response.content) {
        if (block.type === 'text') {
          return block.text.trim();
        }
      }
      return 'Unable to generate summary';
    } catch (err) {
      console.error('[MonitorAgent] API call failed:', err);
      return 'Summary unavailable';
    }
  }
}
