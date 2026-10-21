// ==UserScript==
// @name         Margonem – panel zmiany postaci
// @namespace    margonem.postacie.layout
// @version      1.4
// @description  Własna kolejność postaci (drag & drop), zapamiętane sortowanie i opcjonalny podział wg światów w oknie "Wybierz Postać"
// @match        https://www.margonem.pl/*
// @match        https://margonem.pl/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const cfg = {
        custom: GM_getValue('custom', false),   // czy stosować własną kolejność
        group: GM_getValue('group', false),     // czy rozdzielać wg światów
        order: GM_getValue('order', []),        // lista id postaci w kolejności
        sort: GM_getValue('sort', null),        // {value, text} wybranego sortowania
        hidden: GM_getValue('hidden', []),      // id ukrytych postaci
        def: null                               // ulubiona postać bieżącego konta
    };
    const favoritesByRoster = GM_getValue('favoritesByRoster', {});
    const legacyFavorite = GM_getValue('def', null);
    let activeRoster = null;
    let showHidden = false;                     // tryb podglądu ukrytych (nie jest zapisywany)
    const save = () => {
        GM_setValue('hidden', cfg.hidden);
        GM_setValue('custom', cfg.custom);
        GM_setValue('group', cfg.group);
        GM_setValue('order', cfg.order);
        GM_setValue('sort', cfg.sort);
        if (activeRoster) {
            if (cfg.def) favoritesByRoster[activeRoster] = cfg.def;
            else delete favoritesByRoster[activeRoster];
            GM_setValue('favoritesByRoster', favoritesByRoster);
        }
    };

    const TILE = '.charc[data-id]';
    const MAXI = Number.MAX_SAFE_INTEGER;
    let dragged = null;
    let groupHost = null;
    let timer = null;
    let favoriteAutoSelected = false;

    const orderIdx = (t) => {
        const i = cfg.order.indexOf(t.dataset.id);
        return i === -1 ? MAXI : i;
    };
    const byOrder = (a, b) => orderIdx(a) - orderIdx(b);
    const worldOf = (t) => {
        const inp = t.querySelector('input[name="world"]');
        return (inp && inp.value) || t.dataset.world || '?';
    };

    // Przestawia kafelki w ich dotychczasowych "slotach" w DOM
    function reorderInPlace(kids, cmp) {
        const sorted = kids.slice().sort(cmp);
        const marks = kids.map((k) => {
            const m = document.createComment('');
            k.replaceWith(m);
            return m;
        });
        sorted.forEach((k, i) => marks[i].replaceWith(k));
    }

    function findSelect() {
        return [...document.querySelectorAll('select')].find((s) =>
            [...s.options].some((o) => /nazw/i.test(o.textContent))
        );
    }

    function lca(nodes) {
        let a = nodes[0];
        while (a && !nodes.every((n) => a.contains(n))) a = a.parentElement;
        return a;
    }

    // ---------- panel opcji ----------
    function ensurePanel(sel) {
        const holder = sel.parentElement;
        if (holder.parentElement.querySelector(':scope > .mdr-panel')) return;
        const panel = document.createElement('div');
        panel.className = 'mdr-panel';
        panel.style.cssText =
            'display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px 16px;' +
            'width:100%;box-sizing:border-box;flex:1 1 100%;margin:10px 0 0;font-size:13px;';
        const lbl = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer;margin:0;';
        const chk = 'margin:0;cursor:pointer;';
        const btnCss =
            'cursor:pointer;white-space:nowrap;margin:0;padding:4px 12px;font-size:13px;' +
            'border:1px solid rgba(0,0,0,.45);border-radius:4px;background:rgba(255,255,255,.55);color:#000;';
        panel.innerHTML =
            '<label style="' + lbl + '"><input type="checkbox" class="mdr-custom" style="' + chk + '"><span>Własna kolejność</span></label>' +
            '<label style="' + lbl + '"><input type="checkbox" class="mdr-group" style="' + chk + '"><span>Rozdziel wg światów</span></label>' +
            '<span style="display:inline-flex;gap:8px;flex-wrap:nowrap">' +
            '<button type="button" class="mdr-show" style="' + btnCss + '"></button>' +
            '<button type="button" class="mdr-reset" style="' + btnCss + '">Resetuj kolejność</button>' +
            '</span>';
        holder.insertAdjacentElement('afterend', panel);
        panel.querySelector('.mdr-show').addEventListener('click', () => {
            showHidden = !showHidden;
            refresh();
        });

        const cCustom = panel.querySelector('.mdr-custom');
        const cGroup = panel.querySelector('.mdr-group');
        cCustom.checked = cfg.custom;
        cGroup.checked = cfg.group;
        cCustom.addEventListener('change', () => { cfg.custom = cCustom.checked; save(); refresh(); });
        cGroup.addEventListener('change', () => { cfg.group = cGroup.checked; save(); refresh(); });
        panel.querySelector('.mdr-reset').addEventListener('click', () => {
            cfg.order = []; cfg.custom = false; cCustom.checked = false; save();
            // wymuś ponowne posortowanie przez stronę
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            refresh();
        });
    }

    // ---------- zapamiętywanie sortowania ----------
    function handleSort(sel) {
        if (sel.dataset.mdrInit) return false;
        sel.dataset.mdrInit = '1';
        sel.addEventListener('change', (e) => {
            if (!e.isTrusted) return;
            const o = sel.options[sel.selectedIndex];
            cfg.sort = { value: sel.value, text: o ? o.textContent.trim() : '' };
            save();
        });
        if (!cfg.sort) return false;
        let changed = false;
        if (sel.value !== cfg.sort.value) {
            sel.value = cfg.sort.value;
            if (sel.value !== cfg.sort.value) {
                const o = [...sel.options].find((x) => x.textContent.trim() === cfg.sort.text);
                if (o) sel.value = o.value;
            }
            changed = sel.value !== cfg.sort.value || true;
        }
        if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
        return changed;
    }

    // ---------- drag & drop ----------
    function attachDnD(t) {
        if (t._mdrDnD) return;
        t._mdrDnD = true;
        t.draggable = true;
        t.addEventListener('dragstart', (e) => {
            dragged = t;
            t.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', t.dataset.id); } catch (_) {}
        });
        t.addEventListener('dragend', () => { t.style.opacity = ''; dragged = null; });
        t.addEventListener('dragover', (e) => {
            if (dragged && dragged !== t && dragged.parentElement === t.parentElement) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });
        t.addEventListener('drop', (e) => {
            if (!dragged || dragged === t || dragged.parentElement !== t.parentElement) return;
            e.preventDefault();
            const sibs = [...t.parentElement.querySelectorAll(TILE)];
            const multiCol = new Set(sibs.map((s) => Math.round(s.getBoundingClientRect().left))).size > 1;
            const r = t.getBoundingClientRect();
            const after = multiCol ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
            t.parentElement.insertBefore(dragged, after ? t.nextSibling : t);

            const ids = [...document.querySelectorAll(TILE)].map((x) => x.dataset.id);
            cfg.order = ids.concat(cfg.order.filter((id) => !ids.includes(id)));
            cfg.custom = true;
            const cb = document.querySelector('.mdr-custom');
            if (cb) cb.checked = true;
            save();
        });
    }

    // ---------- ukrywanie postaci ----------
    function attachHideBtn(t) {
        if (t._mdrBtn) return;
        const b = document.createElement('span');
        b.className = 'mdr-hide';
        b.style.cssText =
            'position:absolute;top:2px;right:2px;z-index:5;width:18px;height:18px;line-height:18px;' +
            'text-align:center;font-size:12px;font-weight:bold;cursor:pointer;border-radius:3px;' +
            'background:rgba(0,0,0,.55);color:#fff;user-select:none;';
        const stop = (e) => { e.stopPropagation(); };
        b.addEventListener('mousedown', stop);
        b.addEventListener('mouseup', stop);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const id = t.dataset.id;
            const i = cfg.hidden.indexOf(id);
            if (i === -1) cfg.hidden.push(id); else cfg.hidden.splice(i, 1);
            save();
            refresh();
        });
        if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
        t.appendChild(b);
        t._mdrBtn = b;
    }

    // ---------- ulubiona postać ----------
    function attachFavoriteBtn(t) {
        if (t._mdrFavoriteBtn) return;
        const b = document.createElement('span');
        b.className = 'mdr-favorite';
        b.style.cssText =
            'position:absolute;top:2px;left:2px;z-index:6;width:20px;height:20px;line-height:20px;' +
            'text-align:center;font-size:17px;cursor:pointer;border-radius:3px;' +
            'background:rgba(0,0,0,.55);color:#ffd54a;user-select:none;';
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        b.addEventListener('mouseup', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            cfg.def = cfg.def === t.dataset.id ? null : t.dataset.id;
            save();
            updateFavoriteButtons();
        });
        if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
        t.appendChild(b);
        t._mdrFavoriteBtn = b;
        updateFavoriteButton(t);
    }

    function updateFavoriteButton(t) {
        const b = t._mdrFavoriteBtn;
        if (!b) return;
        const isFavorite = cfg.def === t.dataset.id;
        b.textContent = isFavorite ? '★' : '☆';
        b.title = isFavorite ? 'Ulubiona postać (kliknij, aby odznaczyć)' : 'Ustaw jako ulubioną postać';
    }

    function updateFavoriteButtons() {
        document.querySelectorAll(TILE).forEach(updateFavoriteButton);
    }

    // Używamy pełnej listy ID postaci jako identyfikatora konta. Dzięki temu
    // nie zależymy od tego, czy Margonem udostępnia nazwę zalogowanego konta w DOM.
    function bindRoster(tiles) {
        const ids = tiles.map((t) => t.dataset.id).filter(Boolean).sort();
        if (!ids.length) return;
        const roster = ids.join(',');
        if (activeRoster === roster) return;
        activeRoster = roster;
        cfg.def = favoritesByRoster[roster] || null;
        // Jednorazowa migracja wyboru z poprzedniej wersji skryptu.
        if (!cfg.def && legacyFavorite && ids.includes(legacyFavorite)) {
            cfg.def = legacyFavorite;
            favoritesByRoster[roster] = legacyFavorite;
            GM_setValue('favoritesByRoster', favoritesByRoster);
        }
        favoriteAutoSelected = false;
        updateFavoriteButtons();
    }

    function autoSelectFavorite(tiles) {
        if (favoriteAutoSelected || !cfg.def) return;
        const tile = tiles.find((t) => t.dataset.id === cfg.def);
        if (!tile || tile.style.display === 'none' || !tile.isConnected) return;
        // Kliknięcie kafelka korzysta z natywnej obsługi Margonem wyboru postaci.
        favoriteAutoSelected = true;
        tile.click();
    }

    function applyHidden(tiles) {
        let count = 0;
        tiles.forEach((t) => {
            attachHideBtn(t);
            const isHidden = cfg.hidden.includes(t.dataset.id);
            if (isHidden) count++;
            t.style.display = isHidden && !showHidden ? 'none' : '';
            t.style.filter = isHidden ? 'grayscale(1) opacity(.55)' : '';
            t._mdrBtn.textContent = isHidden ? '↺' : '✕';
            t._mdrBtn.title = isHidden ? 'Przywróć postać' : 'Ukryj postać';
        });
        const btn = document.querySelector('.mdr-show');
        if (btn) {
            btn.textContent = showHidden ? 'Schowaj ukryte' : 'Pokaż ukryte (' + count + ')';
            btn.style.display = count || showHidden ? '' : 'none';
        }
    }

    // ---------- główna logika ----------
    function run() {
        const tiles = [...document.querySelectorAll(TILE)];
        if (!tiles.length) return false;
        bindRoster(tiles);

        const sel = findSelect();
        let rerun = false;
        if (sel) {
            ensurePanel(sel);
            rerun = handleSort(sel);
        }

        tiles.forEach((t) => {
            if (!t.closest('.mdr-groups')) t._mdrOrigin = t.parentElement;
            attachDnD(t);
            attachFavoriteBtn(t);
        });
        autoSelectFavorite(tiles);
        applyHidden(tiles);

        const origins = [...new Set(tiles.map((t) => t._mdrOrigin).filter((o) => o && o.isConnected))];
        let host = null;
        if (cfg.group && groupHost && groupHost.isConnected) host = groupHost;
        else if (origins.length) host = lca(origins);
        else if (groupHost && groupHost.isConnected) host = groupHost;
        if (!host) return rerun;

        let g = host.querySelector(':scope > .mdr-groups');

        if (cfg.group) {
            groupHost = host;
            if (!g) {
                g = document.createElement('div');
                g.className = 'mdr-groups';
                host.appendChild(g);
            }
            [...host.children].forEach((c) => {
                // Gdy host jest jednocześnie oryginalną listą postaci,
                // kafelki trafiają bezpośrednio do jego dzieci. Nie wolno
                // ustawiać im display:none przed przeniesieniem do grupy.
                if (c !== g && !(c.matches && c.matches(TILE)) && !('mdrHid' in c.dataset)) {
                    c.dataset.mdrHid = c.style.display || '';
                    c.style.display = 'none';
                }
            });

            let list = [...document.querySelectorAll(TILE)];
            if (cfg.custom) list.sort(byOrder);
            const listClass = (origins[0] && origins[0].className) || '';
            const worlds = new Map();
            list.forEach((t) => {
                const w = worldOf(t);
                if (!worlds.has(w)) worlds.set(w, []);
                worlds.get(w).push(t);
            });
            g.textContent = '';
            [...worlds.keys()].sort((a, b) => a.localeCompare(b, 'pl')).forEach((w) => {
                const wrap = document.createElement('div');
                const h = document.createElement('h3');
                h.textContent = w;
                h.style.cssText = 'margin:14px 0 6px;font-size:18px;';
                const box = document.createElement('div');
                box.className = listClass;
                worlds.get(w).forEach((t) => box.appendChild(t));
                wrap.append(h, box);
                // Widoczność kafelków może być ustawiana przez CSS Margonem lub
                // inne dodatki. O ukryciu całej grupy decyduje wyłącznie nasza lista.
                const visibleInWorld = worlds.get(w).some((t) => showHidden || !cfg.hidden.includes(t.dataset.id));
                wrap.style.display = visibleInWorld ? '' : 'none';
                g.appendChild(wrap);
            });
        } else {
            if (g) {
                [...g.querySelectorAll(TILE)].forEach((t) => {
                    if (t._mdrOrigin && t._mdrOrigin.isConnected) t._mdrOrigin.appendChild(t);
                });
                g.remove();
            }
            [...host.children].forEach((c) => {
                if ('mdrHid' in c.dataset) {
                    c.style.display = c.dataset.mdrHid;
                    delete c.dataset.mdrHid;
                }
            });
            groupHost = null;
            if (cfg.custom) {
                origins.forEach((o) => {
                    const kids = [...o.children].filter((k) => k.matches && k.matches(TILE));
                    if (kids.length > 1) reorderInPlace(kids, byOrder);
                });
            }
        }
        return rerun;
    }

    const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 60);
    });

    function closeEmailNotice() {
        const notice = document.querySelector('.disabled-enter-game-info');
        if (!notice || notice.dataset.mdrClosed) return;
        const close = notice.querySelector('.close-game-info');
        if (close) {
            notice.dataset.mdrClosed = '1';
            close.click();
        }
    }

    function refresh() {
        obs.disconnect();
        let rerun = false;
        try {
            closeEmailNotice();
            rerun = run();
        } catch (e) { console.error('[Margonem układ postaci]', e); }
        obs.observe(document.body, { childList: true, subtree: true });
        if (rerun) setTimeout(refresh, 120);
    }

    obs.observe(document.body, { childList: true, subtree: true });
    refresh();
})();
