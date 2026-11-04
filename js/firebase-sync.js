/**
 * Firebase Cloud Sync Module for Idle Fish Tank (摸魚水族館)
 * Supports Google Authentication, Firestore Cloud Save/Load,
 * Public Tank Lobby & Cross-User Visiting.
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
     * Save game state to Firestore at `users/{uid}` and update `publicTanks/{uid}`
     * @param {Object} gameState
     */
    async saveToCloud(gameState) {
        if (!this.isReady() || !this.currentUser) {
            return { success: false, reason: 'unauthenticated' };
        }

        try {
            const uid = this.currentUser.uid;
            const docRef = this._firestoreMod.doc(this.db, 'users', uid);

            // Deep clone to ensure strictly clean JSON data
            const cleanState = JSON.parse(JSON.stringify(gameState));
            const now = Date.now();
            cleanState.lastSavedTime = now;
            cleanState.tankId = uid;

            const payload = {
                gameState: cleanState,
                updatedAt: now,
                userEmail: this.currentUser.email || '',
                userDisplayName: this.currentUser.displayName || '',
                userPhotoURL: this.currentUser.photoURL || ''
            };

            await this._firestoreMod.setDoc(docRef, payload, { merge: true });

            // Update public tank registry
            try {
                const publicRef = this._firestoreMod.doc(this.db, 'publicTanks', uid);
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
                await this._firestoreMod.setDoc(publicRef, publicData, { merge: true });
            } catch (pubErr) {
                console.warn('[FirebaseSync] publicTanks sync notice:', pubErr);
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

        if (!this.isReady()) {
            await this.init();
        }

        if (!this.isReady() || !this.db) {
            return { success: false, error: '雲端服務未連線，無法查詢此 ID' };
        }

        try {
            const docRef = this._firestoreMod.doc(this.db, 'users', trimmedId);
            const snap = await this._firestoreMod.getDoc(docRef);

            if (snap.exists()) {
                const data = snap.data();
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

        if (!this.isReady()) {
            await this.init();
        }

        if (!this.isReady() || !this.db) {
            return { success: true, tanks: defaultDemos };
        }

        try {
            const colRef = this._firestoreMod.collection(this.db, 'publicTanks');
            const snap = await this._firestoreMod.getDocs(colRef);
            const list = [];
            snap.forEach(docSnap => {
                const item = docSnap.data();
                if (item && item.isPublic !== false) {
                    list.push({ uid: docSnap.id, ...item });
                }
            });

            // Sort by likes or updatedAt descending
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

        if (!this.isReady() || !this.db) {
            return { success: false, error: '雲端未連線' };
        }

        try {
            const publicRef = this._firestoreMod.doc(this.db, 'publicTanks', tankId);
            const userRef = this._firestoreMod.doc(this.db, 'users', tankId);
            const inc = this._firestoreMod.increment(1);

            await Promise.all([
                this._firestoreMod.setDoc(publicRef, { likes: inc }, { merge: true }),
                this._firestoreMod.setDoc(userRef, { 'gameState.likes': inc }, { merge: true }).catch(() => {})
            ]);

            return { success: true };
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

window.FirebaseSync = FirebaseSync;

// Initiate initialization as soon as loaded
if (typeof window !== 'undefined') {
    FirebaseSync.init().catch(err => {
        console.warn('[FirebaseSync] Initial load notice:', err);
    });
}
