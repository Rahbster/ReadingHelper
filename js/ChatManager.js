export class ChatManager {
    constructor(peerAdapter, identityProvider) {
        this.peerAdapter = peerAdapter;
        this.identityProvider = identityProvider;
        this.isEnabled = false;
        this.unreadCount = 0;
        
        this.dom = {
            messages: document.getElementById('messages'),
            input: document.getElementById('msg-input'),
            sendBtn: document.getElementById('btn-send'),
            badge: document.getElementById('chat-badge'),
            modal: document.getElementById('chat-modal'),
            btnOpenChat: document.getElementById('btn-open-chat')
        };

        this._setupEvents();
    }

    _setupEvents() {
        if (this.dom.sendBtn) {
            this.dom.sendBtn.addEventListener('click', () => this.sendMessage());
        }
        if (this.dom.input) {
            this.dom.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendMessage();
            });
        }
    }

    enable(state) {
        this.isEnabled = state;
        if (this.dom.btnOpenChat) {
            this.dom.btnOpenChat.disabled = !state;
        }
    }

    sendMessage() {
        if (!this.isEnabled) return;
        const content = this.dom.input.value.trim();
        if (!content) return;

        const identity = this.identityProvider();
        
        // Send to peer
        this.peerAdapter.send({ type: 'chat', content });

        // Render local
        this._appendMessage(content, identity.name, 'self');
        this.dom.input.value = '';
    }

    handleIncomingMessage(content, peerName) {
        this._appendMessage(content, peerName, 'remote');
        if (this.dom.modal.classList.contains('hidden')) {
            this.unreadCount++;
            this._updateBadge();
        }
    }

    resetUnread() {
        this.unreadCount = 0;
        this._updateBadge();
    }

    _updateBadge() {
        if (this.dom.badge) {
            this.dom.badge.textContent = this.unreadCount;
            this.dom.badge.classList.toggle('hidden', this.unreadCount === 0);
        }
    }

    _appendMessage(text, sender, type) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`;
        
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = sender;

        const content = document.createElement('div');
        content.className = 'content';
        content.textContent = text;

        msgDiv.appendChild(meta);
        msgDiv.appendChild(content);
        
        this.dom.messages.appendChild(msgDiv);
        this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
    }
}