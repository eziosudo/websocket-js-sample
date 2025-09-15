console.log('Loading environment variables from .envDev...');
require('dotenv').config({ path: '.envDev' });
console.log('Current SUBSCRIPTION_ID:', process.env.SUBSCRIPTION_ID);

const WebSocket = require('ws');

// Global variable for heartbeat interval
let heartbeatInterval;

// Function to check required environment variables
function checkRequiredEnvVars() {
    const requiredEnvVars = ['SUBSCRIPTION_ID', 'WS_URL', 'TOKEN'];
    requiredEnvVars.forEach((envVar) => {
        if (!process.env[envVar]) {
            throw new Error(`Environment variable ${envVar} is required but not defined.`);
        }
    });
}

// Create WebSocket connection
async function createWebSocket(currentWsUrl) {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Attempting to connect to WebSocket: ${currentWsUrl}`);
            const socket = new WebSocket(currentWsUrl);

            // Handle successful connections
            socket.on('upgrade', (response) => {
                const trackingId = response.headers['x-zm-trackingid'];
                console.log(`Connection attempt - Tracking ID: ${trackingId || 'Not available'}`);
            });

            // Add event listeners for WebSocket
            addWebSocketListeners(socket);
            
            socket.on('open', () => resolve(socket));
            socket.on('error', (error) => {
                // Try to get tracking ID from error if available
                const response = error.response || error.target?.response;
                if (response?.headers) {
                    const trackingId = response.headers['x-zm-trackingid'];
                    console.log(`Connection failed - Tracking ID: ${trackingId || 'Not available in error'}`);
                }
                reject(error);
            });
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            reject(error);
        }
    });
}

// Add event listeners to WebSocket
function addWebSocketListeners(socket) {
    socket.addEventListener('open', () => {
        console.log('WebSocket connection opened.');
        startHeartbeat(socket);
    });

    socket.addEventListener('message', (event) => {
        console.log('Message received from WebSocket:', event.data);
    });

    socket.addEventListener('close', (event) => {
        console.warn('WebSocket connection closed:', event.reason);
        stopHeartbeat();
    });

    socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        stopHeartbeat();
    });
}

// Start the heartbeat mechanism
function startHeartbeat(socket) {
    const heartbeatMessage = JSON.stringify({ "module":"heartbeat" });
    // Heartbeat every 30 seconds
    const heartbeatIntervalMs = 30000;

    heartbeatInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(heartbeatMessage);
            console.log('Heartbeat sent.');
        }
    }, heartbeatIntervalMs);
}

// Stop the heartbeat mechanism
function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('Heartbeat stopped.');
    }
}


// Rate limit test function
async function testRateLimit() {
    checkRequiredEnvVars();
    console.log('Starting rate limit test...');
    const startTime = Date.now();
    const totalRequests = 300;
    const timeWindow = 10000; // 10 seconds
    let successfulConnections = 0;
    let failedConnections = 0;
    const connections = [];
    
    const wsUrl = `${process.env.WS_URL}?subscriptionId=${process.env.SUBSCRIPTION_ID}`;

    // Create array of promises for connection attempts
    for (let i = 0; i < totalRequests; i++) {
        connections.push(
            (async () => {
                try {
                    const fullUrl = `${wsUrl}&access_token=${process.env.TOKEN}`;
                    const socket = await createWebSocket(fullUrl);
                    successfulConnections++;
                    // Wait for connection to be established before closing
                    await new Promise(resolve => setTimeout(resolve, 100));
                    socket.close();
                    return true;
                } catch (error) {
                    failedConnections++;
                    return false;
                }
            })()
        );

        // Add small delay between requests to spread them over the 10-second window
        await new Promise(resolve => setTimeout(resolve, timeWindow / totalRequests));
    }

    // Wait for all connection attempts to complete
    await Promise.all(connections);
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n=== Rate Limit Test Results ===');
    console.log(`Total requests sent: ${totalRequests}`);
    console.log(`Successful connections: ${successfulConnections}`);
    console.log(`Failed connections: ${failedConnections}`);
    console.log(`Test duration: ${duration.toFixed(2)} seconds`);
    console.log(`Success rate: ${((successfulConnections / totalRequests) * 100).toFixed(2)}%`);
}

module.exports = { testRateLimit };

// Example invocation
if (require.main === module) {
    (async () => {
        try {
            await testRateLimit();
        } catch (error) {
            console.error("Error:", error);
        }
    })();
}
