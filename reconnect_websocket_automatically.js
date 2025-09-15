require('dotenv').config();

let cachedAccessToken = null;
let tokenExpiryTime = 0; 

function connectWebSocket() {
    const subscriptionId = process.env.SUBSCRIPTION_ID;
    const primaryWsUrl = `wss://ws.zoom.us/ws?subscriptionId=${subscriptionId}`;

    // if primaryWsUrl is down because of deployment or maintenance, you can switch to backup ws url
    const backupWsUrl = `wss://backupwsurl`;

    let currentWsUrl = primaryWsUrl;
    let socket;
    let reconnectAttempts = 0;
     // Maximum number of reconnection attempts
    const maxReconnectAttempts = 5;
    const reconnectInterval = 3000;

    // get access token from Zoom by using client_credentials
    async function getAccessToken() {
        // Check if the cached token is still valid
        if (cachedAccessToken && Date.now() < tokenExpiryTime) {
            console.log("Using cached access token.");
            return cachedAccessToken;
        }
        const username = process.env.CLIENT_USERNAME;
        const password = process.env.CLIENT_PASSWORD;
        const url = `https://zoom.us/oauth/token?grant_type=client_credentials`;
        const headers = {
            "Authorization": `Basic ${btoa(`${username}:${password}`)}`, // Base64 encoding
            "Content-Type": "application/x-www-form-urlencoded"
        };

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: headers,
            });

            const data = await response.text();
            if (!response.ok) {
                throw new Error(`Failed to fetch access token: ${data}`);
            }

            cachedAccessToken = data.access_token;
            tokenExpiryTime = Date.now() + (data.expires_in * 1000) - 60000;
            console.log(`Fetched new access token. Expires in ${data.expires_in} seconds.`);
            return cachedAccessToken;
        } catch (error) {
            console.error("Error fetching access token:", error);
            throw error;
        }
    }

    async function createWebSocket() {
        try {
            const accessToken = await getAccessToken();
            console.log(`Attempting to connect to WebSocket: ${currentWsUrl}`);
            // socket = new WebSocket(`${currentWsUrl}&access_token=${accessToken}`);
            socket = new WebSocket(`${currentWsUrl}&access_token=123`);

            socket.addEventListener('open', () => {
                console.log('WebSocket connection opened.');
                // Reset reconnection attempts on successful connection
                reconnectAttempts = 0;
            });

            socket.addEventListener('message', (event) => {
                console.log('Message received from WebSocket:', event.data);
            });

            socket.addEventListener('close', async (event) => {
                console.warn('WebSocket connection closed:', event.content);

                // Try reconnecting
                if (event.content === "Invalid Token") {
                    console.log("Invalid token detected. Fetching a new token...");
                    cachedAccessToken = null;
                    await getAccessToken();
                    await createWebSocket();
                } else {
                    await attemptReconnect();
                }
            });

            socket.addEventListener('error', (error) => {
                console.error('WebSocket error:', error);
                socket.close();
            });
        } catch (error) {
            console.error("Error creating WebSocket:", error);
            await attemptReconnect();
        }
    }

    async function attemptReconnect() {
        reconnectAttempts++;
        if (reconnectAttempts <= maxReconnectAttempts) {
            console.log(`Reconnecting WebSocket... (${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(createWebSocket, reconnectInterval); // Retry after a delay
        } else {
            console.warn('Maximum reconnect attempts reached. Switching to backup WebSocket URL.');
            switchToBackupUrl();
        }
    }

    function switchToBackupUrl() {
        if (currentWsUrl === primaryWsUrl) {
            currentWsUrl = backupWsUrl;
            console.log('Switched to backup WebSocket URL.');
            reconnectAttempts = 0; // Reset reconnection attempts when switching to backup URL
            createWebSocket();
        } else {
            console.error('Both primary and backup WebSocket URLs failed. Giving up.');
        }
    }

    createWebSocket();
}

// Example invocation
(async () => {
    try {
        connectWebSocket();
    } catch (error) {
        console.error("Error:", error);
    }
})();
