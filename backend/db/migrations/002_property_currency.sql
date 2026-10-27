DO $migration$
BEGIN
    IF to_regclass('public.user_property') IS NULL THEN
        RAISE EXCEPTION 'Expected public.user_property to exist.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_property'
          AND column_name = 'currency'
    ) THEN
        RAISE EXCEPTION 'public.user_property.currency already exists; inspect it before migrating.';
    END IF;
END
$migration$;

ALTER TABLE public.user_property
    ADD COLUMN currency varchar(3) NOT NULL DEFAULT 'ETB',
    ADD CONSTRAINT user_property_currency_valid CHECK (currency IN ('ETB', 'USD'));

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_property'
          AND column_name = 'currency'
          AND data_type = 'character varying'
          AND character_maximum_length = 3
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Currency column post-migration verification failed.';
    END IF;
END
$migration$;
