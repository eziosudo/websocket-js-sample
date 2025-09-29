const WebSocket = require('ws');

// Parse command line arguments to determine environment
function parseEnvironment() {
    const args = process.argv.slice(2);
    let environment = 'dev'; // default environment
    
    for (const arg of args) {
        if (arg.startsWith('-Denv=')) {
            environment = arg.split('=')[1];
            break;
        }
    }
    
    return environment;
}

// Load environment configuration based on the specified environment
function loadEnvironmentConfig(env) {
    let envFile;
    switch (env.toLowerCase()) {
        case 'dev':
            envFile = './.envDev';
            break;
        case 'go':
            envFile = './.envGo';
            break;
        case 'prod':
            envFile = './.envProd';
            break;
        default:
            throw new Error(`Unsupported environment: ${env}. Supported environments: dev, go, prod`);
    }
    
    console.log(`Loading environment configuration from: ${envFile}`);
    require('dotenv').config({ path: envFile });
    return envFile;
}

// Parse subscription IDs from environment variable (supports both JSON array and comma-separated string)
function parseSubscriptionIds() {
    const subscriptionIdsStr = process.env.SUBSCRIPTION_IDS;
    if (!subscriptionIdsStr) {
        throw new Error('SUBSCRIPTION_IDS environment variable is required but not defined.');
    }
    
    let subscriptionIds = [];
    try {
        // Try parsing as JSON array first
        if (subscriptionIdsStr.trim().startsWith('[')) {
            subscriptionIds = JSON.parse(subscriptionIdsStr);
            if (!Array.isArray(subscriptionIds)) {
                throw new Error('SUBSCRIPTION_IDS must be an array');
            }
        } else {
            // Parse as comma-separated string
            subscriptionIds = subscriptionIdsStr.split(',').map(id => id.trim()).filter(id => id.length > 0);
        }
        
        if (subscriptionIds.length === 0) {
            throw new Error('SUBSCRIPTION_IDS must contain at least one subscription ID');
        }
        
        console.log(`Loaded ${subscriptionIds.length} subscription IDs:`, subscriptionIds);
        return subscriptionIds;
    } catch (error) {
        console.error('Error parsing SUBSCRIPTION_IDS:', error);
        throw new Error(`Invalid SUBSCRIPTION_IDS format. Expected JSON array or comma-separated string. Error: ${error.message}`);
    }
}

// Initialize environment and configuration
const environment = parseEnvironment();
const envFile = loadEnvironmentConfig(environment);

// Check if required environment variables are defined
const requiredEnvVars = ['CLIENT_USERNAME', 'CLIENT_PASSWORD', 'SUBSCRIPTION_IDS', 'WS_URL', 'OAUTH_URL'];
requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is required but not defined in ${envFile}.`);
    }
});

// Parse subscription IDs from environment variable
const subscriptionIds = parseSubscriptionIds();

// Map to store active WebSocket connections
const activeConnections = new Map();
// Map to store heartbeat intervals for each WebSocket connection
const heartbeatIntervals = new Map();

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
async function createWebSocket(currentWsUrl, socketId) {
    let socket;
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Fetch a fresh access token before each attempt
            const token = await getAccessToken();
            console.log(`Attempting to connect to WebSocket ${socketId}: ${currentWsUrl}`);
            socket = new WebSocket(`${currentWsUrl}&access_token=${token}`);
            // Add event listeners for WebSocket
            addWebSocketListeners(socket, socketId);
            // Store the socket in active connections
            activeConnections.set(socketId, socket);
            // Return the WebSocket instance if successful
            return socket;
        } catch (error) {
            console.error(`WebSocket ${socketId} connection failed. Retry ${retries + 1}/${maxRetries}`);
            retries++;
            // Wait 3 seconds before retrying
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }

    throw new Error(`Failed to connect to WebSocket ${socketId} after maximum retries.`);
}

// Add event listeners to WebSocket
function addWebSocketListeners(socket, socketId) {
    socket.addEventListener('open', (event) => {
        // Access and log the tracking ID from headers
        const trackingId = socket._socket?.remoteHeaders?.['x-zm-trackingid'];
        console.log(`WebSocket ${socketId} connection opened.`);
        if (trackingId) {
            console.log(`Connection ${socketId} tracking ID:`, trackingId);
        }
        startHeartbeat(socket, socketId);
    });

    socket.addEventListener('message', (event) => {
        const trackingId = socket._socket?.remoteHeaders?.['x-zm-trackingid'];
        console.log(`Message received from WebSocket ${socketId} [tracking ID: ${trackingId || 'N/A'}]:`, event.data);
    });

    socket.addEventListener('close', (event) => {
        console.warn(`WebSocket ${socketId} connection closed:`, event.reason);
        stopHeartbeat(socketId);
        activeConnections.delete(socketId);
    });

    socket.addEventListener('error', (error) => {
        console.error(`WebSocket ${socketId} error:`, error);
        stopHeartbeat(socketId);
    });
}

// Start the heartbeat mechanism for a specific socket
function startHeartbeat(socket, socketId) {
    const heartbeatMessage = JSON.stringify({ "module":"heartbeat" });
    // Heartbeat every 30 seconds
    const heartbeatIntervalMs = 30000;

    const intervalId = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(heartbeatMessage);
            console.log(`Heartbeat sent for socket ${socketId}.`);
        }
    }, heartbeatIntervalMs);
    
    // Store the interval ID with the socket ID
    heartbeatIntervals.set(socketId, intervalId);
}

// Stop the heartbeat mechanism for a specific socket
function stopHeartbeat(socketId) {
    if (heartbeatIntervals.has(socketId)) {
        clearInterval(heartbeatIntervals.get(socketId));
        heartbeatIntervals.delete(socketId);
        console.log(`Heartbeat stopped for socket ${socketId}.`);
    }
}

// Connect to multiple WebSockets
async function connectMultipleWebSockets() {
    const wsUrl = process.env.WS_URL;
    const connections = [];
    
    console.log(`Connecting to ${subscriptionIds.length} WebSockets...`);
    
    // Connect to each subscription ID
    for (let i = 0; i < subscriptionIds.length; i++) {
        const subscriptionId = subscriptionIds[i];
        const wsUrlWithSubscription = `${wsUrl}?subscriptionId=${subscriptionId}`;
        const socketId = `socket-${i+1}`;
        
        try {
            console.log(`Connecting to WebSocket ${socketId} with subscription ID: ${subscriptionId}`);
            const socket = await createWebSocket(wsUrlWithSubscription, socketId);
            connections.push({ socketId, socket, subscriptionId });
        } catch (error) {
            console.error(`Error connecting WebSocket ${socketId}:`, error);
            // Continue with other connections even if one fails
        }
    }
    
    return connections;
}

// Close all active connections
function closeAllConnections() {
    console.log(`Closing all WebSocket connections...`);
    
    activeConnections.forEach((socket, socketId) => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.close();
            console.log(`WebSocket ${socketId} closed.`);
        }
        stopHeartbeat(socketId);
    });
    
    activeConnections.clear();
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('Received SIGINT. Closing all connections...');
    closeAllConnections();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Closing all connections...');
    closeAllConnections();
    process.exit(0);
});

module.exports = { connectMultipleWebSockets, closeAllConnections };

// Example invocation
if (require.main === module) {
    (async () => {
        try {
            console.log(`Running with environment: ${environment}`);
            console.log(`Using configuration file: ${envFile}`);
            console.log(`OAuth URL: ${process.env.OAUTH_URL}`);
            console.log(`WebSocket URL: ${process.env.WS_URL}`);
            console.log('---');
            
            const connections = await connectMultipleWebSockets();
            console.log(`Successfully connected to ${connections.length} WebSockets.`);
        } catch (error) {
            console.error("Error:", error);
            process.exit(1);
        }
    })();
}
