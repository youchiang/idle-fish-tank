/**
 * Main Game Controller for Idle Fish Tank
 * Orchestrates canvas loop, dynamic tank resizing, offline calculations, UI interactions, shop, and state saving.
 */

const TANK_SIZES = {
    1: { width: 440, height: 350, bonusSlots: 0, label: '標準桌上缸 (440x350)' },
    2: { width: 520, height: 390, bonusSlots: 4, label: '豪華寬景缸 (520x390, +4魚)' },
    3: { width: 600, height: 430, bonusSlots: 8, label: '巨幕海景館 (600x430, +8魚)' }
};

const CAPACITY_LEVELS = {
    1: { maxFish: 4, label: '標準容納 (基礎 4 隻)' },
    2: { maxFish: 8, label: '奈米微孔增氧泵 (提升至 8 隻)' },
    3: { maxFish: 14, label: '生化渦流活水循環 (提升至 14 隻)' },
    4: { maxFish: 22, label: '深海巨量群游特許 (提升至 22 隻)' },
    5: { maxFish: 30, label: '頂級海洋霸主群聚特許 (提升至 30 隻)' }
};

class Game {
    constructor() {
        this.canvas = document.getElementById('tankCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;

        this.state = null;
        this.fish = [];
        this.particles = null;
        this.lastTime = performance.now();
        this.autoSaveTimer = 0;
        this.waterDecayTimer = 0;
        this.selectedUploadImage = null;
        this.mousePos = { x: -100, y: -100 };

        // 突發抓魚手事件檢查計時 (正常遊玩下每 10 秒檢查一次，30% 機率觸發)
        this.eventIntervalTimer = 0;
        this.eventCheckInterval = 10000; // 10秒 (10000ms)
        this.eventTriggerChance = 0.30;  // 30% 機率

        // 編輯魚隻與自訂造景暫存
        this.editingFishId = null;
        this.editUploadImage = null;
        this.selectedDecorImage = null;

        // 探訪他人水族箱狀態 (Visiting Mode)
        this.isVisiting = false;
        this.myState = null;
        this.visitingTargetId = null;

        // 擴充功能雲端同步暫存標記
        this._pendingExtensionSync = null;
        this._isSavingExtensionSync = false;
        this._initialCloudSyncDone = false;

        this.init();
    }

    showToast(message, type = 'info', duration = 5000) {
        let toast = document.getElementById('gameToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'gameToast';
            toast.className = 'game-toast';
            const container = document.querySelector('.aquarium-container');
            if (container) {
                container.appendChild(toast);
            } else {
                document.body.appendChild(toast);
            }
        }
        toast.className = `game-toast ${type} show`;
        toast.textContent = message;
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    handleCloudSyncHash() {
        if (typeof window === 'undefined' || !window.location) return;

        let hash = window.location.hash || '';
        if (hash.startsWith('#')) hash = hash.substring(1);

        let params = new URLSearchParams(hash);
        if (!params.get('cloud_sync') && window.location.search) {
            params = new URLSearchParams(window.location.search);
        }

        if (params.get('cloud_sync') === '1' && params.get('data')) {
            const rawData = params.get('data');
            let parsedState = null;
            try {
                parsedState = JSON.parse(rawData);
            } catch (e1) {
                try {
                    const binary = atob(rawData);
                    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
                    parsedState = JSON.parse(new TextDecoder().decode(bytes));
                } catch (e2) {
                    console.error('[CloudSync Bridge] Failed to parse data from hash:', e1, e2);
                }
            }

            if (parsedState && typeof parsedState === 'object') {
                const migrated = Storage.migrateState(parsedState);
                migrated.lastSavedTime = Date.now();

                try {
                    localStorage.setItem('idleFishTankState', JSON.stringify(migrated));
                    console.log('[CloudSync Bridge] Successfully imported extension state into localStorage:', migrated);
                } catch (e) {
                    console.warn('[CloudSync Bridge] localStorage save failed:', e);
                }

                this._pendingExtensionSync = migrated;

                // Clear hash from URL cleanly (history.replaceState)
                try {
                    window.history.replaceState(null, '', window.location.pathname);
                } catch (e) {
                    console.warn('[CloudSync Bridge] replaceState error:', e);
                }
            }
        }
    }

    async triggerExtensionSyncPrompt() {
        if (!this._pendingExtensionSync) return;

        const cloudModal = document.getElementById('cloudModal');
        const updateStatus = (type, icon, text) => {
            const banner = document.getElementById('cloudStatusBanner');
            const iconEl = document.getElementById('cloudStatusIcon');
            const textEl = document.getElementById('cloudStatusText');
            if (banner && textEl) {
                banner.className = `cloud-status-banner ${type}`;
                if (iconEl) iconEl.textContent = icon;
                textEl.textContent = text;
            }
        };

        // Open Cloud Modal automatically
        if (cloudModal) {
            cloudModal.classList.remove('hidden');
        }

        const user = window.FirebaseSync ? window.FirebaseSync.getCurrentUser() : null;
        if (user) {
            // User already logged in -> save immediately to cloud!
            updateStatus('loading', '🔄', '已連線 Google 帳號，正在自動將本機魚缸備份至 Firebase 雲端...');
            const saveRes = await window.FirebaseSync.saveToCloud(this.state);
            if (saveRes.success) {
                const successMsg = '🎉 恭喜！已成功將擴充功能本機魚缸備份至 Firebase 雲端！未來在任何裝置登入均可同步此魚缸。';
                updateStatus('success', '🎉', successMsg);
                this.showToast(successMsg, 'success', 8000);
                this.particles.addFloatingText(this.width / 2, 70, '🎉 雲端備份成功！', '#2ecc71', 18);
                if (window.soundCtrl) window.soundCtrl.playFanfare();
                this._pendingExtensionSync = null;
            } else {
                updateStatus('error', '❌', '雲端同步寫入失敗：' + (saveRes.error || '請點擊立即同步'));
            }
        } else {
            // Not logged in -> Prompt user to click Google Login
            const promptMsg = '已為您載入擴充功能魚缸存檔！請點擊上方「Google 一鍵登入」，即可將此存檔備份至 Firebase 雲端。';
            updateStatus('info', '🐟', promptMsg);
            this.showToast('📥 已成功載入擴充功能本機魚缸！請登入 Google 完成雲端備份。', 'info', 6000);
            this.particles.addFloatingText(this.width / 2, 70, '📥 魚缸存檔已載入！', '#00cec9', 16);
        }
    }

    /**
     * Sanitize state for cloud sync URL transmission to keep payload small (< 15KB).
     * If custom fish or decorations have large Base64 images (> 2000 chars),
     * strip the bulky image data while preserving all core stats (coins, levels,
     * species, hunger, happiness, growth, bornTime, decor positions, upgrades, etc.).
     */
    sanitizeStateForCloudUrl(rawState) {
        if (!rawState) return {};
        let clean;
        try {
            clean = JSON.parse(JSON.stringify(rawState));
        } catch (e) {
            clean = Object.assign({}, rawState);
        }

        const isOverlongBase64 = (val) => {
            if (typeof val !== 'string') return false;
            return val.length > 2000;
        };

        // 1. Sanitize fishList: preserve vital stats (coins, levels, species, hunger, growth, etc.)
        if (Array.isArray(clean.fishList)) {
            clean.fishList = clean.fishList.map(fish => {
                const f = { ...fish };
                if (isOverlongBase64(f.customImage)) {
                    delete f.customImage;
                }
                return f;
            });
        }

        // 2. Sanitize custom decorations: preserve positions, scale, enabled status
        if (clean.decorations && Array.isArray(clean.decorations.customDecorations)) {
            clean.decorations.customDecorations = clean.decorations.customDecorations.map(decor => {
                const d = { ...decor };
                if (isOverlongBase64(d.imageUrl)) {
                    delete d.imageUrl;
                }
                return d;
            });
        }

        // 3. Sanitize eventSettings (custom hand sprite)
        if (clean.eventSettings && isOverlongBase64(clean.eventSettings.customHandUrl)) {
            clean.eventSettings.customHandUrl = '';
        }

        // 4. Ensure total encoded payload is strictly under 15KB safe browser threshold (~14500 chars)
        let encoded = encodeURIComponent(JSON.stringify(clean));
        const MAX_SAFE_URL_PAYLOAD = 14500;
        if (encoded.length > MAX_SAFE_URL_PAYLOAD) {
            console.warn('[CloudSync] Encoded state payload exceeds safe size, stripping remaining non-critical image data...');
            if (Array.isArray(clean.fishList)) {
                clean.fishList.forEach(f => { delete f.customImage; });
            }
            if (clean.decorations && Array.isArray(clean.decorations.customDecorations)) {
                clean.decorations.customDecorations.forEach(d => { delete d.imageUrl; });
            }
            if (clean.eventSettings) {
                clean.eventSettings.customHandUrl = '';
            }
        }

        return clean;
    }

    async init() {
        try {
            // 0. Check Extension Cloud Sync Hash (#cloud_sync=1&data=...)
            this.handleCloudSyncHash();

            // Check if full extension state was delivered from extension bridge
            if (window._pendingFullExtensionState) {
                this._pendingExtensionSync = window._pendingFullExtensionState;
            }

            // 1. Load saved state
            this.state = await Storage.load();
            if (this._pendingExtensionSync) {
                this.state = this._pendingExtensionSync;
            }

            // 2. Setup audio
            if (window.soundCtrl) {
                window.soundCtrl.setEnabled(this.state.soundEnabled);
                this.updateSoundBtn();
            }

            // 3. Initialize Particle Manager & Decorations
            this.particles = new ParticleManager(this.width, this.height);

            // 4. Instantiate Fish entities
            this.fish = (this.state.fishList || []).map(fData => new Fish(fData, { width: this.width, height: this.height }));

            // 5. Apply saved tank size & recalculate fish capacity
            this.applyTankSize((this.state.upgrades && this.state.upgrades.tankSizeTier) || 1);

            // 6. Calculate Offline Idle Earnings
            this.processOfflineProgress();

            // 7. Bind UI Events & Mouse Tracker
            this.bindEvents();

            // 8. Update HUD & Tank ID Display
            this.updateHUD();
            this.updateTankIdUI();

            // 9. Check URL parameter ?tank=TARGET_ID for instant visiting
            const urlParams = new URLSearchParams(window.location.search);
            const targetTankParam = urlParams.get('tank');
            if (targetTankParam) {
                setTimeout(() => {
                    this.visitTank(targetTankParam);
                }, 400);
            }

            // 10. Check if extension state was imported via hash -> trigger cloud sync modal & prompt
            if (this._pendingExtensionSync) {
                setTimeout(() => {
                    this.triggerExtensionSyncPrompt();
                }, 300);
            }

            // 11. Start main render & simulation loop
            requestAnimationFrame((t) => this.loop(t));
        } catch (err) {
            console.error('Aquarium initialization error, launching fallback render loop:', err);
            if (!this.particles) this.particles = new ParticleManager(this.width, this.height);
            requestAnimationFrame((t) => this.loop(t));
        }
    }

    // Dynamic tank resizing (Chrome extension popup smoothly expands)
    applyTankSize(tier, isPurchase = false) {
        const sizeInfo = TANK_SIZES[tier] || TANK_SIZES[1];
        this.width = sizeInfo.width;
        this.height = sizeInfo.height;
        this.canvas.width = sizeInfo.width;
        this.canvas.height = sizeInfo.height;

        document.body.className = `tank-size-${tier}`;

        if (this.particles) {
            this.particles.resize(this.width, this.height);
        }
        if (this.fish) {
            this.fish.forEach(f => {
                f.bounds = { width: this.width, height: this.height };
            });
        }

        this.calculateTotalMaxFish();

        if (isPurchase) {
            if (window.soundCtrl) window.soundCtrl.playFanfare();
            this.particles.addFloatingText(this.width / 2, 70, `🎉 魚缸成功擴建！空間更大更開闊！`, '#00cec9', 15);
        }
    }

    calculateTotalMaxFish() {
        const capTier = this.state.upgrades.tankCapacityTier || 1;
        const sizeTier = this.state.upgrades.tankSizeTier || 1;
        const baseCap = (CAPACITY_LEVELS[capTier] ? CAPACITY_LEVELS[capTier].maxFish : 4);
        const bonusCap = (TANK_SIZES[sizeTier] ? TANK_SIZES[sizeTier].bonusSlots : 0);
        this.state.maxFishCount = baseCap + bonusCap;
        return this.state.maxFishCount;
    }

    // Process idle/offline time when player opens extension
    processOfflineProgress() {
        const now = Date.now();
        const lastSaved = this.state.lastSavedTime || now;
        const elapsedMs = Math.max(0, now - lastSaved);

        // If away for more than 40 seconds, calculate offline gains
        if (elapsedMs >= 40000) {
            const minutesAway = Math.floor(elapsedMs / 60000);
            const cappedMinutes = Math.min(minutesAway, 8 * 60); // Cap at 8 hours of idle time

            let totalOfflineCoins = 0;
            const autoFeederTier = this.state.upgrades.autoFeederTier || 0;

            this.fish.forEach(f => {
                let hungerLoss = Math.floor(cappedMinutes * 0.5);

                if (autoFeederTier > 0) {
                    hungerLoss = Math.max(0, hungerLoss - autoFeederTier * 15);
                }

                f.hunger = Math.max(5, f.hunger - hungerLoss);

                if (f.hunger > 10) {
                    const cycles = Math.floor((cappedMinutes * 60) / 8);
                    const baseEarn = f.species.baseIncome * cycles;
                    totalOfflineCoins += baseEarn;
                    f.coinsGeneratedTotal += baseEarn;
                }
            });

            const filterTier = this.state.upgrades.filterTier || 1;
            const waterLoss = Math.floor(cappedMinutes * (0.2 / filterTier));
            this.state.waterCleanliness = Math.max(20, this.state.waterCleanliness - waterLoss);

            if (totalOfflineCoins > 0) {
                this.state.coins += totalOfflineCoins;
                this.showOfflineModal(minutesAway, totalOfflineCoins);
            }
        }
    }

    showOfflineModal(minutes, coins) {
        const modal = document.getElementById('offlineModal');
        const timeText = document.getElementById('offlineTimeText');
        const coinsText = document.getElementById('offlineCoinsText');

        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        let timeStr = hours > 0 ? `${hours} 小時 ${mins} 分鐘` : `${mins} 分鐘`;
        timeText.textContent = `你離開了水族箱 ${timeStr}`;
        coinsText.textContent = `+${coins.toLocaleString()}`;

        modal.classList.remove('hidden');

        if (window.soundCtrl) window.soundCtrl.playCoinSound();
    }

    bindEvents() {
        // Track mouse movement for fish curiosity
        this.canvas.addEventListener('pointermove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.mousePos.x = (e.clientX - rect.left) * scaleX;
            this.mousePos.y = (e.clientY - rect.top) * scaleY;
        });

        this.canvas.addEventListener('pointerleave', () => {
            this.mousePos.x = -100;
            this.mousePos.y = -100;
        });

        // Canvas Click: Feed food or Pet fish or Defend Hand
        this.canvas.addEventListener('pointerdown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const clickX = (e.clientX - rect.left) * scaleX;
            const clickY = (e.clientY - rect.top) * scaleY;

            // 優先判定：是否擊中突發捕魚手 (Defend Fish!)
            if (this.particles.checkHitHand(clickX, clickY)) {
                if (window.soundCtrl) {
                    window.soundCtrl.playSlap();
                    window.soundCtrl.playMeow(true);
                }
                return;
            }

            let fishPetted = false;
            for (let f of this.fish) {
                if (f.containsPoint(clickX, clickY)) {
                    f.pet();
                    this.state.coins += 2;
                    this.particles.addCoinParticle(f.x, f.y - 20, 2);
                    this.particles.addHeart(f.x, f.y);
                    this.updateHUD();
                    fishPetted = true;
                    break;
                }
            }

            if (!fishPetted) {
                this.dropFood(clickX, clickY);
            }
        });

        // 🐾 Trigger Invasion Event Button (頂部快速召喚)
        const triggerBtn = document.getElementById('triggerEventBtn');
        if (triggerBtn) {
            triggerBtn.addEventListener('click', () => {
                this.triggerInvasionEvent();
            });
        }

        // 🥫 Action Feed Button
        const feedBtn = document.getElementById('feedBtn');
        if (feedBtn) {
            feedBtn.addEventListener('click', () => {
                this.dropFood(this.width / 2 + (Math.random() - 0.5) * 60, 30);
                this.dropFood(this.width / 2 + (Math.random() - 0.5) * 100, 25);
            });
        }

        // 🧽 Clean Tank Button
        const cleanBtn = document.getElementById('cleanBtn');
        if (cleanBtn) {
            cleanBtn.addEventListener('click', () => {
                if (this.state.waterCleanliness >= 100) {
                    this.particles.addFloatingText(this.width / 2, 80, '水質已經很乾淨囉！', '#81ecec');
                    return;
                }
                this.state.waterCleanliness = 100;
                this.state.stats.timesCleaned = (this.state.stats.timesCleaned || 0) + 1;
                if (window.soundCtrl) window.soundCtrl.playCleanSound();

                for (let i = 0; i < 15; i++) {
                    this.particles.addBubble(
                        Math.random() * this.width,
                        Math.random() * this.height,
                        2 + Math.random() * 3,
                        1.5 + Math.random() * 1.5
                    );
                }
                this.particles.addFloatingText(this.width / 2, 70, '✨ 魚缸清潔溜溜！', '#00cec9', 15);
                this.updateHUD();
            });
        }

        // 🔊 Sound Toggle
        const soundBtn = document.getElementById('soundToggleBtn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                this.state.soundEnabled = !this.state.soundEnabled;
                if (window.soundCtrl) window.soundCtrl.setEnabled(this.state.soundEnabled);
                this.updateSoundBtn();
                this.saveState();
            });
        }

        // 🪸 Decor Modal Open
        const decorBtn = document.getElementById('decorBtn');
        if (decorBtn) {
            decorBtn.addEventListener('click', () => {
                if (this.isVisiting) {
                    this.particles.addFloatingText(this.width / 2, 70, '👀 參觀模式中無法修改好友的水族箱造景喔！', '#ff7675', 14);
                    return;
                }
                this.syncDecorModalUI();
                const dModal = document.getElementById('decorModal');
                if (dModal) dModal.classList.remove('hidden');
            });
        }

        // 🐟 Roster Modal Open
        const rosterBtn = document.getElementById('rosterBtn');
        if (rosterBtn) {
            rosterBtn.addEventListener('click', () => {
                if (this.isVisiting) {
                    this.particles.addFloatingText(this.width / 2, 70, '👀 參觀模式中無法管理或放生好友的小魚喔！', '#ff7675', 14);
                    return;
                }
                this.renderRoster();
                const rModal = document.getElementById('rosterModal');
                if (rModal) rModal.classList.remove('hidden');
            });
        }

        // Roster 頂部「➕ 引進新小魚」按鈕
        const rosterAddBtn = document.getElementById('rosterAddFishBtn');
        if (rosterAddBtn) {
            rosterAddBtn.addEventListener('click', () => {
                if (this.isVisiting) return;
                const rModal = document.getElementById('rosterModal');
                const cModal = document.getElementById('customFishModal');
                if (rModal) rModal.classList.add('hidden');
                if (cModal) cModal.classList.remove('hidden');
            });
        }

        // 🏪 Shop Open
        const shopBtn = document.getElementById('shopBtn');
        if (shopBtn) {
            shopBtn.addEventListener('click', () => {
                if (this.isVisiting) {
                    this.particles.addFloatingText(this.width / 2, 70, '👀 參觀模式中無法購買好友水族箱的設施喔！', '#ff7675', 14);
                    return;
                }
                this.renderShop();
                const sModal = document.getElementById('shopModal');
                if (sModal) sModal.classList.remove('hidden');
            });
        }

        // 🎨 Custom Fish Open & Mode Switcher
        const urlInput = document.getElementById('fishUrlInput');
        const fileInput = document.getElementById('fishImageInput');
        const previewImg = document.getElementById('fishPreviewImg');
        const placeholder = document.getElementById('previewPlaceholder');
        const statusText = document.getElementById('customImageStatus');
        const nameInput = document.getElementById('customFishName');

        // Presets for instant testing
        const SAMPLE_PRESETS = {
            puffer: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 80'><ellipse cx='45' cy='40' rx='35' ry='28' fill='%23fbc531'/><ellipse cx='38' cy='48' rx='25' ry='16' fill='%23f5f6fa'/><polygon points='8,40 -2,25 -2,55' fill='%23e1b12c'/><circle cx='60' cy='32' r='7' fill='%232f3640'/><circle cx='63' cy='30' r='2.5' fill='%23ffffff'/><circle cx='30' cy='22' r='2.5' fill='%23e1b12c'/><circle cx='45' cy='18' r='3' fill='%23e1b12c'/><circle cx='25' cy='35' r='3' fill='%23e1b12c'/><circle cx='40' cy='30' r='2' fill='%23e1b12c'/><ellipse cx='35' cy='46' rx='8' ry='4' fill='%23e1b12c'/></svg>",
            shark: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 110 70'><path d='M85,35 Q65,15 35,20 Q15,24 5,35 Q15,46 35,50 Q65,55 85,35 Z' fill='%23487eb0'/><path d='M85,35 Q65,30 35,35 Q15,36 5,35 Q15,46 35,50 Q65,55 85,35 Z' fill='%23f5f6fa'/><polygon points='45,20 55,0 65,19' fill='%23487eb0'/><polygon points='10,35 -2,20 -2,50' fill='%23487eb0'/><circle cx='70' cy='27' r='4' fill='%232f3640'/><circle cx='72' cy='25.5' r='1.5' fill='%23ffffff'/></svg>",
            squid: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 80'><path d='M75,40 C75,22 55,20 40,20 C25,20 15,30 15,40 C15,50 25,60 40,60 C55,60 75,58 75,40 Z' fill='%239c88ff'/><polygon points='75,40 92,25 85,40 92,55' fill='%238c7ae6'/><path d='M15,30 Q-5,32 -2,40 Q-5,48 15,50' stroke='%238c7ae6' stroke-width='4' fill='none'/><circle cx='35' cy='32' r='5' fill='%232f3640'/><circle cx='36.5' cy='30.5' r='1.8' fill='%23ffffff'/></svg>"
        };

        const testAndSetImage = (src, defaultName = '') => {
            if (!src) {
                this.selectedUploadImage = null;
                previewImg.classList.add('hidden');
                placeholder.classList.remove('hidden');
                statusText.textContent = '貼上網址或選取圖檔即可即時預覽';
                statusText.className = 'custom-status-text';
                return;
            }

            statusText.textContent = '⏳ 正在驗證並載入圖片...';
            statusText.className = 'custom-status-text loading';

            const testImg = new Image();
            if (src.startsWith('http://') || src.startsWith('https://')) {
                testImg.crossOrigin = 'anonymous';
            }
            testImg.onload = () => {
                this.selectedUploadImage = src;
                previewImg.src = src;
                previewImg.classList.remove('hidden');
                placeholder.classList.add('hidden');
                statusText.textContent = '✅ 圖片載入成功！可以放流進魚缸囉';
                statusText.className = 'custom-status-text success';

                if (defaultName && !nameInput.value.trim()) {
                    nameInput.value = defaultName;
                }
            };
            testImg.onerror = () => {
                this.selectedUploadImage = null;
                previewImg.classList.add('hidden');
                placeholder.classList.remove('hidden');
                statusText.textContent = '❌ 無法讀取該圖片網址，請確認是有效的公開圖片連結。';
                statusText.className = 'custom-status-text error';
            };
            testImg.src = src;
        };

        const customFishBtn = document.getElementById('customFishBtn');
        if (customFishBtn) {
            customFishBtn.addEventListener('click', () => {
                if (this.isVisiting) {
                    this.particles.addFloatingText(this.width / 2, 70, '👀 參觀模式中無法添加自訂小魚至好友的魚缸喔！', '#ff7675', 14);
                    return;
                }
                this.selectedUploadImage = null;
                if (urlInput) urlInput.value = '';
                if (fileInput) fileInput.value = '';
                if (nameInput) nameInput.value = '';
                testAndSetImage(null);
                const modal = document.getElementById('customFishModal');
                if (modal) modal.classList.remove('hidden');
            });
        }

        // Toggle Method Tabs
        const methodTabs = document.querySelectorAll('.method-tab');
        methodTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                methodTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const method = tab.getAttribute('data-method');
                if (method === 'url') {
                    const uSec = document.getElementById('urlInputSection');
                    const fSec = document.getElementById('fileInputSection');
                    if (uSec) uSec.classList.add('active');
                    if (fSec) fSec.classList.remove('active');
                } else {
                    const uSec = document.getElementById('urlInputSection');
                    const fSec = document.getElementById('fileInputSection');
                    if (uSec) uSec.classList.remove('active');
                    if (fSec) fSec.classList.add('active');
                }
            });
        });

        // URL Input Listener (with instant debounce)
        let urlDebounce = null;
        if (urlInput) {
            urlInput.addEventListener('input', () => {
                clearTimeout(urlDebounce);
                urlDebounce = setTimeout(() => {
                    const url = urlInput.value.trim();
                    testAndSetImage(url);
                }, 300);
            });
        }

        // Quick Sample Preset Buttons
        document.querySelectorAll('.sample-pill-btn').forEach(pill => {
            pill.addEventListener('click', () => {
                const sampleKey = pill.getAttribute('data-sample');
                const sampleNames = { puffer: '圓滾刺河豚', shark: '呆萌小鯊魚', squid: '螢光小烏賊' };
                if (SAMPLE_PRESETS[sampleKey]) {
                    if (urlInput) urlInput.value = SAMPLE_PRESETS[sampleKey];
                    testAndSetImage(SAMPLE_PRESETS[sampleKey], sampleNames[sampleKey] || '自訂小魚');
                }
            });
        });

        // Local File Picker
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        const dataUrl = evt.target.result;
                        const fileNameClean = file.name.replace(/\.[^/.]+$/, "");
                        testAndSetImage(dataUrl, fileNameClean);
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        const createFishBtn = document.getElementById('createCustomFishBtn');
        if (createFishBtn) {
            createFishBtn.addEventListener('click', () => {
                if (!this.selectedUploadImage) {
                    alert('請先輸入有效的圖片網址，或從電腦選取一張魚的圖片喔！');
                    return;
                }
                if (this.fish.length >= this.state.maxFishCount) {
                    alert(`魚缸容量已滿（目前上限 ${this.state.maxFishCount} 隻），請在商城升級魚缸尺寸或溶氧生態槽！`);
                    return;
                }

                const customName = (nameInput && nameInput.value.trim()) || '自訂小魚';
                const newFishData = {
                    id: 'fish_custom_' + Date.now(),
                    speciesId: 'custom',
                    name: customName,
                    customImage: this.selectedUploadImage,
                    hunger: 90,
                    happiness: 95,
                    growth: 40,
                    bornTime: Date.now(),
                    coinsGeneratedTotal: 0
                };

                const fishEntity = new Fish(newFishData, { width: this.width, height: this.height });
                this.fish.push(fishEntity);
                this.state.fishList.push(newFishData);

                if (window.soundCtrl) window.soundCtrl.playFanfare();
                this.particles.addFloatingText(this.width / 2, 80, '🎉 你的專屬小魚游進魚缸了！', '#ffd700', 15);

                const cModal = document.getElementById('customFishModal');
                if (cModal) cModal.classList.add('hidden');
                this.updateHUD();
                this.saveState();
            });
        }

        document.getElementById('rosterBtn').addEventListener('click', () => {
            this.renderRoster();
            document.getElementById('rosterModal').classList.remove('hidden');
        });

        document.querySelectorAll('.close-modal-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-close');
                document.getElementById(targetId).classList.add('hidden');
            });
        });

        document.getElementById('claimOfflineBtn').addEventListener('click', () => {
            document.getElementById('offlineModal').classList.add('hidden');
            this.updateHUD();
            this.saveState();
        });

        document.querySelectorAll('.tab-btn').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                const parentModal = tabBtn.closest('.modal-card');
                if (!parentModal) return;
                parentModal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                parentModal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                tabBtn.classList.add('active');
                const targetTab = tabBtn.getAttribute('data-tab');
                const targetContent = document.getElementById(targetTab);
                if (targetContent) targetContent.classList.add('active');
            });
        });

        // 綁定編輯小魚、造景工坊、雲端存檔與探訪大廳專屬事件
        this.initEditFishEvents();
        this.initDecorWorkshopEvents();
        this.initCloudSyncEvents();
        this.initLobbyEvents();
    }

    applyState(newState) {
        if (!newState) return;
        this.state = newState;
        this.fish = (this.state.fishList || []).map(fData => new Fish(fData, { width: this.width, height: this.height }));
        this.applyTankSize((this.state.upgrades && this.state.upgrades.tankSizeTier) || 1);
        this.updateHUD();
        if (typeof this.updateTankIdUI === 'function') {
            this.updateTankIdUI();
        }
        if (window.soundCtrl) {
            window.soundCtrl.setEnabled(this.state.soundEnabled);
            this.updateSoundBtn();
        }
    }

    initCloudSyncEvents() {
        const cloudAuthBtn = document.getElementById('cloudAuthBtn');
        const cloudModal = document.getElementById('cloudModal');
        const googleLoginBtn = document.getElementById('googleLoginBtn');
        const googleLogoutBtn = document.getElementById('googleLogoutBtn');
        const syncNowBtn = document.getElementById('syncNowBtn');
        const exportSaveBtn = document.getElementById('exportSaveBtn');
        const importSaveBtn = document.getElementById('importSaveBtn');
        const importSaveFileInput = document.getElementById('importSaveFileInput');

        const cloudGuestView = document.getElementById('cloudGuestView');
        const cloudLoggedInView = document.getElementById('cloudLoggedInView');
        const cloudUserAvatar = document.getElementById('cloudUserAvatar');
        const cloudUserName = document.getElementById('cloudUserName');
        const cloudUserEmail = document.getElementById('cloudUserEmail');

        const cloudStatusBanner = document.getElementById('cloudStatusBanner');
        const cloudStatusIcon = document.getElementById('cloudStatusIcon');
        const cloudStatusText = document.getElementById('cloudStatusText');

        const updateStatus = (type, icon, text) => {
            if (!cloudStatusBanner || !cloudStatusText) return;
            cloudStatusBanner.className = `cloud-status-banner ${type}`;
            if (cloudStatusIcon) cloudStatusIcon.textContent = icon;
            cloudStatusText.textContent = text;
        };

        const updateAuthUI = (user) => {
            if (user) {
                const displayName = user.displayName || (user.email ? user.email.split('@')[0] : '已登入');
                if (cloudAuthBtn) {
                    cloudAuthBtn.innerHTML = `☁️ ${displayName}`;
                    cloudAuthBtn.classList.add('logged-in');
                    cloudAuthBtn.title = `已登入：${displayName} (${user.email || ''})`;
                }
                if (cloudGuestView) cloudGuestView.classList.add('hidden');
                if (cloudLoggedInView) cloudLoggedInView.classList.remove('hidden');
                if (cloudUserAvatar) cloudUserAvatar.src = user.photoURL || 'icons/icon48.png';
                if (cloudUserName) cloudUserName.textContent = displayName;
                if (cloudUserEmail) cloudUserEmail.textContent = user.email || '';

                if (googleLoginBtn) googleLoginBtn.classList.add('hidden');
                if (googleLogoutBtn) googleLogoutBtn.classList.remove('hidden');
                if (syncNowBtn) syncNowBtn.disabled = false;
            } else {
                if (cloudAuthBtn) {
                    cloudAuthBtn.innerHTML = `👤 登入`;
                    cloudAuthBtn.classList.remove('logged-in');
                    cloudAuthBtn.title = `雲端帳號與存檔同步`;
                }
                if (cloudGuestView) cloudGuestView.classList.remove('hidden');
                if (cloudLoggedInView) cloudLoggedInView.classList.add('hidden');

                if (googleLoginBtn) googleLoginBtn.classList.remove('hidden');
                if (googleLogoutBtn) googleLogoutBtn.classList.add('hidden');
                if (syncNowBtn) syncNowBtn.disabled = true;
            }
            this.updateTankIdUI();
        };

        // Open Cloud Modal
        if (cloudAuthBtn) {
            cloudAuthBtn.addEventListener('click', () => {
                if (cloudModal) cloudModal.classList.remove('hidden');
                const user = window.FirebaseSync ? window.FirebaseSync.getCurrentUser() : null;
                updateAuthUI(user);
                if (user) {
                    const syncTime = this.state.lastCloudSyncTime || this.state.lastSavedTime || Date.now();
                    updateStatus('info', '☁️', `雲端已連線，上次同步：${new Date(syncTime).toLocaleTimeString()}`);
                } else {
                    const isExtension = (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') ||
                                        (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ||
                                        (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:');
                    if (isExtension) {
                        updateStatus('info', 'ℹ️', '點擊下方「Google 一鍵登入」，將自動為您開啟新分頁並備份本機魚缸至雲端！');
                    } else if (this._pendingExtensionSync) {
                        updateStatus('info', '🐟', '已為您載入擴充功能魚缸存檔！請點擊上方「Google 一鍵登入」備份至雲端。');
                    } else {
                        updateStatus('info', 'ℹ️', '目前處於訪客模式（本機存檔）');
                    }
                }
            });
        }

        // Google Login
        if (googleLoginBtn) {
            const isExtensionEnv = (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') ||
                                   (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ||
                                   (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:');
            if (isExtensionEnv) {
                googleLoginBtn.innerHTML = '<span class="btn-icon">🌐</span> Google 一鍵登入同步至雲端';
            }

            googleLoginBtn.addEventListener('click', async () => {
                const isExtension = (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') ||
                                    (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ||
                                    (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:');

                if (isExtension) {
                    this.saveState();
                    const stateToSync = this.state || await Storage.load();
                    updateStatus('loading', '🚀', '正在準備本機魚缸資料並開啟授權同步分頁...');

                    try {
                        const payload = this.sanitizeStateForCloudUrl(stateToSync);
                        const encodedData = encodeURIComponent(JSON.stringify(payload));
                        const targetUrl = `https://youchiang.github.io/idle-fish-tank/#cloud_sync=1&data=${encodedData}`;

                        if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
                            chrome.tabs.create({ url: targetUrl }, (tab) => {
                                if (chrome.runtime && chrome.runtime.lastError) {
                                    console.error('[CloudSync] chrome.tabs.create error:', chrome.runtime.lastError.message || chrome.runtime.lastError);
                                    try {
                                        window.open(targetUrl, '_blank');
                                    } catch (openErr) {
                                        console.error('[CloudSync] Fallback window.open failed:', openErr);
                                    }
                                }
                            });
                        } else {
                            window.open(targetUrl, '_blank');
                        }

                        updateStatus('success', '🚀', '已為您開啟 Google 授權分頁，登入完成後將自動將本機魚缸備份至雲端！');
                        this.showToast('已為您開啟 Google 授權分頁，登入完成後將自動將本機魚缸備份至雲端！', 'info', 6000);
                        this.particles.addFloatingText(this.width / 2, 70, '🚀 已開啟雲端備份分頁', '#00cec9', 16);
                    } catch (err) {
                        console.error('[CloudSync] Failed to open auth tab:', err);
                        updateStatus('error', '❌', '開啟授權分頁失敗：' + (err.message || '未知錯誤'));
                    }
                    return;
                }

                if (!window.FirebaseSync) return;
                updateStatus('loading', '⏳', '正在連接 Google 帳號中...');
                const loginRes = await window.FirebaseSync.loginWithGoogle();
                if (loginRes.success && loginRes.user) {
                    updateAuthUI(loginRes.user);

                    if (this._pendingExtensionSync) {
                        updateStatus('loading', '🔄', '登入成功！正在將擴充功能魚缸存檔寫入 Firebase 雲端...');
                        const saveRes = await window.FirebaseSync.saveToCloud(this.state);
                        if (saveRes.success) {
                            const successMsg = '🎉 恭喜！已成功將擴充功能本機魚缸備份至 Firebase 雲端！未來在任何裝置登入均可同步此魚缸。';
                            updateStatus('success', '🎉', successMsg);
                            this.showToast(successMsg, 'success', 8000);
                            this.particles.addFloatingText(this.width / 2, 70, '🎉 雲端備份成功！', '#2ecc71', 18);
                            if (window.soundCtrl) window.soundCtrl.playFanfare();
                            this._pendingExtensionSync = null;
                        } else {
                            updateStatus('error', '❌', '雲端同步寫入失敗：' + (saveRes.error || '請重試'));
                        }
                    } else {
                        updateStatus('loading', '🔄', '登入成功！正在智慧同步雲端存檔...');
                        this._isAutoSyncing = true;
                        try {
                            const syncRes = await Storage.syncWithCloud({ preferCloud: true });
                            if (syncRes.action === 'loaded_cloud') {
                                this.applyState(syncRes.state);
                                updateStatus('success', '✅', '成功自雲端下載最新水族箱進度！');
                                this.showToast('☁️ 已同步載入您的雲端水族箱！', 'success', 5000);
                                this.particles.addFloatingText(this.width / 2, 70, '☁️ 雲端存檔同步成功！', '#00cec9', 16);
                                if (window.soundCtrl) window.soundCtrl.playFanfare();
                            } else if (syncRes.action === 'uploaded_local') {
                                updateStatus('success', '✅', '已將目前水族箱進度成功備份至雲端！');
                                this.particles.addFloatingText(this.width / 2, 70, '☁️ 本地進度已上傳雲端！', '#2ecc71', 16);
                            } else {
                                updateStatus('success', '✅', syncRes.message || '雲端同步完成');
                            }
                        } finally {
                            this._isAutoSyncing = false;
                        }
                    }
                } else {
                    updateStatus('error', '❌', loginRes.error || '登入失敗，請確認網路連線');
                }
            });
        }

        // Google Logout
        if (googleLogoutBtn) {
            googleLogoutBtn.addEventListener('click', async () => {
                if (!window.FirebaseSync) return;
                updateStatus('loading', '⏳', '正在登出帳號...');
                await window.FirebaseSync.logout();
                updateAuthUI(null);
                updateStatus('info', 'ℹ️', '已安全登出，後續遊玩將儲存於本機');
            });
        }

        // Manual Cloud Sync Now
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', async () => {
                if (!window.FirebaseSync || !window.FirebaseSync.getCurrentUser()) {
                    updateStatus('error', '⚠️', '請先登入 Google 帳號後再進行同步');
                    return;
                }
                updateStatus('loading', '⏳', '正在同步魚缸進度至雲端...');
                this.saveState();
                const saveRes = await window.FirebaseSync.saveToCloud(this.state);
                if (saveRes.success) {
                    const syncTime = saveRes.timestamp || Date.now();
                    this.state.lastCloudSyncTime = syncTime;
                    await Storage.saveLocalOnly(this.state);
                    const timeStr = new Date(syncTime).toLocaleTimeString();
                    updateStatus('success', '✅', `雲端存檔已同步成功！(${timeStr})`);
                    this.particles.addFloatingText(this.width / 2, 70, '☁️ 雲端進度已即時更新！', '#00cec9', 16);
                    if (window.soundCtrl) window.soundCtrl.playCoinSound();
                } else {
                    const isExtension = (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:') ||
                                        (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function');
                    if (isExtension) {
                        updateStatus('loading', '🚀', 'REST 直連需要重新授權，正在開啟網頁版同步分頁...');
                        try {
                            const payload = this.sanitizeStateForCloudUrl(this.state);
                            const encodedData = encodeURIComponent(JSON.stringify(payload));
                            const targetUrl = `https://youchiang.github.io/idle-fish-tank/#cloud_sync=1&data=${encodedData}`;
                            if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
                                chrome.tabs.create({ url: targetUrl });
                            } else {
                                window.open(targetUrl, '_blank');
                            }
                        } catch (tabErr) {
                            updateStatus('error', '❌', `雲端儲存失敗：${saveRes.error || saveRes.reason || '請檢查網路'}`);
                        }
                    } else {
                        updateStatus('error', '❌', `雲端儲存失敗：${saveRes.error || saveRes.reason || '請檢查網路'}`);
                    }
                }
            });
        }

        // Export JSON Backup
        if (exportSaveBtn) {
            exportSaveBtn.addEventListener('click', async () => {
                this.saveState();
                const fileName = await Storage.exportSave();
                updateStatus('success', '📥', `備份檔案已下載至電腦：${fileName}`);
                this.particles.addFloatingText(this.width / 2, 70, '💾 存檔匯出成功！', '#ffd700', 15);
            });
        }

        // Import JSON Backup
        if (importSaveBtn && importSaveFileInput) {
            importSaveBtn.addEventListener('click', () => {
                importSaveFileInput.click();
            });

            importSaveFileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (evt) => {
                    try {
                        const content = evt.target.result;
                        const res = await Storage.importSave(content);
                        if (res.success && res.state) {
                            this.applyState(res.state);
                            updateStatus('success', '🎉', `存檔還原成功！已載入 ${file.name}`);
                            this.particles.addFloatingText(this.width / 2, 70, '🎉 存檔還原成功！', '#00cec9', 16);
                            if (window.soundCtrl) window.soundCtrl.playFanfare();
                        } else {
                            updateStatus('error', '❌', res.error || '存檔檔案格式錯誤');
                        }
                    } catch (err) {
                        updateStatus('error', '❌', `讀取檔案失敗：${err.message}`);
                    }
                    importSaveFileInput.value = '';
                };
                reader.readAsText(file);
            });
        }

        // Listen for Firebase Auth state changes
        if (window.FirebaseSync && typeof window.FirebaseSync.onAuthStateChanged === 'function') {
            window.FirebaseSync.onAuthStateChanged(async (user) => {
                updateAuthUI(user);
                if (user && this._pendingExtensionSync && !this._isSavingExtensionSync) {
                    this._isSavingExtensionSync = true;
                    try {
                        updateStatus('loading', '🔄', '偵測到 Google 帳號已登入，正在將擴充功能魚缸存檔寫入 Firebase 雲端...');
                        const saveRes = await window.FirebaseSync.saveToCloud(this.state);
                        if (saveRes.success) {
                            const syncTime = saveRes.timestamp || Date.now();
                            this.state.lastCloudSyncTime = syncTime;
                            await Storage.saveLocalOnly(this.state);
                            const successMsg = '🎉 恭喜！已成功將擴充功能本機魚缸備份至 Firebase 雲端！未來在任何裝置登入均可同步此魚缸。';
                            updateStatus('success', '🎉', successMsg);
                            this.showToast(successMsg, 'success', 8000);
                            this.particles.addFloatingText(this.width / 2, 70, '🎉 雲端備份成功！', '#2ecc71', 18);
                            if (window.soundCtrl) window.soundCtrl.playFanfare();
                            this._pendingExtensionSync = null;
                        } else {
                            updateStatus('error', '❌', '雲端同步寫入失敗：' + (saveRes.error || '請重試'));
                        }
                    } finally {
                        this._isSavingExtensionSync = false;
                        this._initialCloudSyncDone = true;
                    }
                } else if (user && !this._pendingExtensionSync && !this._isAutoSyncing) {
                    // Check if running on web (protocol !== 'chrome-extension:')
                    const isExtension = (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:');
                    if (!isExtension) {
                        this._isAutoSyncing = true;
                        try {
                            const syncRes = await Storage.syncWithCloud({ preferCloud: true });
                            if (syncRes.action === 'loaded_cloud') {
                                this.applyState(syncRes.state);
                                this.state.lastCloudSyncTime = syncRes.state.lastCloudSyncTime || Date.now();
                                updateStatus('success', '✅', '已同步載入您的雲端水族箱！');
                                this.showToast('☁️ 已同步載入您的雲端水族箱！', 'success', 5000);
                                this.particles.addFloatingText(this.width / 2, 70, '☁️ 已載入雲端水族箱！', '#00cec9', 16);
                                if (window.soundCtrl) window.soundCtrl.playFanfare();
                            } else if (syncRes.action === 'uploaded_local') {
                                updateStatus('success', '✅', '已將目前水族箱進度備份至雲端！');
                            }
                        } catch (syncErr) {
                            console.warn('[Game] Auto sync notice:', syncErr);
                        } finally {
                            this._isAutoSyncing = false;
                            this._initialCloudSyncDone = true;
                        }
                    }
                }
            });
        }
    }

    updateTankIdUI() {
        const idDisplay = document.getElementById('tankIdDisplay');
        const copyBtn = document.getElementById('copyTankIdBtn');
        if (!idDisplay) return;

        let currentId = 'guest';
        if (window.FirebaseSync && window.FirebaseSync.getCurrentUser()) {
            currentId = window.FirebaseSync.getCurrentUser().uid;
        } else if (this.state && this.state.tankId) {
            currentId = this.state.tankId;
        }

        idDisplay.textContent = currentId;
        idDisplay.title = `魚缸 ID: ${currentId}（點擊一鍵複製）`;

        const doCopy = () => {
            const shareUrl = `${window.location.origin}${window.location.pathname}?tank=${currentId}`;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(currentId).then(() => {
                    this.particles.addFloatingText(this.width / 2, 70, '📋 魚缸 ID 已複製至剪貼簿！', '#ffd700', 15);
                    if (copyBtn) {
                        const orig = copyBtn.textContent;
                        copyBtn.textContent = '✅ 已複製';
                        setTimeout(() => copyBtn.textContent = orig, 1800);
                    }
                }).catch(() => {
                    prompt('請複製你的魚缸 ID：', currentId);
                });
            } else {
                prompt('請複製你的魚缸 ID：', currentId);
            }
        };

        if (copyBtn && !copyBtn._bound) {
            copyBtn._bound = true;
            copyBtn.addEventListener('click', doCopy);
        }
        if (!idDisplay._bound) {
            idDisplay._bound = true;
            idDisplay.addEventListener('click', doCopy);
        }
    }

    async visitTank(tankId) {
        if (!tankId) return;

        // Backup my original state if not visiting yet
        if (!this.isVisiting) {
            this.myState = JSON.parse(JSON.stringify(this.state));
        }

        this.particles.addFloatingText(this.width / 2, 70, `⏳ 正在連接並載入【${tankId}】的水族箱...`, '#81ecec', 14);

        const res = await window.FirebaseSync.loadTankById(tankId);
        if (!res.success || !res.gameState) {
            this.particles.addFloatingText(this.width / 2, 70, `❌ 參觀失敗：${res.error || '找不到此魚缸'}`, '#ff7675', 15);
            return;
        }

        this.isVisiting = true;
        this.visitingTargetId = tankId;

        // Close lobby modal if open
        const lModal = document.getElementById('lobbyModal');
        if (lModal) lModal.classList.add('hidden');

        // Update visiting banner
        const banner = document.getElementById('visitingBanner');
        const titleEl = document.getElementById('visitingTitle');
        const likesEl = document.getElementById('visitingLikesCount');
        if (banner) banner.classList.remove('hidden');
        if (titleEl) titleEl.textContent = `${res.displayName} 的水族箱`;
        if (likesEl) likesEl.textContent = res.likes || 0;

        // Apply visiting state
        this.state = res.gameState;
        this.fish = (this.state.fishList || []).map(fData => new Fish(fData, { width: this.width, height: this.height }));
        this.applyTankSize((this.state.upgrades && this.state.upgrades.tankSizeTier) || 1);
        this.updateHUD();

        // Update URL param
        if (window.history && window.history.pushState) {
            window.history.pushState(null, '', `?tank=${tankId}`);
        }

        if (window.soundCtrl) window.soundCtrl.playFanfare();
        this.particles.addFloatingText(this.width / 2, 70, `👀 歡迎參觀【${res.displayName}】的水族箱！`, '#00cec9', 16);
    }

    exitVisitingMode() {
        if (!this.isVisiting || !this.myState) return;

        this.isVisiting = false;
        this.visitingTargetId = null;

        // Hide banner
        const banner = document.getElementById('visitingBanner');
        if (banner) banner.classList.add('hidden');

        // Restore my state
        this.state = this.myState;
        this.myState = null;
        this.fish = (this.state.fishList || []).map(fData => new Fish(fData, { width: this.width, height: this.height }));
        this.applyTankSize((this.state.upgrades && this.state.upgrades.tankSizeTier) || 1);
        this.updateHUD();
        this.updateTankIdUI();

        // Remove URL param
        if (window.history && window.history.pushState) {
            window.history.pushState(null, '', window.location.pathname);
        }

        this.particles.addFloatingText(this.width / 2, 70, '🏠 已返回你專屬的水族箱！', '#ffd700', 16);
    }

    initLobbyEvents() {
        const lobbyBtn = document.getElementById('lobbyBtn');
        const lobbyModal = document.getElementById('lobbyModal');
        const visitTargetBtn = document.getElementById('visitTargetBtn');
        const visitTankIdInput = document.getElementById('visitTankIdInput');
        const publicTankToggle = document.getElementById('publicTankToggle');
        const refreshLobbyBtn = document.getElementById('refreshLobbyBtn');

        const likeTankBtn = document.getElementById('likeTankBtn');
        const feedFriendBtn = document.getElementById('feedFriendBtn');
        const exitVisitingBtn = document.getElementById('exitVisitingBtn');

        // Open lobby modal
        if (lobbyBtn) {
            lobbyBtn.addEventListener('click', () => {
                if (lobbyModal) lobbyModal.classList.remove('hidden');
                if (publicTankToggle && this.state) {
                    publicTankToggle.checked = this.state.isPublic !== false;
                }
                this.renderLobby();
            });
        }

        // Toggle public status
        if (publicTankToggle) {
            publicTankToggle.addEventListener('change', () => {
                if (this.isVisiting) return;
                this.state.isPublic = publicTankToggle.checked;
                this.saveState();
                const statusMsg = this.state.isPublic ? '🌐 已公開你的水族箱！其他玩家可在大廳前來參觀！' : '🔒 已設為私人魚缸，大廳將不再顯示。';
                this.particles.addFloatingText(this.width / 2, 70, statusMsg, '#81ecec', 14);
            });
        }

        // Visit target ID button
        if (visitTargetBtn && visitTankIdInput) {
            visitTargetBtn.addEventListener('click', () => {
                const targetId = visitTankIdInput.value.trim();
                if (!targetId) {
                    alert('請輸入要參觀的好友魚缸 ID！');
                    return;
                }
                this.visitTank(targetId);
            });

            visitTankIdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const targetId = visitTankIdInput.value.trim();
                    if (targetId) this.visitTank(targetId);
                }
            });
        }

        // Refresh lobby button
        if (refreshLobbyBtn) {
            refreshLobbyBtn.addEventListener('click', () => {
                this.renderLobby();
            });
        }

        // Visiting Banner Buttons
        if (likeTankBtn) {
            likeTankBtn.addEventListener('click', async () => {
                if (!this.isVisiting || !this.visitingTargetId) return;
                if (likeTankBtn._liked) {
                    this.particles.addFloatingText(this.width / 2, 70, '❤️ 你已經為這座水族館點過讚囉！', '#ffd700', 14);
                    return;
                }
                likeTankBtn._liked = true;
                const likesEl = document.getElementById('visitingLikesCount');
                if (likesEl) {
                    likesEl.textContent = parseInt(likesEl.textContent || '0', 10) + 1;
                }
                if (window.soundCtrl) window.soundCtrl.playCoinSound();
                this.particles.addFloatingText(this.width / 2, 70, '❤️ 點讚成功！給好友滿滿鼓勵！', '#ff7675', 16);
                await window.FirebaseSync.likeTank(this.visitingTargetId);
            });
        }

        if (feedFriendBtn) {
            feedFriendBtn.addEventListener('click', () => {
                if (!this.isVisiting) return;
                this.dropFood(this.width / 2 + (Math.random() - 0.5) * 80, 25);
                this.particles.addFloatingText(this.width / 2, 70, '🥫 幫忙投餵飼料！好友的小魚吃得很開心！', '#ffd700', 14);
                if (window.soundCtrl) window.soundCtrl.playCleanSound();
            });
        }

        if (exitVisitingBtn) {
            exitVisitingBtn.addEventListener('click', () => {
                this.exitVisitingMode();
            });
        }
    }

    async renderLobby() {
        const container = document.getElementById('lobbyTankList');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:20px;color:#81ecec;font-size:12px;">⏳ 正在探索公開水族館大廳...</div>';

        const res = await window.FirebaseSync.getPublicTanks();
        container.innerHTML = '';

        if (!res.success || !res.tanks || res.tanks.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#a4b0be;font-size:12px;">目前大廳尚無其他公開魚缸，點擊上方開啟公開成為第一位大廳之星！</div>';
            return;
        }

        const THEME_NAMES = {
            ocean: '經典蔚藍',
            emerald: '熱帶翡翠',
            abyss: '午夜幽深',
            sunset: '夕陽珊瑚',
            cyber: '賽博霓虹'
        };

        res.tanks.forEach(tank => {
            const card = document.createElement('div');
            card.className = 'lobby-tank-card';

            const photo = tank.photoURL || 'icons/icon48.png';
            const themeLabel = THEME_NAMES[tank.theme] || '蔚藍海洋';
            const fishCount = tank.fishCount || 1;
            const likes = tank.likes || 0;
            const title = tank.tankName || `${tank.displayName || '島主'} 的水族館`;

            card.innerHTML = `
                <div class="tank-card-left">
                    <img src="${photo}" class="tank-avatar" alt="頭像">
                    <div class="tank-card-meta">
                        <div class="tank-card-title">${title}</div>
                        <div class="tank-card-sub">
                            <span>👤 ${tank.displayName || '魚友'}</span>
                            <span>·</span>
                            <span>❤️ ${likes} 讚</span>
                        </div>
                        <div class="tank-card-pills">
                            <span class="tank-pill">🐟 ${fishCount} 隻魚</span>
                            <span class="tank-pill">🎨 ${themeLabel}</span>
                        </div>
                    </div>
                </div>
                <button class="visit-action-btn" data-tank-id="${tank.uid}">參觀 🚀</button>
            `;

            const visitBtn = card.querySelector('.visit-action-btn');
            visitBtn.addEventListener('click', () => {
                this.visitTank(tank.uid);
            });

            container.appendChild(card);
        });
    }

    // 觸發捕魚手突發事件 (10秒)
    triggerInvasionEvent() {
        if (!this.particles || this.particles.invasion.active) return;
        const handType = (this.state.eventSettings && this.state.eventSettings.handType) || 'orangeCat';
        const customHandUrl = (this.state.eventSettings && this.state.eventSettings.customHandUrl) || '';
        this.particles.startInvasion({ handType, customHandUrl });

        if (window.soundCtrl) {
            window.soundCtrl.playAlarm();
            window.soundCtrl.playMeow(false);
        }
        this.particles.addFloatingText(this.width / 2, 80, '🚨 捕魚手突襲！快狂點擊退牠！', '#ff4757', 16);
    }

    // 初始化編輯小魚 (Edit Fish) 視窗邏輯
    initEditFishEvents() {
        const modal = document.getElementById('editFishModal');
        const nameInput = document.getElementById('editFishName');
        const speciesSelect = document.getElementById('editFishSpeciesSelect');
        const customZone = document.getElementById('editFishCustomZone');
        const urlInput = document.getElementById('editFishUrlInput');
        const fileInput = document.getElementById('editFishFileInput');
        const previewImg = document.getElementById('editFishPreviewImg');

        if (speciesSelect) {
            speciesSelect.addEventListener('change', () => {
                if (speciesSelect.value === 'custom') {
                    if (customZone) customZone.classList.remove('hidden');
                    if (previewImg) previewImg.src = this.editUploadImage || 'icons/icon48.png';
                } else {
                    if (customZone) customZone.classList.add('hidden');
                    if (previewImg) previewImg.src = 'icons/icon48.png';
                }
            });
        }

        if (urlInput) {
            urlInput.addEventListener('input', () => {
                const url = urlInput.value.trim();
                if (url) {
                    this.editUploadImage = url;
                    if (previewImg) previewImg.src = url;
                }
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        this.editUploadImage = evt.target.result;
                        if (previewImg) previewImg.src = this.editUploadImage;
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        const saveBtn = document.getElementById('saveEditFishBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (!this.editingFishId) return;
                const targetFish = this.fish.find(f => f.id === this.editingFishId);
                if (!targetFish) return;

                const newName = (nameInput && nameInput.value.trim()) || targetFish.name;
                const newSpecies = (speciesSelect && speciesSelect.value) || targetFish.speciesId;
                const newImage = (newSpecies === 'custom') ? this.editUploadImage : null;

                targetFish.updateData({
                    name: newName,
                    speciesId: newSpecies,
                    customImage: newImage
                });

                if (window.soundCtrl) window.soundCtrl.playFanfare();
                this.particles.addFloatingText(this.width / 2, 70, `✨ 已成功更新「${newName}」的資料！`, '#00cec9', 15);

                if (modal) modal.classList.add('hidden');
                this.renderRoster();
                this.saveState();
            });
        }
    }

    openEditFishModal(fishId) {
        const target = this.fish.find(f => f.id === fishId);
        if (!target) return;

        this.editingFishId = fishId;
        this.editUploadImage = target.customImage;

        const nameInput = document.getElementById('editFishName');
        const speciesSelect = document.getElementById('editFishSpeciesSelect');
        const customZone = document.getElementById('editFishCustomZone');
        const urlInput = document.getElementById('editFishUrlInput');
        const previewImg = document.getElementById('editFishPreviewImg');

        nameInput.value = target.name;
        speciesSelect.value = target.speciesId;

        if (target.speciesId === 'custom') {
            customZone.classList.remove('hidden');
            urlInput.value = target.customImage && !target.customImage.startsWith('data:') ? target.customImage : '';
            previewImg.src = target.customImage || 'icons/icon48.png';
        } else {
            customZone.classList.add('hidden');
            urlInput.value = '';
            previewImg.src = 'icons/icon48.png';
        }

        document.getElementById('editFishModal').classList.remove('hidden');
    }

    // 初始化造景調整工坊 (Decor Workshop)
    initDecorWorkshopEvents() {
        const dec = this.state.decorations;

        // 1. 城堡
        const castleToggle = document.getElementById('castleToggle');
        const castleSlider = document.getElementById('castlePosSlider');
        const castleVal = document.getElementById('castlePosVal');
        if (castleToggle) {
            castleToggle.addEventListener('change', () => {
                dec.sunkenCastle = castleToggle.checked;
                this.saveState();
            });
        }
        if (castleSlider) {
            castleSlider.addEventListener('input', () => {
                dec.castleX = parseInt(castleSlider.value) / 100;
                if (castleVal) castleVal.textContent = `${castleSlider.value}%`;
                this.saveState();
            });
        }

        // 2. 珊瑚
        const coralToggle = document.getElementById('coralToggle');
        const coralSlider = document.getElementById('coralPosSlider');
        const coralVal = document.getElementById('coralPosVal');
        if (coralToggle) {
            coralToggle.addEventListener('change', () => {
                dec.coral = coralToggle.checked;
                this.saveState();
            });
        }
        if (coralSlider) {
            coralSlider.addEventListener('input', () => {
                dec.coralX = parseInt(coralSlider.value) / 100;
                if (coralVal) coralVal.textContent = `${coralSlider.value}%`;
                this.saveState();
            });
        }

        // 3. 氣泡石
        const airStoneToggle = document.getElementById('airStoneToggle');
        const airStoneSlider = document.getElementById('airStonePosSlider');
        const airStoneVal = document.getElementById('airStonePosVal');
        if (airStoneToggle) {
            airStoneToggle.addEventListener('change', () => {
                dec.airStone = airStoneToggle.checked;
                this.saveState();
            });
        }
        if (airStoneSlider) {
            airStoneSlider.addEventListener('input', () => {
                dec.airStoneX = parseInt(airStoneSlider.value) / 100;
                if (airStoneVal) airStoneVal.textContent = `${airStoneSlider.value}%`;
                this.saveState();
            });
        }

        // 4. 水草數量
        document.querySelectorAll('[data-seaweed-count]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-seaweed-count]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                dec.seaweedCount = parseInt(btn.getAttribute('data-seaweed-count'));
                this.particles.initPlants(dec.seaweedCount);
                this.saveState();
            });
        });

        // 5. 自訂造景圖片 URL / File 匯入
        const decorUrlInput = document.getElementById('customDecorUrlInput');
        const decorFileInput = document.getElementById('customDecorFileInput');
        const decorPreviewImg = document.getElementById('decorPreviewImg');
        const decorPlaceholder = document.getElementById('decorPreviewPlaceholder');
        const decorNameInput = document.getElementById('customDecorName');
        const decorPosSlider = document.getElementById('customDecorPosSlider');
        const decorPosVal = document.getElementById('customDecorPosVal');

        const SAMPLE_DECOR_PRESETS = {
            treasure: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 80'><rect x='15' y='30' width='70' height='40' rx='4' fill='%238c7b75'/><path d='M15,30 Q50,5 85,30 Z' fill='%235d4037'/><rect x='44' y='32' width='12' height='14' rx='2' fill='%23f1c40f'/><circle cx='50' cy='39' r='2.5' fill='%232c3e50'/><line x1='15' y1='30' x2='85' y2='30' stroke='%23f39c12' stroke-width='3'/></svg>",
            anchor: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 100'><circle cx='40' cy='18' r='10' stroke='%237f8c8d' stroke-width='6' fill='none'/><line x1='40' y1='28' x2='40' y2='85' stroke='%237f8c8d' stroke-width='8'/><line x1='20' y1='38' x2='60' y2='38' stroke='%237f8c8d' stroke-width='6'/><path d='M12,65 Q40,95 68,65' stroke='%237f8c8d' stroke-width='8' fill='none'/><polygon points='12,65 5,55 20,55' fill='%237f8c8d'/><polygon points='68,65 60,55 75,55' fill='%237f8c8d'/></svg>",
            diver: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 100'><circle cx='40' cy='30' r='16' fill='%23e67e22'/><circle cx='40' cy='30' r='10' fill='%2374b9ff'/><rect x='30' y='46' width='20' height='36' rx='6' fill='%23d35400'/><rect x='22' y='50' width='8' height='26' rx='3' fill='%2334495e'/><line x1='35' y1='82' x2='28' y2='98' stroke='%232c3e50' stroke-width='6'/><line x1='45' y1='82' x2='52' y2='98' stroke='%232c3e50' stroke-width='6'/></svg>"
        };

        const setDecorPreview = (src, defaultName = '') => {
            this.selectedDecorImage = src;
            if (src) {
                if (decorPreviewImg) {
                    decorPreviewImg.src = src;
                    decorPreviewImg.classList.remove('hidden');
                }
                if (decorPlaceholder) decorPlaceholder.classList.add('hidden');
                if (defaultName && decorNameInput && !decorNameInput.value.trim()) {
                    decorNameInput.value = defaultName;
                }
            } else {
                if (decorPreviewImg) decorPreviewImg.classList.add('hidden');
                if (decorPlaceholder) decorPlaceholder.classList.remove('hidden');
            }
        };

        if (decorUrlInput) {
            decorUrlInput.addEventListener('input', () => {
                const url = decorUrlInput.value.trim();
                setDecorPreview(url);
            });
        }

        document.querySelectorAll('.decor-sample-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const sampleKey = pill.getAttribute('data-sample');
                const sampleNames = { treasure: '黃金寶藏箱', anchor: '沉船鐵錨', diver: '迷你潛水員' };
                if (SAMPLE_DECOR_PRESETS[sampleKey]) {
                    if (decorUrlInput) decorUrlInput.value = SAMPLE_DECOR_PRESETS[sampleKey];
                    setDecorPreview(SAMPLE_DECOR_PRESETS[sampleKey], sampleNames[sampleKey] || '造景飾品');
                }
            });
        });

        if (decorFileInput) {
            decorFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        const dataUrl = evt.target.result;
                        const fileNameClean = file.name.replace(/\.[^/.]+$/, "");
                        setDecorPreview(dataUrl, fileNameClean);
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        if (decorPosSlider) {
            decorPosSlider.addEventListener('input', () => {
                if (decorPosVal) decorPosVal.textContent = `${decorPosSlider.value}%`;
            });
        }

        const addDecorBtn = document.getElementById('addCustomDecorBtn');
        if (addDecorBtn) {
            addDecorBtn.addEventListener('click', () => {
                if (!this.selectedDecorImage) {
                    alert('請先輸入造景圖片網址或選擇圖檔喔！');
                    return;
                }
                const name = (decorNameInput && decorNameInput.value.trim()) || '自訂飾品';
                const xRatio = decorPosSlider ? (parseInt(decorPosSlider.value) / 100) : 0.5;

                if (!Array.isArray(this.state.decorations.customDecorations)) {
                    this.state.decorations.customDecorations = [];
                }

                this.state.decorations.customDecorations.push({
                    id: 'decor_' + Date.now(),
                    name: name,
                    imageUrl: this.selectedDecorImage,
                    xRatio: xRatio,
                    scale: 1.0,
                    enabled: true
                });

                if (window.soundCtrl) window.soundCtrl.playFanfare();
                this.particles.addFloatingText(this.width / 2, 70, `🎉 已新增造景「${name}」！`, '#20bf6b', 15);

                if (decorUrlInput) decorUrlInput.value = '';
                if (decorNameInput) decorNameInput.value = '';
                setDecorPreview(null);
                this.renderCustomDecorList();
                this.saveState();
            });
        }

        // 6. 水體主題切換
        document.querySelectorAll('[data-theme]').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('[data-theme]').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                dec.theme = card.getAttribute('data-theme');
                if (window.soundCtrl) window.soundCtrl.playCleanSound();
                this.saveState();
            });
        });

        // 7. 底砂切換
        document.querySelectorAll('[data-sand]').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('[data-sand]').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                dec.sandType = card.getAttribute('data-sand');
                if (window.soundCtrl) window.soundCtrl.playCleanSound();
                this.saveState();
            });
        });

        // 8. 捕魚手設定
        const customHandZone = document.getElementById('customHandZone');
        const customHandUrlInput = document.getElementById('customHandUrlInput');

        document.querySelectorAll('[data-hand]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-hand]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const handType = btn.getAttribute('data-hand');
                if (this.state.eventSettings) {
                    this.state.eventSettings.handType = handType;
                }

                if (customHandZone) {
                    if (handType === 'custom') {
                        customHandZone.classList.remove('hidden');
                    } else {
                        customHandZone.classList.add('hidden');
                    }
                }
                this.saveState();
            });
        });

        if (customHandUrlInput) {
            customHandUrlInput.addEventListener('input', () => {
                if (this.state.eventSettings) {
                    this.state.eventSettings.customHandUrl = customHandUrlInput.value.trim();
                }
                this.saveState();
            });
        }

        // 立即召喚按鈕
        const summonBtn = document.getElementById('summonEventBtn');
        if (summonBtn) {
            summonBtn.addEventListener('click', () => {
                const dModal = document.getElementById('decorModal');
                if (dModal) dModal.classList.add('hidden');
                this.triggerInvasionEvent();
            });
        }
    }

    syncDecorModalUI() {
        const dec = this.state.decorations;

        // 城堡
        const castleToggle = document.getElementById('castleToggle');
        const castleSlider = document.getElementById('castlePosSlider');
        const castleVal = document.getElementById('castlePosVal');
        castleToggle.checked = !!dec.sunkenCastle;
        castleSlider.value = Math.round((dec.castleX || 0.55) * 100);
        castleVal.textContent = `${castleSlider.value}%`;

        // 珊瑚
        const coralToggle = document.getElementById('coralToggle');
        const coralSlider = document.getElementById('coralPosSlider');
        const coralVal = document.getElementById('coralPosVal');
        coralToggle.checked = !!dec.coral;
        coralSlider.value = Math.round((dec.coralX || 0.35) * 100);
        coralVal.textContent = `${coralSlider.value}%`;

        // 氣泡石
        const airStoneToggle = document.getElementById('airStoneToggle');
        const airStoneSlider = document.getElementById('airStonePosSlider');
        const airStoneVal = document.getElementById('airStonePosVal');
        airStoneToggle.checked = dec.airStone !== false;
        airStoneSlider.value = Math.round((dec.airStoneX || 0.9) * 100);
        airStoneVal.textContent = `${airStoneSlider.value}%`;

        // 水草數量
        const seaweedCount = dec.seaweedCount || 5;
        document.querySelectorAll('[data-seaweed-count]').forEach(b => {
            b.classList.toggle('active', parseInt(b.getAttribute('data-seaweed-count')) === seaweedCount);
        });

        // 主題
        const currentTheme = dec.theme || 'ocean';
        document.querySelectorAll('[data-theme]').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-theme') === currentTheme);
        });

        // 底砂
        const currentSand = dec.sandType || 'gold';
        document.querySelectorAll('[data-sand]').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-sand') === currentSand);
        });

        // 捕魚手設定
        const handType = (this.state.eventSettings && this.state.eventSettings.handType) || 'orangeCat';
        document.querySelectorAll('[data-hand]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-hand') === handType);
        });
        const customHandZone = document.getElementById('customHandZone');
        const customHandUrlInput = document.getElementById('customHandUrlInput');
        if (handType === 'custom') {
            customHandZone.classList.remove('hidden');
            customHandUrlInput.value = (this.state.eventSettings && this.state.eventSettings.customHandUrl) || '';
        } else {
            customHandZone.classList.add('hidden');
        }

        this.renderCustomDecorList();
    }

    renderCustomDecorList() {
        const container = document.getElementById('customDecorList');
        if (!container) return;
        container.innerHTML = '';

        const decors = this.state.decorations.customDecorations || [];
        if (decors.length === 0) {
            container.innerHTML = '<div style="font-size: 11px; color: #a4b0be; text-align: center; padding: 6px;">尚未添加自訂飾品</div>';
            return;
        }

        decors.forEach((cd, index) => {
            const item = document.createElement('div');
            item.className = 'custom-decor-item';
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${cd.imageUrl}" style="width: 24px; height: 24px; object-fit: contain; border-radius: 4px; background: rgba(0,0,0,0.3);">
                    <div>
                        <div style="font-size: 11px; font-weight: 700; color: #fff;">${cd.name}</div>
                        <div style="font-size: 10px; color: #a4b0be;">位置: ${Math.round(cd.xRatio * 100)}%</div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button class="custom-decor-del-btn" data-del-decor="${index}">刪除 🗑️</button>
                </div>
            `;
            const delBtn = item.querySelector('[data-del-decor]');
            delBtn.addEventListener('click', () => {
                decors.splice(index, 1);
                this.renderCustomDecorList();
                this.saveState();
            });
            container.appendChild(item);
        });
    }

    dropFood(x, y) {
        const tier = this.state.upgrades.foodTier || 1;
        this.particles.addFood(x, y, tier);
        this.state.stats.foodFedCount = (this.state.stats.foodFedCount || 0) + 1;

        if (window.soundCtrl) window.soundCtrl.playFeedDrop();

        this.state.waterCleanliness = Math.max(10, this.state.waterCleanliness - 0.4);
        this.updateHUD();
    }

    updateSoundBtn() {
        const btn = document.getElementById('soundToggleBtn');
        btn.textContent = this.state.soundEnabled ? '🔊' : '🔇';
    }

    updateHUD() {
        document.getElementById('coinCount').textContent = Math.floor(this.state.coins).toLocaleString();
        
        const cleanVal = Math.round(this.state.waterCleanliness);
        document.getElementById('waterCleanliness').textContent = `${cleanVal}%`;
        document.getElementById('waterBar').style.width = `${cleanVal}%`;
        
        if (cleanVal < 40) {
            document.getElementById('waterBar').style.background = '#e74c3c';
        } else {
            document.getElementById('waterBar').style.background = 'linear-gradient(90deg, #00cec9, #0984e3)';
        }

        this.calculateTotalMaxFish();
        document.getElementById('fishCapacity').textContent = `${this.fish.length}/${this.state.maxFishCount}`;
        document.getElementById('feedTierBadge').textContent = `Lv.${this.state.upgrades.foodTier}`;
    }

    renderShop() {
        // 1. Fish Shop Tab
        const fishListEl = document.getElementById('fishShopList');
        fishListEl.innerHTML = '';

        Object.keys(FISH_SPECIES).forEach(sId => {
            if (sId === 'custom') return;
            const sp = FISH_SPECIES[sId];
            const canAfford = this.state.coins >= sp.price;
            const hasSpace = this.fish.length < this.state.maxFishCount;

            const card = document.createElement('div');
            card.className = 'shop-card-item';
            card.innerHTML = `
                <div>
                    <div class="shop-card-title">${sp.name} (${sp.nickname})</div>
                    <div class="shop-card-desc">${sp.description}</div>
                    <div style="font-size: 11px; color: #74b9ff; margin-bottom: 6px;">
                        每週期產出: 🪙 ${sp.baseIncome}
                    </div>
                </div>
                <div class="shop-card-bottom">
                    <span class="shop-price">🪙 ${sp.price.toLocaleString()}</span>
                    <button class="buy-btn" ${(!canAfford || !hasSpace) ? 'disabled' : ''} data-buy-fish="${sId}">
                        ${!hasSpace ? '魚缸已滿' : '引進'}
                    </button>
                </div>
            `;

            const buyBtn = card.querySelector('.buy-btn');
            if (buyBtn && canAfford && hasSpace) {
                buyBtn.addEventListener('click', () => this.buyFish(sId));
            }

            fishListEl.appendChild(card);
        });

        // 2. Upgrades Tab (with the two new requested options prominently featured!)
        const upgListEl = document.getElementById('upgradeShopList');
        upgListEl.innerHTML = '';

        const UPGRADE_SPECS = [
            {
                key: 'tankSizeTier',
                name: '【魚缸尺寸擴展】 (視窗與游動空間加大)',
                tiers: [
                    { level: 2, price: 500, name: '豪華加寬景觀缸 (520×390，游動面積擴大30%，額外+4隻上限)' },
                    { level: 3, price: 1500, name: '巨幕海景全景館 (600×430，震撼全景視野，額外+8隻上限)' }
                ]
            },
            {
                key: 'tankCapacityTier',
                name: '【深層多層溶氧生態槽】 (突破養魚數量上限)',
                tiers: [
                    { level: 2, price: 300, name: '奈米微孔增氧泵 (基礎上限提升至 8 隻)' },
                    { level: 3, price: 850, name: '生化渦流活水循環 (基礎上限提升至 14 隻)' },
                    { level: 4, price: 2000, name: '深海巨量群游生態艙 (基礎上限提升至 22 隻)' },
                    { level: 5, price: 4200, name: '頂級海洋霸主群聚特許 (基礎上限突破至 30 隻！)' }
                ]
            },
            {
                key: 'foodTier',
                name: '高級飼料配方',
                tiers: [
                    { level: 2, price: 150, name: '凍乾豐年蝦 (飽食+35)' },
                    { level: 3, price: 450, name: '螺旋藻大餐 (飽食+55)' },
                    { level: 4, price: 1200, name: '皇家金饌 (飽食+85 & 發光)' }
                ]
            },
            {
                key: 'autoFeederTier',
                name: '自動定時餵食器',
                tiers: [
                    { level: 1, price: 300, name: '基本款 (離線減緩飢餓)' },
                    { level: 2, price: 800, name: '高頻微電腦 (離線大幅延緩飢餓)' },
                    { level: 3, price: 2000, name: '智慧管家 (離線近乎全飽狀態)' }
                ]
            },
            {
                key: 'filterTier',
                name: '循環過濾系統',
                tiers: [
                    { level: 2, price: 250, name: '活性碳生化棉 (髒污累積減半)' },
                    { level: 3, price: 750, name: '活體生態循環 (水質常保清澈)' }
                ]
            }
        ];

        UPGRADE_SPECS.forEach(upg => {
            const currentLvl = this.state.upgrades[upg.key] || 1;
            const nextTier = upg.tiers.find(t => t.level === currentLvl + 1);

            const row = document.createElement('div');
            row.className = 'upgrade-row';

            if (!nextTier) {
                row.innerHTML = `
                    <div class="upgrade-info">
                        <div class="upgrade-title">${upg.name}</div>
                        <div class="upgrade-desc" style="color: #00cec9;">✨ 已達最高等級</div>
                    </div>
                    <button class="buy-btn" disabled>MAX</button>
                `;
            } else {
                const canAfford = this.state.coins >= nextTier.price;
                row.innerHTML = `
                    <div class="upgrade-info">
                        <div class="upgrade-title">${upg.name} Lv.${nextTier.level}</div>
                        <div class="upgrade-desc">${nextTier.name}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="shop-price">🪙 ${nextTier.price.toLocaleString()}</span>
                        <button class="buy-btn" ${!canAfford ? 'disabled' : ''}>升級</button>
                    </div>
                `;
                const btn = row.querySelector('.buy-btn');
                if (btn && canAfford) {
                    btn.addEventListener('click', () => this.buyUpgrade(upg.key, nextTier));
                }
            }
            upgListEl.appendChild(row);
        });

        // 3. Decorations Tab
        const decorListEl = document.getElementById('decorShopList');
        decorListEl.innerHTML = '';

        const DECOR_SPECS = [
            { id: 'coral', name: '夢幻粉紅珊瑚', price: 200, desc: '增添海底繽紛色彩，小魚游過時心情更好。' },
            { id: 'sunkenCastle', name: '沉船古代城堡', price: 500, desc: '神秘的海底沉沒古堡，成為水族箱的地標。' },
            { id: 'airStone', name: '強力氣泡微孔石', price: 150, desc: '產生大量清涼細密氣泡，增加水中溶氧。' }
        ];

        DECOR_SPECS.forEach(d => {
            const unlocked = !!this.state.decorations[d.id];
            const canAfford = this.state.coins >= d.price;

            const card = document.createElement('div');
            card.className = 'shop-card-item';
            card.innerHTML = `
                <div>
                    <div class="shop-card-title">${d.name}</div>
                    <div class="shop-card-desc">${d.desc}</div>
                </div>
                <div class="shop-card-bottom">
                    <span class="shop-price">${unlocked ? '已擁有' : '🪙 ' + d.price}</span>
                    <button class="buy-btn" ${unlocked || !canAfford ? 'disabled' : ''}>
                        ${unlocked ? '已佈置' : '購買'}
                    </button>
                </div>
            `;
            const btn = card.querySelector('.buy-btn');
            if (btn && !unlocked && canAfford) {
                btn.addEventListener('click', () => this.buyDecoration(d.id, d.price));
            }
            decorListEl.appendChild(card);
        });
    }

    buyFish(speciesId) {
        const sp = FISH_SPECIES[speciesId];
        if (!sp || this.state.coins < sp.price || this.fish.length >= this.state.maxFishCount) return;

        this.state.coins -= sp.price;
        const newFishData = {
            id: 'fish_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            speciesId: speciesId,
            name: sp.name,
            hunger: 90,
            happiness: 100,
            growth: 20,
            bornTime: Date.now(),
            coinsGeneratedTotal: 0
        };

        const entity = new Fish(newFishData, { width: this.width, height: this.height });
        this.fish.push(entity);
        this.state.fishList.push(newFishData);

        if (window.soundCtrl) window.soundCtrl.playFanfare();
        this.particles.addFloatingText(this.width / 2, 70, `🎉 引進了新成員：${sp.name}！`, '#ffd700', 14);

        this.updateHUD();
        this.renderShop();
        this.saveState();
    }

    buyUpgrade(key, tierInfo) {
        if (this.state.coins < tierInfo.price) return;
        this.state.coins -= tierInfo.price;
        this.state.upgrades[key] = tierInfo.level;

        if (key === 'tankSizeTier') {
            this.applyTankSize(tierInfo.level, true);
        } else if (key === 'tankCapacityTier') {
            this.calculateTotalMaxFish();
            if (window.soundCtrl) window.soundCtrl.playFanfare();
            this.particles.addFloatingText(this.width / 2, 70, `⚡ 養魚上限成功提升至 ${this.state.maxFishCount} 隻！`, '#ffd700', 15);
        } else {
            if (window.soundCtrl) window.soundCtrl.playFanfare();
            this.particles.addFloatingText(this.width / 2, 70, `⚡ 成功升級設施！`, '#00cec9', 15);
        }

        this.updateHUD();
        this.renderShop();
        this.saveState();
    }

    buyDecoration(id, price) {
        if (this.state.coins < price || this.state.decorations[id]) return;
        this.state.coins -= price;
        this.state.decorations[id] = true;

        if (window.soundCtrl) window.soundCtrl.playFanfare();
        this.particles.addFloatingText(this.width / 2, 70, `🌿 水族造景已佈置！`, '#20bf6b', 15);

        this.updateHUD();
        this.renderShop();
        this.saveState();
    }

    renderRoster() {
        const container = document.getElementById('rosterList');
        const countText = document.getElementById('rosterCountText');
        if (countText) {
            countText.textContent = `目前魚隻：${this.fish.length} / ${this.state.maxFishCount} 隻`;
        }
        container.innerHTML = '';

        if (this.fish.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #a4b0be; padding: 20px;">魚缸裡目前沒有小魚，快點擊上方「➕ 引進新小魚」吧！</div>';
            return;
        }

        const SPECIES_EMOJIS = {
            clownfish: '🐠',
            bluetang: '🐟',
            goldfish: '🐡',
            koi: '🎏',
            angelfish: '🐬',
            jellyfish: '🪼',
            custom: '✨'
        };

        this.fish.forEach((f, idx) => {
            const card = document.createElement('div');
            card.className = 'roster-card';

            const avatarHtml = f.customImage
                ? `<img src="${f.customImage}" alt="${f.name}">`
                : `<span class="roster-avatar-fallback">${SPECIES_EMOJIS[f.speciesId] || '🐟'}</span>`;

            card.innerHTML = `
                <div class="roster-avatar">
                    ${avatarHtml}
                </div>
                <div class="roster-info">
                    <div class="roster-name-row">
                        <span class="roster-name">${f.name}</span>
                        <span class="roster-species-tag">${f.species.name}</span>
                    </div>
                    <div class="roster-bars">
                        <span>飽食: ${Math.round(f.hunger)}%</span>
                        <span>快樂: ${Math.round(f.happiness)}%</span>
                        <span>成長: ${Math.round(f.growth)}%</span>
                    </div>
                    <div style="font-size: 10px; color: #ffd700; margin-top: 3px;">
                        累積產出: 🪙 ${f.coinsGeneratedTotal.toLocaleString()}
                    </div>
                </div>
                <div class="roster-actions">
                    <button class="roster-action-btn edit-btn" data-edit-id="${f.id}">✏️ 編輯</button>
                    <button class="roster-action-btn pet-btn buy-btn" data-pet-id="${f.id}">摸摸 ❤️</button>
                    <button class="roster-action-btn release-btn" data-release-id="${f.id}">🌊 放生</button>
                </div>
            `;

            // ✏️ 編輯按鈕
            card.querySelector('[data-edit-id]').addEventListener('click', () => {
                this.openEditFishModal(f.id);
            });

            // 摸摸按鈕
            card.querySelector('[data-pet-id]').addEventListener('click', () => {
                f.pet();
                this.state.coins += 2;
                this.particles.addCoinParticle(f.x, f.y - 20, 2);
                this.particles.addHeart(f.x, f.y);
                this.updateHUD();
                this.renderRoster();
            });

            // 🌊 放生按鈕 (刪除魚隻)
            card.querySelector('[data-release-id]').addEventListener('click', () => {
                const refund = Math.max(30, Math.floor((f.species.price || 100) * 0.5));
                const confirmMsg = `確定要放生「${f.name}」回歸大海嗎？\n\n• 放生可獲得回饋金幣：🪙 +${refund}\n• 釋放 1 個魚缸空間容量`;
                
                if (confirm(confirmMsg)) {
                    // 從陣列中移除
                    this.fish.splice(idx, 1);
                    this.state.coins += refund;
                    if (window.soundCtrl) window.soundCtrl.playCleanSound();
                    this.particles.addFloatingText(this.width / 2, 70, `🌊「${f.name}」已回歸大海，獲得 +🪙${refund}！`, '#74b9ff', 15);
                    this.updateHUD();
                    this.renderRoster();
                    this.saveState();
                }
            });

            container.appendChild(card);
        });
    }

    saveState() {
        if (!this.state || this.isVisiting) return;
        this.state.fishList = this.fish.map(f => ({
            id: f.id,
            speciesId: f.speciesId,
            name: f.name,
            customImage: f.customImage,
            hunger: f.hunger,
            happiness: f.happiness,
            growth: f.growth,
            bornTime: f.bornTime,
            coinsGeneratedTotal: f.coinsGeneratedTotal
        }));

        // On web, if initial cloud sync has not completed yet, save locally only to avoid overwriting cloud with un-synced local state
        const isExtension = (typeof window !== 'undefined' && window.location && window.location.protocol === 'chrome-extension:');
        if (!isExtension && !this._initialCloudSyncDone && window.FirebaseSync && window.FirebaseSync.getCurrentUser()) {
            Storage.saveLocalOnly(this.state);
        } else {
            Storage.save(this.state);
        }
    }

    loop(timestamp) {
        const dt = Math.min(timestamp - this.lastTime, 100);
        this.lastTime = timestamp;

        // 1. Water cleanliness gradual decay
        this.waterDecayTimer += dt;
        if (this.waterDecayTimer >= 20000) {
            this.waterDecayTimer = 0;
            const filterTier = this.state.upgrades.filterTier || 1;
            this.state.waterCleanliness = Math.max(10, this.state.waterCleanliness - (0.5 / filterTier));
            this.updateHUD();
        }

        // 2. Autosave periodically (every 5 seconds)
        this.autoSaveTimer += dt;
        if (this.autoSaveTimer >= 5000) {
            this.autoSaveTimer = 0;
            this.saveState();
        }

        // 3. 突發捕魚手事件計時 (正常遊玩下每 10 秒檢查一次，30% 機率觸發)
        if (!this.particles.invasion.active) {
            this.eventIntervalTimer += dt;
            if (this.eventIntervalTimer >= this.eventCheckInterval) {
                this.eventIntervalTimer = 0;
                if (Math.random() < this.eventTriggerChance) {
                    this.triggerInvasionEvent();
                }
            }
        } else {
            // 當突發事件正在進行時保持歸零，結束後重新累積 10 秒
            this.eventIntervalTimer = 0;
        }

        // 4. 突發捕魚手事件結算 (10秒時間到)
        if (this.particles.invasion.resultPending) {
            const res = this.particles.invasion.resultPending;
            this.particles.invasion.resultPending = null;

            if (res === 'success') {
                const reward = 60;
                this.state.coins += reward;
                if (this.state.eventSettings) {
                    this.state.eventSettings.defendedCount = (this.state.eventSettings.defendedCount || 0) + 1;
                }
                if (window.soundCtrl) window.soundCtrl.playFanfare();
                this.particles.addFloatingText(this.width / 2, 70, `🎉 成功擊退捕魚手！小魚平安！+🪙${reward}`, '#ffd700', 16);
                this.updateHUD();
                this.saveState();
            } else {
                // 未能完全抵擋
                this.state.waterCleanliness = Math.max(10, this.state.waterCleanliness - 8);
                this.fish.forEach(f => {
                    f.hunger = Math.max(10, f.hunger - 5);
                });
                this.particles.addFloatingText(this.width / 2, 70, '💦 水花被攪亂了！小魚受到驚嚇！', '#ff7675', 15);
                this.updateHUD();
            }
        }

        // 5. Update Particles & Decorations
        this.particles.update(dt, this.state.decorations);

        // 6. 突發事件危險源（小魚會感知貓手位置並機警避開）
        const dangerHand = this.particles.invasion.active ? {
            active: true,
            x: this.particles.invasion.x,
            y: this.particles.invasion.y - this.particles.invasion.recoilY
        } : null;

        // 7. Update Fish with lively physics, mouse interaction, and danger fleeing
        this.fish.forEach(f => {
            f.update(dt, this.particles.foods, this.particles, (earned, fx, fy) => {
                this.state.coins += earned;
                this.particles.addCoinParticle(fx, fy - 20, earned);
                if (window.soundCtrl) window.soundCtrl.playCoinSound();
                this.updateHUD();
            }, this.mousePos, dangerHand);
        });

        // 8. Render Scene
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.particles.drawBackground(this.ctx, this.state.waterCleanliness, this.state.decorations);
        this.fish.forEach(f => f.draw(this.ctx));
        this.particles.drawForeground(this.ctx);

        requestAnimationFrame((t) => this.loop(t));
    }
}

// Start game when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.game = new Game();
});
