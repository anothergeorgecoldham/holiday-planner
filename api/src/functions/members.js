const { app } = require('@azure/functions');
const {
  getContainer,
  getClientPrincipal,
  getUsername,
  isTripMember,
  normalizeMember,
} = require('../shared');

app.http('members', {
  methods: ['GET', 'POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'members',
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

    const container = getContainer();

    try {
      const { resource: trip } = await container.item(tripId, tripId).read();
      if (!trip) {
        return { status: 404, jsonBody: { error: 'Trip not found' } };
      }

      // Only existing members can manage membership
      if (!isTripMember(trip, principal)) {
        return { status: 403, jsonBody: { error: 'Access denied' } };
      }

      if (req.method === 'GET') {
        return {
          status: 200,
          jsonBody: { members: trip.members, tripId },
        };
      }

      // POST = add member, DELETE = remove member
      let body;
      try {
        body = await req.json();
      } catch {
        return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
      }

      const targetUsername = body.username;
      if (!targetUsername || typeof targetUsername !== 'string') {
        return { status: 400, jsonBody: { error: 'username is required' } };
      }

      const cleanUsername = normalizeMember(targetUsername.replace(/^@/, ''));
      trip.members = Array.isArray(trip.members) ? trip.members.map(normalizeMember).filter(Boolean) : [];

      if (req.method === 'POST') {
        if (trip.members.includes(cleanUsername)) {
          return { status: 200, jsonBody: { members: trip.members, message: 'Already a member' } };
        }
        trip.members.push(cleanUsername);
      } else if (req.method === 'DELETE') {
        // Can't remove yourself if you're the last member
        if (trip.members.length <= 1 && cleanUsername === username) {
          return { status: 400, jsonBody: { error: 'Cannot remove the last member' } };
        }
        trip.members = trip.members.filter(m => m !== cleanUsername);
      }

      trip.updatedAt = new Date().toISOString();
      await container.item(tripId, tripId).replace(trip);

      return {
        status: 200,
        jsonBody: { members: trip.members, tripId },
      };
    } catch (err) {
      if (err.code === 404) {
        return { status: 404, jsonBody: { error: 'Trip not found' } };
      }
      context.log('Members error:', err.message);
      return { status: 500, jsonBody: { error: 'Internal server error' } };
    }
  },
});
