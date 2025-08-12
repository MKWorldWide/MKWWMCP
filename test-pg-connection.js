const { Client } = require('pg');

async function testConnection() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'mkwwmcp',
    password: 'postgres',
    port: 5432,
  });

  try {
    await client.connect();
    console.log('✅ Successfully connected to PostgreSQL');
    const res = await client.query('SELECT NOW()');
    console.log('📅 Current time from PostgreSQL:', res.rows[0].now);
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection error:', err);
    return false;
  } finally {
    await client.end();
  }
}

testConnection().then(success => {
  process.exit(success ? 0 : 1);
});
