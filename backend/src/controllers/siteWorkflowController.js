import {
  createFavorite,
  createListingReport,
  createManagedLocation,
  deleteFavorite,
  deleteManagedLocation,
  getBrokerageContact,
  getManagedLocation,
  getPublicInformationPage,
  listFavorites,
  listHomepageNotes,
  listManagedLocations,
  listPublicLocations,
  patchBrokerageContact,
  updateManagedLocation,
} from '../services/siteWorkflowService.js';
import { ApiError } from '../errors.js';

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(404, 'Not found.');
  return id;
}

export function siteWorkflowController({ pool, mediaConfig, logger }) {
  return {
    homepageNotes: async (request, response, next) => {
      try {
        response.json(await listHomepageNotes(pool, request));
      } catch (error) {
        next(error);
      }
    },
    publicInformationPage: async (request, response, next) => {
      try {
        response.json(await getPublicInformationPage(pool, request.params.page));
      } catch (error) {
        next(error);
      }
    },
    brokerageContact: async (request, response, next) => {
      try {
        response.json(await getBrokerageContact(pool, request));
      } catch (error) {
        next(error);
      }
    },
    patchBrokerageContact: async (request, response, next) => {
      try {
        response.json(await patchBrokerageContact(
          pool,
          request,
          request.userId,
          request.validated.body,
          {
            files: request.files,
            mediaConfig,
            logger,
          },
        ));
      } catch (error) {
        next(error);
      }
    },
    listingReport: async (request, response, next) => {
      try {
        response.status(201).json(await createListingReport(pool, request.validated.body));
      } catch (error) {
        next(error);
      }
    },
    favorites: async (request, response, next) => {
      try {
        response.json(await listFavorites(pool, request, request.userId));
      } catch (error) {
        next(error);
      }
    },
    createFavorite: async (request, response, next) => {
      try {
        response.status(201).json(await createFavorite(
          pool,
          request,
          request.userId,
          request.validated.body.property_id,
        ));
      } catch (error) {
        next(error);
      }
    },
    deleteFavorite: async (request, response, next) => {
      try {
        await deleteFavorite(pool, request.userId, parseId(request.params.propertyId));
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    publicLocations: async (request, response, next) => {
      try {
        response.json(await listPublicLocations(pool, request.validated.query));
      } catch (error) {
        next(error);
      }
    },
    managedLocations: async (request, response, next) => {
      try {
        response.json(await listManagedLocations(pool, request.userId, request.validated.query));
      } catch (error) {
        next(error);
      }
    },
    createManagedLocation: async (request, response, next) => {
      try {
        response.status(201).json(await createManagedLocation(
          pool,
          request.userId,
          request.validated.body,
        ));
      } catch (error) {
        next(error);
      }
    },
    managedLocation: async (request, response, next) => {
      try {
        response.json(await getManagedLocation(pool, request.userId, parseId(request.params.id)));
      } catch (error) {
        next(error);
      }
    },
    updateManagedLocation: async (request, response, next) => {
      try {
        response.json(await updateManagedLocation(
          pool,
          request.userId,
          parseId(request.params.id),
          request.validated.body,
        ));
      } catch (error) {
        next(error);
      }
    },
    deleteManagedLocation: async (request, response, next) => {
      try {
        await deleteManagedLocation(pool, request.userId, parseId(request.params.id));
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  };
}
