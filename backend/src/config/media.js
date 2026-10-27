import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = '/home/infinit1/backend';

export function getMediaConfig(overrides = {}) {
  const configuredPublicRoot = overrides.publicRoot || process.env.MEDIA_ROOT;
  const configuredPrivateRoot = overrides.privateRoot || process.env.PRIVATE_MEDIA_ROOT;
  const publicRoot = path.resolve(
    configuredPublicRoot || path.join(projectRoot, 'media'),
  );
  const privateRoot = path.resolve(
    configuredPrivateRoot || path.join(projectRoot, 'private-media'),
  );

  if (
    process.env.NODE_ENV === 'production'
    && (!configuredPublicRoot || !configuredPrivateRoot)
  ) {
    throw new Error('MEDIA_ROOT and PRIVATE_MEDIA_ROOT must be configured in production.');
  }

  const relative = path.relative(publicRoot, privateRoot);
  const inverse = path.relative(privateRoot, publicRoot);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('MEDIA_ROOT and PRIVATE_MEDIA_ROOT must be separate directories.');
  }
  if (!inverse.startsWith('..') && !path.isAbsolute(inverse)) {
    throw new Error('MEDIA_ROOT and PRIVATE_MEDIA_ROOT must be separate directories.');
  }

  const configuredCapacity = overrides.capacityBytes ?? process.env.MEDIA_CAPACITY_BYTES;
  const capacityBytes = configuredCapacity === undefined || configuredCapacity === ''
    ? null
    : Number(configuredCapacity);
  if (
    capacityBytes !== null
    && (!Number.isSafeInteger(capacityBytes) || capacityBytes < 1)
  ) {
    throw new Error('MEDIA_CAPACITY_BYTES must be a positive integer.');
  }

  const configuredWarning = overrides.warningPercent ?? process.env.MEDIA_WARNING_PERCENT ?? '80';
  const warningPercent = Number(configuredWarning);
  if (!Number.isFinite(warningPercent) || warningPercent <= 0 || warningPercent > 100) {
    throw new Error('MEDIA_WARNING_PERCENT must be greater than 0 and at most 100.');
  }

 if (process.env.NODE_ENV === 'production') {
  const roots = [publicRoot, privateRoot];

  if (roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolvedRoot === projectRoot
      || resolvedRoot.startsWith(`${projectRoot}${path.sep}`);
  })) {
    throw new Error(
      'Production media roots must be outside the application directory.',
    );
  }
}

  return { publicRoot, privateRoot, capacityBytes, warningPercent };
}
