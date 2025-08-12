const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5432/mkwwmcp'
});

async function testConnection() {
  try {
    await client.connect();
    console.log('✅ Successfully connected to PostgreSQL');
    
    const res = await client.query('SELECT NOW() as current_time');
    console.log('📅 Current time from PostgreSQL:', res.rows[0].current_time);
    
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
