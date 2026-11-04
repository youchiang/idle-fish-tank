/**
 * Popup script for Idle Fish Tank (摸魚水族館) Chrome Extension
 * Reads existing local storage data and bridges it to the hosted GitHub Pages web app via postMessage.
 */

document.addEventListener('DOMContentLoaded', () => {
    const iframe = document.getElementById('gameFrame');
    if (!iframe) return;

    let localState = null;
    let storageReady = false;
    let iframeReady = false;
    let migrationAck = false;

    // 1. Read existing game save from chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['idleFishTankState'], (res) => {
            if (chrome.runtime.lastError) {
                console.warn('[Popup] Error reading chrome.storage:', chrome.runtime.lastError);
            }
            localState = res ? res.idleFishTankState : null;
            storageReady = true;
            trySendMigrationData();
        });
    } else {
        storageReady = true;
        trySendMigrationData();
    }

    // 2. Wait for iframe to finish loading
    iframe.addEventListener('load', () => {
        iframeReady = true;
        trySendMigrationData();
    });

    // 3. Listen for migration success acknowledgment from GitHub Pages
    window.addEventListener('message', (event) => {
        if (event.origin !== 'https://youchiang.github.io') return;
        if (event.data && event.data.type === 'MIGRATION_SUCCESS') {
            console.log('[Popup] Migration confirmed by GitHub Pages web app!');
            migrationAck = true;
        }
    });

    function trySendMigrationData() {
        if (!storageReady || !iframeReady) return;

        sendPostMessage();

        // Retry delivery in case scripts inside iframe were still initializing
        setTimeout(() => {
            if (!migrationAck) sendPostMessage();
        }, 500);

        setTimeout(() => {
            if (!migrationAck) sendPostMessage();
        }, 1500);
    }

    function sendPostMessage() {
        if (!iframe || !iframe.contentWindow) return;
        try {
            iframe.contentWindow.postMessage(
                {
                    type: 'IMPORT_EXTENSION_DATA',
                    data: localState
                },
                'https://youchiang.github.io'
            );
            console.log('[Popup] Dispatched IMPORT_EXTENSION_DATA to GitHub Pages iframe');
        } catch (err) {
            console.warn('[Popup] postMessage dispatch failed:', err);
        }
    }
});
