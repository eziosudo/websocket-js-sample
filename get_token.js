const axios = require('axios');
require('dotenv').config({ path: '.envDev' });

async function getToken() {
    try {
        console.log('Making request to:', process.env.OAUTH_URL);
        console.log('Using credentials:', {
            username: process.env.CLIENT_USERNAME,
            password: '********'
        });
        
        const response = await axios.post(process.env.OAUTH_URL, null, {
            params: {
                grant_type: 'client_credentials'
            },
            auth: {
                username: process.env.CLIENT_USERNAME,
                password: process.env.CLIENT_PASSWORD
            }
        });
        
        console.log('Access Token:', response.data.access_token);
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting token:', error.response ? error.response.data : error.message);
        throw error;
    }
}

if (require.main === module) {
    getToken().catch(console.error);
}

module.exports = { getToken };
