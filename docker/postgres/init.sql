-- Runs only when the postgres volume is created. For an existing volume use
-- `bun run test:db` (api/), which creates the database if missing.
CREATE DATABASE liro_test;
