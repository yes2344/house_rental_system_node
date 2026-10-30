import { useState, type CSSProperties } from 'react';
import { House } from 'lucide-react';

interface PropertyPhotoProps {
  src: string | null | undefined;
  alt: string;
  className: string;
  fallbackClassName: string;
  fallbackLabel: string;
  loading?: 'eager' | 'lazy';
  style?: CSSProperties;
}

export function PropertyPhoto({
  src,
  alt,
  className,
  fallbackClassName,
  fallbackLabel,
  loading = 'lazy',
  style,
}: PropertyPhotoProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!src || failedSource === src) {
    return (
      <div
        className={fallbackClassName}
        role="img"
        aria-label={alt || fallbackLabel}
        style={style}
      >
        <House size={37} strokeWidth={1.3} aria-hidden="true" />
        <span>{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <img
      key={src}
      className={className}
      src={src}
      alt={alt}
      style={style}
      loading={loading}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth < 256 || event.currentTarget.naturalHeight < 160) {
          setFailedSource(src);
        }
      }}
      onError={() => setFailedSource(src)}
    />
  );
}
