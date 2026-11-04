/**
 * Firebase Cloud Sync Module for Idle Fish Tank (摸魚水族館)
 * Supports Google Authentication and Firestore Cloud Save/Load.
 * Uses Firebase v10 Modular CDN via dynamic import with full offline/CSP fault-tolerance.
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

    /**
     * Initialize Firebase App, Auth and Firestore
     * Safely catches network/CSP failures without interrupting local gameplay.
     */
    async init() {
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
            authMod.onAuthStateChanged(this.auth, (user) => {
                this.currentUser = user;
                this._notifyAuthListeners(user);
            });

            this.isInitialized = true;
            this.isAvailable = true;
            this.initError = null;
            return { success: true };
        } catch (err) {
            console.warn('[FirebaseSync] Firebase unavailable or restricted (offline / strict extension CSP). Using local mode.', err);
            this.isInitialized = true;
            this.isAvailable = false;
            this.initError = err;
            return { success: false, error: err };
        }
    },

    /**
     * Check if cloud service is ready
     */
    isReady() {
        return this.isAvailable && !!this.auth && !!this.db;
    },

    /**
     * Sign in with Google Popup
     */
    async loginWithGoogle() {
        if (!this.isReady()) {
            // Attempt re-init if not ready yet
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
     * Save game state to Firestore at `users/{uid}`
     * @param {Object} gameState
     */
    async saveToCloud(gameState) {
        if (!this.isReady() || !this.currentUser) {
            return { success: false, reason: 'unauthenticated' };
        }

        try {
            const uid = this.currentUser.uid;
            const docRef = this._firestoreMod.doc(this.db, 'users', uid);
            // Deep clone to ensure strictly clean JSON data (no undefined or non-serializable fields)
            const cleanState = JSON.parse(JSON.stringify(gameState));
            const now = Date.now();
            cleanState.lastSavedTime = now;

            const payload = {
                gameState: cleanState,
                updatedAt: now,
                userEmail: this.currentUser.email || '',
                userDisplayName: this.currentUser.displayName || '',
                userPhotoURL: this.currentUser.photoURL || ''
            };

            await this._firestoreMod.setDoc(docRef, payload, { merge: true });
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
        if (!this.isReady() || !this.currentUser) {
            return { success: false, reason: 'unauthenticated' };
        }

        try {
            const uid = this.currentUser.uid;
            const docRef = this._firestoreMod.doc(this.db, 'users', uid);
            const snap = await this._firestoreMod.getDoc(docRef);

            if (snap.exists()) {
                const data = snap.data();
                return {
                    success: true,
                    exists: true,
                    data: data.gameState || data,
                    updatedAt: data.updatedAt || 0
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

window.FirebaseSync = FirebaseSync;

// Initiate initialization as soon as loaded
if (typeof window !== 'undefined') {
    FirebaseSync.init().catch(err => {
        console.warn('[FirebaseSync] Initial load notice:', err);
    });
}
