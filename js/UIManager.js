export class UIManager {
    constructor(dom, chatManager, toastManager) {
        this.dom = dom;
        this.chatManager = chatManager;
        this.toastManager = toastManager;
        this.setupEventListeners();
    }

    setupEventListeners() {
        if (this.dom.hamburgerBtn) this.dom.hamburgerBtn.addEventListener('click', () => this.openNav());
        if (this.dom.closeSidenavBtn) this.dom.closeSidenavBtn.addEventListener('click', () => this.closeNav());
        if (this.dom.overlay) this.dom.overlay.addEventListener('click', () => this.closeNav());
        if (this.dom.themeToggle) this.dom.themeToggle.addEventListener('click', () => this.toggleTheme());
        if (this.dom.settingsNameInput) this.dom.settingsNameInput.addEventListener('change', (e) => this.updateDisplayName(e));
        if (this.dom.googleApiKeyInput) this.dom.googleApiKeyInput.addEventListener('change', (e) => this.updateGoogleApiKey(e));
        if (this.dom.getApiKeyHelpBtn) this.dom.getApiKeyHelpBtn.addEventListener('click', () => this.openApiKeyHelp());
        if (this.dom.btnOpenChat) this.dom.btnOpenChat.addEventListener('click', () => this.openChatModal());
        if (this.dom.closeChatModalBtn) this.dom.closeChatModalBtn.addEventListener('click', () => this.closeChatModal());
        if (this.dom.toggleDashboardBtn) this.dom.toggleDashboardBtn.addEventListener('click', () => { this.toggleDashboard(); this.closeNav(); });
        if (this.dom.chooseStoryBtn) this.dom.chooseStoryBtn.addEventListener('click', () => this.openStoryModal());
        if (this.dom.storyModalXBtn) this.dom.storyModalXBtn.addEventListener('click', () => this.closeStoryModal());
        if (this.dom.storyModal) this.dom.storyModal.addEventListener('click', (e) => { if (e.target === this.dom.storyModal) this.closeStoryModal(); });
    }

    openNav() {
        this.dom.sidenav.style.width = "280px";
        this.dom.overlay.style.display = "block";
        // Populate settings name when opening nav
        const name = localStorage.getItem('readinghelper_display_name') || '';
        if (this.dom.settingsNameInput) {
            this.dom.settingsNameInput.value = name;
        }
        // Populate API Key
        const apiKey = localStorage.getItem('google_ai_api_key') || '';
        if (this.dom.googleApiKeyInput) {
            this.dom.googleApiKeyInput.value = apiKey;
        }
    }

    closeNav() {
        this.dom.sidenav.style.width = "0";
        this.dom.overlay.style.display = "none";
    }

    toggleTheme() {
        const currentTheme = document.body.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        if (this.dom.themeToggle) this.dom.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌓';
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.body.setAttribute('data-theme', savedTheme);
            if (this.dom.themeToggle) this.dom.themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌓';
        }
    }

    openChatModal() {
        this.closeNav();
        this.dom.chatModal.classList.remove('hidden');
        if (this.chatManager) this.chatManager.resetUnread();
    }

    closeChatModal() {
        this.dom.chatModal.classList.add('hidden');
    }

    updateGoogleApiKey(event) {
        const key = event.target.value.trim();
        localStorage.setItem('google_ai_api_key', key);
        if (this.dom.apiKeyStatus) this.dom.apiKeyStatus.textContent = ''; // Reset status icon
        if (this.toastManager) this.toastManager.show('Google AI API Key saved locally.', 'success');
    }

    openApiKeyHelp() {
        window.open('instructions.html', '_blank');
    }

    updateDisplayName(event) {
        const name = event.target.value.trim();
        if (name) {
            localStorage.setItem('readinghelper_display_name', name);
        }
    }

    toggleDashboard() {
        const isDashboardVisible = this.dom.dashboardView.classList.toggle('hidden');
        this.dom.readerView.classList.toggle('hidden', !isDashboardVisible);
        
        // Update button text and visibility based on view
        this.dom.toggleDashboardBtn.querySelector('span').textContent = isDashboardVisible ? 'Dashboard' : 'Back to Reader';
        this.dom.chooseStoryBtn.classList.toggle('hidden', !isDashboardVisible);
    }

    openStoryModal() {
        this.dom.storyModal.classList.remove('hidden');
    }

    closeStoryModal() {
        this.dom.storyModal.classList.add('hidden');
    }
}
