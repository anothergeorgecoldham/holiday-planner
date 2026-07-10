const { CosmosClient } = require('@azure/cosmos');

let client;
let container;

function getContainer() {
  if (!container) {
    client = new CosmosClient({
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY,
    });
    const database = client.database(process.env.COSMOS_DATABASE_ID);
    container = database.container(process.env.COSMOS_CONTAINER_ID);
  }
  return container;
}

function getClientPrincipal(req) {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function normalizeMember(value) {
  return String(value || '').trim().toLowerCase();
}

function getUsername(principal) {
  return normalizeMember(principal?.userDetails);
}

function getPrincipalMemberKey(principal) {
  if (!principal?.identityProvider || !principal?.userId) return '';
  return normalizeMember(`${principal.identityProvider}|${principal.userId}`);
}

function getPrincipalMemberKeys(principal) {
  return [...new Set([getUsername(principal), getPrincipalMemberKey(principal)].filter(Boolean))];
}

function normalizedList(values) {
  return Array.isArray(values) ? values.map(normalizeMember).filter(Boolean) : [];
}

function isTripMember(trip, principal) {
  const principalKeys = getPrincipalMemberKeys(principal);
  const members = normalizedList(trip?.members);
  const memberKeys = normalizedList(trip?.memberKeys);
  return principalKeys.some(key => members.includes(key) || memberKeys.includes(key));
}

function ensurePrincipalMembership(trip, principal) {
  const username = getUsername(principal);
  const memberKey = getPrincipalMemberKey(principal);

  trip.members = normalizedList(trip.members);
  trip.memberKeys = normalizedList(trip.memberKeys);

  if (username && !trip.members.includes(username)) {
    trip.members.push(username);
  }
  if (memberKey && !trip.memberKeys.includes(memberKey)) {
    trip.memberKeys.push(memberKey);
  }
}

module.exports = {
  ensurePrincipalMembership,
  getClientPrincipal,
  getContainer,
  getPrincipalMemberKey,
  getUsername,
  isTripMember,
  normalizeMember,
};
