require('dotenv').config();
const WebSocket = require('ws');

// Check if required environment variables are defined
const requiredEnvVars = ['CLIENT_USERNAME', 'CLIENT_PASSWORD', 'SUBSCRIPTION_ID', 'WS_URL', 'OAUTH_URL'];
requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is required but not defined.`);
    }
});

// Fetch access token
async function getAccessToken() {
    const username = process.env.CLIENT_USERNAME;
    const password = process.env.CLIENT_PASSWORD;
    // OAuth token URL
    const url = `${process.env.OAUTH_URL}?grant_type=client_credentials`;

    const headers = {
        // Base64 encoded credentials
        "Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        "Content-Type": "application/x-www-form-urlencoded"
    };

    try {
        // Send a POST request to fetch the access token
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Failed to fetch access token: ${JSON.stringify(data)}`);
        }
        console.log(`Successfully fetched a new access token.`);
        return data.access_token;
    } catch (error) {
        console.error("Error fetching access token:", error);
        throw error;
    }
}

// Create WebSocket connection
async function createWebSocket(currentWsUrl) {
    let socket;
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Fetch a fresh access token before each attempt
            const token = await getAccessToken();
            console.log(`Attempting to connect to WebSocket: ${currentWsUrl}`);
            socket = new WebSocket(`${currentWsUrl}&access_token=${token}`);
            // Add event listeners for WebSocket
            addWebSocketListeners(socket);
             // Return the WebSocket instance if successful
            return socket;
        } catch (error) {
            console.error(`WebSocket connection failed. Retry ${retries + 1}/${maxRetries}`);
            retries++;
            // Wait 3 seconds before retrying
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }

    throw new Error('Failed to connect to WebSocket after maximum retries.');
}

// Message monitoring variables
let messageStats = {
    count: 0,
    totalSize: 0,
    minSize: Infinity,
    maxSize: 0,
    sizes: []
};
let statsInterval = null;

// Reset message statistics
function resetMessageStats() {
    messageStats = {
        count: 0,
        totalSize: 0,
        minSize: Infinity,
        maxSize: 0,
        sizes: []
    };
}

// Check if message is a heartbeat message
function isHeartbeatMessage(messageData) {
    try {
        const parsed = JSON.parse(messageData);
        return parsed.module === 'heartbeat';
    } catch (error) {
        // If parsing fails, it's not a heartbeat message
        return false;
    }
}

// Record message size and update statistics (excluding heartbeat messages)
function recordMessageSize(messageSize, messageData) {
    // Skip heartbeat messages
    if (isHeartbeatMessage(messageData)) {
        return;
    }
    
    messageStats.count++;
    messageStats.totalSize += messageSize;
    messageStats.sizes.push(messageSize);
    
    if (messageSize < messageStats.minSize) {
        messageStats.minSize = messageSize;
    }
    if (messageSize > messageStats.maxSize) {
        messageStats.maxSize = messageSize;
    }
}

// Print statistics and reset
function printAndResetStats() {
    if (messageStats.count > 0) {
        const avgSize = (messageStats.totalSize / messageStats.count).toFixed(2);
        console.log('=== Message Statistics (Last 1 Minute) ===');
        console.log(`Message Count: ${messageStats.count}`);
        console.log(`Max Message Size: ${messageStats.maxSize} bytes`);
        console.log(`Min Message Size: ${messageStats.minSize} bytes`);
        console.log(`Average Message Size: ${avgSize} bytes`);
        console.log(`Total Message Size: ${messageStats.totalSize} bytes`);
        console.log('========================');
    } else {
        console.log('=== Message Statistics (Last 1 Minute) ===');
        console.log('No messages received');
        console.log('========================');
    }
    resetMessageStats();
}

// Start periodic statistics logging
function startStatsLogging() {
    // Log statistics every minute (60000ms)
    statsInterval = setInterval(printAndResetStats, 60000);
    console.log('Message monitoring started, printing statistics every minute');
}

// Stop periodic statistics logging
function stopStatsLogging() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
        console.log('Message monitoring stopped');
    }
}

// Add event listeners to WebSocket
function addWebSocketListeners(socket) {
    socket.addEventListener('open', () => {
        console.log('WebSocket connection opened.');
        startHeartbeat(socket);
        startStatsLogging();
    });

    socket.addEventListener('message', (event) => {
        const messageSize = Buffer.byteLength(event.data, 'utf8');
        
        recordMessageSize(messageSize, event.data);
        console.log(`Message received from WebSocket (${messageSize} bytes):`, event.data);
    });

    socket.addEventListener('close', (event) => {
        console.warn('WebSocket connection closed:', event.reason);
        stopHeartbeat();
        stopStatsLogging();
        // Print final stats before closing
        if (messageStats.count > 0) {
            console.log('=== Final Message Statistics ===');
            printAndResetStats();
        }
    });

    socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        stopHeartbeat();
        stopStatsLogging();
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

// Connect to WebSocket
async function connectWebSocket() {
    const subscriptionId = process.env.SUBSCRIPTION_ID;
    const primaryWsUrl = `${process.env.WS_URL}?subscriptionId=${subscriptionId}`;
    let socket;

    try {
        socket = await createWebSocket(primaryWsUrl);
        return socket;
    } catch (error) {
        console.error('Error connecting WebSocket:', error);
        throw error;
    }
}

module.exports = { connectWebSocket };

// Example invocation
if (require.main === module) {
    (async () => {
        try {
            await connectWebSocket();
        } catch (error) {
            console.error("Error:", error);
        }
    })();
}
