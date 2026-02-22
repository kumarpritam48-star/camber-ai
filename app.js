/* ========================================
   CAMBER AI — PDF Chat Assistant Logic
   Google OAuth + API Key Auth
   ======================================== */

// ============ Configuration ============
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ============ State ============
const state = {
    user: null,
    authMode: 'apikey', // 'google' or 'apikey'
    apiKey: '',
    accessToken: '',
    pdfTexts: [],
    chatHistory: [],
    language: 'auto',
    isLoading: false
};

// ============ DOM ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const els = {};

// ============ Initialize ============
function init() {
    // Check session
    const session = localStorage.getItem('camber_session');
    if (!session) { window.location.href = 'login.html'; return; }

    try {
        state.user = JSON.parse(session);
    } catch (e) { window.location.href = 'login.html'; return; }

    if (!state.user) { window.location.href = 'login.html'; return; }

    // Set auth mode
    state.authMode = state.user.authMode || 'apikey';
    state.accessToken = state.user.accessToken || '';
    state.apiKey = state.user.apiKey || localStorage.getItem('camber_api_key') || '';

    cacheElements();
    showUserInfo();
    createParticles();
    bindEvents();

    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
    }
}

function cacheElements() {
    els.uploadZone = $('#uploadZone');
    els.pdfInput = $('#pdfInput');
    els.pdfListSection = $('#pdfListSection');
    els.pdfList = $('#pdfList');
    els.chatContainer = $('#chatContainer');
    els.welcomeScreen = $('#welcomeScreen');
    els.messages = $('#messages');
    els.messageInput = $('#messageInput');
    els.sendBtn = $('#sendBtn');
    els.newChatBtn = $('#newChatBtn');
    els.sidebar = $('#sidebar');
    els.mobileMenuBtn = $('#mobileMenuBtn');
    els.toastContainer = $('#toastContainer');
    els.particles = $('#particles');
    els.logoutBtn = $('#logoutBtn');
    els.userName = $('#userName');
    els.userEmail = $('#userEmail');
    els.userAvatarInitial = $('#userAvatarInitial');
    els.welcomeTitle = $('#welcomeTitle');
    els.themeToggle = $('#themeToggle');
    els.themeIcon = $('#themeIcon');
    els.themeLabel = $('#themeLabel');
}

function showUserInfo() {
    const name = state.user.name || 'User';
    const email = state.user.email || (state.authMode === 'google' ? 'Google Account' : 'API Key');
    if (els.userName) els.userName.textContent = name;
    if (els.userEmail) els.userEmail.textContent = email;
    if (els.userAvatarInitial) els.userAvatarInitial.textContent = name.charAt(0).toUpperCase();
    if (els.welcomeTitle) els.welcomeTitle.textContent = `Welcome, ${name.split(' ')[0]}! 👋`;
}

// ============ Particles ============
function createParticles() {
    const c = els.particles;
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div'); p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDelay = Math.random() * 8 + 's';
        p.style.animationDuration = (6 + Math.random() * 6) + 's';
        p.style.background = ['#818cf8', '#c084fc', '#f472b6'][Math.floor(Math.random() * 3)];
        p.style.width = (1 + Math.random() * 2) + 'px'; p.style.height = p.style.width;
        c.appendChild(p);
    }
}

// ============ Events ============
function bindEvents() {
    els.logoutBtn.addEventListener('click', handleLogout);
    els.uploadZone.addEventListener('click', () => els.pdfInput.click());
    els.pdfInput.addEventListener('change', handlePdfSelect);
    els.uploadZone.addEventListener('dragover', handleDragOver);
    els.uploadZone.addEventListener('dragleave', handleDragLeave);
    els.uploadZone.addEventListener('drop', handleDrop);
    els.sendBtn.addEventListener('click', sendMessage);
    els.messageInput.addEventListener('keydown', handleInputKeydown);
    els.messageInput.addEventListener('input', autoResizeTextarea);
    els.newChatBtn.addEventListener('click', startNewChat);
    $$('.lang-btn').forEach(btn => btn.addEventListener('click', () => setLanguage(btn.dataset.lang)));
    els.mobileMenuBtn.addEventListener('click', toggleSidebar);
    els.themeToggle.addEventListener('click', toggleTheme);
    document.addEventListener('click', (e) => { if (e.target.classList.contains('sidebar-overlay')) closeSidebar(); });
    initTheme();
}

// ============ Theme ============
function initTheme() {
    const saved = localStorage.getItem('camber_theme') || 'dark';
    applyTheme(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('camber_theme', next);
    showToast(next === 'light' ? 'Light mode ☀️' : 'Dark mode 🌙', 'info');
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    if (els.themeIcon) els.themeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
    if (els.themeLabel) els.themeLabel.textContent = theme === 'light' ? 'Light Mode' : 'Dark Mode';
}

// ============ Logout ============
function handleLogout() {
    localStorage.removeItem('camber_session');
    showToast('Signed out!', 'info');
    setTimeout(() => { window.location.href = 'login.html'; }, 500);
}

// ============ PDF ============
function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); els.uploadZone.classList.add('drag-over'); }
function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); els.uploadZone.classList.remove('drag-over'); }
function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); els.uploadZone.classList.remove('drag-over');
    const f = e.dataTransfer.files;
    if (f.length > 0 && f[0].type === 'application/pdf') processPdf(f[0]);
    else showToast('Please upload a PDF file', 'error');
}
function handlePdfSelect(e) { if (e.target.files[0]) processPdf(e.target.files[0]); e.target.value = ''; }

async function processPdf(file) {
    if (typeof pdfjsLib === 'undefined') { showToast('PDF.js not loaded. Check internet.', 'error'); return; }
    const pEl = document.createElement('div'); pEl.className = 'pdf-processing';
    pEl.innerHTML = `<div class="spinner"></div><span class="pdf-processing-text">Processing "${file.name}"...</span>`;
    els.uploadZone.parentNode.appendChild(pEl);

    try {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            text += `\n--- Page ${i} ---\n` + tc.items.map(x => x.str).join(' ');
        }
        if (text.trim().length < 10) { showToast('PDF mein text nahi mila.', 'error'); pEl.remove(); return; }
        state.pdfTexts.push({ name: file.name, text: text.trim(), pages: pdf.numPages });
        renderPdfList();
        showToast(`"${file.name}" loaded! (${pdf.numPages} pages) 📄`, 'success');
        pEl.remove();
    } catch (e) { console.error(e); showToast('PDF processing failed.', 'error'); pEl.remove(); }
}

function renderPdfList() {
    if (!state.pdfTexts.length) { els.pdfListSection.style.display = 'none'; return; }
    els.pdfListSection.style.display = 'block';
    els.pdfList.innerHTML = state.pdfTexts.map((p, i) => `
        <div class="pdf-item">
            <div class="pdf-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></div>
            <div class="pdf-item-info"><div class="pdf-item-name" title="${p.name}">${p.name}</div><div class="pdf-item-meta">${p.pages} pages • ${(p.text.length / 1000).toFixed(1)}K</div></div>
            <button class="pdf-item-remove" onclick="removePdf(${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        </div>`).join('');
}

function removePdf(i) { const n = state.pdfTexts[i].name; state.pdfTexts.splice(i, 1); renderPdfList(); showToast(`"${n}" removed`, 'info'); }

// ============ Language ============
function setLanguage(lang) {
    state.language = lang;
    $$('.lang-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-lang="${lang}"]`).classList.add('active');
    showToast(`Language: ${lang === 'auto' ? 'Auto' : lang}`, 'info');
}

// ============ Chat ============
function handleInputKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResizeTextarea() { const t = els.messageInput; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }

async function sendMessage() {
    const text = els.messageInput.value.trim();
    if (!text || state.isLoading) return;

    // Check auth
    if (state.authMode === 'google' && !state.accessToken) {
        showToast('Token expired! Please sign in again.', 'error');
        handleLogout();
        return;
    }
    if (state.authMode === 'apikey' && !state.apiKey) {
        showToast('API key missing! Sign in again.', 'error');
        return;
    }

    els.welcomeScreen.style.display = 'none';
    addMessageToUI('user', text);
    els.messageInput.value = ''; els.messageInput.style.height = 'auto';

    state.isLoading = true; els.sendBtn.disabled = true;
    const typingEl = showTypingIndicator();

    try {
        const response = await callGeminiAPI(text);
        typingEl.remove();
        addMessageToUI('ai', response);
    } catch (error) {
        typingEl.remove();
        console.error('API error:', error);
        let errorMsg = 'Something went wrong. Please try again.';
        if (error.message.includes('401') || error.message.includes('token')) {
            errorMsg = '🔄 Token expired! Please sign out and sign in again.';
        } else if (error.message.includes('403') || error.message.includes('API key')) {
            errorMsg = '❌ Auth failed. Sign out karke dobara sign in karo.';
        } else if (error.message.includes('429') || error.message.includes('quota')) {
            errorMsg = '⚠️ Quota exceeded. Thoda wait karo (1-2 min) aur phir try karo.';
        } else if (error.message.includes('network') || error.message.includes('Failed to fetch')) {
            errorMsg = '🌐 Network error. Internet check karo.';
        }
        addMessageToUI('ai', errorMsg);
        showToast('API call failed', 'error');
    } finally {
        state.isLoading = false; els.sendBtn.disabled = false; els.messageInput.focus();
    }
}

async function callGeminiAPI(userMessage) {
    const systemContext = buildSystemPrompt();
    const requestBody = {
        systemInstruction: { parts: [{ text: systemContext }] },
        contents: [...state.chatHistory, { role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.8, topP: 0.95, topK: 40, maxOutputTokens: 8192 },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };

    // Choose auth method
    let apiUrl, headers;
    if (state.authMode === 'google' && state.accessToken) {
        apiUrl = GEMINI_API_URL;
        headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.accessToken };
    } else {
        apiUrl = GEMINI_API_URL + '?key=' + state.apiKey;
        headers = { 'Content-Type': 'application/json' };
    }

    const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err?.error?.message || 'HTTP ' + response.status;
        if (response.status === 401) throw new Error('401 token expired');
        if (response.status === 403) throw new Error('403 API key/auth failed: ' + msg);
        if (response.status === 429) throw new Error('429 quota exceeded');
        throw new Error(msg);
    }

    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error('Empty response');

    state.chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });
    state.chatHistory.push({ role: 'model', parts: [{ text: aiText }] });
    return aiText;
}

function buildSystemPrompt() {
    let p = `You are "Camber AI", an advanced AI assistant for Civil Engineering. You analyze PDFs, perform calculations, and discuss documents in Hindi, English, and Hinglish.

RULES:
- Summarize uploaded PDFs first, then ask what to discuss
- Show step-by-step working for calculations
- Use markdown formatting (tables, lists, headers, code blocks)
- Match the user's language
- Use emoji sparingly (✅, 📊, 🏗️)
- Be proactive and suggest areas to explore
`;
    if (state.language !== 'auto') {
        const m = { hindi: 'Reply ONLY in Hindi.', english: 'Reply ONLY in English.', hinglish: 'Reply in Hinglish.' };
        p += '\nLANGUAGE: ' + m[state.language];
    }
    if (state.pdfTexts.length) {
        p += '\n\n=== DOCUMENTS ===\n';
        state.pdfTexts.forEach((d, i) => {
            p += `\n--- Doc ${i + 1}: "${d.name}" (${d.pages}p) ---\n`;
            p += d.text.length > 30000 ? d.text.substring(0, 30000) + '\n[truncated]\n' : d.text + '\n';
        });
        p += '=== END ===\n';
    }
    return p;
}

// ============ UI ============
function addMessageToUI(role, text) {
    const div = document.createElement('div'); div.className = 'message ' + role;
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const avatar = role === 'user' ? (state.user?.name || 'U').charAt(0).toUpperCase() : '✦';
    let html = text;
    if (role === 'ai' && typeof marked !== 'undefined') { try { html = marked.parse(text); } catch (e) { html = text.replace(/\n/g, '<br>'); } }
    else { html = escapeHtml(text).replace(/\n/g, '<br>'); }
    div.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-content"><div class="message-bubble">${html}</div><div class="message-time">${time}</div></div>`;
    els.messages.appendChild(div); scrollToBottom();
}

function showTypingIndicator() {
    const d = document.createElement('div'); d.className = 'typing-indicator';
    d.innerHTML = `<div class="message-avatar" style="background:var(--accent-gradient-subtle);border:1px solid var(--border-color);color:var(--accent-1);">✦</div><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    els.messages.appendChild(d); scrollToBottom(); return d;
}

function scrollToBottom() { requestAnimationFrame(() => { els.chatContainer.scrollTop = els.chatContainer.scrollHeight; }); }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ============ New Chat / Sidebar ============
function startNewChat() { state.chatHistory = []; state.pdfTexts = []; els.messages.innerHTML = ''; els.welcomeScreen.style.display = ''; renderPdfList(); showToast('New chat! 🆕', 'info'); closeSidebar(); }
function toggleSidebar() { els.sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); }
function openSidebar() { els.sidebar.classList.add('open'); let o = document.querySelector('.sidebar-overlay'); if (!o) { o = document.createElement('div'); o.className = 'sidebar-overlay'; document.body.appendChild(o); } o.classList.add('active'); }
function closeSidebar() { els.sidebar.classList.remove('open'); const o = document.querySelector('.sidebar-overlay'); if (o) o.classList.remove('active'); }

// ============ Toast ============
function showToast(msg, type = 'info') {
    const t = document.createElement('div'); t.className = 'toast ' + type;
    t.innerHTML = `<span>${{ success: '✅', error: '❌', info: 'ℹ️' }[type] || 'ℹ️'}</span><span>${msg}</span>`;
    els.toastContainer.appendChild(t);
    setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ============ Start ============
document.addEventListener('DOMContentLoaded', init);
