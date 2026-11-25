/* Bitrix24 WhatsApp Skin — reorganiza a lista dos Canais Abertos.
   Desligado por padrão (opção "reorderLines"). Só atua com a pasta Canais Abertos
   selecionada. Não move nós do DOM (o Bitrix/Vue continua dono da lista): achata os
   grupos com display: contents e ordena com a propriedade CSS order.
   Ordem: aguardando resposta no topo (quem espera há mais tempo primeiro),
   depois as demais pela última mensagem (mais recente primeiro). */
(function () {
  'use strict';
  const SEL = {
    scroll: '.bx-imol-list-recent__scroll-container',
    group: '.bx-imol-list-recent__group-item_container',
    groupName: '.bx-imol-list-recent__group_name',
    dateName: '.bx-imol-list-recent__date-group_name',
    item: '.bx-imol-list-recent__item',
    itemDate: '.bx-imol-list-recent-item__content_date',
    avatar: '.bx-imol-list-recent-item__avatar_container',
    folderPanel: '.bx-im-messenger-folder-panel__items',
    linesFolder: '.bx-im-messenger-folder-panel__item[data-folder-code="lines"]'
  };
  const STATUS = {
    unanswered: { rank: 0, cls: 'wabx-st-wait', title: 'Aguardando resposta' },
    work: { rank: 1, cls: 'wabx-st-work', title: 'Em andamento' },
    answered: { rank: 2, cls: 'wabx-st-done', title: 'Finalizada' }
  };
  const OTHER = { rank: 1, cls: 'wabx-st-work', title: '' };
  const MARK = 'wabx-ro';

  let enabled = false;
  let timer = 0;
  let observed = null;
  let observer = null;
  let lastSig = '';

  // ---------- datas ----------
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const DAY = 86400000;

  let monthTable = null;
  function months() {
    if (monthTable) return monthTable;
    monthTable = [];
    const locs = [document.documentElement.lang, navigator.language, 'pt-BR', 'en', 'es'].filter(Boolean);
    for (const loc of locs) {
      for (let m = 0; m < 12; m++) {
        try {
          const d = new Date(2000, m, 15);
          monthTable.push([norm(new Intl.DateTimeFormat(loc, { month: 'long' }).format(d)), m]);
          monthTable.push([norm(new Intl.DateTimeFormat(loc, { month: 'short' }).format(d)), m]);
        } catch (e) { /* idioma não suportado */ }
      }
    }
    return monthTable;
  }
  function monthOf(token) {
    const t = norm(token);
    if (t.length < 3) return -1;
    for (const [name, m] of months()) if (name && (name === t || name.startsWith(t) || t.startsWith(name))) return m;
    return -1;
  }
  const WEEKDAYS = [['dom', 0], ['seg', 1], ['ter', 2], ['qua', 3], ['qui', 4], ['sex', 5], ['sab', 6],
    ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6]];

  // Rótulo de grupo de data do Bitrix ("Hoje", "Ontem", "terça-feira, 9 de junho", "09.06.2025") -> início do dia em ms.
  function labelDay(text) {
    const t = norm(text);
    const today = dayStart(new Date());
    if (!t) return null;
    if (/^(hoje|today|hoy)\b/.test(t)) return today;
    if (/^(ontem|yesterday|ayer)\b/.test(t)) return today - DAY;
    let m = t.match(/(\d{1,2})[\/ -](\d{1,2})(?:[\/ -](\d{2,4}))?/);
    if (m && +m[2] >= 1 && +m[2] <= 12) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear();
      return fixFuture(new Date(y, +m[2] - 1, +m[1]));
    }
    m = t.match(/(\d{1,2})(?: de)? ([a-z]+)(?: de)?(?: (\d{4}))?/);
    if (m) {
      const mi = monthOf(m[2]);
      if (mi >= 0) return fixFuture(new Date(m[3] ? +m[3] : new Date().getFullYear(), mi, +m[1]), !m[3]);
    }
    return null;
  }
  function fixFuture(d, guessYear = true) {
    let ts = dayStart(d);
    if (guessYear && ts > Date.now() + DAY) ts = dayStart(new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()));
    return ts;
  }

  // Data/hora mostrada no item ("14:05", "ter", "09.06") combinada com o dia do grupo.
  function itemTime(item, groupDay) {
    const el = item.querySelector(SEL.itemDate);
    const t = norm(el ? el.textContent : '');
    let day = groupDay;
    let mins = null;
    const hm = t.match(/(\d{1,2}):(\d{2})/);
    if (hm) mins = (+hm[1]) * 60 + (+hm[2]);
    if (day == null) {
      if (hm && t.length <= 5) day = dayStart(new Date());
      else {
        const wd = WEEKDAYS.find(([n]) => t.startsWith(n));
        if (wd) {
          const now = new Date();
          let diff = (now.getDay() - wd[1] + 7) % 7 || 7;
          day = dayStart(now) - diff * DAY;
        } else day = labelDay(t);
      }
    }
    if (day == null) return null;
    return day + (mins != null ? mins * 60000 : 0);
  }

  function statusOf(group) {
    const name = group.querySelector(':scope > ' + SEL.groupName);
    if (!name) return OTHER;
    for (const c of name.classList) {
      const m = c.match(/^bx-imol-list-recent__group_name_(.+)$/);
      if (m && STATUS[m[1]]) return STATUS[m[1]];
    }
    return Object.assign({}, OTHER, { title: name.textContent.trim() });
  }

  // ---------- ativação ----------
  function linesSelected() {
    const panel = document.querySelector(SEL.folderPanel);
    if (!panel) return true; // layout sem painel de pastas: a lista de Canais Abertos já é a tela própria
    const f = panel.querySelector(SEL.linesFolder);
    return !!(f && f.classList.contains('--selected'));
  }

  function clear(scroll) {
    const root = scroll || document;
    root.querySelectorAll('.' + MARK).forEach((n) => n.classList.remove(MARK, 'wabx-ro-flat', 'wabx-ro-contents', 'wabx-ro-hide', 'wabx-ro-tail'));
    root.querySelectorAll('[data-wabx-order]').forEach((n) => { n.style.removeProperty('order'); n.removeAttribute('data-wabx-order'); });
    root.querySelectorAll('.wabx-st-dot').forEach((n) => n.remove());
    lastSig = '';
  }

  function setOrder(el, n) {
    const v = String(n);
    if (el.style.order !== v) el.style.order = v;
    el.setAttribute('data-wabx-order', '');
  }

  function dot(item, st) {
    const av = item.querySelector(SEL.avatar);
    if (!av) return;
    let d = av.querySelector(':scope > .wabx-st-dot');
    if (!d) { d = document.createElement('span'); av.appendChild(d); av.classList.add(MARK); }
    const cls = 'wabx-st-dot ' + st.cls;
    if (d.className !== cls) d.className = cls;
    if (st.title && d.title !== st.title) d.title = st.title;
  }

  // ---------- reorganizar ----------
  function apply() {
    timer = 0;
    const scroll = document.querySelector(SEL.scroll);
    if (!enabled || !scroll || !linesSelected()) { if (scroll || lastSig) clear(scroll); return; }

    const rows = [];
    let seq = 0;
    for (const group of scroll.querySelectorAll(':scope > ' + SEL.group)) {
      const st = statusOf(group);
      const gName = group.querySelector(':scope > ' + SEL.groupName);
      if (gName) gName.classList.add(MARK, 'wabx-ro-hide');
      group.classList.add(MARK, 'wabx-ro-contents');
      for (const wrap of group.children) {
        if (wrap === gName) continue;
        const dName = wrap.querySelector(':scope > ' + SEL.dateName);
        const day = dName ? labelDay(dName.textContent) : null;
        if (dName) dName.classList.add(MARK, 'wabx-ro-hide');
        const items = wrap.matches(SEL.item) ? [wrap] : Array.from(wrap.querySelectorAll(SEL.item));
        if (!wrap.matches(SEL.item)) wrap.classList.add(MARK, 'wabx-ro-contents');
        for (const item of items) rows.push({ item, st, ts: itemTime(item, day), seq: seq++ });
      }
    }
    if (!rows.length) return;

    // assinatura: só mexe no DOM quando algo mudou (evita loop com o observer e piscadas)
    const sig = rows.map((r) => r.st.rank + ':' + r.ts + ':' + r.seq).join('|');
    const intact = scroll.classList.contains('wabx-ro-flat') && rows.every((r) => r.item.hasAttribute('data-wabx-order'));
    if (sig === lastSig && intact) return;
    lastSig = sig;

    rows.sort((a, b) => {
      if (a.st.rank === 0 || b.st.rank === 0) {
        if (a.st.rank !== b.st.rank) return a.st.rank === 0 ? -1 : 1;
        // aguardando: mais antiga primeiro; sem data, mantém a ordem do Bitrix invertida (ele lista a mais recente primeiro)
        if (a.ts != null && b.ts != null && a.ts !== b.ts) return a.ts - b.ts;
        return b.seq - a.seq;
      }
      if (a.ts != null && b.ts != null && a.ts !== b.ts) return b.ts - a.ts;
      if ((a.ts == null) !== (b.ts == null)) return a.ts == null ? 1 : -1;
      return a.seq - b.seq;
    });

    scroll.classList.add(MARK, 'wabx-ro-flat');
    rows.forEach((r, i) => { setOrder(r.item, i + 1); dot(r.item, r.st); });
    // tudo que não é conversa (carregando, sentinela do "carregar mais") vai para o fim,
    // senão o carregamento infinito dispara no topo
    for (const child of scroll.children) {
      if (!child.matches(SEL.group)) { child.classList.add(MARK, 'wabx-ro-tail'); setOrder(child, 999999); }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(apply, 120);
  }

  function watch() {
    const scroll = document.querySelector(SEL.scroll);
    if (scroll !== observed) {
      if (observer) observer.disconnect();
      observed = scroll;
      lastSig = '';
      if (scroll) {
        observer = new MutationObserver((muts) => {
          // ignora mudanças feitas por este script
          if (muts.every((m) => m.type === 'attributes' || (m.target.classList && m.target.classList.contains('wabx-st-dot')))) return;
          schedule();
        });
        observer.observe(scroll, { childList: true, subtree: true, characterData: true });
      }
    }
    schedule();
  }

  // um observer leve no body só para trocar de lista/pasta; o trabalho pesado fica no da lista
  let bodyTimer = 0;
  const bodyObs = new MutationObserver(() => {
    if (bodyTimer) return;
    bodyTimer = setTimeout(() => { bodyTimer = 0; watch(); }, 300);
  });
  function start() {
    bodyObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    watch();
  }
  function stop() {
    bodyObs.disconnect();
    if (observer) observer.disconnect();
    observer = null; observed = null;
    clear(document.querySelector(SEL.scroll));
  }

  function setEnabled(v) {
    v = !!v;
    if (v === enabled) return;
    enabled = v;
    if (enabled) start(); else stop();
  }

  chrome.storage.sync.get({ reorderLines: false }, (o) => setEnabled(o.reorderLines));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' && ch.reorderLines) setEnabled(ch.reorderLines.newValue);
  });
})();
