// shared/configTypes.ts
//
// Contract shared by the worker (server/src/routes/config.ts, configDb.ts),
// the client (src/systems/ConfigClient.ts), and tests.

/** Full config map as returned by GET /config: key -> arbitrary JSON value. */
export type AppConfig = Record<string, unknown>;

/** GET /config 200 body. */
export interface GetConfigResponse {
  config: AppConfig;
}

/** PUT /config/:key request body. */
export interface UpdateConfigRequest {
  value: unknown;
}

/** Shape of the 'ad_cadence' config value. */
export interface AdCadenceConfig {
  min: number;
  max: number;
}

/**
 * Shape of the 'min_version' config value — the hard update gate. Defined with
 * its parser/comparator in shared/versionGate.ts and re-exported here so the
 * config key shapes stay discoverable from one place.
 */
export type { MinVersionConfig } from './versionGate';
