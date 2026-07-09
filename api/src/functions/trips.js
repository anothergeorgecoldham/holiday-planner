const { app } = require('@azure/functions');
const { getContainer, getClientPrincipal } = require('../shared');

app.http('trips', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'trips',
  handler: async (req, context) => {
    const principal = getClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Authentication required' } };
    }

    const username = principal.userDetails;
    if (!username) {
      return { status: 401, jsonBody: { error: 'Could not determine username' } };
    }

    const container = getContainer();

    if (req.method === 'GET') {
      // List all trips where user is a member
      try {
        const query = {
          query: 'SELECT c.id, c.tripId, c.name, c.updatedAt, c.createdAt FROM c WHERE ARRAY_CONTAINS(c.members, @username)',
          parameters: [{ name: '@username', value: username }],
        };
        const { resources } = await container.items.query(query).fetchAll();
        return {
          status: 200,
          jsonBody: { trips: resources },
        };
      } catch (err) {
        context.log('Trips list error:', err.message);
        return { status: 500, jsonBody: { error: 'Internal server error' } };
      }
    }

    if (req.method === 'POST') {
      // Create a new trip
      let body;
      try {
        body = await req.json();
      } catch {
        return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
      }

      const name = (body.name || '').trim();
      if (!name) {
        return { status: 400, jsonBody: { error: 'Trip name is required' } };
      }

      // Generate a random trip ID
      const tripId = 'trip_' + Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);

      const now = new Date().toISOString();
      const newTrip = {
        id: tripId,
        tripId: tripId,
        type: 'trip',
        name: name,
        data: {},
        members: [username],
        createdAt: now,
        updatedAt: now,
      };

      try {
        const { resource } = await container.items.create(newTrip);
        return {
          status: 201,
          jsonBody: {
            tripId: resource.tripId,
            name: resource.name,
            createdAt: resource.createdAt,
          },
        };
      } catch (err) {
        context.log('Trip create error:', err.message);
        return { status: 500, jsonBody: { error: 'Internal server error' } };
      }
    }
  },
});
