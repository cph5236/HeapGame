// src/systems/FeedbackClient.ts

import { getLogEnvelope } from '../logging';
import { fetchWithLog } from '../logging/fetchWithLog';
import type { FeedbackCategory, FeedbackSubmitRequest } from '../../shared/feedbackTypes';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type FeedbackStatus = 'success' | 'offline' | 'error';

export interface FeedbackResult {
  status:  FeedbackStatus;
  message: string;
}

/** Sends one feedback message to the server, built from the logging envelope. */
export async function submitFeedback(
  category: FeedbackCategory,
  rawMessage: string,
  heapId: string | null,
): Promise<FeedbackResult> {
  const message = rawMessage.trim();
  if (!message) return { status: 'error', message: 'Enter a message' };

  const env = getLogEnvelope();
  const req: FeedbackSubmitRequest = {
    category,
    message,
    playerGuid: env.userGuid,
    sessionId:  env.sessionId,
    appVersion: env.appVersion,
    platform:   env.platform,
    userAgent:  env.userAgent,
    heapId,
  };

  let res: Response;
  try {
    res = await fetchWithLog(`${SERVER_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    return { status: 'offline', message: 'Offline — try again' };
  }

  return res.ok
    ? { status: 'success', message: 'Thanks!' }
    : { status: 'error', message: "Couldn't send — try again" };
}
