const { app } = require('@azure/functions');
const {
  ensurePrincipalMembership,
  getContainer,
  getClientPrincipal,
  getUsername,
  isTripMember,
} = require('../shared');

app.http('save', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'save',
  handler: async (req, context) => {
    const tripId = req.query.get('tripId');
    if (!tripId) {
      return { status: 400, jsonBody: { error: 'tripId is required' } };
    }

    const principal = getClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Authentication required' } };
    }

    const username = getUsername(principal);
    if (!username) {
      return { status: 401, jsonBody: { error: 'Could not determine username' } };
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
    }

    if (!body.data || typeof body.data !== 'object') {
      return { status: 400, jsonBody: { error: 'Request body must contain a data object' } };
    }

    const container = getContainer();
    const now = new Date().toISOString();

    try {
      // Try to read existing document
      let existing = null;
      try {
        const { resource } = await container.item(tripId, tripId).read();
        existing = resource;
      } catch (err) {
        if (err.code !== 404) throw err;
      }

      if (existing) {
        // Check membership
        if (!isTripMember(existing, principal)) {
          return { status: 403, jsonBody: { error: 'Access denied' } };
        }

        // Optimistic concurrency check
        if (body.etag && body.etag !== existing._etag) {
          return {
            status: 409,
            jsonBody: {
              error: 'Conflict: trip has been modified by someone else. Please reload.',
              currentEtag: existing._etag,
            },
          };
        }

        // Update existing document
        const updated = {
          ...existing,
          data: body.data,
          updatedAt: now,
        };
        ensurePrincipalMembership(updated, principal);

        const { resource } = await container.item(tripId, tripId).replace(updated, {
          accessCondition: { type: 'IfMatch', condition: existing._etag },
        });

        return {
          status: 200,
          jsonBody: { ok: true, etag: resource._etag, updatedAt: now },
        };
      } else {
        // Create new trip — caller becomes the first member
        const newTrip = {
          id: tripId,
          tripId: tripId,
          type: 'trip',
          name: body.name || 'Untitled Trip',
          data: body.data,
          members: [username],
          memberKeys: [],
          createdAt: now,
          updatedAt: now,
        };
        ensurePrincipalMembership(newTrip, principal);

        const { resource } = await container.items.create(newTrip);

        return {
          status: 201,
          jsonBody: { ok: true, etag: resource._etag, updatedAt: now },
        };
      }
    } catch (err) {
      if (err.code === 412) {
        // Precondition failed — concurrent modification
        return {
          status: 409,
          jsonBody: { error: 'Conflict: trip was modified concurrently. Please reload.' },
        };
      }
      context.log('Save error:', err.message);
      return { status: 500, jsonBody: { error: 'Internal server error' } };
    }
  },
});
