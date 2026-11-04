// ==UserScript==
// @name         Margonem – panel zmiany postaci
// @namespace    margonem.postacie.layout
// @version      1.13
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
    let legacySort = legacyPrefs.sort || 'default';
    let legacyRoster = null;
    let legacySelectFavorite = null;
    let legacyShowHidden = false;
    let legacyAutoSelected = false;
    let legacySelect = null;
    let legacyDialog = null;
    let legacyDialogOpen = false;

    function saveLegacy() {
        legacyPrefs.hidden = [...legacyHidden];
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

    function findLegacySelect() {
        return [...document.querySelectorAll('select')].find((select) =>
            select.options.length > 1 && [...select.options].some((option) => /\(\s*\d+\s*[a-ząćęłńóśźż]+\s*\)/i.test(option.textContent))
        );
    }

    function bindLegacyRoster(select) {
        const options = [...select.options].filter((option) => option.value !== '');
        if (!options.length) return;
        const roster = options.map(legacyOptionKey).sort().join('|');
        if (legacyRoster === roster) return false;
        legacyRoster = roster;
        options.forEach((option) => { option.dataset.mdrWorld = legacyOptionWorld(option); });
        legacySelectFavorite = legacyPrefs.favorites?.[roster] || null;
        legacyAutoSelected = false;
        const groups = [...select.children].filter((child) => child.tagName === 'OPTGROUP');
        legacyPrefs.groupOrder = legacyPrefs.groupOrder || groups.map((group) => group.label);
        legacyPrefs.characterOrder = legacyPrefs.characterOrder || {};
        groups.forEach((group) => {
            const world = group.label || '?';
            if (!legacyPrefs.groupOrder.includes(world)) legacyPrefs.groupOrder.push(world);
            if (!legacyPrefs.characterOrder[world]) {
                legacyPrefs.characterOrder[world] = [...group.children].filter((option) => option.value !== '').map(legacyOptionKey);
            }
        });
        // Migruj kolejność zapisaną przez wcześniejsze wydania do osobnych list światów i postaci.
        if (Array.isArray(legacyPrefs.order) && legacyPrefs.order.length) {
            const flat = legacyPrefs.order;
            const rank = (group) => Math.min(...[...group.children].filter((option) => option.value !== '').map((option) => {
                const index = flat.indexOf(legacyOptionKey(option));
                return index < 0 ? MAXI : index;
            }));
            groups.sort((a, b) => rank(a) - rank(b));
            legacyPrefs.groupOrder = groups.map((group) => group.label || '?');
            groups.forEach((group) => {
                const world = group.label || '?';
                const keys = [...group.children].filter((option) => option.value !== '').map(legacyOptionKey);
                const migrated = flat.filter((key) => keys.includes(key));
                if (migrated.length) legacyPrefs.characterOrder[world] = migrated.concat(keys.filter((key) => !migrated.includes(key)));
            });
            delete legacyPrefs.order;
        }
        saveLegacy();
        return true;
    }

    const legacySortOptions = (options) => {
        if (legacySort === 'default') return;
        options.sort((a, b) => {
            if (legacySort === 'level-asc' || legacySort === 'level-desc') {
                const al = legacyOptionLevel(a), bl = legacyOptionLevel(b);
                if (Number.isNaN(al) !== Number.isNaN(bl)) return Number.isNaN(al) ? 1 : -1;
                if (!Number.isNaN(al) && al !== bl) return legacySort === 'level-asc' ? al - bl : bl - al;
            } else {
                const byName = a.textContent.localeCompare(b.textContent, 'pl', { sensitivity: 'base' });
                if (byName) return legacySort === 'name-asc' ? byName : -byName;
            }
            return 0;
        });
    };

    function applyLegacyOrder(select) {
        const selected = select.selectedOptions[0];
        const groups = [...select.children].filter((child) => child.tagName === 'OPTGROUP');
        const loose = [...select.children].filter((child) => child.tagName === 'OPTION' && child.value !== '');
        if (groups.length) {
            groups.sort((a, b) => {
                const ai = legacyPrefs.groupOrder.indexOf(a.label || '?');
                const bi = legacyPrefs.groupOrder.indexOf(b.label || '?');
                return (ai < 0 ? MAXI : ai) - (bi < 0 ? MAXI : bi);
            });
            groups.forEach((group) => {
                const world = group.label || '?';
                const options = [...group.children].filter((option) => option.value !== '');
                if (legacySort === 'default') {
                    const order = legacyPrefs.characterOrder[world] || [];
                    options.sort((a, b) => {
                        const ai = order.indexOf(legacyOptionKey(a)), bi = order.indexOf(legacyOptionKey(b));
                        return (ai < 0 ? MAXI : ai) - (bi < 0 ? MAXI : bi);
                    });
                } else legacySortOptions(options);
                options.forEach((option) => group.appendChild(option));
                select.appendChild(group);
            });
        } else if (loose.length) {
            if (legacySort === 'default') {
                const order = legacyPrefs.characterOrder['?'] || [];
                loose.sort((a, b) => order.indexOf(legacyOptionKey(a)) - order.indexOf(legacyOptionKey(b)));
            } else legacySortOptions(loose);
            loose.forEach((option) => select.appendChild(option));
        }
        if (selected) select.selectedIndex = [...select.options].indexOf(selected);
        saveLegacy();
    }

    function legacyGroups(select) {
        const groups = [...select.children].filter((child) => child.tagName === 'OPTGROUP');
        return groups.length ? groups : [{ label: 'Postacie', _loose: true, children: [...select.children].filter((child) => child.tagName === 'OPTION' && child.value !== '') }];
    }

    function reorderLegacyGroup(select, world, targetIndex) {
        const groupOrder = legacyPrefs.groupOrder || (legacyPrefs.groupOrder = legacyGroups(select).map((group) => group.label || '?'));
        const from = groupOrder.indexOf(world);
        if (from < 0 || targetIndex < 0 || targetIndex >= groupOrder.length || from === targetIndex) return;
        groupOrder.splice(from, 1);
        groupOrder.splice(targetIndex, 0, world);
        applyLegacyOrder(select);
        renderLegacyDialog(select);
    }

    function reorderLegacyCharacter(select, world, key, targetIndex) {
        const group = legacyGroups(select).find((item) => (item.label || '?') === world);
        if (!group) return;
        const options = group._loose ? group.children : [...group.children].filter((option) => option.value !== '');
        let order;
        if (legacySort === 'default') order = (legacyPrefs.characterOrder[world] || (legacyPrefs.characterOrder[world] = options.map(legacyOptionKey))).slice();
        else { order = options.slice(); legacySortOptions(order); order = order.map(legacyOptionKey); }
        const from = order.indexOf(key);
        if (from < 0 || targetIndex < 0 || targetIndex >= order.length || from === targetIndex) return;
        order.splice(from, 1);
        order.splice(targetIndex, 0, key);
        legacySort = 'default';
        applyLegacyOrder(select);
        renderLegacyDialog(select);
    }

    function legacyButton(label, title, onClick) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label; button.title = title;
        button.className = 'mdr-legacy-button'; button.addEventListener('click', onClick);
        return button;
    }

    function renderLegacyDialog(select) {
        if (!legacyDialog) return;
        const list = legacyDialog.querySelector('.mdr-legacy-list');
        list.replaceChildren();
        const sort = legacyDialog.querySelector('.mdr-legacy-sort');
        sort.value = legacySort;
        const groups = legacyGroups(select);
        const groupOrder = legacyPrefs.groupOrder || (legacyPrefs.groupOrder = groups.map((group) => group.label || '?'));
        groups.sort((a, b) => groupOrder.indexOf(a.label || '?') - groupOrder.indexOf(b.label || '?'));
        groups.forEach((group, groupIndex) => {
            const world = group.label || '?';
            const options = group._loose ? group.children.slice() : [...group.children].filter((option) => option.value !== '');
            const order = legacyPrefs.characterOrder[world] || (legacyPrefs.characterOrder[world] = options.map(legacyOptionKey));
            options.sort((a, b) => legacySort === 'default'
                ? (() => { const ai = order.indexOf(legacyOptionKey(a)), bi = order.indexOf(legacyOptionKey(b)); return (ai < 0 ? MAXI : ai) - (bi < 0 ? MAXI : bi); })()
                : 0);
            if (legacySort !== 'default') legacySortOptions(options);
            const section = document.createElement('section'); section.className = 'mdr-legacy-world';
            const heading = document.createElement('div'); heading.className = 'mdr-legacy-world-head';
            const title = document.createElement('strong'); title.textContent = world;
            const groupControls = document.createElement('span'); groupControls.className = 'mdr-legacy-actions';
            groupControls.append(
                legacyButton('↑', 'Przesuń świat wyżej', () => reorderLegacyGroup(select, world, groupIndex - 1)),
                legacyButton('↓', 'Przesuń świat niżej', () => reorderLegacyGroup(select, world, groupIndex + 1))
            );
            heading.append(title, groupControls); heading.draggable = true; heading.dataset.world = world;
            heading.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/mdr-world', world); event.dataTransfer.effectAllowed = 'move'; });
            heading.addEventListener('dragover', (event) => { if (event.dataTransfer.types.includes('text/mdr-world')) event.preventDefault(); });
            heading.addEventListener('drop', (event) => {
                const source = event.dataTransfer.getData('text/mdr-world');
                if (!source || source === world) return;
                event.preventDefault();
                const current = [...groupOrder]; const from = current.indexOf(source), to = current.indexOf(world);
                if (from >= 0 && to >= 0) { current.splice(from, 1); current.splice(to, 0, source); legacyPrefs.groupOrder = current; applyLegacyOrder(select); renderLegacyDialog(select); }
            });
            section.appendChild(heading);
            const chars = document.createElement('div'); chars.className = 'mdr-legacy-characters';
            options.forEach((option, index) => {
                const key = legacyOptionKey(option);
                const row = document.createElement('div'); row.className = 'mdr-legacy-character'; row.draggable = true;
                row.classList.toggle('is-hidden', legacyHidden.has(key));
                const text = document.createElement('button'); text.type = 'button'; text.className = 'mdr-legacy-select';
                text.textContent = option.textContent.trim(); text.title = 'Wybierz tę postać na natywnej liście';
                text.addEventListener('click', () => { select.selectedIndex = [...select.options].indexOf(option); select.dispatchEvent(new Event('change', { bubbles: true })); });
                const actions = document.createElement('span'); actions.className = 'mdr-legacy-actions';
                const favorite = legacyButton(legacySelectFavorite === key ? '★' : '☆', 'Ustaw lub usuń ulubioną postać', () => {
                    legacySelectFavorite = legacySelectFavorite === key ? null : key; saveLegacy(); renderLegacyDialog(select);
                });
                const hide = legacyButton(legacyHidden.has(key) ? '↺' : '×', legacyHidden.has(key) ? 'Odkryj postać' : 'Ukryj postać', () => {
                    if (legacyHidden.has(key)) legacyHidden.delete(key); else legacyHidden.add(key);
                    applyLegacyHidden(select); saveLegacy(); renderLegacyDialog(select);
                });
                actions.append(
                    legacyButton('↑', 'Przesuń postać wyżej w tym świecie', () => reorderLegacyCharacter(select, world, key, index - 1)),
                    legacyButton('↓', 'Przesuń postać niżej w tym świecie', () => reorderLegacyCharacter(select, world, key, index + 1)),
                    favorite, hide
                );
                row.append(text, actions); row.dataset.world = world; row.dataset.key = key;
                row.addEventListener('dragstart', (event) => {
                    event.dataTransfer.setData('text/mdr-character', JSON.stringify({ world, key }));
                    event.dataTransfer.effectAllowed = 'move';
                });
                row.addEventListener('dragover', (event) => { if (event.dataTransfer.types.includes('text/mdr-character')) event.preventDefault(); });
                row.addEventListener('drop', (event) => {
                    let source; try { source = JSON.parse(event.dataTransfer.getData('text/mdr-character')); } catch (_) { return; }
                    if (!source || source.world !== world || source.key === key) return;
                    event.preventDefault();
                    const keys = (legacySort === 'default' ? (legacyPrefs.characterOrder[world] || options.map(legacyOptionKey)) : options.map(legacyOptionKey)).slice();
                    const from = keys.indexOf(source.key), to = keys.indexOf(key);
                    if (from >= 0 && to >= 0) { keys.splice(from, 1); keys.splice(to, 0, source.key); legacyPrefs.characterOrder[world] = keys; legacySort = 'default'; applyLegacyOrder(select); renderLegacyDialog(select); }
                });
                chars.appendChild(row);
            });
            section.appendChild(chars); list.appendChild(section);
        });
    }

    function ensureLegacyPanel(select) {
        legacySelect = select;
        const host = select.parentElement;
        host.querySelectorAll(':scope > .mdr-legacy-gear, :scope > .mdr-legacy-panel').forEach((node) => node.remove());
        let configButton = document.querySelector('.mdr-legacy-config');
        if (!configButton) {
            const configLink = [...document.querySelectorAll('a[href]')].find((link) => {
                try { return new URL(link.href, location.href).pathname.replace(/\/$/, '') === '/config'; }
                catch (_) { return false; }
            });
            if (configLink) {
                const parent = configLink.parentElement?.tagName === 'LI' ? configLink.parentElement : null;
                const item = parent ? parent.cloneNode(true) : null;
                configButton = item ? item.querySelector('a') : configLink.cloneNode(false);
                configButton.classList.add('mdr-legacy-config');
                configButton.href = '#';
                configButton.textContent = 'Konfiguracja logowania';
                configButton.removeAttribute('target');
                configButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    legacyDialogOpen = !legacyDialogOpen;
                    legacyDialog.hidden = !legacyDialogOpen;
                    if (legacyDialogOpen) renderLegacyDialog(legacySelect);
                });
                if (item) configLink.parentElement.insertAdjacentElement('afterend', item);
                else configLink.insertAdjacentElement('afterend', configButton);
            }
        }
        if (!legacyDialog) {
            const style = document.createElement('style');
            style.textContent = `
                .mdr-legacy-dialog[hidden]{display:none!important}.mdr-legacy-dialog{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.74);font:14px Arial,sans-serif;color:#f4e4bf}
                .mdr-legacy-box{width:min(720px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#302015;border:2px solid #9c7445;border-radius:9px;box-shadow:0 14px 50px #000;padding:16px;box-sizing:border-box}
                .mdr-legacy-top{display:flex;align-items:center;gap:12px;border-bottom:1px solid #8e6b43;padding-bottom:12px}.mdr-legacy-top h2{margin:0 auto 0 0;color:#ffe7a0;font-size:20px}
                .mdr-legacy-sort{padding:6px;max-width:210px}.mdr-legacy-list{overflow:auto;padding:12px 4px;display:flex;flex-direction:column;gap:10px}
                .mdr-legacy-world{border:1px solid #76542f;border-radius:6px;background:rgba(255,230,180,.06);padding:8px}.mdr-legacy-world-head{display:flex;align-items:center;justify-content:space-between;padding:2px 3px 7px;border-bottom:1px solid #65472c;cursor:grab;color:#ffe7a0;font-size:16px}
                .mdr-legacy-characters{display:flex;flex-direction:column;gap:4px;padding-top:6px}.mdr-legacy-character{display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 5px;background:rgba(0,0,0,.2);border-radius:4px;cursor:grab}.mdr-legacy-character.is-hidden{opacity:.48}
                .mdr-legacy-select{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;border:0;color:inherit;cursor:pointer;font:inherit}.mdr-legacy-actions{display:flex;gap:3px;flex-shrink:0}
                .mdr-legacy-button{min-width:29px;min-height:27px;cursor:pointer;color:#ffe7a0;background:linear-gradient(#8a4c28,#542817);border:1px solid #654326;border-radius:4px;font:13px Arial,sans-serif}
                .mdr-legacy-bottom{display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #8e6b43;padding-top:11px}.mdr-legacy-bottom button{padding:7px 11px}
                @media(max-width:520px){.mdr-legacy-box{padding:10px}.mdr-legacy-top{flex-wrap:wrap}.mdr-legacy-top h2{width:70%}.mdr-legacy-character{align-items:flex-start}.mdr-legacy-actions{flex-wrap:wrap;justify-content:flex-end;max-width:128px}}
            `;
            document.head.appendChild(style);
            legacyDialog = document.createElement('div'); legacyDialog.className = 'mdr-legacy-dialog'; legacyDialog.hidden = true;
            const box = document.createElement('div'); box.className = 'mdr-legacy-box';
            box.innerHTML = '<div class="mdr-legacy-top"><h2>Ustawienia postaci</h2><label>Sortuj w światach <select class="mdr-legacy-sort"><option value="default">Kolejność własna</option><option value="name-asc">Nazwa A–Z</option><option value="name-desc">Nazwa Z–A</option><option value="level-asc">Poziom rosnąco</option><option value="level-desc">Poziom malejąco</option></select></label><button type="button" class="mdr-legacy-button mdr-legacy-close" aria-label="Zamknij">✕</button></div><div class="mdr-legacy-list"></div><div class="mdr-legacy-bottom"><button type="button" class="mdr-legacy-button mdr-legacy-hidden"></button><button type="button" class="mdr-legacy-button mdr-legacy-restore">Odkryj wszystkie</button><button type="button" class="mdr-legacy-button mdr-legacy-reset">Resetuj kolejność</button></div>';
            legacyDialog.appendChild(box); document.body.appendChild(legacyDialog);
            legacyDialog.querySelector('.mdr-legacy-hidden').textContent = 'Pokaż ukryte';
            legacyDialog.querySelector('.mdr-legacy-close').addEventListener('click', () => { legacyDialogOpen = false; legacyDialog.hidden = true; });
            legacyDialog.addEventListener('click', (event) => { if (event.target === legacyDialog) { legacyDialogOpen = false; legacyDialog.hidden = true; } });
            legacyDialog.querySelector('.mdr-legacy-sort').addEventListener('change', (event) => { legacySort = event.target.value; applyLegacyOrder(select); renderLegacyDialog(select); });
            legacyDialog.querySelector('.mdr-legacy-hidden').addEventListener('click', (event) => {
                legacyShowHidden = !legacyShowHidden; applyLegacyHidden(select);
                event.currentTarget.textContent = legacyShowHidden ? 'Schowaj ukryte' : 'Pokaż ukryte';
                renderLegacyDialog(select);
            });
            legacyDialog.querySelector('.mdr-legacy-restore').addEventListener('click', () => {
                legacyHidden.clear(); legacyShowHidden = false; applyLegacyHidden(select); saveLegacy(); renderLegacyDialog(select);
                legacyDialog.querySelector('.mdr-legacy-hidden').textContent = 'Pokaż ukryte';
            });
            legacyDialog.querySelector('.mdr-legacy-reset').addEventListener('click', () => {
                legacyPrefs.groupOrder = legacyGroups(select).map((group) => group.label || '?');
                legacyPrefs.characterOrder = {};
                legacyGroups(select).forEach((group) => { const world = group.label || '?'; legacyPrefs.characterOrder[world] = (group._loose ? group.children : [...group.children]).filter((option) => option.value !== '').map(legacyOptionKey); });
                legacySort = 'default'; applyLegacyOrder(select); renderLegacyDialog(select);
            });
            document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && legacyDialogOpen) { legacyDialogOpen = false; legacyDialog.hidden = true; } });
        }
        legacySelect = select;
        return configButton;
    }

    function applyLegacyHidden(select) {
        let selectedWasHidden = false;
        [...select.options].forEach((option) => {
            const hidden = legacyHidden.has(legacyOptionKey(option));
            option.hidden = hidden && !legacyShowHidden;
            if (hidden && option.selected && !legacyShowHidden) selectedWasHidden = true;
        });
        [...select.children].filter((child) => child.tagName === 'OPTGROUP').forEach((group) => {
            const options = [...group.children].filter((child) => child.tagName === 'OPTION' && child.value !== '');
            group.hidden = !legacyShowHidden && (options.length === 0 || options.every((option) => option.hidden));
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
        const rosterChanged = bindLegacyRoster(select);
        ensureLegacyPanel(select);
        if (rosterChanged || !select.dataset.mdrOrdered) {
            applyLegacyOrder(select);
            select.dataset.mdrOrdered = '1';
        }
        applyLegacyHidden(select);
        if (legacySelectFavorite && !legacyAutoSelected) {
            const favorite = [...select.options].find((option) => legacyOptionKey(option) === legacySelectFavorite);
            if (favorite && !legacyHidden.has(legacySelectFavorite)) {
                legacyAutoSelected = true;
                select.selectedIndex = [...select.options].indexOf(favorite);
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        if (legacyDialogOpen) renderLegacyDialog(select);
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
