-- Drop legacy score.name column — names resolve via player_name (0005) join.
ALTER TABLE score DROP COLUMN name;
