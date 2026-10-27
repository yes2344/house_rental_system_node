import {
  getPublicProperty,
  listPublicAmenities,
  listPublicProperties,
  publicPropertyTypes,
} from '../services/publicPropertyService.js';

export function publicPropertyController({ pool }) {
  return {
    amenities: async (_request, response) => {
      response.json(await listPublicAmenities(pool));
    },
    propertyTypes: async (_request, response) => {
      response.json(await publicPropertyTypes());
    },
    properties: async (request, response) => {
      response.json(await listPublicProperties(
        pool,
        request,
        request.validated.query,
      ));
    },
    propertyDetail: async (request, response) => {
      response.json(await getPublicProperty(pool, request, request.params.slug));
    },
  };
}
