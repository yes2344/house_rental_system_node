import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { PropertyPhoto } from './PropertyPhoto';

export interface SlideshowImage {
  id: number;
  url: string | null;
  caption: string;
  is_primary: boolean;
}

interface PropertySlideshowProps {
  images: SlideshowImage[];
  fallbackImage?: string | null;
  title: string;
  fallbackLabel: string;
  previousLabel: string;
  nextLabel: string;
  photoLabel: string;
  imageLoading?: 'eager' | 'lazy';
}

export function PropertySlideshow({
  images,
  fallbackImage,
  title,
  fallbackLabel,
  previousLabel,
  nextLabel,
  photoLabel,
  imageLoading = 'lazy',
}: PropertySlideshowProps) {
  const orderedImages = useMemo(
    () => [...images].filter((image) => image.url).sort(
      (first, second) => Number(second.is_primary) - Number(first.is_primary),
    ),
    [images],
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motionReduced, setMotionReduced] = useState(false);
  const [sliding, setSliding] = useState(false);
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const [nextImageReady, setNextImageReady] = useState(false);

  useEffect(() => setCurrentIndex(0), [orderedImages]);

  const nextIndex = orderedImages.length
    ? (currentIndex + 1) % orderedImages.length
    : 0;
  const previousIndex = orderedImages.length
    ? (currentIndex - 1 + orderedImages.length) % orderedImages.length
    : 0;
  const active = orderedImages[currentIndex];
  const next = orderedImages[slideDirection === 1 ? nextIndex : previousIndex];

  useEffect(() => {
    setNextImageReady(false);
    if (!next?.url) return undefined;

    const preload = new Image();
    preload.onload = () => setNextImageReady(true);
    preload.onerror = () => setNextImageReady(true);
    preload.src = next.url;
    if (preload.complete) setNextImageReady(true);
    return () => {
      preload.onload = null;
      preload.onerror = null;
    };
  }, [next?.url]);

  useEffect(() => {
    const mediaPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      setMotionReduced(
        mediaPreference.matches || document.documentElement.dataset.reducedMotion === 'reduce',
      );
    };
    const observer = new MutationObserver(updateMotionPreference);
    mediaPreference.addEventListener('change', updateMotionPreference);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduced-motion'],
    });
    updateMotionPreference();
    return () => {
      mediaPreference.removeEventListener('change', updateMotionPreference);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (paused || orderedImages.length < 2 || motionReduced || sliding || !nextImageReady) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setSlideDirection(1);
      setSliding(true);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [motionReduced, nextImageReady, orderedImages.length, paused, sliding]);

  const move = (offset: number) => {
    if (sliding || orderedImages.length < 2) return;
    setSlideDirection(offset > 0 ? 1 : -1);
    setSliding(true);
  };
  const finishSlide = () => {
    setCurrentIndex((current) => (
      (current + slideDirection + orderedImages.length) % orderedImages.length
    ));
    setSliding(false);
  };

  return (
    <div
      className={`property-slideshow${sliding ? ` is-sliding ${slideDirection === 1 ? 'slides-left' : 'slides-right'}` : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      onTransitionEnd={(event) => {
        if (
          event.target instanceof HTMLElement
          && event.target.classList.contains('slideshow-next')
          && event.propertyName === 'transform'
        ) finishSlide();
      }}
    >
      {active && (
        <PropertyPhoto
          key={active.id}
          src={active.url}
          alt={`${title} — ${active.caption || photoLabel}`}
          className="listing-image slideshow-current"
          fallbackClassName="listing-image listing-image-placeholder slideshow-current"
          fallbackLabel={fallbackLabel}
          loading={imageLoading}
        />
      )}
      {next && orderedImages.length > 1 && (
        <PropertyPhoto
          key={next.id}
          src={next.url}
          alt={`${title} — ${next.caption || photoLabel}`}
          className="listing-image slideshow-next"
          fallbackClassName="listing-image listing-image-placeholder slideshow-next"
          fallbackLabel={fallbackLabel}
          loading="lazy"
          style={{ visibility: nextImageReady ? 'visible' : 'hidden' }}
        />
      )}
      {!active && (
        <PropertyPhoto
          src={fallbackImage}
          alt=""
          className="listing-image"
          fallbackClassName="listing-image listing-image-placeholder"
          fallbackLabel={fallbackLabel}
          loading={imageLoading}
        />
      )}
      {orderedImages.length > 1 && (
        <>
          <button
            className="slideshow-arrow slideshow-previous"
            type="button"
            aria-label={previousLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              move(-1);
            }}
            disabled={sliding}
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <button
            className="slideshow-arrow slideshow-next"
            type="button"
            aria-label={nextLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              move(1);
            }}
            disabled={sliding}
          >
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <div className="slideshow-dots" aria-label={`${currentIndex + 1} / ${orderedImages.length}`}>
            {orderedImages.map((image, index) => (
              <button
                className={`slideshow-dot${index === currentIndex ? ' is-active' : ''}`}
                key={image.id}
                type="button"
                aria-label={`${photoLabel} ${index + 1}`}
                aria-current={index === currentIndex ? 'true' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (sliding) return;
                  setSliding(false);
                  setCurrentIndex(index);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
