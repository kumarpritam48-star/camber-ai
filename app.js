/* ========================================
   CAMBER AI — Full-Featured AI Assistant
   Multi-format uploads, Conversation History,
   Downloadable Responses, Multi-user
   ======================================== */

// ============ Configuration ============
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const DB_NAME = 'CamberAI';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';
const RETENTION_DAYS = 15;

// PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ============ State ============
const state = {
    user: null,
    authMode: 'apikey',
    apiKey: '',
    accessToken: '',
    uploadedFiles: [],       // {name, type, content, base64?, preview?}
    chatHistory: [],         // Gemini format
    chatMessages: [],        // UI messages {role, text, files?, timestamp}
    language: 'auto',
    isLoading: false,
    currentConvoId: null,
    db: null
};

// ============ DOM ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const els = {};

// Allowed file types
const ALLOWED_TYPES = {
    'application/pdf': { icon: '📄', label: 'PDF', ext: 'pdf' },
    'image/jpeg': { icon: '🖼️', label: 'Image', ext: 'jpg' },
    'image/jpg': { icon: '🖼️', label: 'Image', ext: 'jpg' },
    'image/png': { icon: '🖼️', label: 'Image', ext: 'png' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: '📝', label: 'Word', ext: 'docx' },
    'application/msword': { icon: '📝', label: 'Word', ext: 'doc' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: '📊', label: 'Excel', ext: 'xlsx' },
    'application/vnd.ms-excel': { icon: '📊', label: 'Excel', ext: 'xls' },
    'text/csv': { icon: '📊', label: 'CSV', ext: 'csv' }
};

const ACCEPT_STRING = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv';

// ============ IndexedDB ============
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('userEmail', 'userEmail', { unique: false });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
        };
        req.onsuccess = (e) => { state.db = e.target.result; resolve(state.db); };
        req.onerror = (e) => { console.error('IndexedDB error:', e); reject(e); };
    });
}

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 8); }

function getUserEmail() { return state.user?.email || state.user?.name || 'anonymous'; }

async function saveConversation() {
    if (!state.db || !state.currentConvoId) return;
    const convo = {
        id: state.currentConvoId,
        userEmail: getUserEmail(),
        title: getConversationTitle(),
        messages: state.chatMessages,
        files: state.uploadedFiles.map(f => ({ name: f.name, type: f.type, icon: f.icon })),
        createdAt: state._convoCreatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    return new Promise((resolve, reject) => {
        const tx = state.db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(convo);
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
}

function getConversationTitle() {
    const first = state.chatMessages.find(m => m.role === 'user');
    if (first) return first.text.substring(0, 50) + (first.text.length > 50 ? '...' : '');
    return 'New Chat';
}

async function loadConversations() {
    if (!state.db) return [];
    const email = getUserEmail();
    return new Promise((resolve) => {
        const tx = state.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('userEmail');
        const req = index.getAll(email);
        req.onsuccess = () => {
            const convos = req.result || [];
            convos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            resolve(convos);
        };
        req.onerror = () => resolve([]);
    });
}

async function loadConversation(id) {
    if (!state.db) return null;
    return new Promise((resolve) => {
        const tx = state.db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function deleteConversation(id) {
    if (!state.db) return;
    return new Promise((resolve) => {
        const tx = state.db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = resolve;
    });
}

async function cleanOldConversations() {
    if (!state.db) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const all = await loadConversations();
    for (const c of all) {
        if (new Date(c.updatedAt) < cutoff) {
            await deleteConversation(c.id);
        }
    }
}

// ============ Initialize ============
async function init() {
    const session = localStorage.getItem('camber_session');
    if (!session) { window.location.href = 'login.html'; return; }
    try { state.user = JSON.parse(session); } catch (e) { window.location.href = 'login.html'; return; }
    if (!state.user) { window.location.href = 'login.html'; return; }

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

    // Init DB and load conversations
    try {
        await openDB();
        await cleanOldConversations();
        await renderConversationList();
    } catch (e) { console.error('DB init error:', e); }

    startNewChat(true);
}

function cacheElements() {
    els.uploadZone = $('#uploadZone');
    els.fileInput = $('#fileInput');
    els.fileListSection = $('#fileListSection');
    els.fileList = $('#fileList');
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
    els.attachBtn = $('#attachBtn');
    els.attachInput = $('#attachInput');
    els.pendingFiles = $('#pendingFiles');
    els.convoList = $('#convoList');
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
    els.uploadZone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', handleFileSelect);
    els.uploadZone.addEventListener('dragover', handleDragOver);
    els.uploadZone.addEventListener('dragleave', handleDragLeave);
    els.uploadZone.addEventListener('drop', handleDrop);
    els.sendBtn.addEventListener('click', sendMessage);
    els.messageInput.addEventListener('keydown', handleInputKeydown);
    els.messageInput.addEventListener('input', autoResizeTextarea);
    els.newChatBtn.addEventListener('click', () => startNewChat());
    $$('.lang-btn').forEach(btn => btn.addEventListener('click', () => setLanguage(btn.dataset.lang)));
    els.mobileMenuBtn.addEventListener('click', toggleSidebar);
    els.themeToggle.addEventListener('click', toggleTheme);
    els.attachBtn.addEventListener('click', () => els.attachInput.click());
    els.attachInput.addEventListener('change', handleAttachFiles);
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
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    if (els.themeIcon) els.themeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
    if (els.themeLabel) els.themeLabel.textContent = theme === 'light' ? 'Light Mode' : 'Dark Mode';
}

// ============ Logout ============
function handleLogout() {
    localStorage.removeItem('camber_session');
    showToast('Signed out!', 'info');
    setTimeout(() => { window.location.href = 'login.html'; }, 500);
}

// ============ File Upload (Sidebar) ============
function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); els.uploadZone.classList.add('drag-over'); }
function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); els.uploadZone.classList.remove('drag-over'); }
function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); els.uploadZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => processFile(f));
}
function handleFileSelect(e) {
    Array.from(e.target.files).forEach(f => processFile(f));
    e.target.value = '';
}

// ============ Attach Files (Chat Input) ============
let pendingAttachments = []; // Files queued for next message
function handleAttachFiles(e) {
    Array.from(e.target.files).forEach(f => {
        const info = ALLOWED_TYPES[f.type];
        if (!info) { showToast(`${f.name} ka format supported nahi hai`, 'error'); return; }
        pendingAttachments.push(f);
        renderPendingFiles();
    });
    e.target.value = '';
}
function renderPendingFiles() {
    if (!els.pendingFiles) return;
    if (pendingAttachments.length === 0) { els.pendingFiles.style.display = 'none'; return; }
    els.pendingFiles.style.display = 'flex';
    els.pendingFiles.innerHTML = pendingAttachments.map((f, i) => {
        const info = ALLOWED_TYPES[f.type] || { icon: '📎', label: 'File' };
        return `<div class="pending-file-chip"><span>${info.icon}</span><span class="pending-file-name">${f.name}</span><button class="pending-file-remove" onclick="removePendingFile(${i})">×</button></div>`;
    }).join('');
}
function removePendingFile(i) { pendingAttachments.splice(i, 1); renderPendingFiles(); }

// ============ File Processing ============
async function processFile(file) {
    const info = ALLOWED_TYPES[file.type];
    if (!info) { showToast(`"${file.name}" — ye format supported nahi hai.`, 'error'); return; }

    const pEl = document.createElement('div'); pEl.className = 'file-processing';
    pEl.innerHTML = `<div class="spinner"></div><span class="file-processing-text">Processing "${file.name}"...</span>`;
    els.uploadZone.parentNode.appendChild(pEl);

    try {
        let fileData = { name: file.name, type: file.type, icon: info.icon, label: info.label, ext: info.ext };

        if (file.type === 'application/pdf') {
            fileData = await processPdf(file, fileData);
        } else if (file.type.startsWith('image/')) {
            fileData = await processImage(file, fileData);
        } else if (file.type.includes('word') || file.type === 'application/msword') {
            fileData = await processWord(file, fileData);
        } else if (file.type.includes('spreadsheet') || file.type.includes('excel') || file.type === 'text/csv') {
            fileData = await processSpreadsheet(file, fileData);
        }

        state.uploadedFiles.push(fileData);
        renderFileList();
        showToast(`"${file.name}" loaded! ${info.icon}`, 'success');
        await saveConversation();
    } catch (e) {
        console.error('File processing error:', e);
        showToast(`"${file.name}" process nahi ho paya: ${e.message}`, 'error');
    } finally { pEl.remove(); }
}

async function processPdf(file, fileData) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded');
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        text += `\n--- Page ${i} ---\n` + tc.items.map(x => x.str).join(' ');
    }
    if (text.trim().length < 10) throw new Error('PDF mein text nahi mila');
    fileData.content = text.trim();
    fileData.pages = pdf.numPages;
    fileData.meta = `${pdf.numPages} pages • ${(text.length / 1000).toFixed(1)}K chars`;
    return fileData;
}

async function processImage(file, fileData) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            fileData.base64 = e.target.result.split(',')[1]; // Remove data:image/...;base64, prefix
            fileData.mimeType = file.type;
            fileData.preview = e.target.result; // Full data URL for preview
            fileData.meta = `${(file.size / 1024).toFixed(0)} KB`;
            fileData.content = `[Image: ${file.name}]`;
            resolve(fileData);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function processWord(file, fileData) {
    if (typeof mammoth === 'undefined') throw new Error('Word processing library not loaded');
    const ab = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: ab });
    if (!result.value || result.value.trim().length < 5) throw new Error('Word file mein text nahi mila');
    fileData.content = result.value.trim();
    fileData.meta = `${(result.value.length / 1000).toFixed(1)}K chars`;
    return fileData;
}

async function processSpreadsheet(file, fileData) {
    if (file.type === 'text/csv') {
        // CSV: read as text
        const text = await file.text();
        fileData.content = text;
        const rows = text.split('\n').length;
        fileData.meta = `${rows} rows • CSV`;
        return fileData;
    }
    // Excel: use SheetJS
    if (typeof XLSX === 'undefined') throw new Error('Excel processing library not loaded');
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    let allText = '';
    wb.SheetNames.forEach(name => {
        const sheet = wb.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        allText += `\n--- Sheet: ${name} ---\n${csv}`;
    });
    fileData.content = allText.trim();
    fileData.meta = `${wb.SheetNames.length} sheet(s)`;
    return fileData;
}

// ============ File List (Sidebar) ============
function renderFileList() {
    if (!state.uploadedFiles.length) { if (els.fileListSection) els.fileListSection.style.display = 'none'; return; }
    if (els.fileListSection) els.fileListSection.style.display = 'block';
    if (!els.fileList) return;
    els.fileList.innerHTML = state.uploadedFiles.map((f, i) => `
        <div class="file-item">
            <div class="file-item-icon">${f.icon}</div>
            <div class="file-item-info">
                <div class="file-item-name" title="${f.name}">${f.name}</div>
                <div class="file-item-meta">${f.meta || f.label}</div>
            </div>
            <button class="file-item-remove" onclick="removeFile(${i})" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>`).join('');
}

function removeFile(i) {
    const n = state.uploadedFiles[i].name;
    state.uploadedFiles.splice(i, 1);
    renderFileList();
    showToast(`"${n}" removed`, 'info');
    saveConversation();
}

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
    if (!text && pendingAttachments.length === 0) return;
    if (state.isLoading) return;

    // Check auth
    if (state.authMode === 'google' && !state.accessToken) {
        showToast('Token expired! Please sign in again.', 'error');
        handleLogout(); return;
    }
    if (state.authMode === 'apikey' && !state.apiKey) {
        showToast('API key missing! Sign in again.', 'error'); return;
    }

    els.welcomeScreen.style.display = 'none';

    // Process pending attachments first
    const msgFiles = [];
    for (const file of pendingAttachments) {
        const info = ALLOWED_TYPES[file.type] || { icon: '📎', label: 'File' };
        const fileData = { name: file.name, type: file.type, icon: info.icon, label: info.label };

        if (file.type.startsWith('image/')) {
            const processed = await processImage(file, { ...fileData });
            state.uploadedFiles.push(processed);
            msgFiles.push(processed);
        } else if (file.type === 'application/pdf') {
            const processed = await processPdf(file, { ...fileData });
            state.uploadedFiles.push(processed);
            msgFiles.push(processed);
        } else if (file.type.includes('word') || file.type === 'application/msword') {
            try {
                const processed = await processWord(file, { ...fileData });
                state.uploadedFiles.push(processed);
                msgFiles.push(processed);
            } catch (e) { showToast(`${file.name}: ${e.message}`, 'error'); }
        } else if (file.type.includes('spreadsheet') || file.type.includes('excel') || file.type === 'text/csv') {
            try {
                const processed = await processSpreadsheet(file, { ...fileData });
                state.uploadedFiles.push(processed);
                msgFiles.push(processed);
            } catch (e) { showToast(`${file.name}: ${e.message}`, 'error'); }
        }
    }
    pendingAttachments = [];
    renderPendingFiles();
    renderFileList();

    // Build user message
    const userMsg = { role: 'user', text: text || '(File uploaded)', files: msgFiles.map(f => f.name), timestamp: new Date().toISOString() };
    state.chatMessages.push(userMsg);
    addMessageToUI('user', text || '📎 Files attached', msgFiles);

    els.messageInput.value = ''; els.messageInput.style.height = 'auto';
    state.isLoading = true; els.sendBtn.disabled = true;
    const typingEl = showTypingIndicator();

    try {
        const response = await callGeminiAPI(text, msgFiles);
        typingEl.remove();
        addMessageToUI('ai', response);
        state.chatMessages.push({ role: 'ai', text: response, timestamp: new Date().toISOString() });
        await saveConversation();
        await renderConversationList();
    } catch (error) {
        typingEl.remove();
        console.error('API error:', error);
        let errorMsg = 'Something went wrong. Please try again.';
        if (error.message.includes('401') || error.message.includes('token')) {
            errorMsg = '🔄 Token expired! Please sign out and sign in again.';
        } else if (error.message.includes('403')) {
            errorMsg = '❌ Auth failed. Sign out karke dobara sign in karo.';
        } else if (error.message.includes('429') || error.message.includes('quota')) {
            errorMsg = '⚠️ Quota exceeded. Thoda wait karo (1-2 min) aur phir try karo.';
        } else if (error.message.includes('network') || error.message.includes('Failed to fetch')) {
            errorMsg = '🌐 Network error. Internet check karo.';
        }
        addMessageToUI('ai', errorMsg);
        state.chatMessages.push({ role: 'ai', text: errorMsg, timestamp: new Date().toISOString() });
        showToast('API call failed', 'error');
    } finally {
        state.isLoading = false; els.sendBtn.disabled = false; els.messageInput.focus();
    }
}

async function callGeminiAPI(userMessage, msgFiles = []) {
    const systemContext = buildSystemPrompt();

    // Build content parts for this message
    const userParts = [];
    if (userMessage) userParts.push({ text: userMessage });

    // Add images as inline_data for multimodal
    for (const f of msgFiles) {
        if (f.base64 && f.mimeType) {
            userParts.push({ inline_data: { mime_type: f.mimeType, data: f.base64 } });
        }
    }

    // Add file content as text context if not image
    for (const f of msgFiles) {
        if (f.content && !f.base64) {
            userParts.push({ text: `\n[Attached file: ${f.name}]\n${f.content.substring(0, 30000)}` });
        }
    }

    if (userParts.length === 0) userParts.push({ text: '(no message)' });

    const requestBody = {
        systemInstruction: { parts: [{ text: systemContext }] },
        contents: [...state.chatHistory, { role: 'user', parts: userParts }],
        generationConfig: { temperature: 0.8, topP: 0.95, topK: 40, maxOutputTokens: 8192 },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };

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
        throw new Error(msg);
    }

    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error('Empty response');

    // Update Gemini chat history (text only for context, no images to save tokens)
    state.chatHistory.push({ role: 'user', parts: [{ text: userMessage || '(file uploaded)' }] });
    state.chatHistory.push({ role: 'model', parts: [{ text: aiText }] });
    return aiText;
}

function buildSystemPrompt() {
    let p = `You are "Camber AI", a powerful, full-featured AI assistant. You can analyze documents (PDF, Word, Excel, CSV), images, perform calculations, write code, create content, and have intelligent conversations in Hindi, English, and Hinglish.

CAPABILITIES:
- Analyze uploaded PDF, Word, Excel, CSV files and images
- Write and explain code in any programming language
- Create HTML pages, generate tables, charts data
- Perform engineering calculations, math, logic
- Answer general knowledge, science, history, current affairs
- Generate structured content (reports, essays, summaries)

RULES:
- When user uploads a file, acknowledge it and ask what they want to do
- Show step-by-step working for calculations
- Use markdown formatting (tables, lists, headers, code blocks with language tags)
- Match the user's language
- When writing code, always specify the language in code blocks
- Use emoji sparingly (✅, 📊, 🏗️, 💡)
- Be proactive and suggest areas to explore
- Format code blocks properly so users can copy/download them
`;
    if (state.language !== 'auto') {
        const m = { hindi: 'Reply ONLY in Hindi.', english: 'Reply ONLY in English.', hinglish: 'Reply in Hinglish.' };
        p += '\nLANGUAGE: ' + m[state.language];
    }
    // Add uploaded file content as context
    const textFiles = state.uploadedFiles.filter(f => f.content && !f.base64);
    if (textFiles.length) {
        p += '\n\n=== UPLOADED DOCUMENTS ===\n';
        textFiles.forEach((d, i) => {
            p += `\n--- Doc ${i + 1}: "${d.name}" (${d.label}) ---\n`;
            p += d.content.length > 30000 ? d.content.substring(0, 30000) + '\n[truncated]\n' : d.content + '\n';
        });
        p += '=== END ===\n';
    }
    return p;
}

// ============ UI ============
function addMessageToUI(role, text, files = []) {
    const div = document.createElement('div'); div.className = 'message ' + role;
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const avatar = role === 'user' ? (state.user?.name || 'U').charAt(0).toUpperCase() : '✦';

    let html = text;
    if (role === 'ai' && typeof marked !== 'undefined') {
        try { html = marked.parse(text); } catch (e) { html = text.replace(/\n/g, '<br>'); }
    } else {
        html = escapeHtml(text).replace(/\n/g, '<br>');
    }

    // File chips for user messages
    let fileChipsHtml = '';
    if (files.length > 0) {
        fileChipsHtml = '<div class="msg-file-chips">' + files.map(f => {
            let preview = '';
            if (f.preview) preview = `<img src="${f.preview}" class="msg-file-preview" alt="${f.name}">`;
            return `<div class="msg-file-chip">${preview}<span>${f.icon || '📎'}</span><span class="msg-file-chip-name">${f.name}</span></div>`;
        }).join('') + '</div>';
    }

    div.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-content">${fileChipsHtml}<div class="message-bubble">${html}</div><div class="message-time">${time}</div></div>`;

    // Add copy/download buttons to code blocks in AI messages
    if (role === 'ai') {
        setTimeout(() => addCodeBlockButtons(div), 200);
    }

    els.messages.appendChild(div); scrollToBottom();
}

function addCodeBlockButtons(messageDiv) {
    // Try pre>code first, then standalone pre
    let codeBlocks = messageDiv.querySelectorAll('pre code');
    if (codeBlocks.length === 0) {
        // Fallback: wrap pre content in code tag
        messageDiv.querySelectorAll('pre').forEach(pre => {
            if (!pre.querySelector('code')) {
                const code = document.createElement('code');
                code.innerHTML = pre.innerHTML;
                pre.innerHTML = '';
                pre.appendChild(code);
            }
        });
        codeBlocks = messageDiv.querySelectorAll('pre code');
    }
    codeBlocks.forEach(code => {
        const pre = code.parentElement;
        if (pre.querySelector('.code-actions')) return; // Already has buttons

        const lang = (code.className.match(/language-(\w+)/) || [])[1] || 'txt';
        const actions = document.createElement('div');
        actions.className = 'code-actions';
        actions.innerHTML = `
            <span class="code-lang-tag">${lang.toUpperCase()}</span>
            <button class="code-action-btn copy-btn" title="Copy">📋 Copy</button>
            <button class="code-action-btn download-btn" title="Download">⬇️ Download</button>
        `;

        const copyBtn = actions.querySelector('.copy-btn');
        const downloadBtn = actions.querySelector('.download-btn');

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(code.textContent).then(() => {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
            });
        });

        downloadBtn.addEventListener('click', () => {
            const extMap = { javascript: 'js', python: 'py', html: 'html', css: 'css', java: 'java', cpp: 'cpp', c: 'c', json: 'json', xml: 'xml', sql: 'sql', bash: 'sh', powershell: 'ps1', csv: 'csv', txt: 'txt' };
            const ext = extMap[lang] || 'txt';
            downloadFile(code.textContent, `camber_ai_code.${ext}`, 'text/plain');
        });

        pre.style.position = 'relative';
        pre.insertBefore(actions, pre.firstChild);
    });
}

function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded: ${filename}`, 'success');
}

function showTypingIndicator() {
    const d = document.createElement('div'); d.className = 'typing-indicator';
    d.innerHTML = `<div class="message-avatar" style="background:var(--accent-gradient-subtle);border:1px solid var(--border-color);color:var(--accent-1);">✦</div><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    els.messages.appendChild(d); scrollToBottom(); return d;
}

function scrollToBottom() { requestAnimationFrame(() => { els.chatContainer.scrollTop = els.chatContainer.scrollHeight; }); }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ============ Conversations ============
async function startNewChat(silent = false) {
    state.chatHistory = [];
    state.chatMessages = [];
    state.uploadedFiles = [];
    state.currentConvoId = generateId();
    state._convoCreatedAt = new Date().toISOString();
    pendingAttachments = [];

    if (els.messages) els.messages.innerHTML = '';
    if (els.welcomeScreen) els.welcomeScreen.style.display = '';
    renderFileList();
    renderPendingFiles();
    if (!silent) {
        showToast('New chat! 🆕', 'info');
        closeSidebar();
    }
    highlightActiveConvo();
}

async function resumeConversation(id) {
    const convo = await loadConversation(id);
    if (!convo) { showToast('Conversation nahi mili', 'error'); return; }

    state.currentConvoId = id;
    state._convoCreatedAt = convo.createdAt;
    state.chatMessages = convo.messages || [];
    state.uploadedFiles = [];
    state.chatHistory = [];

    // Rebuild Gemini chat history and UI
    if (els.messages) els.messages.innerHTML = '';
    if (els.welcomeScreen) els.welcomeScreen.style.display = 'none';

    for (const msg of state.chatMessages) {
        addMessageToUI(msg.role === 'ai' ? 'ai' : 'user', msg.text);
        // Rebuild Gemini history
        if (msg.role === 'user') {
            state.chatHistory.push({ role: 'user', parts: [{ text: msg.text }] });
        } else {
            state.chatHistory.push({ role: 'model', parts: [{ text: msg.text }] });
        }
    }

    renderFileList();
    highlightActiveConvo();
    closeSidebar();
    showToast('Conversation loaded', 'info');
}

async function renderConversationList() {
    if (!els.convoList) return;
    const convos = await loadConversations();
    if (convos.length === 0) {
        els.convoList.innerHTML = '<div class="no-convos">No past conversations</div>';
        return;
    }

    els.convoList.innerHTML = convos.slice(0, 20).map(c => {
        const date = new Date(c.updatedAt);
        const isToday = new Date().toDateString() === date.toDateString();
        const timeStr = isToday ? date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const isActive = c.id === state.currentConvoId;
        return `<div class="convo-item ${isActive ? 'active' : ''}" onclick="resumeConversation('${c.id}')">
            <div class="convo-title">${escapeHtml(c.title)}</div>
            <div class="convo-meta">
                <span>${timeStr}</span>
                <button class="convo-delete" onclick="event.stopPropagation(); deleteConvo('${c.id}')" title="Delete">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

function highlightActiveConvo() {
    document.querySelectorAll('.convo-item').forEach(el => {
        el.classList.toggle('active', el.onclick?.toString().includes(state.currentConvoId));
    });
}

async function deleteConvo(id) {
    await deleteConversation(id);
    if (state.currentConvoId === id) startNewChat(true);
    await renderConversationList();
    showToast('Conversation deleted', 'info');
}

// ============ Sidebar ============
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
