/**
 * Local HTTP Connection
 * Simple password authentication to localhost:5474 plugin server
 * NO WebRTC, NO Supabase, NO TURN - Pure local-only connection
 */

export default class LocalConnection {
    constructor() {
        this.mode = 'local';
        this.authHash = null;
        this.onMessage = null;
        console.log('🔌 Note Relay: Local HTTP mode');
    }

    /**
     * Hash password using SHA-256
     */
    async hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Connect to local plugin HTTP server
     */
    async connect(password, onStatusUpdate) {
        this.onStatusUpdate = onStatusUpdate || ((msg) => console.log(msg));
        this.authHash = await this.hashString(password);
        
        this.onStatusUpdate("Connecting to local vault...");
        
        const response = await fetch('http://localhost:5474/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: 'PING', authHash: this.authHash })
        });
        
        if (!response.ok) {
            throw new Error('Authentication Failed');
        }
        
        const pingResult = await response.json();
        
        // Apply Obsidian theme if provided
        if (pingResult.data && pingResult.data.css) {
            let styleTag = document.getElementById('obsidian-theme-vars');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'obsidian-theme-vars';
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = pingResult.data.css;
        }
        
        console.log('📡 PING response received');
        this.onStatusUpdate("Authenticated. Loading vault...");
        
        // Notify UI that connection is established
        if (this.onMessage) {
            this.onMessage({ type: 'CONNECTED', data: {} });
        }
        
        // Initial data load
        await this.send('GET_TREE');
        await this.send('LOAD_TAGS');
        await this.send('LOAD_GRAPH');
        
        return true;
    }

    /**
     * Send command via HTTP
     */
    async send(cmd, extraData = {}) {
        const response = await fetch('http://localhost:5474/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd, authHash: this.authHash, ...extraData })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP request failed: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Trigger onMessage handler with the response
        if (this.onMessage && result) {
            this.onMessage(result);
        }
        
        return result;
    }

    /**
     * Disconnect (no-op for HTTP)
     */
    disconnect() {
        console.log('Local connection closed');
    }
}
