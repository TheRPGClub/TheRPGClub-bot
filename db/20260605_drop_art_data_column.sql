-- Drop ART_DATA column from GAMEDB_GAMES; artwork is no longer stored separately.
ALTER TABLE GAMEDB_GAMES DROP COLUMN ART_DATA;
