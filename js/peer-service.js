let peerPrefix = 'app-';
let peerConfig = {};
let peer = null;
let connections = [];
let peerId = null;
let onConnectionChangeCallback = () => {};

/**
 * Configures the peer service with a specific prefix and PeerJS options.
 * @param {string} prefix - The prefix to use for peer IDs (e.g., 'myapp-').
 * @param {object} config - Configuration object for the Peer constructor.
 */
export function initialize(prefix, config = {}) {
    if (prefix) peerPrefix = prefix;
    peerConfig = config;
}

/**
 * Initializes the PeerJS object for the host and sets up event listeners.
 */
export function createHost(onOpen, onConnect, onData, onError, onConnectionChange, customId = null) {
    destroyPeer();
    onConnectionChangeCallback = onConnectionChange || (() => {});
    peerId = customId ? `${peerPrefix}${customId}` : `${peerPrefix}${Math.floor(100000 + Math.random() * 900000)}`;
    peer = new Peer(peerId, peerConfig);

    peer.on('open', (id) => {
        console.log('PeerJS Host is open. ID:', id);
        if (onOpen) onOpen(id.replace(peerPrefix, ''));
    });

    peer.on('connection', (conn) => {
        console.log('Incoming connection...');
        connections.push(conn);
        onConnectionChangeCallback(connections.length);
        setupConnectionEvents(conn, onConnect, onData);
    });

    peer.on('error', (err) => {
        console.error('PeerJS Host Error:', err);
        if (onError) onError(err.type || err);
    });
}

/**
 * Initializes the PeerJS object for the joiner and connects to a host.
 */
export function joinHost(hostId, onConnect, onData, onError, onConnectionChange) {
    destroyPeer();
    onConnectionChangeCallback = onConnectionChange || (() => {});
    peer = new Peer(peerConfig);

    peer.on('open', () => {
        console.log('PeerJS Joiner is open. Connecting to host:', hostId);
        const fullHostId = `${peerPrefix}${hostId}`;
        const conn = peer.connect(fullHostId, { reliable: true });
        connections.push(conn);
        onConnectionChangeCallback(connections.length);
        setupConnectionEvents(conn, onConnect, onData);
    });

    peer.on('error', (err) => {
        console.error('PeerJS Joiner Error:', err);
        if (onError) onError(err.type || err);
    });
}

function setupConnectionEvents(conn, onConnect, onData) {
    if (!conn) return;

    conn.on('open', () => {
        console.log('Data connection is open.');
        onConnectionChangeCallback(connections.filter((c) => c && c.open).length || connections.length);
        if (onConnect) onConnect();
    });

    conn.on('data', (data) => {
        if (onData) onData(data);
    });

    conn.on('close', () => {
        console.log('Connection closed.');
        connections = connections.filter((c) => c.connectionId !== conn.connectionId);
        onConnectionChangeCallback(connections.length);
    });
}

/**
 * Sends data to all open peer connections.
 * @param {object} data - The data object to send.
 * @returns {boolean} - True if data was sent to at least one open peer, false otherwise.
 */
export function sendData(data) {
    let sent = false;
    if (connections.length > 0) {
        connections.forEach((conn) => {
            if (conn && conn.open) {
                conn.send(data);
                sent = true;
            }
        });
    }
    if (!sent) {
        console.warn('Cannot send data, no open connection.');
    }
    return sent;
}

/**
 * Destroys the current PeerJS instance and cleans up connections.
 */
export function destroyPeer() {
    if (connections.length > 0) {
        connections.forEach((conn) => conn.close());
        connections = [];
        onConnectionChangeCallback(0);
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    console.log('Peer instance destroyed.');
}
