CREATE TABLE public.backend_media_file_metadata (
    property_image_id bigint PRIMARY KEY
        REFERENCES public.user_propertyimage(id) ON DELETE CASCADE,
    public_file_size_bytes bigint NOT NULL CHECK (public_file_size_bytes >= 0),
    original_file_size_bytes bigint NOT NULL CHECK (original_file_size_bytes >= 0),
    mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    file_extension text NOT NULL CHECK (file_extension IN ('jpg', 'png', 'webp')),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    uploaded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
