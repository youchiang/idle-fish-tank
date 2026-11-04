/**
 * Storage Helper for Idle Fish Tank (摸魚水族館)
 * Seamlessly handles chrome.storage.local with automatic fallback to localStorage
 * and integrates with FirebaseSync for cross-device cloud persistence.
 */

const Storage = {
    // Default initial game state
    getDefaultState() {
        return {
            coins: 80,
            tankLevel: 1,
            maxFishCount: 4,
            waterCleanliness: 100, // 0 - 100
            lastSavedTime: Date.now(),
            soundEnabled: true,
            tankId: 'tank_' + Math.random().toString(36).substring(2, 10),
            tankName: '我的療癒水族箱',
            isPublic: true,
            likes: 0,
            upgrades: {
                foodTier: 1,         // 1: 基礎碎屑, 2: 凍乾豐年蝦, 3: 螺旋藻大餐, 4: 皇家金饌
                autoFeederTier: 0,   // 0: 無, 1: 慢速, 2: 中速, 3: 智慧高頻
                filterTier: 1,       // 1: 一般濾棉, 2: 活性碳過濾, 3: 活體生態循環
                tankCapacityTier: 1, // 1: 4隻, 2: 8隻, 3: 14隻, 4: 22隻, 5: 30隻
                tankSizeTier: 1      // 1: 標準桌上缸(440x350), 2: 豪華寬景缸(520x390), 3: 巨幕海景館(600x430)
            },
            decorations: {
                seaweed: true,
                seaweedCount: 5,
                airStone: true,
                airStoneX: 0.9,
                coral: false,
                coralX: 0.35,
                sunkenCastle: false,
                castleX: 0.55,
                theme: 'ocean',       // ocean, emerald, abyss, sunset, cyber
                sandType: 'gold',     // gold, white, black, candy
                customDecorations: [] // [{ id, name, imageUrl, xRatio, scale, enabled }]
            },
            eventSettings: {
                handType: 'orangeCat', // orangeCat, tuxedoCat, human, custom
                customHandUrl: '',
                defendedCount: 0
            },
            fishList: [
                {
                    id: 'fish_' + Date.now() + '_1',
                    speciesId: 'clownfish',
                    name: '小尼莫',
                    hunger: 75,      // 0 - 100
                    happiness: 90,   // 0 - 100
                    growth: 30,      // 0 - 100
                    bornTime: Date.now() - 3600000,
                    coinsGeneratedTotal: 25
                }
            ],
            stats: {
                totalCoinsEarned: 80,
                foodFedCount: 0,
                timesCleaned: 0
            }
        };
    },

    /**
     * Inspect incoming cloud sync data from URL hash (#cloud_sync=1&data=...)
     * Migrates format and writes directly to localStorage.
     * @returns {Object|null}
     */
    checkIncomingHashSync() {
        if (typeof window === 'undefined' || !window.location) return null;
        try {
            let hash = window.location.hash || '';
            if (hash.startsWith('#')) hash = hash.substring(1);

            let params = new URLSearchParams(hash);
            if (!params.get('cloud_sync') && window.location.search) {
                params = new URLSearchParams(window.location.search);
            }

            if (params.get('cloud_sync') === '1' && params.get('data')) {
                const rawData = params.get('data');
                let parsed = null;
                try {
                    parsed = JSON.parse(rawData);
                } catch (e1) {
                    try {
                        const binary = atob(rawData);
                        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
                        parsed = JSON.parse(new TextDecoder().decode(bytes));
                    } catch (e2) {
                        console.error('[Storage] Failed to decode hash sync state:', e1, e2);
                    }
                }

                if (parsed && typeof parsed === 'object') {
                    const migrated = this.migrateState(parsed);
                    migrated.lastSavedTime = Date.now();
                    try {
                        localStorage.setItem('idleFishTankState', JSON.stringify(migrated));
                    } catch (e) {
                        console.warn('[Storage] localStorage save failed:', e);
                    }
                    return migrated;
                }
            }
        } catch (e) {
            console.warn('[Storage] checkIncomingHashSync notice:', e);
        }
        return null;
    },

    /**
     * Load game state from local storage (or chrome.storage.local)
     * @returns {Promise<Object>}
     */
    async load() {
        return new Promise((resolve) => {
            const defaultState = this.getDefaultState();

            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['idleFishTankState'], (result) => {
                    if (chrome.runtime.lastError || !result.idleFishTankState) {
                        resolve(this.migrateState(defaultState));
                    } else {
                        resolve(this.migrateState(result.idleFishTankState));
                    }
                });
            } else {
                // Check if incoming cloud sync data is in URL hash
                const hashSyncState = this.checkIncomingHashSync();
                if (hashSyncState) {
                    resolve(hashSyncState);
                    return;
                }

                try {
                    const saved = localStorage.getItem('idleFishTankState');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        resolve(this.migrateState(parsed));
                    } else {
                        resolve(this.migrateState(defaultState));
                    }
                } catch (e) {
                    console.warn('[Storage] LocalStorage load failed, using default state', e);
                    resolve(this.migrateState(defaultState));
                }
            }
        });
    },

    /**
     * Save game state locally and, if logged in, asynchronously sync to Firestore.
     * @param {Object} state
     * @returns {Promise<void>}
     */
    async save(state) {
        state.lastSavedTime = Date.now();

        // 1. Save to local storage first (instant & reliable)
        await this.saveLocalOnly(state);

        // 2. If user is logged into Firebase, asynchronously write to Firestore
        if (window.FirebaseSync && typeof window.FirebaseSync.getCurrentUser === 'function') {
            const user = window.FirebaseSync.getCurrentUser();
            if (user && typeof window.FirebaseSync.saveToCloud === 'function') {
                window.FirebaseSync.saveToCloud(state).catch(err => {
                    console.warn('[Storage] Background cloud save notice:', err);
                });
            }
        }
    },

    /**
     * Write to local storage only (avoids cloud loop during sync resolution)
     * @param {Object} state
     * @returns {Promise<void>}
     */
    async saveLocalOnly(state) {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ idleFishTankState: state }, () => {
                    resolve();
                });
            } else {
                try {
                    localStorage.setItem('idleFishTankState', JSON.stringify(state));
                } catch (e) {
                    console.warn('[Storage] LocalStorage save failed', e);
                }
                resolve();
            }
        });
    },

    /**
     * Smart Cloud Synchronization
     * Compares timestamps between local and cloud saves:
     * - If cloud is newer -> adopts cloud save and updates local.
     * - If local is newer (or cloud is empty) -> uploads local save to cloud.
     * @returns {Promise<{action: 'loaded_cloud'|'uploaded_local'|'no_change'|'error', state: Object, message: string}>}
     */
    async syncWithCloud() {
        if (!window.FirebaseSync || !window.FirebaseSync.getCurrentUser()) {
            const local = await this.load();
            return { action: 'no_change', state: local, message: '未登入帳號，使用本機存檔' };
        }

        try {
            const localState = await this.load();
            const cloudResult = await window.FirebaseSync.loadFromCloud();

            if (!cloudResult.success) {
                return { action: 'error', state: localState, message: cloudResult.error || '讀取雲端存檔失敗' };
            }

            // Case 1: First time user on cloud (no cloud doc yet) -> upload local state
            if (!cloudResult.exists || !cloudResult.data) {
                await window.FirebaseSync.saveToCloud(localState);
                return { action: 'uploaded_local', state: localState, message: '雲端尚無存檔，已自動將本機進度同步至雲端！' };
            }

            // Case 2: Compare timestamps
            const cloudState = this.migrateState(cloudResult.data);
            const cloudTime = cloudResult.updatedAt || cloudState.lastSavedTime || 0;
            const localTime = localState.lastSavedTime || 0;

            if (cloudTime > localTime) {
                // Cloud progress is newer -> download and apply
                await this.saveLocalOnly(cloudState);
                return { action: 'loaded_cloud', state: cloudState, message: '發現較新的雲端進度，已自動同步更新！' };
            } else {
                // Local progress is newer or equal -> upload to cloud
                await window.FirebaseSync.saveToCloud(localState);
                return { action: 'uploaded_local', state: localState, message: '本機進度較新，已成功備份至雲端！' };
            }
        } catch (err) {
            console.error('[Storage] syncWithCloud exception:', err);
            const local = await this.load();
            return { action: 'error', state: local, message: err.message || '雲端同步處理失敗' };
        }
    },

    /**
     * Export current save state as downloadable JSON file
     * @returns {Promise<string>} Downloaded filename
     */
    async exportSave() {
        const state = await this.load();
        const jsonStr = JSON.stringify(state, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const fileName = `idle-fish-tank-backup-${dateStr}-${timeStr}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return fileName;
    },

    /**
     * Import save data from JSON string or object
     * @param {string|Object} jsonData
     * @returns {Promise<{success: boolean, state?: Object, error?: string}>}
     */
    async importSave(jsonData) {
        try {
            let parsed = jsonData;
            if (typeof jsonData === 'string') {
                parsed = JSON.parse(jsonData);
            }
            if (!parsed || typeof parsed !== 'object') {
                return { success: false, error: '存檔檔案格式錯誤：並非有效 JSON 格式' };
            }

            // Schema validation & migration
            const migratedState = this.migrateState(parsed);
            migratedState.lastSavedTime = Date.now();

            // Save locally and sync to cloud if logged in
            await this.save(migratedState);

            return { success: true, state: migratedState };
        } catch (err) {
            console.error('[Storage] importSave error:', err);
            return { success: false, error: err.message || '解析存檔檔案失敗' };
        }
    },

    /**
     * Ensure any newly introduced fields exist in older saved states
     */
    migrateState(state) {
        const def = this.getDefaultState();
        if (!state) return def;

        const merged = { ...def, ...state };
        merged.upgrades = { ...def.upgrades, ...(state.upgrades || {}) };
        merged.decorations = { ...def.decorations, ...(state.decorations || {}) };
        if (!Array.isArray(merged.decorations.customDecorations)) {
            merged.decorations.customDecorations = [];
        }
        merged.eventSettings = { ...def.eventSettings, ...(state.eventSettings || {}) };
        merged.stats = { ...def.stats, ...(state.stats || {}) };

        if (!Array.isArray(merged.fishList) || merged.fishList.length === 0) {
            merged.fishList = def.fishList;
        }

        if (!merged.tankId) {
            merged.tankId = 'tank_' + Math.random().toString(36).substring(2, 10);
        }
        if (typeof merged.isPublic !== 'boolean') {
            merged.isPublic = true;
        }
        if (typeof merged.likes !== 'number') {
            merged.likes = 0;
        }
        if (!merged.tankName) {
            merged.tankName = '我的療癒水族箱';
        }

        return merged;
    }
};

window.Storage = Storage;

// Detect if running inside iframe container (e.g. Chrome Extension popup shell)
if (window.self !== window.top) {
    document.documentElement.classList.add('in-iframe');
    if (document.body) {
        document.body.classList.add('in-iframe');
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            document.body.classList.add('in-iframe');
        });
    }
}

// PostMessage bridge for migrating Chrome extension local data to GitHub Pages web app
window.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'IMPORT_EXTENSION_DATA') return;

    try {
        const incomingData = event.data.data;
        if (incomingData && typeof incomingData === 'object') {
            const state = Storage.migrateState(incomingData);

            let shouldAdopt = true;
            try {
                const rawLocal = localStorage.getItem('idleFishTankState');
                if (rawLocal) {
                    const local = JSON.parse(rawLocal);
                    const incomingCoins = (state.stats && state.stats.totalCoinsEarned) || state.coins || 0;
                    const localCoins = (local.stats && local.stats.totalCoinsEarned) || local.coins || 0;
                    const incomingTime = state.lastSavedTime || 0;
                    const localTime = local.lastSavedTime || 0;

                    // If local save is strictly newer AND has equal or more coins, keep current local save
                    if (localTime > incomingTime && localCoins >= incomingCoins) {
                        shouldAdopt = false;
                    }
                }
            } catch (e) {
                shouldAdopt = true;
            }

            if (shouldAdopt) {
                localStorage.setItem('idleFishTankState', JSON.stringify(state));
                console.log('[Storage Bridge] Successfully imported extension state into localStorage:', state);

                if (window.game) {
                    if (typeof window.game.applyState === 'function') {
                        window.game.applyState(state);
                    } else {
                        window.game.state = state;
                        if (typeof window.game.init === 'function') {
                            window.game.init();
                        }
                    }
                }
            }
        }

        // Reply confirmation to parent window / extension popup
        if (event.source && typeof event.source.postMessage === 'function') {
            event.source.postMessage({ type: 'MIGRATION_SUCCESS' }, '*');
        }
    } catch (err) {
        console.error('[Storage Bridge] Error processing IMPORT_EXTENSION_DATA:', err);
    }
});
