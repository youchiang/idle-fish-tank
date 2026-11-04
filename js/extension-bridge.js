/**
 * Extension Content Script Bridge for Idle Fish Tank (摸魚水族館)
 * Bridges Google Auth credentials and full state between GitHub Pages web app
 * and Chrome Extension local storage.
 */

(function () {
    console.log('[FishTank Bridge] Content script initialized on https://youchiang.github.io/idle-fish-tank/');

    // 1. Listen for postMessage from web page (Auth synchronization)
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
        }
    });

    // 2. If launched with cloud_sync flag, deliver full uncropped extension state to web page
    const checkAndDeliverExtensionState = () => {
        try {
            const hash = window.location.hash || '';
            const search = window.location.search || '';
            const isCloudSync = hash.includes('cloud_sync=1') || search.includes('cloud_sync=1');

            if (isCloudSync && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['idleFishTankState'], (res) => {
                    if (res && res.idleFishTankState) {
                        console.log('[FishTank Bridge] Delivering full extension state to web app via postMessage');
                        window.postMessage({
                            type: 'AF_FULL_EXTENSION_STATE',
                            state: res.idleFishTankState
                        }, '*');
                    }
                });
            }
        } catch (e) {
            console.warn('[FishTank Bridge] Notice in checkAndDeliverExtensionState:', e);
        }
    };

    // Run immediately and also upon DOMContentLoaded
    checkAndDeliverExtensionState();
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', checkAndDeliverExtensionState, { once: true });
    }
})();
