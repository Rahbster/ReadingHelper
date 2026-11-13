import * as VoiceManager from './VoiceManager.js';
import { openDialog, closeDialog, requireParentGate } from './utils/dom-utils.js';
import { isSoundEnabled, setSoundEnabled } from './sound-effects.js';

export class UIManager {
    constructor(dom, chatManager, toastManager, options = {}) {
        this.dom = dom;
        this.chatManager = chatManager;
        this.toastManager = toastManager;
        this.onLeaveReaderView = options.onLeaveReaderView || null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        if (this.dom.hamburgerBtn) this.dom.hamburgerBtn.addEventListener('click', () => this.openNav());
        if (this.dom.closeSidenavBtn) this.dom.closeSidenavBtn.addEventListener('click', () => this.closeNav());
        if (this.dom.overlay) this.dom.overlay.addEventListener('click', () => this.closeNav());
        if (this.dom.themeToggle) this.dom.themeToggle.addEventListener('click', () => this.toggleTheme());
        if (this.dom.soundToggle) this.dom.soundToggle.addEventListener('click', () => this.toggleSound());
        if (this.dom.settingsNameInput) this.dom.settingsNameInput.addEventListener('change', (e) => this.updateDisplayName(e));
        if (this.dom.googleApiKeyInput) this.dom.googleApiKeyInput.addEventListener('change', (e) => this.updateGoogleApiKey(e));
        if (this.dom.getApiKeyHelpBtn) this.dom.getApiKeyHelpBtn.addEventListener('click', () => this.openApiKeyHelp());
        if (this.dom.btnOpenChat) this.dom.btnOpenChat.addEventListener('click', () => this.openChatModal());
        if (this.dom.closeChatModalBtn) this.dom.closeChatModalBtn.addEventListener('click', () => this.closeChatModal());
        if (this.dom.toggleDashboardBtn) {
            this.dom.toggleDashboardBtn.addEventListener('click', async () => {
                this.closeNav();
                await this.toggleDashboard();
            });
        }
        if (this.dom.dashboardBackBtn) {
            this.dom.dashboardBackBtn.addEventListener('click', () => this.showView('reader'));
        }
        if (this.dom.chooseStoryBtn) this.dom.chooseStoryBtn.addEventListener('click', () => this.openStoryModal());
        if (this.dom.storyModalXBtn) this.dom.storyModalXBtn.addEventListener('click', () => this.closeStoryModal());

        // Allow Escape key to close the side navigation drawer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.dom.sidenav && this.dom.sidenav.classList.contains('open')) {
                this.closeNav();
            }
        });
    }

    openNav() {
        VoiceManager.warmUp();
        if (this.dom.sidenav) {
            this.dom.sidenav.classList.add('open');
            this.dom.sidenav.setAttribute('aria-hidden', 'false');
            this.dom.sidenav.inert = false;
            this.dom.sidenav.removeAttribute('inert');
        }
        document.body.classList.add('nav-open');
        if (this.dom.overlay) this.dom.overlay.style.display = 'block';

        const name = localStorage.getItem('readinghelper_display_name') || '';
        if (this.dom.settingsNameInput) {
            this.dom.settingsNameInput.value = name;
        }
        const apiKey = localStorage.getItem('google_ai_api_key') || '';
        if (this.dom.googleApiKeyInput) {
            this.dom.googleApiKeyInput.value = apiKey;
        }
        this._syncSoundToggleUI();
        if (this.dom.closeSidenavBtn) {
            this.dom.closeSidenavBtn.focus();
        }
    }

    closeNav() {
        const focusWasInsideNav = Boolean(
            this.dom.sidenav && document.activeElement && this.dom.sidenav.contains(document.activeElement)
        );
        if (this.dom.sidenav) {
            this.dom.sidenav.classList.remove('open');
            this.dom.sidenav.setAttribute('aria-hidden', 'true');
            this.dom.sidenav.inert = true;
            this.dom.sidenav.setAttribute('inert', '');
        }
        document.body.classList.remove('nav-open');
        if (this.dom.overlay) this.dom.overlay.style.display = 'none';
        if (focusWasInsideNav && this.dom.hamburgerBtn) {
            this.dom.hamburgerBtn.focus();
        }
    }

    _applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        if (this.dom.themeToggle) {
            this.dom.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌓';
            this.dom.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme');
        }
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', theme === 'dark' ? '#1e1e1e' : '#A9C9FF');
        }
    }

    toggleTheme() {
        const currentTheme = document.body.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        this._applyTheme(newTheme);
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
            this._applyTheme(savedTheme);
        } else {
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            this._applyTheme(prefersDark ? 'dark' : 'light');
        }
        this._syncSoundToggleUI();
    }

    _syncSoundToggleUI() {
        if (!this.dom.soundToggle) return;
        const enabled = isSoundEnabled();
        this.dom.soundToggle.textContent = enabled ? '🔊' : '🔇';
        this.dom.soundToggle.setAttribute('aria-pressed', String(enabled));
        this.dom.soundToggle.setAttribute('aria-label', enabled ? 'Mute Sound Effects' : 'Enable Sound Effects');
    }

    toggleSound() {
        const next = !isSoundEnabled();
        setSoundEnabled(next);
        this._syncSoundToggleUI();
        if (this.toastManager) {
            this.toastManager.show(next ? 'Sound effects enabled.' : 'Sound effects muted.', 'info', 1500);
        }
    }

    openChatModal() {
        this.closeNav();
        openDialog(this.dom.chatModal);
        if (this.chatManager) this.chatManager.resetUnread();
    }

    closeChatModal() {
        closeDialog(this.dom.chatModal);
    }

    showView(viewName) {
        if (viewName !== 'reader' && typeof this.onLeaveReaderView === 'function') {
            this.onLeaveReaderView();
        }

        this.dom.readerView?.classList.add('hidden');
        this.dom.gameView?.classList.add('hidden');
        this.dom.dashboardView?.classList.add('hidden');

        const isReader = viewName === 'reader';
        document.querySelectorAll('.header-reader-only').forEach((el) => {
            el.classList.toggle('hidden', !isReader);
        });

        if (isReader) {
            this.dom.readerView?.classList.remove('hidden');
            if (this.dom.toggleDashboardBtn) this.dom.toggleDashboardBtn.querySelector('span').textContent = 'Dashboard';
        } else if (viewName === 'game') {
            this.dom.gameView?.classList.remove('hidden');
        } else if (viewName === 'dashboard') {
            this.dom.dashboardView?.classList.remove('hidden');
            if (this.dom.toggleDashboardBtn) this.dom.toggleDashboardBtn.querySelector('span').textContent = 'Back to Reader';
        }
    }

    async updateGoogleApiKey(event) {
        const allowed = await requireParentGate('API Key Settings');
        if (!allowed) {
            event.target.value = localStorage.getItem('google_ai_api_key') || '';
            if (this.toastManager) this.toastManager.show('Grown-up check cancelled.', 'info');
            return;
        }
        const key = event.target.value.trim();
        localStorage.setItem('google_ai_api_key', key);
        if (this.dom.apiKeyStatus) this.dom.apiKeyStatus.textContent = '';
        if (this.toastManager) this.toastManager.show('Google AI API Key saved locally.', 'success');
    }

    openApiKeyHelp() {
        window.open('instructions.html', '_blank', 'noopener');
    }

    updateDisplayName(event) {
        const name = event.target.value.trim();
        if (name) {
            localStorage.setItem('readinghelper_display_name', name);
        }
    }

    async toggleDashboard() {
        const isDashboardHidden = this.dom.dashboardView.classList.contains('hidden');
        if (isDashboardHidden) {
            const allowed = await requireParentGate('Parent Dashboard');
            if (!allowed) {
                if (this.toastManager) this.toastManager.show('Grown-up check did not match.', 'info', 2000);
                return;
            }
            this.showView('dashboard');
        } else {
            this.showView('reader');
        }
    }

    openStoryModal() {
        openDialog(this.dom.storyModal);
    }

    closeStoryModal() {
        closeDialog(this.dom.storyModal);
    }
}
