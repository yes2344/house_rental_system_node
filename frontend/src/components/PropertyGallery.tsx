import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

import type { PropertyDetail } from '../api/properties';
import type { MessageKey } from '../i18n';
import { PropertyPhoto } from './PropertyPhoto';

interface PropertyGalleryProps {
  property: PropertyDetail;
  text: (key: MessageKey) => string;
}

export function PropertyGallery({ property, text }: PropertyGalleryProps) {
  const images = useMemo(() => {
    const available = property.images.filter((image) => image.url);
    const ordered = [...available].sort(
      (first, second) => Number(second.is_primary) - Number(first.is_primary),
    );
    if (ordered.length) return ordered;
    if (property.primary_image) {
      return [{
        id: property.id,
        url: property.primary_image,
        caption: '',
        is_primary: true,
      }];
    }
    return [];
  }, [property]);
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const closeButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const activeImage = images[selected];

  useEffect(() => {
    setSelected(0);
    setZoom(1);
  }, [property.id]);

  useEffect(() => setZoom(1), [selected]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
      if (event.key === 'ArrowLeft' && images.length > 1) {
        setSelected((index) => (index - 1 + images.length) % images.length);
      }
      if (event.key === 'ArrowRight' && images.length > 1) {
        setSelected((index) => (index + 1) % images.length);
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.property-lightbox-dialog button:not(:disabled)',
          ),
        );
        const first = focusable.at(0);
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      openButton.current?.focus();
    };
  }, [images.length, lightboxOpen]);

  const previous = () => setSelected((index) => (index - 1 + images.length) % images.length);
  const next = () => setSelected((index) => (index + 1) % images.length);

  return (
    <section className="container detail-gallery-section" aria-label={text('photos')}>
      <div className="detail-gallery">
        <div className="detail-main-image">
          <button
            className="gallery-image-open"
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label={text('openPhotoViewer')}
            ref={openButton}
            disabled={!activeImage}
          >
            <PropertyPhoto
              key={activeImage?.id ?? property.id}
              src={activeImage?.url}
              alt={activeImage
                ? `${activeImage.caption || text('propertyImage')}: ${property.title}`
                : text('noPhoto')}
              className="detail-property-image"
              fallbackClassName="detail-main-image-placeholder"
              fallbackLabel={text('noPhoto')}
            />
          </button>
          <span className={`listing-type${property.listing_type === 'rent' ? ' is-rent' : ''}`}>
            {property.listing_type === 'rent' ? text('forRent') : text('forSale')}
          </span>
          {images.length > 1 && (
            <>
              <button className="gallery-arrow gallery-previous" type="button" aria-label={text('previousPage')} onClick={previous}>
                <ArrowLeft size={19} aria-hidden="true" />
              </button>
              <button className="gallery-arrow gallery-next" type="button" aria-label={text('nextPage')} onClick={next}>
                <ArrowRight size={19} aria-hidden="true" />
              </button>
              <span className="gallery-count">{selected + 1} / {images.length}</span>
            </>
          )}
        </div>
        {images.length > 1 && (
          <div className="gallery-thumbnails" aria-label={text('photos')}>
            {images.map((image, index) => (
              <button
                className={`gallery-thumbnail${selected === index ? ' is-selected' : ''}`}
                key={image.id}
                type="button"
                aria-label={`${text('photoNumber')} ${index + 1}`}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                <PropertyPhoto
                  src={image.url}
                  alt=""
                  className="gallery-thumbnail-image"
                  fallbackClassName="gallery-thumbnail-placeholder"
                  fallbackLabel={text('emptyImageLabel')}
                />
              </button>
            ))}
          </div>
        )}
      </div>
      {lightboxOpen && activeImage && (
        <div
          className="property-lightbox"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLightboxOpen(false);
          }}
        >
          <section
            className="property-lightbox-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${text('photos')} — ${property.title}`}
          >
            <button
              className="lightbox-close"
              type="button"
              aria-label={text('closePhotoViewer')}
              onClick={() => setLightboxOpen(false)}
              ref={closeButton}
            >
              <X size={22} aria-hidden="true" />
            </button>
            <PropertyPhoto
              src={activeImage.url}
              alt={`${activeImage.caption || text('propertyImage')}: ${property.title}`}
              className="lightbox-image"
              fallbackClassName="lightbox-image lightbox-placeholder"
              fallbackLabel={text('noPhoto')}
              style={{ transform: `scale(${zoom})` }}
            />
            <div className="lightbox-zoom-controls" aria-label={text('photoZoomControls')}>
              <button
                type="button"
                aria-label={text('zoomOutPhoto')}
                onClick={() => setZoom((current) => Math.max(1, Number((current - 0.25).toFixed(2))))}
                disabled={zoom <= 1}
              >
                <ZoomOut size={17} aria-hidden="true" />
              </button>
              <span aria-live="polite">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label={text('zoomInPhoto')}
                onClick={() => setZoom((current) => Math.min(2.5, Number((current + 0.25).toFixed(2))))}
                disabled={zoom >= 2.5}
              >
                <ZoomIn size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={text('resetPhotoZoom')}
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>
            {images.length > 1 && (
              <>
                <button className="lightbox-arrow lightbox-previous" type="button" aria-label={text('previousPage')} onClick={previous}>
                  <ArrowLeft size={22} aria-hidden="true" />
                </button>
                <button className="lightbox-arrow lightbox-next" type="button" aria-label={text('nextPage')} onClick={next}>
                  <ArrowRight size={22} aria-hidden="true" />
                </button>
                <span className="lightbox-count" aria-live="polite">{selected + 1} / {images.length}</span>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
