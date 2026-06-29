CREATE TABLE IF NOT EXISTS heap_parameters (
  heap_id      TEXT PRIMARY KEY,
  enemy_params TEXT NOT NULL DEFAULT '{}'
);

INSERT OR IGNORE INTO heap_parameters (heap_id, enemy_params) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '{"percher":{"spawnStartPxAboveFloor":0,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":15000,"spawnChanceMin":0.15,"spawnChanceMax":0.45},"ghost":{"spawnStartPxAboveFloor":5000,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":20000,"spawnChanceMin":0.10,"spawnChanceMax":0.35}}'
);
