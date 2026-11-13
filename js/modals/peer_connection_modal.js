import * as peerService from '../peer-service.js';
import { escapeHtml, openDialog, closeDialog, showConfirmModal } from '../utils/dom-utils.js';

export function showPeerConnectionModal(toastManager, config) {
    if (!document.getElementById('peer-modal-css')) {
        const link = document.createElement('link');
        link.id = 'peer-modal-css';
        link.rel = 'stylesheet';
        link.href = 'css/peer_connection_modal.css';
        document.head.appendChild(link);
    }

    if (document.getElementById('peer-modal')) return;

    const appPrefix = config.appPrefix || 'pwa';
    const peerPrefix = config.peerPrefix || 'pwa-';

    function getIdentity() {
        let guid = localStorage.getItem(`${appPrefix}_user_guid`);
        if (!guid) {
            guid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem(`${appPrefix}_user_guid`, guid);
        }
        const name = localStorage.getItem(`${appPrefix}_display_name`) || 'Anonymous';
        return { guid, name: String(name).slice(0, 50) };
    }

    function getPeers() {
        try {
            return JSON.parse(localStorage.getItem(`${appPrefix}_peers`) || '{}');
        } catch (e) {
            return {};
        }
    }

    function savePeer(guid, name) {
        if (!guid || getIdentity().guid === guid) return;
        const safeGuid = String(guid).slice(0, 64);
        const safeName = String(name || 'Peer').slice(0, 50);
        const peers = getPeers();
        peers[safeGuid] = { name: safeName, lastSeen: Date.now() };
        localStorage.setItem(`${appPrefix}_peers`, JSON.stringify(peers));
    }

    function removePeer(guid) {
        const peers = getPeers();
        delete peers[guid];
        localStorage.setItem(`${appPrefix}_peers`, JSON.stringify(peers));
    }

    const modalHTML = `
        <dialog id="peer-modal" class="modal">
            <div class="modal-content">
                <button type="button" id="close-peer-modal" class="close-modal" aria-label="Close Peer Connection">&times;</button>
                <h2>Peer Connection <button type="button" id="btn-peer-info" class="info-icon" title="How it works" aria-label="How Peer Connection Works">ℹ️</button></h2>
                <div class="peer-controls">
                    <div id="peer-setup">
                        <div class="role-selector">
                            <button type="button" id="select-host" class="role-btn">Host</button>
                            <button type="button" id="select-joiner" class="role-btn">Joiner</button>
                        </div>
                        <div id="panel-host" class="role-panel hidden">
                            <div class="step-box">
                                <h4>Host Session</h4>
                                <button type="button" id="btn-host-session">Start Hosting</button>
                                <div id="host-share-info" class="hidden">
                                    <p>Share this ID with the Joiner:</p>
                                    <div id="host-id-display" class="code-display">------</div>
                                </div>
                            </div>
                        </div>
                        <div id="panel-join" class="role-panel hidden">
                            <div class="step-box">
                                <h4>Join Session</h4>
                                <label for="joiner-id-input" style="display: block; margin-bottom: 0.5rem;">Enter 6-Digit Host ID:</label>
                                <input type="text" id="joiner-id-input" class="sdp-box" placeholder="Enter Host ID" maxlength="6" inputmode="numeric" style="text-align: center; font-size: 1.5rem; letter-spacing: 4px;">
                            </div>
                        </div>
                        <input type="text" id="peer-search-input" class="sdp-box hidden" placeholder="Search peers..." aria-label="Search recent peers" style="margin-bottom: 0.5rem;">
                        <div id="recent-peers-list" class="step-box hidden"></div>
                    </div>
                </div>
            </div>
        </dialog>
        <dialog id="peer-info-modal" class="modal hidden">
            <div class="modal-content">
                <button type="button" id="close-peer-info-modal" class="close-modal" aria-label="Close Info">&times;</button>
                <h2>How it Works</h2>
                <div class="info-content">
                    <h3>Host</h3>
                    <p>The Host initiates the session. They generate a unique ID (or use their own) which must be shared with the Joiner.</p>
                    <h3>Joiner</h3>
                    <p>The Joiner connects to a Host by entering the Host's 6-digit ID.</p>
                    <h3>Direct Connection</h3>
                    <p>Once connected, data is exchanged directly between devices (Peer-to-Peer) without going through a central server.</p>
                    <h3>Recent Peers</h3>
                    <p>When a connection is established, the Host and Joiner exchange their display names and a unique internal ID so you can reconnect easily later.</p>
                </div>
            </div>
        </dialog>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    let connectionRole = null;
    let isConnected = false;
    let currentRemoteName = 'Peer';

    const dom = {
        peerModal: document.getElementById('peer-modal'),
        closePeerModalBtn: document.getElementById('close-peer-modal'),
        peerInfoModal: document.getElementById('peer-info-modal'),
        btnPeerInfo: document.getElementById('btn-peer-info'),
        closePeerInfoModalBtn: document.getElementById('close-peer-info-modal'),
        selectHostBtn: document.getElementById('select-host'),
        selectJoinerBtn: document.getElementById('select-joiner'),
        panelHost: document.getElementById('panel-host'),
        panelJoin: document.getElementById('panel-join'),
        btnHostSession: document.getElementById('btn-host-session'),
        hostShareInfo: document.getElementById('host-share-info'),
        hostIdDisplay: document.getElementById('host-id-display'),
        joinerIdInput: document.getElementById('joiner-id-input'),
        peerSearchInput: document.getElementById('peer-search-input'),
        recentPeersList: document.getElementById('recent-peers-list')
    };

    function destroyModal() {
        closeDialog(dom.peerInfoModal);
        closeDialog(dom.peerModal);
        dom.peerModal?.remove();
        dom.peerInfoModal?.remove();
    }

    function renderPeerList(role) {
        const peers = getPeers();
        const filter = (dom.peerSearchInput?.value || '').toLowerCase();
        let listHTML = '<h5>Recent Peers</h5>';

        const filteredPeers = Object.entries(peers).filter(([, p]) =>
            String(p.name || '').toLowerCase().includes(filter)
        );

        if (Object.keys(peers).length === 0) {
            listHTML += '<p>No recent connections found.</p>';
        } else if (filteredPeers.length === 0) {
            listHTML += '<p>No peers match your search.</p>';
        } else {
            filteredPeers.forEach(([guid, peer]) => {
                const safeGuid = escapeHtml(guid);
                const safeName = escapeHtml(peer.name || 'Peer');
                const actionBtn = isConnected
                    ? `<span style="font-size:0.8em; color:#28a745;">Connected</span>`
                    : role === 'host'
                        ? `<button type="button" class="host-user-btn" data-guid="${safeGuid}">Host</button>`
                        : `<button type="button" class="join-user-btn" data-guid="${safeGuid}">Join</button>`;
                const lastSeenText = peer.lastSeen ? escapeHtml(new Date(peer.lastSeen).toLocaleString()) : '';

                listHTML += `
                    <div class="peer-item">
                        <div style="display: flex; flex-direction: column; text-align: left;">
                            <span class="peer-name">${safeName}</span>
                            <span style="font-size: 0.75rem; opacity: 0.7;">${lastSeenText}</span>
                        </div>
                        <div class="peer-item-actions">
                            ${actionBtn}
                            <button type="button" class="remove-peer-btn" data-guid="${safeGuid}" title="Remove Peer" aria-label="Remove ${safeName}">&times;</button>
                        </div>
                    </div>`;
            });
        }
        if (dom.recentPeersList) dom.recentPeersList.innerHTML = listHTML;
    }

    function selectRole(role) {
        connectionRole = role;
        dom.selectHostBtn.classList.toggle('selected', role === 'host');
        dom.selectJoinerBtn.classList.toggle('selected', role !== 'host');
        dom.panelHost.classList.toggle('hidden', role !== 'host');
        dom.panelJoin.classList.toggle('hidden', role === 'host');
        dom.recentPeersList.classList.remove('hidden');
        dom.peerSearchInput.classList.remove('hidden');
        renderPeerList(role);
    }

    function updateConnectionStatus(count) {
        isConnected = count > 0;
        if (config.onConnectionChange) config.onConnectionChange(isConnected, count);
        if (connectionRole && document.body.contains(dom.peerModal)) renderPeerList(connectionRole);
    }

    function handleDataReceived(data) {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'identity') {
            currentRemoteName = String(data.name || 'Peer').slice(0, 50);
            savePeer(data.guid, currentRemoteName);
            if (document.body.contains(dom.peerModal)) renderPeerList(connectionRole);
            toastManager.show(`Connected with ${currentRemoteName}`, 'info');
        } else {
            if (config.onDataReceived) config.onDataReceived(data, currentRemoteName);
        }
    }

    function handleConnectionEstablished() {
        toastManager.show('Connected to peer!', 'success');
        isConnected = true;
        if (config.onConnectionChange) config.onConnectionChange(true, 1);
        const identity = getIdentity();
        peerService.sendData({ type: 'identity', guid: identity.guid, name: identity.name });
        destroyModal();
    }

    function startHostingProcess(customId = null) {
        peerService.createHost(
            (id) => {
                if (dom.hostIdDisplay) dom.hostIdDisplay.textContent = id;
                dom.hostShareInfo?.classList.remove('hidden');
                toastManager.show('Session started. Waiting for peer...', 'info');
            },
            handleConnectionEstablished,
            handleDataReceived,
            (err) => toastManager.show(`Error: ${err.type || err}`, 'error'),
            updateConnectionStatus,
            customId
        );
    }

    function startJoiningProcess(hostId) {
        if (!hostId) return;
        peerService.joinHost(
            hostId,
            handleConnectionEstablished,
            handleDataReceived,
            (err) => toastManager.show(`Error: ${err.type || err}`, 'error'),
            updateConnectionStatus
        );
    }

    dom.closePeerModalBtn.addEventListener('click', destroyModal);
    dom.peerModal.addEventListener('cancel', (e) => {
        e.preventDefault();
        destroyModal();
    });
    dom.peerModal.addEventListener('click', (e) => {
        if (e.target === dom.peerModal) destroyModal();
    });

    dom.btnPeerInfo.addEventListener('click', () => openDialog(dom.peerInfoModal));
    dom.closePeerInfoModalBtn.addEventListener('click', () => closeDialog(dom.peerInfoModal));

    dom.selectHostBtn.addEventListener('click', () => selectRole('host'));
    dom.selectJoinerBtn.addEventListener('click', () => selectRole('joiner'));
    dom.peerSearchInput.addEventListener('input', () => renderPeerList(connectionRole));
    dom.btnHostSession.addEventListener('click', () => startHostingProcess());
    dom.joinerIdInput.addEventListener('input', () => {
        if (dom.joinerIdInput.value.trim().length === 6) startJoiningProcess(dom.joinerIdInput.value.trim());
    });
    dom.recentPeersList.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-guid]');
        if (!btn) return;
        const guid = btn.dataset.guid;
        if (!guid) return;

        if (btn.classList.contains('remove-peer-btn')) {
            const confirmed = await showConfirmModal({
                title: 'Remove Peer?',
                message: 'Are you sure you want to remove this peer from your recent list?',
                confirmText: 'Remove',
                destructive: true
            });
            if (confirmed) {
                removePeer(guid);
                btn.closest('.peer-item')?.remove();
            }
        } else if (btn.classList.contains('host-user-btn')) {
            startHostingProcess(getIdentity().guid);
        } else if (btn.classList.contains('join-user-btn')) {
            startJoiningProcess(guid);
        }
    });

    selectRole('host');
    peerService.initialize(peerPrefix);
    openDialog(dom.peerModal);
}
