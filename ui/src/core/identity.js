/**
 * Identity Management
 * Reads user identity injected by the server
 */

export function getIdentity() {
  return window.NOTE_RELAY_IDENTITY || {
    email: null,
    vaultId: null,
    licenseType: 'free',
    token: null
  };
}

export function isProLicense() {
  return getIdentity().licenseType === 'pro';
}

export function canAddGuests() {
  return isProLicense();
}
