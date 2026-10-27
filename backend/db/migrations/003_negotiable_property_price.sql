DO $migration$
BEGIN
    IF to_regclass('public.user_property') IS NULL THEN
        RAISE EXCEPTION 'Expected public.user_property to exist.';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_property'
          AND column_name = 'price'
          AND data_type = 'numeric'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Expected public.user_property.price to be a NOT NULL numeric column; inspect it before migrating.';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.user_property'::regclass
          AND conname = 'property_price_positive'
          AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'Expected the property_price_positive constraint to exist.';
    END IF;
END
$migration$;

ALTER TABLE public.user_property
    ALTER COLUMN price DROP NOT NULL;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_property'
          AND column_name = 'price'
          AND data_type = 'numeric'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'Property price nullability verification failed.';
    END IF;
END
$migration$;
