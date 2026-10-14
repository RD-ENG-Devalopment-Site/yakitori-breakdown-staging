import { createClient } from './vendor/supabase-js-2.117.2.min.js';

const projectUrl = 'https://qsvsrudyarmxohrhqwqf.supabase.co';
const publicKey = 'sb_publishable_h58FnkQqWPIQLPK00DLlsA_N0uCDyRa';
const stagingOrigin = 'https://yakitori-breakdown-staging.pages.dev';
const status = document.getElementById('auth-status');
const action = document.getElementById('auth-action');
const result = document.getElementById('auth-result');

function showError(message) {
  status.textContent = message;
  action.hidden = false;
  action.disabled = false;
}

if (location.origin !== stagingOrigin || !window.sessionStorage) {
  status.textContent = 'หน้านี้ใช้งานได้เฉพาะเว็บ staging ที่กำหนด';
} else {
  const callback = new URL(location.href);
  const code = callback.searchParams.get('code');
  const callbackError = callback.searchParams.has('error');
  if (code || callbackError) {
    for (const key of ['code', 'error', 'error_description', 'error_code']) {
      callback.searchParams.delete(key);
    }
    history.replaceState({}, '', callback.toString());
  }

  const client = createClient(projectUrl, publicKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      storage: window.sessionStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  action.addEventListener('click', async () => {
    action.disabled = true;
    if (action.dataset.mode === 'logout') {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) showError('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่');
      else location.reload();
      return;
    }
    status.textContent = 'กำลังเปิด Google Sign-In…';
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google', options: { skipBrowserRedirect: true }
    });
    if (error || !data?.url) showError('เริ่มเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    else window.top.location.assign(data.url);
  });

  try {
    if (callbackError) throw new Error('callback');
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw new Error('exchange');
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error('session');
    if (!sessionData.session) {
      status.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
      action.hidden = false;
    } else {
      // getUser verifies the bearer token with Supabase Auth; do not trust cached metadata alone.
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user || userData.user.id !== sessionData.session.user.id) {
        throw new Error('identity');
      }
      const user = userData.user;
      document.getElementById('auth-email').textContent = user.email || 'ไม่พบอีเมล';
      document.getElementById('auth-uuid').textContent = user.id;
      document.getElementById('auth-provider').textContent = user.app_metadata?.provider || 'ไม่พบ provider';
      document.getElementById('auth-expiry').textContent =
        new Date(sessionData.session.expires_at * 1000).toLocaleString('th-TH');
      result.hidden = false;
      status.textContent = 'เข้าสู่ระบบสำเร็จ และตรวจตัวตนกับ Supabase Auth แล้ว';
      action.textContent = 'ออกจากระบบในแท็บนี้';
      action.dataset.mode = 'logout';
      action.hidden = false;
    }
  } catch (_) {
    showError('ตรวจ session ไม่สำเร็จ กรุณาลองเข้าสู่ระบบด้วย Google อีกครั้ง');
  }
}
