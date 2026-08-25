/**
 * Where the sync service lives.
 *
 * Baked in so that linking a new device is a passphrase and nothing else —
 * no address to find, copy, or type correctly on a phone keyboard. The field
 * in the app stays editable for the case where the worker is redeployed under
 * a different name.
 */
export const DEFAULT_ENDPOINT = 'https://lemma-sync.boroda496.workers.dev';
