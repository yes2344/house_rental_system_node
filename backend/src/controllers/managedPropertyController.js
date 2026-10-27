import { listManagedProperties } from '../services/managedPropertyService.js';

export function managedPropertyController({ pool }) {
  return {
    list: async (request, response) => {
      response.json(await listManagedProperties(
        pool,
        request,
        request.userId,
        request.validated.query,
      ));
    },
  };
}
