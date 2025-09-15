const { getToken } = require('./get_token.js');
const { testRateLimit } = require('./rate_limit_test.js');

async function run() {
    try {
        const token = await getToken();
        process.env.TOKEN = token;
        await testRateLimit();
    } catch (error) {
        console.error('Error:', error);
    }
}

run();
