// The one place the repository URL is written. The open-source claim appears in the landing
// block, in the footer of every page, and on the ceremony page; a URL copied into each of them is
// three chances for the claim and the link that backs it to drift apart.
//
// It lives in lib/ rather than beside the landing block because the footer renders on every route
// and must not drag a landing stylesheet into every bundle to read one string.
export const REPO = 'https://github.com/monygroupcorp/noema';

/** The ceremony contributor guide, in the repository. Two places on /ceremony link it. */
export const CEREMONY_GUIDE = `${REPO}/blob/main/docs/arcanum-ceremony.md`;
