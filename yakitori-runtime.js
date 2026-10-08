(function (global) {
    const BUILD_VERSION = "20261002-layout-readonly-01";
    const CONFIG = {
        appsScriptUrl: "https://script.google.com/macros/s/AKfycbzCP20irjQdA65MEQXeB4KW8kkvmYRMJYbL8Zm1IdklPpKvvmTIIFcx0Zs_pm3Nwyel/exec",
        buildVersion: BUILD_VERSION
    };

    function isSameOriginUrl(url) {
        try {
            return new URL(url, global.location.href).origin === global.location.origin;
        } catch (_) {
            return false;
        }
    }

    function appendVersion(url) {
        if (!url || !isSameOriginUrl(url)) return url;

        const target = new URL(url, global.location.href);
        target.searchParams.set("v", BUILD_VERSION);
        return target.toString();
    }

    function stampElementUrls(root = global.document) {
        if (!root || !root.querySelectorAll) return;

        root.querySelectorAll('a[href], script[src], link[href], iframe[src], source[src]').forEach((node) => {
            const attr = node.tagName === 'A' || node.tagName === 'LINK' ? 'href' : 'src';
            const current = node.getAttribute(attr);
            if (!current) return;
            const stamped = appendVersion(current);
            if (stamped && stamped !== current) node.setAttribute(attr, stamped);
        });
    }

    function stampCurrentUrl() {
        try {
            const current = new URL(global.location.href);
            if (current.searchParams.get("v") !== BUILD_VERSION) {
                current.searchParams.set("v", BUILD_VERSION);
                global.history.replaceState({}, "", current.toString());
            }
        } catch (_) {
            // Best-effort only.
        }
    }

    function applyCacheBust() {
        stampCurrentUrl();
        stampElementUrls(global.document);
        normalizeExecutiveSummaryDom();
    }

    function normalizeExecutiveSummaryDom() {
        if (!String(global.location.pathname || '').includes('Gizzard')) return;

        const prodLabel = global.document.getElementById('lbl-summary-prod');
        if (!prodLabel) return;

        const title = Array.from(global.document.querySelectorAll('h2')).find(el =>
            String(el.textContent || '').includes('Efficiency Growth & Impact Analysis')
        );
        const section = title?.closest('.mt-8.pt-8.border-t-2');
        if (!section) return;

        const sectionTitle = section.querySelector('h2');
        if (sectionTitle) {
            const textNode = Array.from(sectionTitle.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
            if (textNode) textNode.textContent = '\n                Efficiency Growth & Impact Analysis\n            ';
            const badge = sectionTitle.querySelector('span');
            if (badge) badge.textContent = 'Executive Summary';
        }

        const summaryGrid = section.querySelector('.grid.grid-cols-1.md\\:grid-cols-4');
        if (summaryGrid) {
            const cards = Array.from(summaryGrid.children);
            const cardTitles = [
                'Productivity (sticks/person/hour)',
                'Efficiency Leap (%)',
                'Cycle Time (sec)',
                'Total Output (sticks/hour)'
            ];
            cards.forEach((card, index) => {
                const cardTitle = card.querySelector('p.text-\\[11px\\].font-bold');
                if (cardTitle && cardTitles[index]) cardTitle.textContent = cardTitles[index];
                const unitsRow = card.querySelector('.flex.items-baseline.gap-2');
                if (unitsRow) {
                    const spans = unitsRow.querySelectorAll('span');
                    if (spans[1]) spans[1].textContent = '→';
                }
            });
        }

        const charts = section.querySelectorAll('.grid.grid-cols-1.lg\\:grid-cols-2 > div');
        if (charts[0]) {
            const chartTitle = charts[0].querySelector('h3');
            const target = charts[0].querySelector('span.text-xs');
            if (chartTitle) chartTitle.textContent = 'Productivity & Efficiency Journey (Focus: Baseline vs Best vs Target)';
            if (target) target.textContent = /69/.test(target.textContent || '') ? target.textContent : 'Target: 84';
        }
        if (charts[1]) {
            const chartTitle = charts[1].querySelector('h3');
            const unit = charts[1].querySelector('span.text-xs');
            if (chartTitle) chartTitle.textContent = 'Cycle Time Reduction (Bottlenecks Comparison)';
            if (unit) unit.textContent = 'Unit: seconds';
        }

        const gapCard = section.querySelector('.grid.grid-cols-1.gap-6.mb-8 .bg-card');
        if (gapCard) {
            const gapTitle = gapCard.querySelector('h3');
            const gapSubtitle = gapCard.querySelector('p.text-xs');
            const compare = gapCard.querySelector('span.uppercase');
            if (gapTitle) gapTitle.textContent = 'Gap Analysis';
            if (gapSubtitle) gapSubtitle.textContent = 'Compare the baseline trial and the selected trial against each line target.';
            if (compare) compare.textContent = 'Compare';
        }
    }

    function apiEndpoint() {
        const selected = global.BREAKDOWN_SUPABASE;
        if (!selected || selected.environment !== 'staging') return CONFIG.appsScriptUrl;
        if (global.location.origin !== selected.frontendOrigin ||
            !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(selected.gasUrl || '') ||
            selected.gasUrl !== selected.approvedGasUrl || selected.gasUrl === CONFIG.appsScriptUrl ||
            /SET_|PLACEHOLDER|REPLACE_/i.test(selected.gasUrl)) throw Error('STAGING_CONFIG_REQUIRED');
        return selected.gasUrl;
    }

    function buildApiUrl(sheet, extraParams = {}) {
        const url = new URL(apiEndpoint());
        url.searchParams.set("page", "api");
        url.searchParams.set("v", BUILD_VERSION);
        if (sheet) url.searchParams.set("sheet", sheet);
        Object.entries(extraParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    }

    async function postToAppsScript(action, payload = {}, options = {}) {
        if (global.BREAKDOWN_SUPABASE?.environment === 'staging') throw Error('STAGING_UNSIGNED_WRITE_DISABLED');
        const body = {
            action,
            payload
        };

        await fetch(CONFIG.appsScriptUrl, {
            method: "POST",
            mode: "no-cors",
            signal: options.signal,
            headers: {
                "Content-Type": "text/plain;charset=UTF-8"
            },
            body: JSON.stringify(body)
        });

        return { ok: true, queued: true };
    }

    function requireAccessOrWarn() {
        return true;
    }

    global.YakitoriRuntime = {
        CONFIG,
        apiEndpoint,
        requireAccessOrWarn,
        buildApiUrl,
        postToAppsScript,
        BUILD_VERSION,
        appendVersion,
        stampElementUrls,
        applyCacheBust
    };

    if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", applyCacheBust, { once: true });
    } else {
        applyCacheBust();
    }
})(window);
