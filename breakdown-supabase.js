(function (root) {
    'use strict';
    function error(code) { return Object.assign(new Error(code), {code}); }
    function validate(config) {
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.url || '')) throw error('SUPABASE_CONFIG_INVALID');
        const key = config.publishableKey || '';
        if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ')) throw error('SUPABASE_CONFIG_INVALID');
        if (key.startsWith('eyJ')) {
            let claims; try { claims = JSON.parse(root.atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch (_) { throw error('SUPABASE_CONFIG_INVALID'); }
            if (claims.role !== 'anon') throw error('SUPABASE_SECRET_IN_FRONTEND');
        }
        if (config.environment === 'staging') {
            if (config.url !== 'https://qsvsrudyarmxohrhqwqf.supabase.co' ||
                !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(config.gasUrl || '') ||
                config.gasUrl !== config.approvedGasUrl || /SET_|PLACEHOLDER|REPLACE_/i.test(config.gasUrl)) throw error('STAGING_CONFIG_REQUIRED');
            const origin = new URL(config.frontendOrigin || 'https://invalid.invalid');
            const callback = new URL(config.redirectUrl || 'https://invalid.invalid');
            if (origin.protocol !== 'https:' || origin.origin !== config.frontendOrigin ||
                callback.origin !== origin.origin || !callback.pathname.endsWith('/MachineBreakdownLog.html') ||
                callback.search || callback.hash) throw error('STAGING_CONFIG_REQUIRED');
        } else if (config.environment && config.environment !== 'production') throw error('SUPABASE_CONFIG_INVALID');
        return config;
    }
    function createTransport(config, getAuth, fetchImpl = root.fetch.bind(root)) {
        validate(config);
        let csrf = '';
        async function request(action, body, params = {}) {
            const auth = await getAuth();
            const {data,error:sessionError} = await auth.auth.getSession();
            if (sessionError || !data?.session?.access_token) throw error('AUTH_REQUIRED');
            const url = new URL(config.url + '/functions/v1/breakdown-api');
            url.searchParams.set('action',action); Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,value));
            let response;
            try {
                response = await fetchImpl(url.toString(),{
                    method:body ? 'POST' : 'GET',credentials:'omit',cache:'no-store',
                    headers:{apikey:config.publishableKey,Authorization:'Bearer ' + data.session.access_token,...(body ? {'Content-Type':'application/json','X-CSRF-Token':csrf} : {})},
                    signal:AbortSignal.timeout(15000),...(body ? {body:JSON.stringify(body)} : {})
                });
            } catch (_) { throw error('BACKEND_UNAVAILABLE'); }
            const result = await response.json().catch(() => null);
            if (!response.ok) {
                if (['submit','status'].includes(action) && result?.state === 'rejected') return result;
                throw error(result?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN' : 'BACKEND_UNAVAILABLE'));
            }
            if (!result) throw error('BACKEND_UNAVAILABLE');
            return result;
        }
        return {
            async health() { const result = await request('health'); csrf = result.session?.csrfToken || ''; return result; },
            submit: operation => request('submit',operation),
            status: requestId => request('status',{requestId}),
            readRecords: () => request('read_breakdown'),
            readEvent: eventId => request('read_breakdown_event',null,{eventId}),
            readLayout: () => request('read_machine_layout'),
            logout: () => request('logout',{})
        };
    }
    async function bootstrap(config) {
        validate(config);
        if (root.location.protocol !== 'https:') throw error('HTTPS_REQUIRED');
        if (config.environment === 'staging' && root.location.origin !== config.frontendOrigin) throw error('ORIGIN_DENIED');
        const current = new URL(root.location.href), code = current.searchParams.get('code');
        const callbackError = current.searchParams.get('error');
        if (code || callbackError) {
            ['code','error','error_description','error_code'].forEach(key => current.searchParams.delete(key));
            root.history.replaceState({},'',current.toString());
        }
        // Tab-scoped storage preserves PKCE/session across these three HTML pages.
        // Identity and roles are always verified by Auth/Postgres on the server.
        const {createClient} = await import('./vendor/supabase-js-2.117.2.min.js');
        const auth = createClient(config.url,config.publishableKey,{
            auth:{flowType:'pkce',persistSession:true,storage:root.sessionStorage,autoRefreshToken:true,detectSessionInUrl:false}
        });
        let callbackFailed = false;
        if (code || callbackError) {
            if (callbackError) callbackFailed = true;
            else {
                const {error:exchangeError} = await auth.auth.exchangeCodeForSession(code);
                callbackFailed = !!exchangeError;
            }
        }
        const {data} = await auth.auth.getSession();
        const panel = root.document.createElement('div'); panel.className = 'card'; panel.setAttribute('aria-label','เข้าสู่ระบบ Machine Breakdown');
        const label = root.document.createElement('span'); label.textContent = data.session ? 'เข้าสู่ระบบแล้ว · ' + (data.session.user.email || 'ผู้ใช้งาน') : 'เข้าสู่ระบบเพื่อบันทึกหรืออัปเดตเหตุการณ์';
        if (callbackFailed && !data.session) label.textContent = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองเข้าสู่ระบบด้วย Google อีกครั้ง';
        const button = root.document.createElement('button'); button.type = 'button'; button.textContent = data.session ? 'ออกจากระบบ' : 'เข้าสู่ระบบด้วย Google';
        button.style.marginInlineStart = '12px';
        button.addEventListener('click',async () => {
            button.disabled = true;
            try {
                if (data.session) {
                    // Revoke the durable app session before clearing local tokens.
                    let durableLogoutFailed = false;
                    try { await root.BREAKDOWN_TRANSPORT.logout(); } catch (_) { durableLogoutFailed = true; }
                    const {error:logoutError} = await auth.auth.signOut({scope:'local'});
                    if (logoutError) throw error('BACKEND_UNAVAILABLE');
                    if (durableLogoutFailed) {
                        label.textContent = 'ล้างการเข้าสู่ระบบในแท็บแล้ว แต่ยังยืนยันการเพิกถอนบน server ไม่ได้ กรุณาให้ผู้ดูแลตรวจ session';
                        button.hidden = true;
                        root.BREAKDOWN_TRANSPORT = {health:async () => {throw error('AUTH_REQUIRED');}};
                        return;
                    }
                    root.location.reload();
                } else {
                    const redirectTo = config.redirectUrl || new URL('MachineBreakdownLog.html',root.location.href).toString();
                    const {data:login,error:loginError} = await auth.auth.signInWithOAuth({provider:'google',options:{redirectTo,skipBrowserRedirect:true}});
                    if (loginError) throw error('AUTH_REQUIRED');
                    // Google login must open at the top level, including when
                    // this page was embedded by the existing Dashboard shell.
                    root.top.location.href = login.url;
                }
            } catch (_) { label.textContent = 'ดำเนินการเข้าสู่ระบบ/ออกจากระบบไม่ได้ กรุณาลองใหม่'; button.disabled = false; }
        });
        panel.append(label,button); root.document.getElementById('transportState')?.before(panel);
        return auth;
    }
    root.BreakdownSupabase = {createTransport,validate};
    if (root.BREAKDOWN_SUPABASE?.enabled === true) {
        // Install the transport immediately so the existing UI waits for auth.
        const ready = bootstrap(root.BREAKDOWN_SUPABASE);
        ready.catch(() => {});
        try { root.BREAKDOWN_TRANSPORT = createTransport(root.BREAKDOWN_SUPABASE,() => ready); }
        catch (_) { root.BREAKDOWN_TRANSPORT = {health:async () => {throw error('BACKEND_UNAVAILABLE');}}; }
    }
})(typeof window !== 'undefined' ? window : globalThis);
