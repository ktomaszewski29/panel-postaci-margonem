// ==UserScript==
// @name         Margonem – panel zmiany postaci
// @namespace    margonem.postacie.layout
// @version      1.11
// @description  Usprawnia wybór postaci na nowej i klasycznej stronie głównej Margonem
// @updateURL    https://raw.githubusercontent.com/ktomaszewski29/panel-postaci-margonem/main/panel-zmiany-postaci.user.js
// @downloadURL  https://raw.githubusercontent.com/ktomaszewski29/panel-postaci-margonem/main/panel-zmiany-postaci.user.js
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

    // Klasyczna strona główna (np. motyw „stara strona główna”) używa
    // natywnego selecta zamiast kafelków .charc. Trzymamy jej ustawienia
    // osobno, aby nie mieszać ich z ustawieniami nowego panelu.
    const legacyPrefs = GM_getValue('legacyPrefs', {});
    const legacyHidden = new Set(legacyPrefs.hidden || []);
    const legacyOrder = (legacyPrefs.order || []).slice();
    let legacySort = legacyPrefs.sort || 'default';
    let legacyRoster = null;
    let legacySelectFavorite = null;
    let legacyShowHidden = false;
    let legacyAutoSelected = false;
    let legacyOriginalOrder = [];
    let legacyArrangementKey = null;

    function saveLegacy() {
        legacyPrefs.hidden = [...legacyHidden];
        legacyPrefs.order = legacyOrder;
        legacyPrefs.sort = legacySort;
        legacyPrefs.favorites = legacyPrefs.favorites || {};
        if (legacyRoster) {
            if (legacySelectFavorite) legacyPrefs.favorites[legacyRoster] = legacySelectFavorite;
            else delete legacyPrefs.favorites[legacyRoster];
        }
        GM_setValue('legacyPrefs', legacyPrefs);
    }

    const legacyOptionWorld = (option) => option.dataset.mdrWorld || (option.parentElement?.tagName === 'OPTGROUP'
        ? option.parentElement.label || '?'
        : option.dataset.world || '?');

    function legacyOptionKey(option) {
        return [legacyOptionWorld(option), option.value || option.textContent.trim()].join('::');
    }

    function legacyOptionLevel(option) {
        const match = option.textContent.match(/\(\s*(\d+)\s*[a-ząćęłńóśźż]*\s*\)/i);
        return match ? Number(match[1]) : Number.NaN;
    }

    function currentLegacyArrangementKey() {
        return [legacyRoster, legacyPrefs.custom === true, legacySort, legacyOrder.join('|')].join('::');
    }

    function findLegacySelect() {
        return [...document.querySelectorAll('select')].find((select) =>
            select.options.length > 1 && [...select.options].some((option) => /\(\s*\d+\s*[a-ząćęłńóśźż]+\s*\)/i.test(option.textContent))
        );
    }

    function bindLegacyRoster(select) {
        const options = [...select.options].filter((option) => option.value !== '');
        if (!options.length) return;
        const roster = options.map(legacyOptionKey).sort().join('|');
        if (legacyRoster === roster && legacyOriginalOrder.every((option) => select.contains(option))) return;
        legacyRoster = roster;
        options.forEach((option) => { option.dataset.mdrWorld = legacyOptionWorld(option); });
        legacySelectFavorite = legacyPrefs.favorites?.[roster] || null;
        legacyAutoSelected = false;
        legacyOriginalOrder = options.slice();
        legacyArrangementKey = null;
    }

    function arrangeLegacyOptions(select) {
        const options = [...select.options].filter((option) => option.value !== '');
        if (!options.length) return;
        const selected = select.selectedOptions[0];
        const originalIndex = new Map(legacyOriginalOrder.map((option, index) => [option, index]));
        const compare = (a, b) => {
            if (legacyPrefs.custom && legacyOrder.length) {
                const ai = legacyOrder.indexOf(legacyOptionKey(a));
                const bi = legacyOrder.indexOf(legacyOptionKey(b));
                if (ai !== bi) return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
            }
            if (legacySort === 'level-asc' || legacySort === 'level-desc') {
                const al = legacyOptionLevel(a);
                const bl = legacyOptionLevel(b);
                if (Number.isNaN(al) !== Number.isNaN(bl)) return Number.isNaN(al) ? 1 : -1;
                if (!Number.isNaN(al) && al !== bl) return legacySort === 'level-asc' ? al - bl : bl - al;
            }
            if (legacySort === 'name-asc') return a.textContent.localeCompare(b.textContent, 'pl');
            if (legacySort === 'name-desc') return b.textContent.localeCompare(a.textContent, 'pl');
            return originalIndex.get(a) - originalIndex.get(b);
        };
        const groups = [...select.children].filter((child) => child.tagName === 'OPTGROUP');
        const looseOptions = [...select.children].filter((child) => child.tagName === 'OPTION' && child.value !== '');
        const sortGroupOptions = (parent) => {
            const children = [...parent.children].filter((child) => child.tagName === 'OPTION');
            children.sort(compare).forEach((option) => parent.appendChild(option));
        };
        if (groups.length) {
            groups.forEach(sortGroupOptions);
            if (legacyPrefs.custom && legacyOrder.length) {
                const firstPosition = (group) => Math.min(...[...group.children].map((option) => {
                    const index = legacyOrder.indexOf(legacyOptionKey(option));
                    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
                }));
                groups.sort((a, b) => firstPosition(a) - firstPosition(b));
            } else if (legacySort !== 'default') {
                const groupHead = (group) => [...group.children].find((option) => option.tagName === 'OPTION');
                groups.sort((a, b) => {
                    const ao = groupHead(a), bo = groupHead(b);
                    if (!ao) return 1;
                    if (!bo) return -1;
                    return compare(ao, bo);
                });
            }
            groups.forEach((group) => select.appendChild(group));
        } else {
            looseOptions.sort(compare).forEach((option) => select.appendChild(option));
        }
        if (selected) select.selectedIndex = [...select.options].indexOf(selected);
        legacyArrangementKey = currentLegacyArrangementKey();
    }

    function updateLegacyPanel(select) {
        const panel = select.parentElement.querySelector(':scope > .mdr-legacy-panel');
        if (!panel) return;
        const selected = select.selectedOptions[0];
        const selectedKey = selected ? legacyOptionKey(selected) : null;
        const hiddenCount = [...select.options].filter((option) => legacyHidden.has(legacyOptionKey(option))).length;
        const favorite = panel.querySelector('.mdr-legacy-favorite');
        const hide = panel.querySelector('.mdr-legacy-hide');
        if (favorite) {
            favorite.textContent = selectedKey && legacySelectFavorite === selectedKey ? '★ Ulubiona' : '☆ Ustaw ulubioną';
            favorite.disabled = !selected;
        }
        if (hide) {
            hide.textContent = selectedKey && legacyHidden.has(selectedKey) ? 'Przywróć wybraną' : 'Ukryj wybraną';
            hide.disabled = !selected;
        }
        const hiddenButton = panel.querySelector('.mdr-legacy-hidden');
        if (hiddenButton) {
            hiddenButton.textContent = legacyShowHidden ? 'Schowaj ukryte' : 'Pokaż ukryte (' + hiddenCount + ')';
            hiddenButton.hidden = !hiddenCount && !legacyShowHidden;
        }
        const restoreAll = panel.querySelector('.mdr-legacy-restore');
        if (restoreAll) restoreAll.hidden = hiddenCount === 0;
        const moveUp = panel.querySelector('.mdr-legacy-up');
        const moveDown = panel.querySelector('.mdr-legacy-down');
        const custom = panel.querySelector('.mdr-legacy-custom');
        const siblings = selected ? [...selected.parentElement.children].filter((child) => child.tagName === 'OPTION' && !child.hidden) : [];
        const siblingIndex = selected ? siblings.indexOf(selected) : -1;
        const worldGroups = selected?.parentElement.tagName === 'OPTGROUP'
            ? [...select.children].filter((child) => child.tagName === 'OPTGROUP') : [];
        const groupIndex = worldGroups.indexOf(selected?.parentElement);
        const useGroups = siblings.length <= 1 && worldGroups.length > 1;
        const position = useGroups ? groupIndex : siblingIndex;
        const length = useGroups ? worldGroups.length : siblings.length;
        if (moveUp) moveUp.disabled = !selected || !custom?.checked || position <= 0;
        if (moveDown) moveDown.disabled = !selected || !custom?.checked || position < 0 || position >= length - 1;
    }

    function ensureLegacyPanel(select) {
        const host = select.parentElement;
        const previousPanel = [...host.children].find((child) => child.classList.contains('mdr-legacy-panel'));
        if (previousPanel?._mdrSelect === select) return previousPanel;
        if (previousPanel) previousPanel.remove();

        const panel = document.createElement('div');
        panel.className = 'mdr-legacy-panel';
        panel._mdrSelect = select;
        panel.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;align-items:center;width:100%;box-sizing:border-box;margin:5px 0 7px;padding:5px;border:1px solid rgba(255,220,130,.45);border-radius:4px;background:rgba(0,0,0,.22);font:12px Arial,sans-serif;line-height:1.2;';
        const buttonStyle = 'cursor:pointer;min-width:0;min-height:25px;padding:3px 5px;border:1px solid #593a22;border-radius:3px;background:linear-gradient(#8a4c28,#542817);color:#ffe7a0;font:12px Arial,sans-serif;white-space:normal;';
        const full = 'grid-column:1 / -1;';
        panel.innerHTML =
            '<label style="' + full + 'display:flex;align-items:center;gap:5px;color:#ffe7a0;font:12px Arial,sans-serif"><input class="mdr-legacy-custom" type="checkbox" style="margin:0">Własna kolejność</label>' +
            '<select class="mdr-legacy-sort" aria-label="Sortuj postacie" style="' + full + 'width:100%;box-sizing:border-box;font:12px Arial,sans-serif"><option value="default">Kolejność domyślna</option><option value="name-asc">Nazwa A–Z</option><option value="name-desc">Nazwa Z–A</option><option value="level-asc">Poziom rosnąco</option><option value="level-desc">Poziom malejąco</option></select>' +
            '<button type="button" class="mdr-legacy-favorite" style="' + buttonStyle + full + '">☆ Ulubiona</button>' +
            '<button type="button" class="mdr-legacy-hide" style="' + buttonStyle + '">Ukryj wybraną</button>' +
            '<span style="display:flex;gap:4px;justify-content:flex-end"><button type="button" class="mdr-legacy-up" style="' + buttonStyle + '" title="Przesuń wyżej">↑</button>' +
            '<button type="button" class="mdr-legacy-down" style="' + buttonStyle + '" title="Przesuń niżej">↓</button></span>' +
            '<button type="button" class="mdr-legacy-hidden" style="' + buttonStyle + full + '"></button>' +
            '<button type="button" class="mdr-legacy-restore" style="' + buttonStyle + full + '">Odkryj wszystkie</button>' +
            '<button type="button" class="mdr-legacy-reset" style="' + buttonStyle + full + '">Resetuj kolejność</button>';
        select.insertAdjacentElement('afterend', panel);

        const custom = panel.querySelector('.mdr-legacy-custom');
        const sort = panel.querySelector('.mdr-legacy-sort');
        custom.checked = legacyPrefs.custom === true;
        sort.value = legacySort;
        custom.addEventListener('change', () => {
            legacyPrefs.custom = custom.checked;
            if (custom.checked && !legacyOrder.length) legacyOrder.push(...[...select.options].map(legacyOptionKey));
            arrangeLegacyOptions(select);
            saveLegacy(); updateLegacyPanel(select);
        });
        sort.addEventListener('change', () => {
            legacySort = sort.value;
            if (custom.checked) { custom.checked = false; legacyPrefs.custom = false; }
            arrangeLegacyOptions(select); saveLegacy(); updateLegacyPanel(select);
        });
        panel.querySelector('.mdr-legacy-favorite').addEventListener('click', () => {
            const option = select.selectedOptions[0];
            if (!option) return;
            const key = legacyOptionKey(option);
            legacySelectFavorite = legacySelectFavorite === key ? null : key;
            saveLegacy(); updateLegacyPanel(select);
        });
        panel.querySelector('.mdr-legacy-hide').addEventListener('click', () => {
            const option = select.selectedOptions[0];
            if (!option) return;
            const key = legacyOptionKey(option);
            if (legacyHidden.has(key)) legacyHidden.delete(key); else legacyHidden.add(key);
            applyLegacyHidden(select); saveLegacy(); updateLegacyPanel(select);
        });
        panel.querySelector('.mdr-legacy-hidden').addEventListener('click', () => {
            legacyShowHidden = !legacyShowHidden;
            applyLegacyHidden(select); updateLegacyPanel(select);
        });
        panel.querySelector('.mdr-legacy-restore').addEventListener('click', () => {
            legacyHidden.clear(); legacyShowHidden = false;
            applyLegacyHidden(select); saveLegacy(); updateLegacyPanel(select);
        });
        const move = (offset) => {
            if (!legacyPrefs.custom) return;
            const option = select.selectedOptions[0];
            if (!option) return;
            const parent = option.parentElement;
            const siblings = [...parent.children].filter((child) => child.tagName === 'OPTION' && !child.hidden);
            const index = siblings.indexOf(option);
            const target = siblings[index + offset];
            if (target) parent.insertBefore(option, offset < 0 ? target : target.nextSibling);
            else if (parent.tagName === 'OPTGROUP' && siblings.length === 1) {
                const groups = [...select.children].filter((child) => child.tagName === 'OPTGROUP');
                const groupIndex = groups.indexOf(parent);
                const targetGroup = groups[groupIndex + offset];
                if (!targetGroup) return;
                select.insertBefore(parent, offset < 0 ? targetGroup : targetGroup.nextSibling);
            } else return;
            legacyOrder.splice(0, legacyOrder.length, ...[...select.options].map(legacyOptionKey));
            select.selectedIndex = [...select.options].indexOf(option);
            saveLegacy(); updateLegacyPanel(select);
        };
        panel.querySelector('.mdr-legacy-up').addEventListener('click', () => move(-1));
        panel.querySelector('.mdr-legacy-down').addEventListener('click', () => move(1));
        panel.querySelector('.mdr-legacy-reset').addEventListener('click', () => {
            legacyOrder.length = 0;
            legacyPrefs.custom = false;
            custom.checked = false;
            arrangeLegacyOptions(select);
            saveLegacy();
            updateLegacyPanel(select);
        });
        select.addEventListener('change', () => updateLegacyPanel(select));
        return panel;
    }

    function applyLegacyHidden(select) {
        let selectedWasHidden = false;
        [...select.options].forEach((option) => {
            const hidden = legacyHidden.has(legacyOptionKey(option));
            option.hidden = hidden && !legacyShowHidden;
            if (hidden && option.selected && !legacyShowHidden) selectedWasHidden = true;
        });
        if (selectedWasHidden) {
            const replacement = [...select.options].find((option) => option.value && !option.hidden);
            if (replacement) {
                select.selectedIndex = [...select.options].indexOf(replacement);
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    function runLegacy() {
        const select = findLegacySelect();
        if (!select) return false;
        bindLegacyRoster(select);
        ensureLegacyPanel(select);
        if (legacyArrangementKey !== currentLegacyArrangementKey()) arrangeLegacyOptions(select);
        applyLegacyHidden(select);
        if (legacySelectFavorite && !legacyAutoSelected) {
            const favorite = [...select.options].find((option) => legacyOptionKey(option) === legacySelectFavorite);
            if (favorite && !legacyHidden.has(legacySelectFavorite)) {
                legacyAutoSelected = true;
                select.selectedIndex = [...select.options].indexOf(favorite);
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        updateLegacyPanel(select);
        return true;
    }

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
            'cursor:pointer;white-space:nowrap;margin:0;min-height:32px;padding:5px 12px;font-size:13px;' +
            'border:1px solid rgba(0,0,0,.45);border-radius:4px;background:rgba(255,255,255,.55);color:#000;';
        panel.innerHTML =
            '<label style="' + lbl + '"><input type="checkbox" class="mdr-custom" style="' + chk + '"><span>Własna kolejność</span></label>' +
            '<label style="' + lbl + '"><input type="checkbox" class="mdr-group" style="' + chk + '"><span>Rozdziel wg światów</span></label>' +
            '<span class="mdr-actions" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;width:100%;box-sizing:border-box">' +
            '<button type="button" class="mdr-show" style="' + btnCss + '"></button>' +
            '<button type="button" class="mdr-restore-all" style="' + btnCss + '">Odkryj wszystkie</button>' +
            '<button type="button" class="mdr-reset" style="' + btnCss + '">Resetuj kolejność</button>' +
            '</span>';
        holder.insertAdjacentElement('afterend', panel);
        panel.querySelector('.mdr-show').addEventListener('click', () => {
            showHidden = !showHidden;
            refresh();
        });
        panel.querySelector('.mdr-restore-all').addEventListener('click', () => {
            cfg.hidden = [];
            showHidden = false;
            save();
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
        const restoreAll = document.querySelector('.mdr-restore-all');
        if (btn) {
            btn.textContent = showHidden ? 'Schowaj ukryte' : 'Pokaż ukryte (' + count + ')';
            btn.style.display = count || showHidden ? '' : 'none';
        }
        if (restoreAll) restoreAll.style.display = count ? '' : 'none';
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

    function exposeEnterGameButton() {
        const button = document.querySelector('.info-container .enter-game');
        if (!button) return;
        const container = button.closest('.info-container');
        button.hidden = false;
        button.style.removeProperty('display');
        if (container) {
            container.hidden = false;
            container.style.removeProperty('display');
        }
    }

    function closeEmailNotice() {
        const notice = document.querySelector('.disabled-enter-game-info');
        if (!notice) return;
        const close = notice.querySelector('.close-game-info');
        if (!close || notice._mdrCloseScheduled) return;
        const attempts = Number(notice.dataset.mdrCloseAttempts || 0);
        if (attempts >= 12) {
            // Ostatnia deska ratunku dla profili, w których obsługa X ładuje się
            // z opóźnieniem albo nie jest dostępna. Komunikat jest tylko zaleceniem.
            notice.remove();
            exposeEnterGameButton();
            return;
        }
        notice.dataset.mdrCloseAttempts = String(attempts + 1);
        notice._mdrCloseScheduled = true;
        try { close.click(); } catch (e) { console.warn('[Margonem układ postaci] Nie udało się zamknąć komunikatu e-mail', e); }
        setTimeout(() => {
            notice._mdrCloseScheduled = false;
            if (!notice.isConnected) return;
            const noticeStyle = getComputedStyle(notice);
            const enterButton = document.querySelector('.info-container .enter-game');
            if (noticeStyle.display === 'none' || noticeStyle.visibility === 'hidden') return;
            if (enterButton && getComputedStyle(enterButton).display !== 'none') {
                notice.remove();
                return;
            }
            closeEmailNotice();
        }, 300);
    }

    function refresh() {
        obs.disconnect();
        let rerun = false;
        try {
            closeEmailNotice();
            // Motyw klasyczny może pozostawiać w DOM ukryte kafelki .charc
            // (np. utworzone przez inny dodatek). Wykrycie natywnej listy ma
            // pierwszeństwo, żeby klasyczny panel nie został pomylony z nowym.
            if (findLegacySelect()) runLegacy();
            else rerun = run();
        } catch (e) { console.error('[Margonem układ postaci]', e); }
        obs.observe(document.body, { childList: true, subtree: true });
        if (rerun) setTimeout(refresh, 120);
    }

    obs.observe(document.body, { childList: true, subtree: true });
    refresh();
})();
