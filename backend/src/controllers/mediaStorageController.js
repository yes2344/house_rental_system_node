import { getMediaStorageReport } from '../services/mediaStorageService.js';

export function mediaStorageController({ pool, mediaConfig }) {
  return async (_request, response) => {
    response.json(await getMediaStorageReport(pool, mediaConfig));
  };
}
