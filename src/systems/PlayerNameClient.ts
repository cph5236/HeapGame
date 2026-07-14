import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export class PlayerNameClient {
  /** Push a validated rename to the server. Returns the canonical stored name, or null on failure. */
  static async updateName(playerId: string, name: string): Promise<string | null> {
    try {
      const res = await fetchWithLog(`${SERVER_URL}/players/${encodeURIComponent(playerId)}/name`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ name }),
      });
      if (!res.ok) {
        logIfAuthRejected('players:rename', res.status);
        return null;
      }
      const data = (await res.json()) as { name: string };
      return data.name;
    } catch {
      return null;
    }
  }
}
