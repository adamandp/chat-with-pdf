export interface SeedConfig {
  databaseUrl: string;
  demoPassword: string;
  documentId: string | null;
}

// validate production
export function getSeedConfig(): SeedConfig {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production'
  ) {
    throw new Error('Demo seeding is forbidden in production.');
  }

  // enable seeding
  if (process.env.SEED_DEMO !== 'true') {
    throw new Error('Set SEED_DEMO=true to explicitly enable demo seeding.');
  }

  const databaseUrl = process.env.DATABASE_URL;

  // validate database url
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const parsedUrl = new URL(databaseUrl);

  // validate db provider
  if (
    parsedUrl.protocol !== 'postgresql:' &&
    parsedUrl.protocol !== 'postgres:'
  ) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

  const expectedDatabaseName = process.env.SEED_EXPECTED_DB_NAME;

  // validate db name
  if (
    !databaseName ||
    !expectedDatabaseName ||
    databaseName !== expectedDatabaseName
  ) {
    throw new Error('Database name does not match SEED_EXPECTED_DB_NAME.');
  }

  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? '';

  // validate db password
  if (demoPassword.length < 12) {
    throw new Error('SEED_DEMO_PASSWORD must contain at least 12 characters.');
  }

  return {
    databaseUrl,
    demoPassword,
    documentId: process.env.SEED_DOCUMENT_ID || null,
  };
}
