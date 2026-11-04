/**
 * Extension Content Script Bridge for Idle Fish Tank (摸魚水族館)
 * Bridges Google Auth credentials and full state between GitHub Pages web app
 * and Chrome Extension local storage.
 */

(function () {
    console.log('[FishTank Bridge] Content script initialized on https://youchiang.github.io/idle-fish-tank/');

    // Helper to deliver full extension state to web page
    const checkAndDeliverExtensionState = () => {
        try {
            const hash = window.location.hash || '';
            const search = window.location.search || '';
            const isCloudSync = hash.includes('cloud_sync=1') || search.includes('cloud_sync=1') || !!window._wasCloudSyncUrl;

            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['idleFishTankState', 'cloudUser'], (res) => {
                    if (res && res.idleFishTankState) {
                        console.log('[FishTank Bridge] Delivering full extension state to web app via postMessage (isCloudSync=' + isCloudSync + ')');
                        window.postMessage({
                            type: 'AF_FULL_EXTENSION_STATE',
                            state: res.idleFishTankState,
                            isCloudSyncUrl: isCloudSync
                        }, '*');
                    }
                });
            }
        } catch (e) {
            console.warn('[FishTank Bridge] Notice in checkAndDeliverExtensionState:', e);
        }
    };

    // 1. Listen for postMessage from web page (Auth synchronization & state requests)
    window.addEventListener('message', (event) => {
        // Ensure message came from same window
        if (event.source !== window || !event.data) return;

        if (event.data.type === 'AF_AUTH_SYNC_TO_EXT' && event.data.user) {
            console.log('[FishTank Bridge] Received user auth info from web, syncing to extension:', event.data.user.displayName || event.data.user.email);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ cloudUser: event.data.user }, () => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        console.error('[FishTank Bridge] Failed to save cloudUser:', chrome.runtime.lastError);
                    } else {
                        console.log('[FishTank Bridge] cloudUser saved to chrome.storage.local');
                    }
                });
            }
        } else if (event.data.type === 'AF_AUTH_LOGOUT_TO_EXT') {
            console.log('[FishTank Bridge] Received logout signal from web, clearing extension cloudUser');
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.remove(['cloudUser'], () => {
                    console.log('[FishTank Bridge] cloudUser removed from chrome.storage.local');
                });
            }
        } else if (event.data.type === 'AF_REQUEST_EXTENSION_STATE') {
            console.log('[FishTank Bridge] Received AF_REQUEST_EXTENSION_STATE, delivering extension state...');
            checkAndDeliverExtensionState();
        } else if (event.data.type === 'AF_SYNC_STATE_TO_EXT' && event.data.state) {
            console.log('[FishTank Bridge] Received AF_SYNC_STATE_TO_EXT, merging missing images and saving...');
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['idleFishTankState'], (res) => {
                    const existing = res ? res.idleFishTankState : null;
                    let target = event.data.state;
                    if (existing && existing.fishList && target && target.fishList) {
                        for (const tf of target.fishList) {
                            if (!tf.customImage) {
                                const df = existing.fishList.find(f => f.id === tf.id) ||
                                           existing.fishList.find(f => f.speciesId === 'custom' && f.name === tf.name && f.customImage);
                                if (df && df.customImage) {
                                    tf.customImage = df.customImage;
                                }
                            }
                        }
                    }
                    if (existing && existing.decorations && existing.decorations.customDecorations && target && target.decorations && target.decorations.customDecorations) {
                        for (const td of target.decorations.customDecorations) {
                            if (!td.imageUrl) {
                                const dd = existing.decorations.customDecorations.find(d => d.id === td.id);
                                if (dd && dd.imageUrl) {
                                    td.imageUrl = dd.imageUrl;
                                }
                            }
                        }
                    }
                    chrome.storage.local.set({ idleFishTankState: target }, () => {
                        console.log('[FishTank Bridge] Successfully synced updated state into extension chrome.storage.local');
                    });
                });
            }
        }
    });

    // 2. Deliver full extension state to web page (immediately, on DOM ready, and after 500ms)
    checkAndDeliverExtensionState();
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', checkAndDeliverExtensionState, { once: true });
    }
    setTimeout(checkAndDeliverExtensionState, 500);
})();
