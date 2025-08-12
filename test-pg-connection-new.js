const { Client } = require('pg');

async function testConnection() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres', // Connect to default postgres database first
    password: 'postgres',
    port: 5432,
  });

  try {
    // Test basic connection
    await client.connect();
    console.log('✅ Successfully connected to PostgreSQL server');
    
    // Check if our database exists
    const dbCheck = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'mkwwmcp'"
    );
    
    if (dbCheck.rows.length > 0) {
      console.log('✅ Database mkwwmcp exists');
      
      // Connect to the actual database
      await client.end();
      client.database = 'mkwwmcp';
      await client.connect();
      
      // Test query
      const res = await client.query('SELECT NOW() as current_time');
      console.log('📅 Current time from PostgreSQL:', res.rows[0].current_time);
      
      // List tables (if any)
      const tables = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      );
      
      if (tables.rows.length > 0) {
        console.log('📊 Tables in mkwwmcp database:');
        tables.rows.forEach(row => console.log(`   - ${row.table_name}`));
      } else {
        console.log('ℹ️ No tables found in mkwwmcp database');
      }
      
      return true;
    } else {
      console.log('❌ Database mkwwmcp does not exist');
      return false;
    }
  } catch (err) {
    console.error('❌ PostgreSQL connection error:', err.message);
    return false;
  } finally {
    await client.end().catch(console.error);
  }
}

testConnection().then(success => {
  process.exit(success ? 0 : 1);
});
