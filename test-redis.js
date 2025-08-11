import { createClient } from 'redis';

async function testRedisConnection() {
  const redisUrl = 'redis://localhost:6380';
  console.log(`Attempting to connect to Redis at ${redisUrl}...`);
  
  const client = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        console.log(`Retry attempt: ${retries}`);
        if (retries > 3) {
          console.error('Max retries reached. Could not connect to Redis.');
          return new Error('Max retries reached');
        }
        return 1000; // Retry after 1 second
      }
    }
  });

  client.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  try {
    await client.connect();
    console.log('Successfully connected to Redis!');
    const pong = await client.ping();
    console.log('Ping response:', pong);
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  } finally {
    await client.quit();
    process.exit(0);
  }
}

testRedisConnection();
