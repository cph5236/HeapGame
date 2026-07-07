import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { fetchWithLog } from '../logging/fetchWithLog';
import { authHeaders, logIfAuthRejected } from './authToken';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export class CustomizationClient {
  /** Upsert the equipped loadout. Returns false on any failure (offline etc.). */
  static async putLoadout(playerId: string, loadout: EquippedLoadout): Promise<boolean> {
    try {
      const res = await fetchWithLog(
        `${SERVER_URL}/customization/${encodeURIComponent(playerId)}`,
        {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body:    JSON.stringify({ loadout }),
        },
      );
      if (!res.ok) logIfAuthRejected('customization:put', res.status);
      return res.ok;
    } catch {
      return false;
    }
  }
}
