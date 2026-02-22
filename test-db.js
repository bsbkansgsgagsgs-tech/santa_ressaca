const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

async function test() {
    const url = process.env.DATABASE_URL;
    console.log('Testing connection to:', url ? url.split('@')[1] : 'NULL');

    if (!url) {
        console.error('No DATABASE_URL found');
        return;
    }

    try {
        const sql = neon(url);
        console.log('Attempting simple query...');
        const result = await sql`SELECT NOW()`;
        console.log('✅ Success! Result:', result[0]);

        console.log('Checking users table...');
        const users = await sql`SELECT COUNT(*) FROM users`;
        console.log('✅ Success! User count:', users[0].count);
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
    }
}

test();
