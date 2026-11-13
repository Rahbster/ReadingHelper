/**
 * dom-utils.js
 * Shared HTML sanitization, word token normalization, native <dialog> helpers,
 * non-blocking prompt/confirm modals, and a child-safe Parent Gate.
 */

const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

const PARENT_GATE_SESSION_KEY = 'readingHelperParentUnlockedUntil';
const PARENT_GATE_TTL_MS = 15 * 60 * 1000; // 15 minutes per parent session

/**
 * Escapes untrusted strings for safe interpolation into HTML content or attributes.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Normalizes a tapped or spoken word token by converting curly apostrophes,
 * stripping leading/trailing quotes and punctuation, and lowercasing while
 * keeping internal apostrophes (e.g., "don't", "witch's") intact.
 * @param {string} raw
 * @returns {string}
 */
export function cleanWordToken(raw) {
    if (!raw) return '';
    return String(raw)
        .replace(/[\u2018\u2019\u201B`]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .trim()
        .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
        .toLowerCase();
}

/**
 * Checks whether the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Opens a <dialog> element as a top-layer modal, wiring light-dismiss on backdrop clicks.
 * @param {HTMLDialogElement|HTMLElement} dialogEl
 */
export function openDialog(dialogEl) {
    if (!dialogEl) return;
    dialogEl.classList.remove('hidden');

    if (typeof dialogEl.showModal === 'function') {
        if (!dialogEl.open) {
            try {
                dialogEl.showModal();
            } catch (e) {
                dialogEl.setAttribute('open', '');
            }
        }
        if (!dialogEl.dataset.backdropBound) {
            dialogEl.dataset.backdropBound = 'true';
            dialogEl.addEventListener('click', (e) => {
                if (e.target === dialogEl && dialogEl.dataset.noBackdropDismiss !== 'true') {
                    closeDialog(dialogEl);
                }
            });
        }
    }
}

/**
 * Closes a <dialog> element cleanly.
 * @param {HTMLDialogElement|HTMLElement} dialogEl
 */
export function closeDialog(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.close === 'function' && dialogEl.open) {
        dialogEl.close();
    }
    dialogEl.classList.add('hidden');
}

/**
 * Displays an accessible non-blocking confirmation dialog using native <dialog>.
 * @param {object} options
 * @returns {Promise<boolean>}
 */
export function showConfirmModal({
    title = 'Confirm',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false
} = {}) {
    if (typeof document === 'undefined') return Promise.resolve(false);

    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'modal dynamic-dialog';
        dialog.innerHTML = `
            <div class="modal-content">
                <h2>${escapeHtml(title)}</h2>
                <p class="dialog-message">${escapeHtml(message)}</p>
                <div class="modal-footer-buttons">
                    <button type="button" class="theme-button secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
                    <button type="button" class="theme-button ${destructive ? 'destructive' : ''}" data-action="confirm">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            closeDialog(dialog);
            dialog.remove();
            resolve(result);
        };

        dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
        dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            finish(false);
        });
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) finish(false);
        });

        document.body.appendChild(dialog);
        openDialog(dialog);
        dialog.querySelector('[data-action="confirm"]').focus();
    });
}

/**
 * Displays an accessible non-blocking text prompt dialog using native <dialog>.
 * @param {object} options
 * @returns {Promise<string|null>}
 */
export function showPromptModal({
    title = 'Enter Value',
    message = '',
    placeholder = '',
    defaultValue = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    allowEmpty = false
} = {}) {
    if (typeof document === 'undefined') return Promise.resolve(null);

    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'modal dynamic-dialog';
        dialog.innerHTML = `
            <form method="dialog" class="modal-content">
                <h2>${escapeHtml(title)}</h2>
                ${message ? `<p class="dialog-message">${escapeHtml(message)}</p>` : ''}
                <input type="text" class="dialog-text-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}" autocomplete="off">
                <div class="modal-footer-buttons">
                    <button type="button" class="theme-button secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
                    <button type="submit" class="theme-button" data-action="confirm">${escapeHtml(confirmText)}</button>
                </div>
            </form>
        `;

        const input = dialog.querySelector('.dialog-text-input');
        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            closeDialog(dialog);
            dialog.remove();
            resolve(val);
        };

        dialog.querySelector('form').addEventListener('submit', (e) => {
            e.preventDefault();
            const val = input.value.trim();
            if (!allowEmpty && !val) {
                input.focus();
                return;
            }
            finish(val);
        });
        dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            finish(null);
        });
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) finish(null);
        });

        document.body.appendChild(dialog);
        openDialog(dialog);
        input.focus();
        input.select();
    });
}

/**
 * Protects parent/admin actions from accidental taps by young children.
 * Unlocks for 15 minutes in sessionStorage once answered accurately.
 * @param {string} [actionName='Parent Settings']
 * @returns {Promise<boolean>}
 */
export async function requireParentGate(actionName = 'Parent Settings') {
    if (typeof window === 'undefined') return true;

    const unlockedUntil = Number(sessionStorage.getItem(PARENT_GATE_SESSION_KEY) || 0);
    if (unlockedUntil > Date.now()) {
        return true;
    }

    const a = Math.floor(Math.random() * 5) + 4; // 4..8
    const b = Math.floor(Math.random() * 5) + 3; // 3..7
    const expected = String(a * b);

    const answer = await showPromptModal({
        title: '🔒 Grown-Up Check',
        message: `To open ${actionName}, please solve: What is ${a} × ${b}?`,
        placeholder: 'Answer',
        confirmText: 'Unlock',
        cancelText: 'Cancel'
    });

    if (answer === null) return false;
    if (answer.trim() === expected) {
        sessionStorage.setItem(PARENT_GATE_SESSION_KEY, String(Date.now() + PARENT_GATE_TTL_MS));
        return true;
    }
    return false;
}
