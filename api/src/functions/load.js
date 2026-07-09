const { app } = require('@azure/functions');
const { getContainer, getClientPrincipal } = require('../shared');

app.http('load', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'load',
  handler: async (req, context) => {
    const tripId = req.query.get('tripId');
    if (!tripId) {
      return { status: 400, jsonBody: { error: 'tripId is required' } };
    }

    const principal = getClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Authentication required' } };
    }

    const userId = `${principal.identityProvider}|${principal.userId}`;

    try {
      const container = getContainer();
      const { resource } = await container.item(tripId, tripId).read();

      if (!resource) {
        return { status: 404, jsonBody: { error: 'Trip not found' } };
      }

      // Check membership
      if (resource.members && !resource.members.includes(userId)) {
        return { status: 403, jsonBody: { error: 'Access denied' } };
      }

      return {
        status: 200,
        jsonBody: {
          tripId: resource.tripId,
          name: resource.name,
          data: resource.data || {},
          etag: resource._etag,
          updatedAt: resource.updatedAt,
        },
      };
    } catch (err) {
      if (err.code === 404) {
        return { status: 404, jsonBody: { error: 'Trip not found' } };
      }
      context.log('Load error:', err.message);
      return { status: 500, jsonBody: { error: 'Internal server error' } };
    }
  },
});
