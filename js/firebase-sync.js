/**
 * Firebase Cloud Sync Module for Idle Fish Tank (摸魚水族館)
 * Supports Google Authentication, Firestore Cloud Save/Load,
 * Public Tank Lobby & Cross-User Visiting.
 * Features native Firestore REST API direct channel for Chrome Extension environment.
 */

const firebaseConfig = {
    apiKey: "AIzaSyDkOAnYuyF0dPfgPnLeUguwwybUsWKwxMQ",
    authDomain: "idle-fish-tank.firebaseapp.com",
    projectId: "idle-fish-tank",
    storageBucket: "idle-fish-tank.firebasestorage.app",
    messagingSenderId: "271137921066",
    appId: "1:271137921066:web:377c5f9f0c9687ab640b53",
    measurementId: "G-1HN22318M8"
};

const FirebaseSync = {
    config: firebaseConfig,
    isInitialized: false,
    isAvailable: false,
    initError: null,
    currentUser: null,
    authListeners: [],
    auth: null,
    db: null,
    _authMod: null,
    _firestoreMod: null,
    _hasStorageListener: false,

    // ==========================================
    // 1. Firestore REST API Value Converters
    // ==========================================

    /**
     * Convert JavaScript value to Firestore REST Value format
     * @param {*} val
     * @returns {Object}
     */
    toFirestoreValue(val) {
        if (val === null || val === undefined) {
            return { nullValue: null };
        }
        if (typeof val === 'boolean') {
            return { booleanValue: val };
        }
        if (typeof val === 'number') {
            if (!Number.isFinite(val)) {
                return { integerValue: '0' };
            }
            if (Number.isInteger(val)) {
                return { integerValue: String(val) };
            }
            return { doubleValue: val };
        }
        if (typeof val === 'string') {
            return { stringValue: val };
        }
        if (Array.isArray(val)) {
            return {
                arrayValue: {
                    values: val.map(item => this.toFirestoreValue(item))
                }
            };
        }
        if (typeof val === 'object') {
            const fields = {};
            for (const [k, v] of Object.entries(val)) {
                if (!k || v === undefined || typeof v === 'function') continue;
                fields[k] = this.toFirestoreValue(v);
            }
            return {
                mapValue: { fields }
            };
        }
        return { stringValue: String(val) };
    },

    /**
     * Convert Firestore REST Field value back to JavaScript value
     * @param {Object} field
     * @returns {*}
     */
    fromFirestoreValue(field) {
        if (!field || typeof field !== 'object') {
            return null;
        }
        if ('nullValue' in field) {
            return null;
        }
        if ('booleanValue' in field) {
            return Boolean(field.booleanValue);
        }
        if ('integerValue' in field) {
            return Number(field.integerValue);
        }
        if ('doubleValue' in field) {
            return Number(field.doubleValue);
        }
        if ('stringValue' in field) {
            return String(field.stringValue);
        }
        if ('timestampValue' in field) {
            return new Date(field.timestampValue).getTime();
        }
        if ('arrayValue' in field) {
            const arr = field.arrayValue && Array.isArray(field.arrayValue.values)
                ? field.arrayValue.values
                : [];
            return arr.map(v => this.fromFirestoreValue(v));
        }
        if ('mapValue' in field) {
            return this.fromFirestoreFields(field.mapValue.fields || {});
        }
        return null;
    },

    /**
     * Convert JavaScript object to Firestore fields dictionary
     * @param {Object} obj
     * @returns {Object}
     */
    toFirestoreFields(obj) {
        if (!obj || typeof obj !== 'object') return {};
        const fields = {};
        for (const [k, v] of Object.entries(obj)) {
            if (!k || v === undefined || typeof v === 'function') continue;
            fields[k] = this.toFirestoreValue(v);
        }
        return fields;
    },

    /**
     * Convert Firestore fields dictionary to JavaScript object
     * @param {Object} fields
     * @returns {Object}
     */
    fromFirestoreFields(fields) {
        if (!fields || typeof fields !== 'object') return {};
        const result = {};
        for (const [k, v] of Object.entries(fields)) {
            result[k] = this.fromFirestoreValue(v);
        }
        return result;
    },

    // ==========================================
    // 2. REST API Helpers & Token Management
    // ==========================================

    _getRestBaseUrl() {
        return `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents`;
    },

    /**
     * Retrieve valid ID Token for REST API, refreshing if expired or forced
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<string|null>}
     */
    async _getValidRestToken(forceRefresh = false) {
        if (!this.currentUser) return null;

        const refreshToken = this.currentUser.refreshToken ||
            (this.currentUser.stsTokenManager && this.currentUser.stsTokenManager.refreshToken);
        const now = Date.now();

        // 1. If not forcing refresh and current idToken is present and not expired
        if (!forceRefresh && this.currentUser.idToken && this.currentUser._tokenExpiry && now < this.currentUser._tokenExpiry) {
            return this.currentUser.idToken;
        }

        // 2. If no refreshToken available, fallback to existing idToken
        if (!refreshToken) {
            return this.currentUser.idToken || null;
        }

        // 3. Request fresh token from Google SecureToken API
        try {
            const url = `https://securetoken.googleapis.com/v1/token?key=${this.config.apiKey}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data && data.id_token) {
                    this.currentUser.idToken = data.id_token;
                    if (data.refresh_token) {
                        this.currentUser.refreshToken = data.refresh_token;
                    }
                    const expiresInSec = parseInt(data.expires_in, 10) || 3600;
                    this.currentUser._tokenExpiry = Date.now() + Math.max(60, expiresInSec - 120) * 1000;

                    // Sync updated token back to chrome.storage.local
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ cloudUser: this.currentUser });
                    }

                    return data.id_token;
                }
            } else {
                console.warn('[FirebaseSync] Refresh token endpoint returned status:', resp.status);
            }
        } catch (e) {
            console.warn('[FirebaseSync] Refresh token network error:', e);
        }

        return this.currentUser.idToken || null;
    },

    /**
     * Dispatch REST request with auto-retry on 401/403 token expiration
     * @param {string} url
     * @param {Object} options
     * @returns {Promise<Response>}
     */
    async _restFetch(url, options = {}) {
        let token = await this._getValidRestToken(false);
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let resp = await fetch(url, { ...options, cache: 'no-store', headers });

        // If unauthorized/forbidden and refresh token exists, force refresh and retry once
        const hasRefreshToken = this.currentUser && (
            this.currentUser.refreshToken ||
            (this.currentUser.stsTokenManager && this.currentUser.stsTokenManager.refreshToken)
        );

        if ((resp.status === 401 || resp.status === 403) && hasRefreshToken) {
            console.warn(`[FirebaseSync] REST API returned ${resp.status}, attempting token refresh...`);
            token = await this._getValidRestToken(true);
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
                resp = await fetch(url, { ...options, cache: 'no-store', headers });
            }
        }

        return resp;
    },

    /**
     * REST setDoc (PATCH to Firestore document)
     * @param {string} collection
     * @param {string} docId
     * @param {Object} dataObj
     * @returns {Promise<Object>}
     */
    async _restSetDoc(collection, docId, dataObj) {
        const baseUrl = this._getRestBaseUrl();
        const url = `${baseUrl}/${collection}/${encodeURIComponent(docId)}`;
        const body = JSON.stringify({
            fields: this.toFirestoreFields(dataObj)
        });

        const resp = await this._restFetch(url, {
            method: 'PATCH',
            body: body
        });

        if (!resp.ok) {
            let errText = '';
            try {
                const errJson = await resp.json();
                errText = (errJson.error && errJson.error.message) || JSON.stringify(errJson);
            } catch (_) {
                errText = `HTTP ${resp.status}`;
            }
            throw new Error(`Firestore REST setDoc error (${resp.status}): ${errText}`);
        }

        return await resp.json();
    },

    /**
     * REST getDoc (GET Firestore document)
     * @param {string} collection
     * @param {string} docId
     * @returns {Promise<{exists: boolean, data: Object|null}>}
     */
    async _restGetDoc(collection, docId) {
        const baseUrl = this._getRestBaseUrl();
        const url = `${baseUrl}/${collection}/${encodeURIComponent(docId)}`;

        const resp = await this._restFetch(url, {
            method: 'GET'
        });

        if (resp.status === 404) {
            return { exists: false, data: null };
        }

        if (!resp.ok) {
            let errText = '';
            try {
                const errJson = await resp.json();
                errText = (errJson.error && errJson.error.message) || JSON.stringify(errJson);
            } catch (_) {
                errText = `HTTP ${resp.status}`;
            }
            throw new Error(`Firestore REST getDoc error (${resp.status}): ${errText}`);
        }

        const json = await resp.json();
        if (json && json.fields) {
            return {
                exists: true,
                data: this.fromFirestoreFields(json.fields),
                createTime: json.createTime,
                updateTime: json.updateTime
            };
        }
        return { exists: false, data: null };
    },

    /**
     * REST listDocs (GET collection documents)
     * @param {string} collection
     * @param {number} [pageSize=25]
     * @returns {Promise<Array<Object>>}
     */
    async _restListDocs(collection, pageSize = 25) {
        const baseUrl = this._getRestBaseUrl();
        const url = `${baseUrl}/${collection}?pageSize=${pageSize}`;

        const resp = await this._restFetch(url, {
            method: 'GET'
        });

        if (!resp.ok) {
            let errText = '';
            try {
                const errJson = await resp.json();
                errText = (errJson.error && errJson.error.message) || JSON.stringify(errJson);
            } catch (_) {
                errText = `HTTP ${resp.status}`;
            }
            throw new Error(`Firestore REST listDocs error (${resp.status}): ${errText}`);
        }

        const json = await resp.json();
        const docs = [];
        if (json && Array.isArray(json.documents)) {
            for (const doc of json.documents) {
                const parts = (doc.name || '').split('/');
                const docId = parts[parts.length - 1];
                const data = this.fromFirestoreFields(doc.fields || {});
                docs.push({ uid: docId, id: docId, ...data });
            }
        }
        return docs;
    },

    // ==========================================
    // 3. Lifecycle & Initialization
    // ==========================================

    /**
     * Initialize Firebase App, Auth and Firestore
     * Safely catches network/CSP failures without interrupting local gameplay.
     */
    async init() {
        if (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:') {
            this.isInitialized = true;
            this.isAvailable = true; // REST API direct connection is ready

            // In Chrome Extension popup environment, read bridged cloudUser from chrome.storage.local
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['cloudUser'], (result) => {
                    if (result && result.cloudUser) {
                        this.currentUser = result.cloudUser;
                        this._notifyAuthListeners(this.currentUser);
                    }
                });

                if (chrome.storage.onChanged && !this._hasStorageListener) {
                    this._hasStorageListener = true;
                    chrome.storage.onChanged.addListener((changes, areaName) => {
                        if (areaName === 'local' && changes.cloudUser) {
                            this.currentUser = changes.cloudUser.newValue || null;
                            this._notifyAuthListeners(this.currentUser);
                        }
                    });
                }
            }

            return { success: true, currentUser: this.currentUser, reason: 'extension_bridge' };
        }

        if (this.isInitialized) {
            return { success: this.isAvailable, currentUser: this.currentUser };
        }

        try {
            // Dynamically import Firebase v10 modular packages from official Google CDN
            const [appMod, authMod, firestoreMod] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
                import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
            ]);

            this._authMod = authMod;
            this._firestoreMod = firestoreMod;

            // Initialize or reuse Firebase App
            const app = (appMod.getApps && appMod.getApps().length > 0)
                ? appMod.getApp()
                : appMod.initializeApp(this.config);

            this.auth = authMod.getAuth(app);
            this.db = firestoreMod.getFirestore(app);

            // Listen to auth state changes
            authMod.onAuthStateChanged(this.auth, async (user) => {
                this.currentUser = user;
                this._notifyAuthListeners(user);

                // Bridge to extension content script if running on web
                if (typeof window !== 'undefined') {
                    if (user) {
                        let idToken = '';
                        let refreshToken = '';
                        try {
                            idToken = await user.getIdToken();
                            refreshToken = user.refreshToken || (user.stsTokenManager && user.stsTokenManager.refreshToken) || '';
                        } catch (tokErr) {
                            console.warn('[FirebaseSync] Failed to retrieve tokens in onAuthStateChanged:', tokErr);
                        }
                        window.postMessage({
                            type: 'AF_AUTH_SYNC_TO_EXT',
                            user: {
                                uid: user.uid,
                                displayName: user.displayName || '',
                                email: user.email || '',
                                photoURL: user.photoURL || '',
                                idToken: idToken,
                                refreshToken: refreshToken
                            }
                        }, '*');
                    } else {
                        window.postMessage({
                            type: 'AF_AUTH_LOGOUT_TO_EXT'
                        }, '*');
                    }
                }
            });

            this.isInitialized = true;
            this.isAvailable = true;
            this.initError = null;
            return { success: true };
        } catch (err) {
            console.warn('[FirebaseSync] Firebase unavailable or restricted (offline / strict extension CSP). Falling back to REST mode.', err);
            this.isInitialized = true;
            this.isAvailable = true; // REST API direct connection remains available
            this.initError = err;
            return { success: false, error: err };
        }
    },

    /**
     * Check if cloud service is ready via official JS SDK
     */
    isReady() {
        return this.isAvailable && !!this.auth && !!this.db;
    },

    /**
     * Sign in with Google Popup
     */
    async loginWithGoogle() {
        if (!this.isReady()) {
            const initRes = await this.init();
            if (!initRes.success || !this.isReady()) {
                return {
                    success: false,
                    error: 'Firebase 雲端服務尚未連線（可能是離線狀態或瀏覽器擴充套件安全性原則限制，建議使用 GitHub Pages 網頁版體驗完整雲端同步）'
                };
            }
        }

        try {
            const provider = new this._authMod.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            const result = await this._authMod.signInWithPopup(this.auth, provider);
            this.currentUser = result.user;
            this._notifyAuthListeners(this.currentUser);

            if (typeof window !== 'undefined' && result.user) {
                let idToken = '';
                let refreshToken = '';
                try {
                    idToken = await result.user.getIdToken();
                    refreshToken = result.user.refreshToken || (result.user.stsTokenManager && result.user.stsTokenManager.refreshToken) || '';
                } catch (tokErr) {
                    console.warn('[FirebaseSync] Failed to retrieve tokens in loginWithGoogle:', tokErr);
                }
                window.postMessage({
                    type: 'AF_AUTH_SYNC_TO_EXT',
                    user: {
                        uid: result.user.uid,
                        displayName: result.user.displayName || '',
                        email: result.user.email || '',
                        photoURL: result.user.photoURL || '',
                        idToken: idToken,
                        refreshToken: refreshToken
                    }
                }, '*');
            }

            return { success: true, user: result.user };
        } catch (err) {
            console.error('[FirebaseSync] Google login failed:', err);
            let userMsg = '登入失敗，請稍後再試。';
            if (err.code === 'auth/popup-closed-by-user') {
                userMsg = '登入視窗已被關閉。';
            } else if (err.code === 'auth/network-request-failed') {
                userMsg = '網路連線異常，請檢查網路設定。';
            } else if (err.code === 'auth/unauthorized-domain') {
                userMsg = '此網域尚未在 Firebase Console 加入授權網域 (Authorized domains)。';
            } else if (err.message) {
                userMsg = err.message;
            }
            return { success: false, error: userMsg, rawError: err };
        }
    },

    /**
     * Sign out current user
     */
    async logout() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                chrome.storage.local.remove(['cloudUser']);
            } catch (e) {
                console.warn('[FirebaseSync] Failed to clear cloudUser in extension:', e);
            }
        }

        if (typeof window !== 'undefined') {
            window.postMessage({ type: 'AF_AUTH_LOGOUT_TO_EXT' }, '*');
        }

        if (!this.isReady() || !this.auth) {
            this.currentUser = null;
            this._notifyAuthListeners(null);
            return { success: true };
        }

        try {
            await this._authMod.signOut(this.auth);
            this.currentUser = null;
            this._notifyAuthListeners(null);
            return { success: true };
        } catch (err) {
            console.error('[FirebaseSync] Logout error:', err);
            return { success: false, error: err.message || '登出發生錯誤' };
        }
    },

    /**
     * Compress Base64 image data URL to lightweight WebP/JPEG format
     * @param {string} dataUrl
     * @param {number} [maxDim=140]
     * @param {number} [quality=0.78]
     * @returns {Promise<string>}
     */
    async compressBase64Image(dataUrl, maxDim = 140, quality = 0.78) {
        if (!dataUrl || typeof dataUrl !== 'string') return '';
        if (!dataUrl.startsWith('data:')) {
            // Keep external http/https and relative URLs intact
            return dataUrl;
        }
        if (dataUrl.length <= 22000) {
            return dataUrl;
        }

        // If in browser DOM with Image & Canvas available
        if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
            return new Promise((resolve) => {
                let resolved = false;
                const timer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        // On timeout: keep image if within reasonable 150KB bound
                        resolve(dataUrl.length <= 150000 ? dataUrl : '');
                    }
                }, 4000);

                const img = new Image();
                img.onload = () => {
                    if (resolved) return;
                    try {
                        let w = img.naturalWidth || img.width || maxDim;
                        let h = img.naturalHeight || img.height || maxDim;
                        const maxSide = Math.max(w, h);
                        if (maxSide > maxDim) {
                            const scale = maxDim / maxSide;
                            w = Math.max(1, Math.round(w * scale));
                            h = Math.max(1, Math.round(h * scale));
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);

                        let resUrl = canvas.toDataURL('image/webp', quality);
                        if (!resUrl.startsWith('data:image/webp') || resUrl.length > dataUrl.length) {
                            const pngUrl = canvas.toDataURL('image/png');
                            const jpegUrl = canvas.toDataURL('image/jpeg', quality);
                            resUrl = (pngUrl.length <= jpegUrl.length) ? pngUrl : jpegUrl;
                            if (resUrl.length > dataUrl.length) {
                                resUrl = dataUrl;
                            }
                        }

                        // Step 1 reduction if > 45000 chars: scale down to 96x96
                        if (resUrl.length > 45000) {
                            const smallMaxDim = 96;
                            const sSide = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
                            const sScale = Math.min(1, smallMaxDim / sSide);
                            const sw = Math.max(1, Math.round((img.naturalWidth || smallMaxDim) * sScale));
                            const sh = Math.max(1, Math.round((img.naturalHeight || smallMaxDim) * sScale));
                            canvas.width = sw;
                            canvas.height = sh;
                            ctx.clearRect(0, 0, sw, sh);
                            ctx.drawImage(img, 0, 0, sw, sh);
                            resUrl = canvas.toDataURL('image/webp', 0.65);
                            if (!resUrl.startsWith('data:image/webp')) {
                                resUrl = canvas.toDataURL('image/jpeg', 0.65);
                            }
                        }

                        // Step 2 reduction if STILL > 45000 chars: scale down to 64x64
                        if (resUrl.length > 45000) {
                            const tinyMaxDim = 64;
                            const tSide = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
                            const tScale = Math.min(1, tinyMaxDim / tSide);
                            const tw = Math.max(1, Math.round((img.naturalWidth || tinyMaxDim) * tScale));
                            const th = Math.max(1, Math.round((img.naturalHeight || tinyMaxDim) * tScale));
                            canvas.width = tw;
                            canvas.height = th;
                            ctx.clearRect(0, 0, tw, th);
                            ctx.drawImage(img, 0, 0, tw, th);
                            resUrl = canvas.toDataURL('image/webp', 0.5);
                            if (!resUrl.startsWith('data:image/webp')) {
                                resUrl = canvas.toDataURL('image/jpeg', 0.5);
                            }
                        }

                        resolved = true;
                        clearTimeout(timer);
                        // NEVER resolve empty if resUrl was created!
                        resolve(resUrl || (dataUrl.length <= 150000 ? dataUrl : ''));
                    } catch (e) {
                        resolved = true;
                        clearTimeout(timer);
                        resolve(dataUrl.length <= 150000 ? dataUrl : '');
                    }
                };

                img.onerror = () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        resolve(dataUrl.length <= 150000 ? dataUrl : '');
                    }
                };

                img.src = dataUrl;
            });
        }

        // Non-browser or headless environment without DOM
        return dataUrl.length > 150000 ? '' : dataUrl;
    },

    /**
     * Prepare, compress and sanitize game state before writing to Firestore.
     * Guarantees payload stays well under Firestore's 1MB / HTTP 400 document cap.
     * @param {Object} gameState
     * @returns {Promise<Object>}
     */
    async prepareStateForFirestore(gameState) {
        const cleanState = JSON.parse(JSON.stringify(gameState || {}));

        // 1. Compress fishList custom images
        if (Array.isArray(cleanState.fishList)) {
            for (let i = 0; i < cleanState.fishList.length; i++) {
                const fish = cleanState.fishList[i];
                if (fish && fish.customImage && fish.customImage.length > 22000) {
                    const compressed = await this.compressBase64Image(fish.customImage, 140, 0.78);
                    if (compressed) {
                        fish.customImage = compressed;
                    } else if (fish.customImage.length > 120000) {
                        delete fish.customImage;
                    }

                    if (gameState && Array.isArray(gameState.fishList) && gameState.fishList[i]) {
                        if (fish.customImage) {
                            gameState.fishList[i].customImage = fish.customImage;
                        } else {
                            delete gameState.fishList[i].customImage;
                        }
                    }
                }
            }
        }

        // 2. Compress customDecorations
        if (cleanState.decorations && Array.isArray(cleanState.decorations.customDecorations)) {
            for (let i = 0; i < cleanState.decorations.customDecorations.length; i++) {
                const decor = cleanState.decorations.customDecorations[i];
                if (decor && decor.imageUrl && decor.imageUrl.length > 22000) {
                    const compressed = await this.compressBase64Image(decor.imageUrl, 160, 0.78);
                    if (compressed) {
                        decor.imageUrl = compressed;
                    } else if (decor.imageUrl.length > 120000) {
                        delete decor.imageUrl;
                    }

                    if (gameState && gameState.decorations && Array.isArray(gameState.decorations.customDecorations) && gameState.decorations.customDecorations[i]) {
                        if (decor.imageUrl) {
                            gameState.decorations.customDecorations[i].imageUrl = decor.imageUrl;
                        } else {
                            delete gameState.decorations.customDecorations[i].imageUrl;
                        }
                    }
                }
            }
        }

        // 3. Compress eventSettings customHandUrl
        if (cleanState.eventSettings && cleanState.eventSettings.customHandUrl && cleanState.eventSettings.customHandUrl.length > 22000) {
            const compressed = await this.compressBase64Image(cleanState.eventSettings.customHandUrl, 140, 0.78);
            if (compressed) {
                cleanState.eventSettings.customHandUrl = compressed;
            } else if (cleanState.eventSettings.customHandUrl.length > 120000) {
                cleanState.eventSettings.customHandUrl = '';
            }
            if (gameState && gameState.eventSettings) {
                gameState.eventSettings.customHandUrl = cleanState.eventSettings.customHandUrl;
            }
        }

        // 4. Hard Size Cap Guarantee: must not exceed 450,000 bytes
        const HARD_CAP = 450000;
        let serializedLen = JSON.stringify(cleanState).length;
        if (serializedLen > HARD_CAP) {
            console.warn(`[FirebaseSync] CleanState exceeds ${HARD_CAP} bytes (${serializedLen}), stripping large image data...`);
            if (Array.isArray(cleanState.fishList)) {
                for (const fish of cleanState.fishList) {
                    if (fish.customImage && fish.customImage.length > 8000) {
                        delete fish.customImage;
                        if (JSON.stringify(cleanState).length <= HARD_CAP) break;
                    }
                }
            }
            if (JSON.stringify(cleanState).length > HARD_CAP && cleanState.decorations && Array.isArray(cleanState.decorations.customDecorations)) {
                for (const decor of cleanState.decorations.customDecorations) {
                    if (decor.imageUrl && decor.imageUrl.length > 8000) {
                        delete decor.imageUrl;
                        if (JSON.stringify(cleanState).length <= HARD_CAP) break;
                    }
                }
            }
            if (JSON.stringify(cleanState).length > HARD_CAP && cleanState.eventSettings && cleanState.eventSettings.customHandUrl && cleanState.eventSettings.customHandUrl.length > 8000) {
                cleanState.eventSettings.customHandUrl = '';
            }
        }

        return cleanState;
    },

    /**
     * Save game state to Firestore at `users/{uid}` and update `publicTanks/{uid}`
     * Supports both Firebase JS SDK and Native Firestore REST API direct fallback.
     * @param {Object} gameState
     */
    async saveToCloud(gameState) {
        if (!this.currentUser || !this.currentUser.uid) {
            return { success: false, reason: 'unauthenticated' };
        }

        try {
            const uid = this.currentUser.uid;
            const cleanState = await this.prepareStateForFirestore(gameState);
            const now = Date.now();
            cleanState.lastSavedTime = now;
            cleanState.lastCloudSyncTime = now;
            cleanState.tankId = uid;

            const payload = {
                gameState: cleanState,
                updatedAt: now,
                userEmail: this.currentUser.email || '',
                userDisplayName: this.currentUser.displayName || '',
                userPhotoURL: this.currentUser.photoURL || ''
            };

            const isPublic = cleanState.isPublic !== false;
            const publicData = {
                uid: uid,
                displayName: this.currentUser.displayName || (this.currentUser.email ? this.currentUser.email.split('@')[0] : '神秘島主'),
                photoURL: this.currentUser.photoURL || '',
                fishCount: (cleanState.fishList || []).length,
                theme: (cleanState.decorations && cleanState.decorations.theme) || 'ocean',
                sandType: (cleanState.decorations && cleanState.decorations.sandType) || 'gold',
                tankName: cleanState.tankName || ((this.currentUser.displayName || '島主') + ' 的水族箱'),
                likes: cleanState.likes || 0,
                updatedAt: now,
                isPublic: isPublic
            };

            if (this.isReady()) {
                try {
                    const docRef = this._firestoreMod.doc(this.db, 'users', uid);
                    await this._firestoreMod.setDoc(docRef, payload, { merge: true });

                    try {
                        const publicRef = this._firestoreMod.doc(this.db, 'publicTanks', uid);
                        await this._firestoreMod.setDoc(publicRef, publicData, { merge: true });
                    } catch (pubErr) {
                        console.warn('[FirebaseSync] publicTanks sync notice:', pubErr);
                    }
                } catch (sdkErr) {
                    console.warn('[FirebaseSync] SDK save failed, falling back to REST API:', sdkErr);
                    await this._restSetDoc('users', uid, payload);
                    await this._restSetDoc('publicTanks', uid, publicData).catch(() => {});
                }
            } else {
                // Extension or SDK unavailable: directly use native REST API!
                await this._restSetDoc('users', uid, payload);
                await this._restSetDoc('publicTanks', uid, publicData).catch((pubErr) => {
                    console.warn('[FirebaseSync] REST publicTanks notice:', pubErr);
                });
            }

            // Update in-memory and local storage lastCloudSyncTime
            if (gameState) {
                gameState.lastCloudSyncTime = now;
                if (typeof Storage !== 'undefined' && typeof Storage.saveLocalOnly === 'function') {
                    Storage.saveLocalOnly(gameState).catch(() => {});
                }
            }

            return { success: true, timestamp: now };
        } catch (err) {
            console.error('[FirebaseSync] saveToCloud error:', err);
            return { success: false, error: err.message || err };
        }
    },

    /**
     * Load game state from Firestore `users/{uid}`
     */
    async loadFromCloud() {
        if (!this.currentUser) {
            return { success: false, reason: 'unauthenticated' };
        }

        try {
            const uid = this.currentUser.uid;
            let resultData = null;
            let exists = false;

            if (this.isReady()) {
                try {
                    const docRef = this._firestoreMod.doc(this.db, 'users', uid);
                    const snap = await this._firestoreMod.getDoc(docRef);
                    if (snap.exists()) {
                        exists = true;
                        resultData = snap.data();
                    }
                } catch (sdkErr) {
                    console.warn('[FirebaseSync] SDK load failed, falling back to REST API:', sdkErr);
                    const restRes = await this._restGetDoc('users', uid);
                    if (restRes.exists) {
                        exists = true;
                        resultData = restRes.data;
                    }
                }
            } else {
                // Extension or SDK unavailable: directly use native REST API!
                const restRes = await this._restGetDoc('users', uid);
                if (restRes.exists) {
                    exists = true;
                    resultData = restRes.data;
                }
            }

            if (exists && resultData) {
                return {
                    success: true,
                    exists: true,
                    data: resultData.gameState || resultData,
                    updatedAt: resultData.updatedAt || 0
                };
            } else {
                return {
                    success: true,
                    exists: false,
                    data: null,
                    updatedAt: 0
                };
            }
        } catch (err) {
            console.error('[FirebaseSync] loadFromCloud error:', err);
            return { success: false, error: err.message || err };
        }
    },

    /**
     * Load target player's aquarium by tankId (UID or demo ID)
     * @param {string} tankId
     */
    async loadTankById(tankId) {
        if (!tankId || typeof tankId !== 'string') {
            return { success: false, error: '請輸入有效的魚缸 ID' };
        }

        const trimmedId = tankId.trim();

        // Built-in presets for offline exploration or demo testing
        const DEMO_TANKS = {
            'demo_ocean': {
                uid: 'demo_ocean',
                displayName: '海洋守護者 · 艾倫',
                tankName: '蔚藍幻彩群游館',
                photoURL: 'icons/icon48.png',
                likes: 42,
                gameState: {
                    coins: 888,
                    tankLevel: 2,
                    tankName: '蔚藍幻彩群游館',
                    waterCleanliness: 100,
                    upgrades: { foodTier: 3, autoFeederTier: 2, filterTier: 3, tankCapacityTier: 3, tankSizeTier: 2 },
                    decorations: { seaweed: true, seaweedCount: 7, airStone: true, airStoneX: 0.9, coral: true, coralX: 0.35, sunkenCastle: true, castleX: 0.6, theme: 'ocean', sandType: 'gold', customDecorations: [] },
                    fishList: [
                        { id: 'df1', speciesId: 'clownfish', name: '小尼莫', hunger: 90, happiness: 100, growth: 80, bornTime: Date.now() - 5000000, coinsGeneratedTotal: 150 },
                        { id: 'df2', speciesId: 'bluetang', name: '多莉', hunger: 85, happiness: 95, growth: 70, bornTime: Date.now() - 4000000, coinsGeneratedTotal: 180 },
                        { id: 'df3', speciesId: 'koi', name: '吉祥金錦鯉', hunger: 95, happiness: 100, growth: 90, bornTime: Date.now() - 3000000, coinsGeneratedTotal: 300 },
                        { id: 'df4', speciesId: 'jellyfish', name: '星海幽光水母', hunger: 90, happiness: 90, growth: 60, bornTime: Date.now() - 2000000, coinsGeneratedTotal: 220 }
                    ],
                    stats: { totalCoinsEarned: 1200, foodFedCount: 30, timesCleaned: 5 }
                }
            },
            'demo_cyber': {
                uid: 'demo_cyber',
                displayName: '霓虹夜客 · 賽博',
                tankName: '賽博未來霓虹水族館',
                photoURL: 'icons/icon48.png',
                likes: 88,
                gameState: {
                    coins: 2049,
                    tankLevel: 3,
                    tankName: '賽博未來霓虹水族館',
                    waterCleanliness: 100,
                    upgrades: { foodTier: 4, autoFeederTier: 3, filterTier: 3, tankCapacityTier: 4, tankSizeTier: 3 },
                    decorations: { seaweed: true, seaweedCount: 5, airStone: true, airStoneX: 0.85, coral: true, coralX: 0.25, sunkenCastle: true, castleX: 0.5, theme: 'cyber', sandType: 'black', customDecorations: [] },
                    fishList: [
                        { id: 'cf1', speciesId: 'jellyfish', name: '霓虹脈衝', hunger: 90, happiness: 100, growth: 95, bornTime: Date.now() - 6000000, coinsGeneratedTotal: 400 },
                        { id: 'cf2', speciesId: 'angelfish', name: '深海大帝', hunger: 88, happiness: 90, growth: 75, bornTime: Date.now() - 5000000, coinsGeneratedTotal: 350 },
                        { id: 'cf3', speciesId: 'koi', name: '電幻錦鯉', hunger: 92, happiness: 100, growth: 85, bornTime: Date.now() - 4000000, coinsGeneratedTotal: 500 }
                    ],
                    stats: { totalCoinsEarned: 3500, foodFedCount: 50, timesCleaned: 10 }
                }
            }
        };

        if (DEMO_TANKS[trimmedId]) {
            return { success: true, exists: true, ...DEMO_TANKS[trimmedId] };
        }

        try {
            let data = null;
            let exists = false;

            if (this.isReady()) {
                try {
                    const docRef = this._firestoreMod.doc(this.db, 'users', trimmedId);
                    const snap = await this._firestoreMod.getDoc(docRef);
                    if (snap.exists()) {
                        exists = true;
                        data = snap.data();
                    }
                } catch (sdkErr) {
                    console.warn('[FirebaseSync] SDK loadTankById failed, falling back to REST:', sdkErr);
                    const restRes = await this._restGetDoc('users', trimmedId);
                    if (restRes.exists) {
                        exists = true;
                        data = restRes.data;
                    }
                }
            } else {
                const restRes = await this._restGetDoc('users', trimmedId);
                if (restRes.exists) {
                    exists = true;
                    data = restRes.data;
                }
            }

            if (exists && data) {
                const gState = data.gameState || data;
                const displayName = data.userDisplayName || (data.userEmail ? data.userEmail.split('@')[0] : '魚友玩家');
                return {
                    success: true,
                    exists: true,
                    uid: trimmedId,
                    displayName: displayName,
                    photoURL: data.userPhotoURL || '',
                    tankName: gState.tankName || `${displayName} 的水族箱`,
                    likes: gState.likes || 0,
                    gameState: gState
                };
            } else {
                return { success: false, exists: false, error: `找不到魚缸 ID 為「${trimmedId}」的資料` };
            }
        } catch (err) {
            console.error('[FirebaseSync] loadTankById error:', err);
            return { success: false, error: err.message || '查詢魚缸失敗' };
        }
    },

    /**
     * Retrieve public tanks list for the lobby
     */
    async getPublicTanks() {
        const defaultDemos = [
            {
                uid: 'demo_ocean',
                displayName: '海洋守護者 · 艾倫',
                tankName: '蔚藍幻彩群游館',
                photoURL: 'icons/icon48.png',
                fishCount: 4,
                theme: 'ocean',
                sandType: 'gold',
                likes: 42,
                isDemo: true
            },
            {
                uid: 'demo_cyber',
                displayName: '霓虹夜客 · 賽博',
                tankName: '賽博未來霓虹水族館',
                photoURL: 'icons/icon48.png',
                fishCount: 3,
                theme: 'cyber',
                sandType: 'black',
                likes: 88,
                isDemo: true
            }
        ];

        try {
            let list = [];
            if (this.isReady()) {
                try {
                    const colRef = this._firestoreMod.collection(this.db, 'publicTanks');
                    const snap = await this._firestoreMod.getDocs(colRef);
                    snap.forEach(docSnap => {
                        const item = docSnap.data();
                        if (item && item.isPublic !== false) {
                            list.push({ uid: docSnap.id, ...item });
                        }
                    });
                } catch (sdkErr) {
                    console.warn('[FirebaseSync] SDK getPublicTanks failed, falling back to REST:', sdkErr);
                    list = await this._restListDocs('publicTanks');
                }
            } else {
                list = await this._restListDocs('publicTanks');
            }

            // Filter out private tanks
            list = list.filter(item => item && item.isPublic !== false);

            // Sort by likes descending
            list.sort((a, b) => (b.likes || 0) - (a.likes || 0));

            // Merge demo tanks so the lobby always has curated community tanks
            defaultDemos.forEach(demo => {
                if (!list.some(t => t.uid === demo.uid)) {
                    list.push(demo);
                }
            });

            return { success: true, tanks: list };
        } catch (err) {
            console.warn('[FirebaseSync] getPublicTanks fallback to demos:', err);
            return { success: true, tanks: defaultDemos, error: err.message };
        }
    },

    /**
     * Give a like ❤️ to target tank
     * @param {string} tankId
     */
    async likeTank(tankId) {
        if (!tankId) return { success: false };

        if (tankId.startsWith('demo_')) {
            return { success: true, newLikes: 1 };
        }

        try {
            if (this.isReady()) {
                try {
                    const publicRef = this._firestoreMod.doc(this.db, 'publicTanks', tankId);
                    const userRef = this._firestoreMod.doc(this.db, 'users', tankId);
                    const inc = this._firestoreMod.increment(1);

                    await Promise.all([
                        this._firestoreMod.setDoc(publicRef, { likes: inc }, { merge: true }),
                        this._firestoreMod.setDoc(userRef, { 'gameState.likes': inc }, { merge: true }).catch(() => {})
                    ]);

                    return { success: true };
                } catch (sdkErr) {
                    console.warn('[FirebaseSync] SDK likeTank failed, falling back to REST:', sdkErr);
                }
            }

            // REST fallback for likeTank:
            // Fetch doc, increment likes, and patch
            const pubDoc = await this._restGetDoc('publicTanks', tankId);
            const currentData = (pubDoc.exists && pubDoc.data) ? pubDoc.data : {};
            const newLikes = (currentData.likes || 0) + 1;
            await this._restSetDoc('publicTanks', tankId, { ...currentData, likes: newLikes });
            return { success: true, newLikes };
        } catch (err) {
            console.error('[FirebaseSync] likeTank error:', err);
            return { success: false, error: err.message };
        }
    },

    /**
     * Get currently authenticated user
     */
    getCurrentUser() {
        return this.currentUser;
    },

    /**
     * Register authentication state listener
     * @param {Function} callback (user) => void
     * @returns {Function} Unsubscribe function
     */
    onAuthStateChanged(callback) {
        if (typeof callback === 'function') {
            this.authListeners.push(callback);
            if (this.isInitialized) {
                callback(this.currentUser);
            }
        }
        return () => {
            this.authListeners = this.authListeners.filter(cb => cb !== callback);
        };
    },

    /**
     * Internal notify helper
     */
    _notifyAuthListeners(user) {
        this.authListeners.forEach(cb => {
            try {
                cb(user);
            } catch (e) {
                console.error('[FirebaseSync] Listener callback error:', e);
            }
        });
    }
};

if (typeof window !== 'undefined') {
    window.FirebaseSync = FirebaseSync;
    FirebaseSync.init().catch(err => {
        console.warn('[FirebaseSync] Initial load notice:', err);
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FirebaseSync;
}