-- The Server background delivery path uses the Postgres-native queue and async HTTP extensions.
create extension if not exists pgmq with schema pgmq;
create extension if not exists pg_net with schema extensions;
