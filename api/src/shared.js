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

module.exports = { getContainer, getClientPrincipal };
