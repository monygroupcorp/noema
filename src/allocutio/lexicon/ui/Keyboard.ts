// =============================================================================
// UI keyboard — a platform-neutral inline keyboard spec.
// =============================================================================
// Both the session bulletin and the delivery menu describe their controls as
// rows of { label, callback-data } buttons. The platform adapter (Telegram, …)
// maps this into its own inline-keyboard shape. Keeping it neutral is what lets
// these HUDs be reused by other apps/surfaces, not just Telegram.

export interface UiButton { label: string; data: string }
export type UiKeyboard = UiButton[][]
