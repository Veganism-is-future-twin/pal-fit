// Google Identity Services (the "Sign in with Google" button).

let gisPromise = null;

/** Load Google's sign-in script once. */
export function loadGoogleScript() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * Render the official Google button into `el`.
 * onCredential(idToken) is called after the user picks their account.
 */
export async function renderGoogleButton(el, clientId, onCredential) {
  const google = await loadGoogleScript();
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (resp) => onCredential(resp.credential),
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true,
    itp_support: true,
    use_fedcm_for_prompt: true,
  });
  const width = Math.min(360, Math.max(220, el.clientWidth || 320));
  google.accounts.id.renderButton(el, {
    type: 'standard', theme: 'filled_blue', size: 'large', shape: 'pill',
    text: 'continue_with', logo_alignment: 'left', width,
  });
}

/** Stop Google from auto-signing the user back in after logout. */
export function googleSignOut() {
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* not loaded */ }
}
