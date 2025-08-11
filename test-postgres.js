import pg from 'pg';

async function testPostgresConnection() {
  const connectionString = 'postgres://postgres:postgres@localhost:5432/mkwwmcp';
  console.log(`Attempting to connect to PostgreSQL at ${connectionString}...`);
  
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });

  try {
    await client.connect();
    console.log('Successfully connected to PostgreSQL!');
    
    // Test query
    const result = await client.query('SELECT NOW() as current_time');
    console.log('Current database time:', result.rows[0].current_time);
    
    // Check if tables exist
    const tablesResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    console.log('Available tables:', tablesResult.rows.map(row => row.table_name));
    
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err);
  } finally {
    await client.end();
    process.exit(0);
  }
}

testPostgresConnection();
