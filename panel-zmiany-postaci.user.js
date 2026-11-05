// ==UserScript==
// @name         Margonem – panel zmiany postaci
// @namespace    margonem.postacie.layout
// @version      1.27
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

    const preferences = {
        custom: GM_getValue('custom', false),   // Whether to apply the saved custom order.
        group: GM_getValue('group', false),     // Whether to group characters by world.
        order: GM_getValue('order', []),        // Character IDs in the saved order.
        sort: GM_getValue('sort', null),        // Selected sorting option as {value, text}.
        hidden: GM_getValue('hidden', []),      // Hidden character IDs.
        def: null                               // Favorite character of the active roster.
    };
    const favoritesByRoster = GM_getValue('favoritesByRoster', {});
    const pinnedByRoster = GM_getValue('pinnedByRoster', {});
    const legacyFavorite = GM_getValue('def', null);
    let activeRoster = null;
    let pinnedCharacters = [];
    let showHidden = false;                     // Temporary preview of hidden characters.
    const save = () => {
        GM_setValue('hidden', preferences.hidden);
        GM_setValue('custom', preferences.custom);
        GM_setValue('group', preferences.group);
        GM_setValue('order', preferences.order);
        GM_setValue('sort', preferences.sort);
        if (activeRoster) {
            if (preferences.def) favoritesByRoster[activeRoster] = preferences.def;
            else favoritesByRoster[activeRoster] = null;
            GM_setValue('favoritesByRoster', favoritesByRoster);
            pinnedByRoster[activeRoster] = pinnedCharacters;
            GM_setValue('pinnedByRoster', pinnedByRoster);
        }
    };

    const TILE = '.charc[data-id]';
    const LAST_POSITION = Number.MAX_SAFE_INTEGER;
    const pinStyle = document.createElement('style');
    pinStyle.textContent = `
        .mdr-panel [hidden] {
            display: none !important;
        }
        .mdr-panel > .mdr-actions {
            display: flex !important;
            flex-direction: row !important;
            flex: 0 0 auto;
            flex-wrap: wrap;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
            width: max-content;
            max-width: calc(100vw - 80px);
            box-sizing: border-box;
        }
        .mdr-panel > .mdr-actions > button {
            flex: 0 0 auto !important;
            width: auto !important;
            margin: 0 !important;
        }
        .mdr-tile-tooltip {
            position: fixed;
            z-index: 2147483647;
            max-width: calc(100vw - 16px);
            padding: 6px 9px;
            border: 1px solid #a68a58;
            border-radius: 4px;
            background: #20190f;
            color: #ffe8b3;
            font: 12px/1.4 Arial, sans-serif;
            pointer-events: none;
            box-sizing: border-box;
        }
        .mdr-tile-tooltip[hidden] { display: none !important; }

        .mdr-login-actions {
            display:flex;
            align-items:center;
            justify-content:center;
            gap:12px;
            flex-wrap:wrap;
            width:100%;
            box-sizing:border-box;
        }
        .mdr-login-actions>.enter-game,.mdr-login-actions>.mdr-login-as {
            margin:0!important;
        }
        .mdr-quick-login {
            display:grid;
            grid-template-columns:repeat(3,minmax(0,1fr));
            justify-content:center;
            align-content:center;
            gap:6px;
            margin:16px auto 0;
            padding:0 3px;
            position:relative;
            transform:translateY(var(--mdr-quick-offset,0px));
            max-width:390px;
            width:100%;
            box-sizing:border-box;
        }
        .mdr-quick-login[data-count="1"]>.mdr-quick-character {
            grid-column:2;
        }
        .mdr-quick-login[data-count="2"] {
            grid-template-columns:repeat(6,minmax(0,1fr));
            column-gap:3px;
        }
        .mdr-quick-login[data-count="2"]>.mdr-quick-character:first-child {
            grid-column:2 / span 2;
        }
        .mdr-quick-login[data-count="2"]>.mdr-quick-character:last-child {
            grid-column:4 / span 2;
        }
        .mdr-quick-login[hidden] {
            display:none!important;
        }
        .mdr-quick-character {
            display:flex;
            align-items:center;
            gap:5px;
            width:100%;
            min-width:0;
            height:34px;
            min-height:34px;
            padding:2px 5px;
            border:1px solid rgba(235,215,170,.45);
            border-radius:5px;
            background:transparent;
            color:inherit;
            text-align:left;
            cursor:pointer;
            transition:border-color .15s,box-shadow .15s;
            box-sizing:border-box;
        }
        .mdr-quick-character:hover,.mdr-quick-character:focus-visible {
            border-color:#ffe08a;
            box-shadow:0 0 0 1px rgba(255,224,138,.5);
            outline:none;
        }
        .mdr-pin-portrait-wrap {
            display:flex;
            align-items:flex-start;
            justify-content:center;
            flex:0 0 30px;
            width:30px;
            height:28px;
            overflow:hidden;
        }
        .mdr-pin-portrait {
            display:block;
            width:30px;
            height:44px;
            object-fit:contain;
            object-position:top center;
        }
        .mdr-quick-label {
            display:flex;
            flex-direction:column;
            min-width:0;
            line-height:1.2;
        }
        .mdr-quick-label strong,.mdr-quick-label small {
            max-width:80px;
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
        }
        .mdr-quick-label strong {
            font-size:11px;
        }
        .mdr-quick-label small {
            font-size:9px;
            opacity:.8;
        }
        .mdr-deputy-time {
            position:static!important;
            display:block!important;
            width:100%;
            max-width:100%!important;
            margin:0!important;
            text-align:left!important;
            font-size:13px!important;
            line-height:1.25!important;
            white-space:normal!important;
            box-sizing:border-box;
        }
        .mdr-time-label {
            text-align:left!important;
        }
        .mdr-time-label .substitution-time {
            position:static!important;
            inset:auto!important;
            transform:none!important;
            margin:0!important;
            text-align:left!important;
            display:block!important;
        }
        .mdr-time-label .substitution-time strong {
            position:static!important;
            display:inline!important;
            margin:0!important;
        }
        .mdr-deputy-time-slot {
            display:block;
            flex:0 0 auto;
            width:100%;
        }
        @media(max-width:520px) {
            .mdr-login-actions {
                gap:7px;
            }
            .mdr-quick-login {
                gap:5px;
            }
            .mdr-quick-character {
                gap:3px;
                padding-inline:3px;
            }
            .mdr-pin-portrait-wrap,.mdr-pin-portrait {
                width:26px;
            }
            .mdr-pin-portrait-wrap {
                flex-basis:26px;
            }
            .mdr-quick-label strong {
                font-size:10px;
            }
            .mdr-quick-label small {
                font-size:8px;
            }
        }
    `;
    document.head.appendChild(pinStyle);
    let dragged = null;
    let groupHost = null;
    let timer = null;
    let favoriteAutoSelected = false;

    // The classic theme uses a native select instead of character tiles.
    // Keep its preferences separate from the modern panel.
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
        // Migrate older flat ordering into world and character lists.
        if (Array.isArray(legacyPrefs.order) && legacyPrefs.order.length) {
            const flat = legacyPrefs.order;
            const rank = (group) => Math.min(...[...group.children].filter((option) => option.value !== '').map((option) => {
                const index = flat.indexOf(legacyOptionKey(option));
                return index < 0 ? LAST_POSITION : index;
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

    function savedPosition(order, key) {
        const index = order.indexOf(key);
        return index < 0 ? LAST_POSITION : index;
    }

    function applyLegacyOrder(select) {
        const selected = select.selectedOptions[0];
        const groups = [...select.children].filter((child) => child.tagName === 'OPTGROUP');
        const loose = [...select.children].filter((child) => child.tagName === 'OPTION' && child.value !== '');
        if (groups.length) {
            groups.sort((a, b) => {
                return savedPosition(legacyPrefs.groupOrder, a.label || '?') -
                    savedPosition(legacyPrefs.groupOrder, b.label || '?');
            });
            groups.forEach((group) => {
                const world = group.label || '?';
                const options = [...group.children].filter((option) => option.value !== '');
                if (legacySort === 'default') {
                    const order = legacyPrefs.characterOrder[world] || [];
                    options.sort((a, b) => {
                        return savedPosition(order, legacyOptionKey(a)) -
                            savedPosition(order, legacyOptionKey(b));
                    });
                } else legacySortOptions(options);
                options.forEach((option) => group.appendChild(option));
                select.appendChild(group);
            });
        } else if (loose.length) {
            if (legacySort === 'default') {
                const order = legacyPrefs.characterOrder['Postacie'] || legacyPrefs.characterOrder['?'] || [];
                loose.sort((a, b) => savedPosition(order, legacyOptionKey(a)) -
                    savedPosition(order, legacyOptionKey(b)));
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
        if (legacySort === 'default') {
            order = (legacyPrefs.characterOrder[world] || options.map(legacyOptionKey)).slice();
        } else {
            order = options.slice();
            legacySortOptions(order);
            order = order.map(legacyOptionKey);
        }
        const currentKeys = options.map(legacyOptionKey);
        order = order.filter((item) => currentKeys.includes(item));
        order.push(...currentKeys.filter((item) => !order.includes(item)));
        const from = order.indexOf(key);
        if (from < 0 || targetIndex < 0 || targetIndex >= order.length || from === targetIndex) return;
        order.splice(from, 1);
        order.splice(targetIndex, 0, key);
        legacyPrefs.characterOrder[world] = order;
        legacySort = 'default';
        applyLegacyOrder(select);
        renderLegacyDialog(select);
    }

    function legacyButton(label, title, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.className = 'mdr-legacy-button';
        button.addEventListener('click', onClick);
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
            if (legacySort === 'default') {
                options.sort((a, b) => savedPosition(order, legacyOptionKey(a)) -
                    savedPosition(order, legacyOptionKey(b)));
            } else {
                legacySortOptions(options);
            }
            const section = document.createElement('section');
            section.className = 'mdr-legacy-world';
            const heading = document.createElement('div');
            heading.className = 'mdr-legacy-world-head';
            const title = document.createElement('strong');
            title.textContent = world;
            const groupControls = document.createElement('span');
            groupControls.className = 'mdr-legacy-actions';
            groupControls.append(
                legacyButton('↑', 'Przesuń świat wyżej', () => reorderLegacyGroup(select, world, groupIndex - 1)),
                legacyButton('↓', 'Przesuń świat niżej', () => reorderLegacyGroup(select, world, groupIndex + 1))
            );
            heading.append(title, groupControls);
            heading.draggable = true;
            heading.dataset.world = world;
            heading.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/mdr-world', world); event.dataTransfer.effectAllowed = 'move'; });
            heading.addEventListener('dragover', (event) => { if (event.dataTransfer.types.includes('text/mdr-world')) event.preventDefault(); });
            heading.addEventListener('drop', (event) => {
                const source = event.dataTransfer.getData('text/mdr-world');
                if (!source || source === world) return;
                event.preventDefault();
                const current = [...groupOrder];
                const from = current.indexOf(source), to = current.indexOf(world);
                if (from >= 0 && to >= 0) { current.splice(from, 1); current.splice(to, 0, source); legacyPrefs.groupOrder = current; applyLegacyOrder(select); renderLegacyDialog(select); }
            });
            section.appendChild(heading);
            const chars = document.createElement('div');
            chars.className = 'mdr-legacy-characters';
            options.forEach((option, index) => {
                const key = legacyOptionKey(option);
                const row = document.createElement('div');
                row.className = 'mdr-legacy-character';
                row.draggable = true;
                row.classList.toggle('is-hidden', legacyHidden.has(key));
                const text = document.createElement('button');
                text.type = 'button';
                text.className = 'mdr-legacy-select';
                text.textContent = option.textContent.trim();
                text.title = 'Wybierz tę postać na natywnej liście';
                text.addEventListener('click', () => { select.selectedIndex = [...select.options].indexOf(option); select.dispatchEvent(new Event('change', { bubbles: true })); });
                const actions = document.createElement('span');
                actions.className = 'mdr-legacy-actions';
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
                row.append(text, actions);
                row.dataset.world = world;
                row.dataset.key = key;
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
            section.appendChild(chars);
            list.appendChild(section);
        });
    }

    function ensureLegacyPanel(select) {
        legacySelect = select;
        const host = select.parentElement;
        host.querySelectorAll(':scope > .mdr-legacy-gear, :scope > .mdr-legacy-panel').forEach((node) => node.remove());
        let configButton = document.querySelector('.mdr-legacy-config');
        // Anchor to the Tools section. Invitation banners also link to /config.
        const quickLoadLink = [...document.querySelectorAll('a')].find((link) =>
            /szybsze\s+ładowanie\s+gry/i.test(link.textContent.trim())
        );
        if (quickLoadLink) {
            const quickLoadItem = quickLoadLink.closest('li') || quickLoadLink;
            const currentItem = configButton?.closest('li') || configButton;
            const alreadyInTools = configButton && currentItem.parentElement === quickLoadItem.parentElement && currentItem.nextElementSibling === quickLoadItem;
            if (configButton && !alreadyInTools) {
                // Remove only our misplaced link, preserving the surrounding page content.
                const oldItem = configButton.closest('li');
                configButton.remove();
                if (oldItem && !oldItem.textContent.trim() && !oldItem.querySelector('*')) oldItem.remove();
                configButton = null;
            }
            if (!configButton) {
                const item = quickLoadItem.cloneNode(true);
                // The cloned item must open our dialog, not run the theme's quick loader.
                [item, ...item.querySelectorAll('*')].forEach((element) => {
                    [...element.attributes].filter((attribute) => /^on/i.test(attribute.name))
                        .forEach((attribute) => element.removeAttribute(attribute.name));
                });
                configButton = item.matches('a') ? item : item.querySelector('a');
                if (configButton) {
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
                }
            }
            if (configButton) {
                configButton.textContent = 'Konfiguracja logowania';
                configButton.href = '#';
                configButton.removeAttribute('target');
                const configItem = configButton.closest('li') || configButton;
                if (configItem.parentElement !== quickLoadItem.parentElement) quickLoadItem.parentElement.insertBefore(configItem, quickLoadItem);
            }
        }
        if (!legacyDialog) {
            const style = document.createElement('style');
            style.textContent = `
                .mdr-legacy-config::before {
                    content:"· ";
                }
                .mdr-legacy-dialog[hidden] {
                    display:none!important;
                }
                .mdr-legacy-dialog {
                    position:fixed;
                    inset:0;
                    z-index:2147483000;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    padding:16px;
                    background:rgba(0,0,0,.74);
                    font:14px Arial,sans-serif;
                    color:#f4e4bf;
                }
                .mdr-legacy-box {
                    width:min(720px,96vw);
                    max-height:88vh;
                    display:flex;
                    flex-direction:column;
                    background:#302015;
                    border:2px solid #9c7445;
                    border-radius:9px;
                    box-shadow:0 14px 50px #000;
                    padding:16px;
                    box-sizing:border-box;
                }
                .mdr-legacy-top {
                    display:flex;
                    align-items:center;
                    gap:12px;
                    border-bottom:1px solid #8e6b43;
                    padding-bottom:12px;
                }
                .mdr-legacy-top h2 {
                    margin:0 auto 0 0;
                    color:#ffe7a0;
                    font-size:20px;
                }
                .mdr-legacy-sort {
                    padding:6px;
                    max-width:210px;
                }
                .mdr-legacy-list {
                    overflow:auto;
                    padding:12px 4px;
                    display:flex;
                    flex-direction:column;
                    gap:10px;
                }
                .mdr-legacy-world {
                    border:1px solid #76542f;
                    border-radius:6px;
                    background:rgba(255,230,180,.06);
                    padding:8px;
                }
                .mdr-legacy-world-head {
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    padding:2px 3px 7px;
                    border-bottom:1px solid #65472c;
                    cursor:grab;
                    color:#ffe7a0;
                    font-size:16px;
                }
                .mdr-legacy-characters {
                    display:flex;
                    flex-direction:column;
                    gap:4px;
                    padding-top:6px;
                }
                .mdr-legacy-character {
                    display:flex;
                    align-items:center;
                    gap:8px;
                    min-height:34px;
                    padding:4px 5px;
                    background:rgba(0,0,0,.2);
                    border-radius:4px;
                    cursor:grab;
                }
                .mdr-legacy-character.is-hidden {
                    opacity:.48;
                }
                .mdr-legacy-select {
                    flex:1;
                    min-width:0;
                    text-align:left;
                    overflow:hidden;
                    text-overflow:ellipsis;
                    white-space:nowrap;
                    background:none;
                    border:0;
                    color:inherit;
                    cursor:pointer;
                    font:inherit;
                }
                .mdr-legacy-actions {
                    display:flex;
                    gap:3px;
                    flex-shrink:0;
                }
                .mdr-legacy-button {
                    min-width:29px;
                    min-height:27px;
                    cursor:pointer;
                    color:#ffe7a0;
                    background:linear-gradient(#8a4c28,#542817);
                    border:1px solid #654326;
                    border-radius:4px;
                    font:13px Arial,sans-serif;
                }
                .mdr-legacy-bottom {
                    display:flex;
                    gap:8px;
                    justify-content:flex-end;
                    border-top:1px solid #8e6b43;
                    padding-top:11px;
                }
                .mdr-legacy-bottom button {
                    padding:7px 11px;
                }
                @media(max-width:520px) {
                    .mdr-legacy-box {
                        padding:10px;
                    }
                    .mdr-legacy-top {
                        flex-wrap:wrap;
                    }
                    .mdr-legacy-top h2 {
                        width:70%;
                    }
                    .mdr-legacy-character {
                        align-items:flex-start;
                    }
                    .mdr-legacy-actions {
                        flex-wrap:wrap;
                        justify-content:flex-end;
                        max-width:128px;
                    }
                }
            `;
            document.head.appendChild(style);
            legacyDialog = document.createElement('div');
            legacyDialog.className = 'mdr-legacy-dialog';
            legacyDialog.hidden = true;
            const box = document.createElement('div');
            box.className = 'mdr-legacy-box';
            box.innerHTML = '<div class="mdr-legacy-top"><h2>Ustawienia postaci</h2><label>Sortuj w światach <select class="mdr-legacy-sort"><option value="default">Kolejność własna</option><option value="name-asc">Nazwa A–Z</option><option value="name-desc">Nazwa Z–A</option><option value="level-asc">Poziom rosnąco</option><option value="level-desc">Poziom malejąco</option></select></label><button type="button" class="mdr-legacy-button mdr-legacy-close" aria-label="Zamknij">✕</button></div><div class="mdr-legacy-list"></div><div class="mdr-legacy-bottom"><button type="button" class="mdr-legacy-button mdr-legacy-hidden"></button><button type="button" class="mdr-legacy-button mdr-legacy-restore">Odkryj wszystkie</button><button type="button" class="mdr-legacy-button mdr-legacy-reset">Resetuj kolejność</button></div>';
            legacyDialog.appendChild(box);
            document.body.appendChild(legacyDialog);
            legacyDialog.querySelector('.mdr-legacy-hidden').textContent = 'Pokaż ukryte';
            legacyDialog.querySelector('.mdr-legacy-close').addEventListener('click', () => { legacyDialogOpen = false; legacyDialog.hidden = true; });
            legacyDialog.addEventListener('click', (event) => { if (event.target === legacyDialog) { legacyDialogOpen = false; legacyDialog.hidden = true; } });
            legacyDialog.querySelector('.mdr-legacy-sort').addEventListener('change', (event) => { legacySort = event.target.value; applyLegacyOrder(legacySelect); renderLegacyDialog(legacySelect); });
            legacyDialog.querySelector('.mdr-legacy-hidden').addEventListener('click', (event) => {
                legacyShowHidden = !legacyShowHidden; applyLegacyHidden(legacySelect);
                event.currentTarget.textContent = legacyShowHidden ? 'Schowaj ukryte' : 'Pokaż ukryte';
                renderLegacyDialog(legacySelect);
            });
            legacyDialog.querySelector('.mdr-legacy-restore').addEventListener('click', () => {
                legacyHidden.clear(); legacyShowHidden = false; applyLegacyHidden(legacySelect); saveLegacy(); renderLegacyDialog(legacySelect);
                legacyDialog.querySelector('.mdr-legacy-hidden').textContent = 'Pokaż ukryte';
            });
            legacyDialog.querySelector('.mdr-legacy-reset').addEventListener('click', () => {
                legacyPrefs.groupOrder = legacyGroups(legacySelect).map((group) => group.label || '?');
                legacyPrefs.characterOrder = {};
                legacyGroups(legacySelect).forEach((group) => { const world = group.label || '?'; legacyPrefs.characterOrder[world] = (group._loose ? group.children : [...group.children]).filter((option) => option.value !== '').map(legacyOptionKey); });
                legacySort = 'default'; applyLegacyOrder(legacySelect); renderLegacyDialog(legacySelect);
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
        const i = preferences.order.indexOf(t.dataset.id);
        return i === -1 ? LAST_POSITION : i;
    };
    const byOrder = (a, b) => orderIdx(a) - orderIdx(b);
    const worldOf = (t) => {
        const inp = t.querySelector('input[name="world"]');
        return (inp && inp.value) || t.dataset.world || '?';
    };

    // Reorder tiles within their existing DOM slots.
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

    function commonAncestor(nodes) {
        let a = nodes[0];
        while (a && !nodes.every((n) => a.contains(n))) a = a.parentElement;
        return a;
    }

    // Options panel
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
            'display:inline-flex!important;float:none!important;clear:none!important;flex:0 0 auto!important;width:auto!important;cursor:pointer;white-space:nowrap;margin:0!important;min-height:32px;padding:5px 12px;font-size:13px;' +
            'border:1px solid rgba(0,0,0,.45);border-radius:4px;background:rgba(255,255,255,.55);color:#000;';
        panel.innerHTML =
            '<label style="' + lbl + '"><input type="checkbox" class="mdr-custom" style="' + chk + '"><span>Własna kolejność</span></label>' +
            '<label style="' + lbl + '"><input type="checkbox" class="mdr-group" style="' + chk + '"><span>Rozdziel wg światów</span></label>' +
            '<div class="mdr-actions" style="display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;flex:0 0 auto!important;width:max-content!important;max-width:none!important;min-width:max-content!important">' +
            '<button type="button" class="mdr-show" style="' + btnCss + '"></button>' +
            '<button type="button" class="mdr-restore-all" style="' + btnCss + '">Odkryj wszystkie</button>' +
            '<button type="button" class="mdr-reset" style="' + btnCss + '">Resetuj kolejność</button>' +
            '<button type="button" class="mdr-unpin-all" style="' + btnCss + '">Odepnij wszystkie</button>' +
            '</div>';
        holder.insertAdjacentElement('afterend', panel);
        panel.querySelector('.mdr-show').addEventListener('click', () => {
            showHidden = !showHidden;
            refresh();
        });
        panel.querySelector('.mdr-restore-all').addEventListener('click', () => {
            preferences.hidden = [];
            showHidden = false;
            save();
            refresh();
        });

        panel.querySelector('.mdr-unpin-all').addEventListener('click', () => {
            if (!activeRoster) return;
            pinnedCharacters = [];
            save();
            renderPinnedCharacters([...document.querySelectorAll(TILE)]);
            updatePinnedButtons();
        });

        const cCustom = panel.querySelector('.mdr-custom');
        const cGroup = panel.querySelector('.mdr-group');
        cCustom.checked = preferences.custom;
        cGroup.checked = preferences.group;
        cCustom.addEventListener('change', () => { preferences.custom = cCustom.checked; save(); refresh(); });
        cGroup.addEventListener('change', () => { preferences.group = cGroup.checked; save(); refresh(); });
        panel.querySelector('.mdr-reset').addEventListener('click', () => {
            preferences.order = [];
            preferences.custom = false;
            cCustom.checked = false; save();
            // Ask the page to reapply its native sorting.
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            refresh();
        });
    }

    // Persist native sorting
    function handleSort(sel) {
        if (sel.dataset.mdrInit) return false;
        sel.dataset.mdrInit = '1';
        sel.addEventListener('change', (e) => {
            if (!e.isTrusted) return;
            const o = sel.options[sel.selectedIndex];
            preferences.sort = { value: sel.value, text: o ? o.textContent.trim() : '' };
            save();
        });
        if (!preferences.sort) return false;
        let changed = false;
        if (sel.value !== preferences.sort.value) {
            sel.value = preferences.sort.value;
            if (sel.value !== preferences.sort.value) {
                const o = [...sel.options].find((x) => x.textContent.trim() === preferences.sort.text);
                if (o) sel.value = o.value;
            }
            changed = true;
        }
        if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
        return changed;
    }

    // Drag and drop
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
            preferences.order = ids.concat(preferences.order.filter((id) => !ids.includes(id)));
            preferences.custom = true;
            const cb = document.querySelector('.mdr-custom');
            if (cb) cb.checked = true;
            save();
        });
    }

    let tileTooltip = null;

    function setTileTooltip(button, text) {
        button.dataset.mdrTooltip = text;
        button.setAttribute('aria-label', text);
        button.removeAttribute('title');
        if (button._mdrTooltipBound) return;
        button._mdrTooltipBound = true;
        const hide = () => { if (tileTooltip) tileTooltip.hidden = true; };
        const show = () => {
            if (!tileTooltip) {
                tileTooltip = document.createElement('div');
                tileTooltip.className = 'mdr-tile-tooltip';
                tileTooltip.setAttribute('role', 'tooltip');
                document.body.appendChild(tileTooltip);
            }
            tileTooltip.textContent = button.dataset.mdrTooltip;
            tileTooltip.hidden = false;
            const anchor = button.getBoundingClientRect();
            const tooltip = tileTooltip.getBoundingClientRect();
            const left = Math.max(8, Math.min(anchor.right - tooltip.width,
                window.innerWidth - tooltip.width - 8));
            const top = anchor.top >= tooltip.height + 8
                ? anchor.top - tooltip.height - 6
                : anchor.bottom + 6;
            tileTooltip.style.left = `${left}px`;
            tileTooltip.style.top = `${top}px`;
        };
        button.addEventListener('mouseenter', show);
        button.addEventListener('mouseleave', hide);
        button.addEventListener('focus', show);
        button.addEventListener('blur', hide);
        button.addEventListener('click', hide);
    }
    window.addEventListener('scroll', () => {
        if (tileTooltip) tileTooltip.hidden = true;
    }, true);

    // Character visibility
    function attachHideBtn(t) {
        if (t._mdrBtn) return;
        const b = document.createElement('span');
        b.className = 'mdr-hide';
        b.style.cssText =
            'position:absolute;top:2px;right:2px;z-index:5;width:20px;height:20px;line-height:20px;' +
            'text-align:center;font-size:12px;font-weight:bold;cursor:pointer;border-radius:3px;' +
            'background:rgba(0,0,0,.55);color:#fff;user-select:none;';
        const stop = (e) => { e.stopPropagation(); };
        b.addEventListener('mousedown', stop);
        b.addEventListener('mouseup', stop);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const id = t.dataset.id;
            const i = preferences.hidden.indexOf(id);
            if (i === -1) preferences.hidden.push(id); else preferences.hidden.splice(i, 1);
            save();
            refresh();
        });
        if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
        t.appendChild(b);
        t._mdrBtn = b;
    }

    // Favorite character
    function attachFavoriteBtn(t) {
        if (t._mdrFavoriteBtn) return;
        const b = document.createElement('span');
        b.className = 'mdr-favorite';
        b.style.cssText =
            'position:absolute;top:2px;right:24px;z-index:6;width:20px;height:20px;line-height:20px;' +
            'text-align:center;font-size:17px;cursor:pointer;border-radius:3px;' +
            'background:rgba(0,0,0,.55);color:#ffd54a;user-select:none;';
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        b.addEventListener('mouseup', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            preferences.def = preferences.def === t.dataset.id ? null : t.dataset.id;
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
        const isFavorite = preferences.def === t.dataset.id;
        b.textContent = isFavorite ? '★' : '☆';
        setTileTooltip(b, isFavorite ? 'Usuń z ulubionych' : 'Ustaw jako ulubioną');
    }

    function updateFavoriteButtons() {
        document.querySelectorAll(TILE).forEach(updateFavoriteButton);
    }

    function characterName(tile) {
        const named = tile.dataset.name || tile.getAttribute('data-name') ||
            tile.querySelector('[class*="name"], [class*="nick"]')?.textContent.trim();
        if (named) return named;
        return (tile.innerText || tile.textContent || '').split(/\n+/).map((part) => part.trim()).find(Boolean) || tile.dataset.id;
    }

    function updatePinnedButtons() {
        const unpinAll = document.querySelector('.mdr-unpin-all');
        if (unpinAll) unpinAll.disabled = !pinnedCharacters.length;
        document.querySelectorAll(TILE).forEach((tile) => {
            const button = tile._mdrPinBtn;
            if (!button) return;
            const pinned = pinnedCharacters.includes(tile.dataset.id);
            button.textContent = pinned ? '📌' : '＋';
            setTileTooltip(button, pinned ? 'Usuń z szybkiego logowania' : 'Dodaj do szybkiego logowania');
        });
    }

    function attachPinBtn(tile) {
        if (tile._mdrPinBtn) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mdr-pin';
        button.style.cssText = 'position:absolute;top:2px;right:46px;z-index:6;width:20px;min-width:20px;height:20px;padding:0;border:0;border-radius:3px;background:rgba(0,0,0,.6);color:#ffe18a;font-size:13px;line-height:20px;cursor:pointer;';
        button.addEventListener('mousedown', (event) => event.stopPropagation());
        button.addEventListener('mouseup', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            if (!activeRoster) return;
            const id = tile.dataset.id;
            if (pinnedCharacters.includes(id)) pinnedCharacters = pinnedCharacters.filter((item) => item !== id);
            else {
                if (pinnedCharacters.length >= 9) { window.alert('Możesz przypiąć maksymalnie 9 postaci.'); return; }
                pinnedCharacters = [...pinnedCharacters, id];
            }
            save(); renderPinnedCharacters([...document.querySelectorAll(TILE)]); updatePinnedButtons();
        });
        if (getComputedStyle(tile).position === 'static') tile.style.position = 'relative';
        tile.appendChild(button);
        tile._mdrPinBtn = button; updatePinnedButtons();
    }

    function characterPortrait(tile) {
        const img = tile.querySelector('img');
        if (img?.src) {
            const portrait = document.createElement('img');
            portrait.src = img.currentSrc || img.src;
            portrait.alt = '';
            portrait.className = 'mdr-pin-portrait';
            return portrait;
        }
        const source = [tile, ...tile.querySelectorAll('*')].find((element) => getComputedStyle(element).backgroundImage !== 'none');
        if (!source) return null;
        const portrait = document.createElement('span');
        portrait.className = 'mdr-pin-portrait';
        portrait.style.backgroundImage = getComputedStyle(source).backgroundImage;
        portrait.style.backgroundPosition = getComputedStyle(source).backgroundPosition;
        portrait.style.backgroundRepeat = 'no-repeat';
        portrait.style.backgroundSize = getComputedStyle(source).backgroundSize;
        return portrait;
    }

    function arrangeQuickLoginActions(enter) {
        const info = enter.closest('.info-container');
        if (!info) return;

        // Hide the separator after moving both login actions into one row.
        const loginRoot = enter.closest('#js-login-box') || enter.closest('.box-enter') || enter.parentElement;
        [...loginRoot.querySelectorAll('*')].forEach((element) => {
            if (element.dataset.mdrHiddenAlternative === '1') return;
            if ((element.textContent || '').trim().toLocaleLowerCase('pl') !== 'lub') return;
            element.dataset.mdrHiddenAlternative = '1';
            element.hidden = true;
        });

        const candidates = [...loginRoot.querySelectorAll('button, a, .c-btn, [role="button"]')];
        const loginAs = candidates.find((element) => element !== enter &&
            /^zaloguj jako\b/i.test((element.textContent || '').replace(/\s+/g, ' ').trim()));

        let actions = info.querySelector(':scope > .mdr-login-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'mdr-login-actions';
            info.appendChild(actions);
        }
        if (enter.parentElement !== actions) actions.appendChild(enter);
        if (loginAs) {
            loginAs.classList.add('mdr-login-as');
            if (loginAs.parentElement !== actions) actions.appendChild(loginAs);
        }
    }

    function arrangeDeputyTime() {
        const login = document.querySelector('#js-login-box');
        if (!login) return;
        const label = login.querySelector(':scope > .info-container > .label');
        if (!label) return;
        const timer = login.querySelector(':scope > .substitution-time') ||
            label.querySelector('.substitution-time');
        if (!timer) {
            if (/wybierz\s+postać/i.test(label.textContent)) label.hidden = true;
            return;
        }

        // Move the original live timer, including its numeric countdown.
        // Earlier versions left the prefix inside a separate label slot.
        if (!/pozostały czas gry zastępcy/i.test(timer.textContent)) {
            const prefix = label.querySelector('.mdr-deputy-time-slot > span');
            if (prefix) timer.prepend(prefix, document.createTextNode(' '));
            else timer.prepend(document.createTextNode('Pozostały czas gry Zastępcy: '));
        }
        timer.querySelectorAll('.mdr-deputy-time').forEach((part) => {
            part.classList.remove('mdr-deputy-time');
        });
        if (timer.parentElement !== label) label.replaceChildren(timer);
        label.classList.remove('mdr-deputy-time');
        label.classList.add('mdr-time-label');
        label.hidden = false;
        timer.classList.add('mdr-deputy-time');
        label.parentElement.hidden = false;
    }

    let quickLayoutFrame = 0;
    const quickLayoutObserver = new ResizeObserver(scheduleQuickLayout);
    let quickLayoutElements = [];

    function scheduleQuickLayout() {
        if (quickLayoutFrame) return;
        quickLayoutFrame = requestAnimationFrame(() => {
            quickLayoutFrame = 0;
            const panel = document.querySelector('#js-login-box .mdr-quick-login');
            const card = panel?.closest('.header-box--logged');
            const actions = card?.querySelector('.mdr-login-actions');
            if (!panel || panel.hidden || !card || !actions) return;
            const panelRect = panel.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const actionsRect = actions.getBoundingClientRect();
            if (!card.offsetHeight || !cardRect.height || !panelRect.height) return;
            const scale = cardRect.height / card.offsetHeight;
            const previousOffset = panel._mdrQuickOffset || 0;
            const naturalTop = panelRect.top - previousOffset * scale;
            const centeredTop = (actionsRect.bottom + cardRect.bottom - panelRect.height) / 2;
            // Keep a readable gap when a theme leaves too little free space.
            const desiredTop = Math.max(actionsRect.bottom + 16 * scale, centeredTop);
            const offset = Math.max(0, (desiredTop - naturalTop) / scale);
            if (Math.abs(offset - previousOffset) > 0.25) {
                panel._mdrQuickOffset = offset;
                panel.style.setProperty('--mdr-quick-offset', `${offset}px`);
            }
        });
    }

    function observeQuickLayout(panel, enter) {
        const elements = [panel, enter.closest('.mdr-login-actions'),
            panel.closest('.header-box--logged')].filter(Boolean);
        if (elements.length !== quickLayoutElements.length ||
            elements.some((element, index) => element !== quickLayoutElements[index])) {
            quickLayoutObserver.disconnect();
            elements.forEach((element) => quickLayoutObserver.observe(element));
            quickLayoutElements = elements;
        }
        scheduleQuickLayout();
    }
    window.addEventListener('resize', scheduleQuickLayout);

    function renderPinnedCharacters(tiles) {
        if (!activeRoster) return;
        const enter = document.querySelector('.info-container .enter-game');
        if (!enter?.parentElement) return;
        arrangeQuickLoginActions(enter);
        const tileById = new Map(tiles.map((tile) => [tile.dataset.id, tile]));
        pinnedCharacters = pinnedCharacters.filter((id) => tileById.has(id)).slice(0, 9);
        let panel = document.querySelector('.mdr-quick-login');
        if (!panel) { panel = document.createElement('div'); panel.className = 'mdr-quick-login'; }
        const parent = enter.closest('.info-container') || enter.parentElement;
        if (parent.nextElementSibling !== panel) parent.insertAdjacentElement('afterend', panel);
        panel.parentElement?.classList.remove('mdr-login-panel-host');
        observeQuickLayout(panel, enter);
        panel.dataset.count = String(pinnedCharacters.length);
        const signature = pinnedCharacters.map((id) => {
            const tile = tileById.get(id); return `${id}:${characterName(tile)}:${worldOf(tile)}`;
        }).join('|');
        if (panel.dataset.signature === signature && panel.hidden === (pinnedCharacters.length === 0)) return;
        panel.dataset.signature = signature;
        panel.replaceChildren();
        panel.hidden = pinnedCharacters.length === 0;
        if (panel.hidden) return;
        pinnedCharacters.forEach((id) => {
            const tile = tileById.get(id); if (!tile) return;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'mdr-quick-character';
            card.title = `Wejdź do gry postacią ${characterName(tile)} (${worldOf(tile)})`;
            const crop = document.createElement('span');
            crop.className = 'mdr-pin-portrait-wrap';
            const portrait = characterPortrait(tile); if (portrait) crop.appendChild(portrait);
            const label = document.createElement('span');
            label.className = 'mdr-quick-label';
            const name = document.createElement('strong');
            name.textContent = characterName(tile);
            const world = document.createElement('small');
            world.textContent = worldOf(tile);
            label.append(name, world);
            card.append(crop, label);
            card.addEventListener('click', () => {
                const roster = activeRoster;
                const currentTile = [...document.querySelectorAll(TILE)]
                    .find((candidate) => candidate.dataset.id === id);
                if (!currentTile?.isConnected) return;
                currentTile.click();
                setTimeout(() => {
                    if (activeRoster !== roster || !currentTile.isConnected) return;
                    const selectedId = document.querySelector('#js-login-box #chid');
                    if (selectedId && selectedId.value !== id) return;
                    const enterButton = document.querySelector('#js-login-box .enter-game');
                    if (enterButton && !enterButton.disabled) enterButton.click();
                }, 100);
            });
            panel.appendChild(card);
        });
    }

    // Use the complete roster as an account key when no account ID is exposed.
    function bindRoster(tiles) {
        const ids = tiles.map((t) => t.dataset.id).filter(Boolean).sort();
        if (!ids.length) return;
        const roster = ids.join(',');
        if (activeRoster === roster) return;
        activeRoster = roster;
        preferences.def = favoritesByRoster[roster] || null;
        pinnedCharacters = (pinnedByRoster[roster] || []).filter((id) => ids.includes(id)).slice(0, 9);
        // Recover pins from a previous subset when a character is added.
        // An explicitly saved empty list must stay empty after unpinning all.
        if (!Object.prototype.hasOwnProperty.call(pinnedByRoster, roster)) {
            const previousRoster = Object.entries(pinnedByRoster)
                .map(([key, pins]) => ({ key, ids: key.split(',').filter(Boolean), pins: Array.isArray(pins) ? pins : [] }))
                .filter((entry) => entry.ids.length && entry.ids.length < ids.length &&
                    entry.ids.every((id) => ids.includes(id)) && entry.pins.some((id) => ids.includes(id)))
                .sort((a, b) => b.ids.length - a.ids.length)[0];
            if (previousRoster) pinnedCharacters = previousRoster.pins.filter((id) => ids.includes(id)).slice(0, 9);
        }
        pinnedByRoster[roster] = pinnedCharacters;
        GM_setValue('pinnedByRoster', pinnedByRoster);
        // Migrate the favorite saved by older releases once per roster.
        if (!Object.prototype.hasOwnProperty.call(favoritesByRoster, roster) &&
            legacyFavorite && ids.includes(legacyFavorite)) {
            preferences.def = legacyFavorite;
            favoritesByRoster[roster] = legacyFavorite;
            GM_setValue('favoritesByRoster', favoritesByRoster);
        }
        favoriteAutoSelected = false;
        updateFavoriteButtons();
        updatePinnedButtons();
    }

    function autoSelectFavorite(tiles) {
        if (favoriteAutoSelected || !preferences.def) return;
        const tile = tiles.find((t) => t.dataset.id === preferences.def);
        if (!tile || tile.style.display === 'none' || !tile.isConnected) return;
        // Use the native character selection handler.
        favoriteAutoSelected = true;
        tile.click();
    }

    function applyHidden(tiles) {
        const hiddenIds = new Set(preferences.hidden);
        const hiddenCount = tiles.filter((tile) => hiddenIds.has(tile.dataset.id)).length;
        if (hiddenCount === 0) showHidden = false;

        tiles.forEach((tile) => {
            attachHideBtn(tile);
            const isHidden = hiddenIds.has(tile.dataset.id);
            tile.style.display = isHidden && !showHidden ? 'none' : '';
            tile.style.filter = isHidden ? 'grayscale(1) opacity(.55)' : '';
            tile._mdrBtn.textContent = isHidden ? '↺' : '✕';
            setTileTooltip(tile._mdrBtn, isHidden ? 'Przywróć postać' : 'Ukryj postać');
        });

        const panel = document.querySelector('.mdr-panel');
        if (!panel) return;
        const showButton = panel.querySelector('.mdr-show');
        const restoreButton = panel.querySelector('.mdr-restore-all');
        if (showButton) {
            showButton.textContent = showHidden ? 'Schowaj ukryte' : `Pokaż ukryte (${hiddenCount})`;
        }
        [showButton, restoreButton].filter(Boolean).forEach((button) => {
            button.hidden = hiddenCount === 0;
            // Native page rules can override both hidden and normal inline display.
            button.style.setProperty('display', hiddenCount ? 'inline-flex' : 'none', 'important');
        });
    }

    // Refresh the modern panel
    function run() {
        arrangeDeputyTime();
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
            attachPinBtn(t);
        });
        autoSelectFavorite(tiles);
        applyHidden(tiles);
        renderPinnedCharacters(tiles);

        const origins = [...new Set(tiles.map((t) => t._mdrOrigin).filter((o) => o && o.isConnected))];
        let host = null;
        if (preferences.group && groupHost && groupHost.isConnected) host = groupHost;
        else if (origins.length) host = commonAncestor(origins);
        else if (groupHost && groupHost.isConnected) host = groupHost;
        if (!host) return rerun;

        let g = host.querySelector(':scope > .mdr-groups');

        if (preferences.group) {
            groupHost = host;
            if (!g) {
                g = document.createElement('div');
                g.className = 'mdr-groups';
                host.appendChild(g);
            }
            [...host.children].forEach((c) => {
                // The host may contain character tiles directly. Preserve their visibility
                // while moving them into world groups.
                if (c !== g && !(c.matches && c.matches(TILE)) && !('mdrHid' in c.dataset)) {
                    c.dataset.mdrHid = c.style.display || '';
                    c.style.display = 'none';
                }
            });

            let list = [...document.querySelectorAll(TILE)];
            if (preferences.custom) list.sort(byOrder);
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
                // Determine empty worlds from our hidden IDs, independent of page CSS.
                const visibleInWorld = worlds.get(w).some((t) => showHidden || !preferences.hidden.includes(t.dataset.id));
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
            if (preferences.custom) {
                origins.forEach((o) => {
                    const kids = [...o.children].filter((k) => k.matches && k.matches(TILE));
                    if (kids.length > 1) reorderInPlace(kids, byOrder);
                });
            }
        }
        return rerun;
    }

    const mutationObserver = new MutationObserver(() => {
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
            // Fallback when the advisory notice has no working close handler.
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
        mutationObserver.disconnect();
        let rerun = false;
        try {
            closeEmailNotice();
            // The classic theme can leave modern tiles in the DOM.
            // Prefer its native character select when detecting the page layout.
            if (findLegacySelect()) runLegacy();
            else rerun = run();
        } catch (e) { console.error('[Margonem układ postaci]', e); }
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        if (rerun) setTimeout(refresh, 120);
    }

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    refresh();
})();
