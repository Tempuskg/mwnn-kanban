import type { AgentCliModelStatus } from './agentCliHandoff';
import type { CliRunStatus } from './types';

export interface CliRunStatusTrackerOptions {
  readonly cardId: string;
  readonly providerLabel: string;
  /** Unique per CLI process attempt, so the board can tell dispatches apart. */
  readonly dispatchId: string;
  readonly stoppable?: boolean;
  readonly post: (status: CliRunStatus) => void;
}

export interface CliRunStatusTracker {
  setModel(status: AgentCliModelStatus): void;
  start(): void;
  statusLine(line: string): void;
  end(): void;
}

/**
 * Tracks the live status of one CLI dispatch for the card's running pill. Every
 * message carries the dispatch id and the model and thinking level known so
 * far, and nothing is
 * posted outside the start..end window, so a late model report or status line
 * from a finished dispatch can never reach the board.
 */
export function createCliRunStatusTracker(options: CliRunStatusTrackerOptions): CliRunStatusTracker {
  let running = false;
  let lastLine: string | undefined;
  let requestedModel: string | undefined;
  let actualModel: string | undefined;
  let thinkingLevel: string | undefined;
  const post = (isRunning: boolean, statusLine?: string): void => {
    options.post({
      cardId: options.cardId,
      providerLabel: options.providerLabel,
      dispatchId: options.dispatchId,
      running: isRunning,
      ...(statusLine !== undefined ? { statusLine } : {}),
      ...(isRunning && options.stoppable ? { stoppable: true } : {}),
      ...(isRunning && requestedModel !== undefined ? { requestedModel } : {}),
      ...(isRunning && actualModel !== undefined ? { actualModel } : {}),
      ...(isRunning && thinkingLevel !== undefined ? { thinkingLevel } : {}),
    });
  };
  return {
    setModel: (status) => {
      requestedModel = status.requested;
      // A report without an actual model never clears one already confirmed.
      actualModel = status.actual ?? actualModel;
      thinkingLevel = status.thinkingLevel;
      if (running) {
        post(true, lastLine);
      }
    },
    start: () => {
      running = true;
      lastLine = `Starting ${options.providerLabel}…`;
      post(true, lastLine);
    },
    statusLine: (line) => {
      if (running) {
        lastLine = line;
        post(true, line);
      }
    },
    end: () => {
      if (running) {
        running = false;
        post(false);
      }
    },
  };
}
