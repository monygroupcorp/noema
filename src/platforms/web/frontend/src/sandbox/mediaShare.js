/**
 * mediaShare.js — helpers to copy links and share output media to
 * Telegram / X. Used by the image lightbox and the NODE_MODE video output.
 *
 * We intentionally do NOT try to force a download via fetch/blob — native
 * tap-and-hold is the primary save path on mobile, enabled via CSS in
 * focus-demo.css. These helpers exist for the one gap the OS leaves us:
 * iOS Safari does not provide a save menu for HTML5 <video> elements, so
 * we surface "Copy link" so users can paste the URL elsewhere, plus direct
 * share intents to Telegram and X.
 */

const DEFAULT_SHARE_TEXT = 'Generated with noema.art';

/**
 * @param {string} url — permanent media URL (e.g. R2 public URL)
 * @returns {Promise<boolean>} true if successfully copied
 */
export async function copyMediaLink(url) {
    if (!url) return false;
    try {
        await navigator.clipboard.writeText(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Open the Telegram share intent in a new tab. Telegram will show its
 * share dialog (picks a chat, pre-fills the URL and caption).
 */
export function shareToTelegram(url, text = DEFAULT_SHARE_TEXT) {
    if (!url) return;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Open the X compose intent in a new tab. X will pre-fill the tweet with
 * the URL and caption; X fetches the URL and renders a media card.
 */
export function shareToX(url, text = DEFAULT_SHARE_TEXT) {
    if (!url) return;
    const shareUrl = `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
}
