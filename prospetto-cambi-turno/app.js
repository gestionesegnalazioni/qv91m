(() => {
  "use strict";

  const data = window.PROSPETTO_DATA;
  const STORAGE_KEY = "prospetto-cambi-turno:selected-v1";
  const VACATION_STORAGE_KEY = "prospetto-cambi-turno:vacations-v1";
  const AGENDA_DAY_STORAGE_KEY = "prospetto-cambi-turno:agenda-days-v1";
  const AGENDA_PENDING_STORAGE_KEY = "prospetto-cambi-turno:agenda-pending-v1";
  const weeksEl = document.querySelector("#weeks");
  const prospettoView = document.querySelector("#prospettoView");
  const agendaView = document.querySelector("#agendaView");
  const agendaDaysEl = document.querySelector("#agendaDays");
  const dialog = document.querySelector("#turnDialog");
  const dialogBody = document.querySelector("#dialogBody");
  const dialogTitle = document.querySelector("#dialogTitle");
  const dialogGroup = document.querySelector("#dialogGroup");
  const EVENING_TURNS = new Set(["128", "154", "156", "158"]);
  const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
  const monthFormat = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdayFormat = new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" });
  const dayMonthFormat = new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" });
  const agendaEntries = Array.isArray(data.agenda) ? data.agenda : [];
  const agendaMonths = [...new Set(agendaEntries.map(entry => entry.date.slice(0, 7)))].sort();
  let todayKey = currentDateKey();
  let selections = loadSelections();
  let vacationWeeks = loadVacationWeeks();
  let agendaDayData = loadAgendaDayData();
  let agendaPendingDates = loadAgendaPendingDates();
  let cloudUser = null;
  let cloudDocument = null;
  let cloudReady = false;
  let cloudSaveTimer = null;
  let ignoreOwnCloudUpdate = false;
  let stopCloudListener = null;
  let firebaseServices = null;

  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

  function currentDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function loadSelections() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function saveSelections() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selections]));
    scheduleCloudSave();
  }

  function loadVacationWeeks() {
    try { return new Set(JSON.parse(localStorage.getItem(VACATION_STORAGE_KEY) || "[]"));
    } catch { return new Set(); }
  }

  function saveVacationWeeks() {
    localStorage.setItem(VACATION_STORAGE_KEY, JSON.stringify([...vacationWeeks]));
    scheduleCloudSave();
  }

  function loadAgendaDayData() {
    try { return JSON.parse(localStorage.getItem(AGENDA_DAY_STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }

  function loadAgendaPendingDates() {
    try { return new Set(JSON.parse(localStorage.getItem(AGENDA_PENDING_STORAGE_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function saveAgendaPendingDates() {
    localStorage.setItem(AGENDA_PENDING_STORAGE_KEY, JSON.stringify([...agendaPendingDates]));
  }

  function saveAgendaDayData(date) {
    localStorage.setItem(AGENDA_DAY_STORAGE_KEY, JSON.stringify(agendaDayData));
    if (date) {
      agendaPendingDates.add(date);
      saveAgendaPendingDates();
    }
    scheduleCloudSave();
  }

  function storeCloudDataLocally(payload) {
    selections = new Set(Array.isArray(payload.selections) ? payload.selections : []);
    vacationWeeks = new Set(Array.isArray(payload.vacationWeeks) ? payload.vacationWeeks : []);
    const remoteAgenda = payload.agendaDayData && typeof payload.agendaDayData === "object" ? payload.agendaDayData : {};
    const localAgendaToPreserve = {};
    Object.entries(agendaDayData).forEach(([date, value]) => {
      if (agendaPendingDates.has(date) || !Object.prototype.hasOwnProperty.call(remoteAgenda, date)) {
        localAgendaToPreserve[date] = value;
        agendaPendingDates.add(date);
      }
    });
    agendaDayData = { ...remoteAgenda, ...localAgendaToPreserve };
    saveAgendaPendingDates();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selections]));
    localStorage.setItem(VACATION_STORAGE_KEY, JSON.stringify([...vacationWeeks]));
    localStorage.setItem(AGENDA_DAY_STORAGE_KEY, JSON.stringify(agendaDayData));
    renderWeeks();
    if (!document.activeElement?.matches("[data-agenda-note]")) renderAgenda();
  }

  function cloudPayload(pendingAgenda = {}) {
    const payload = {
      selections: [...selections],
      vacationWeeks: [...vacationWeeks],
      updatedAt: firebaseServices.serverTimestamp()
    };
    if (Object.keys(pendingAgenda).length) payload.agendaDayData = pendingAgenda;
    return payload;
  }

  async function saveToCloud() {
    if (!cloudReady || !cloudUser || !cloudDocument || !firebaseServices) return;
    const pendingDates = [...agendaPendingDates];
    const pendingAgenda = {};
    const capturedValues = new Map();
    pendingDates.forEach(date => {
      if (!agendaDayData[date]) return;
      pendingAgenda[date] = agendaDayData[date];
      capturedValues.set(date, JSON.stringify(agendaDayData[date]));
    });
    try {
      ignoreOwnCloudUpdate = true;
      await firebaseServices.setDoc(cloudDocument, cloudPayload(pendingAgenda), { merge: true });
      pendingDates.forEach(date => {
        if (capturedValues.get(date) === JSON.stringify(agendaDayData[date])) agendaPendingDates.delete(date);
      });
      saveAgendaPendingDates();
      setTimeout(() => { ignoreOwnCloudUpdate = false; }, 1000);
      if (agendaPendingDates.size) scheduleCloudSave(0);
    } catch (error) {
      ignoreOwnCloudUpdate = false;
      saveAgendaPendingDates();
      console.error("Salvataggio online non riuscito", error);
    }
  }

  function scheduleCloudSave(delay = 350) {
    clearTimeout(cloudSaveTimer);
    if (!cloudReady || !cloudUser) return;
    cloudSaveTimer = setTimeout(saveToCloud, delay);
  }

  async function connectCloudUser(user) {
    cloudReady = false;
    cloudUser = user;
    if (stopCloudListener) stopCloudListener();
    stopCloudListener = null;
    if (!user) {
      cloudDocument = null;
      return;
    }

    cloudDocument = firebaseServices.doc(firebaseServices.db, "prospettoCambiTurno", "archivioCondiviso");
    try {
      const snapshot = await firebaseServices.getDoc(cloudDocument);
      if (snapshot.exists()) {
        storeCloudDataLocally(snapshot.data());
      } else {
        await firebaseServices.setDoc(cloudDocument, cloudPayload(agendaDayData));
        agendaPendingDates.clear();
        saveAgendaPendingDates();
      }
      cloudReady = true;
      if (agendaPendingDates.size) scheduleCloudSave(0);
      stopCloudListener = firebaseServices.onSnapshot(cloudDocument, remote => {
        if (!remote.exists() || !cloudReady || ignoreOwnCloudUpdate) return;
        storeCloudDataLocally(remote.data());
      }, error => {
        console.error("Aggiornamento online non disponibile", error);
      });
    } catch (error) {
      console.error("Collegamento al database non riuscito", error);
    }
  }

  async function initCloudSync() {
    try {
      const firebaseApp = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js");
      const firestore = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js");
      const firebaseAuth = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js");
      const app = firebaseApp.initializeApp({
        apiKey: "AIzaSyBdwNH43PZFgSfKZOEfJtBrF-ooC4NOnGc",
        authDomain: "gestionesegnalazioni.firebaseapp.com",
        projectId: "gestionesegnalazioni",
        storageBucket: "gestionesegnalazioni.firebasestorage.app",
        messagingSenderId: "930504240088",
        appId: "1:930504240088:web:60e43f95f82883b43b20ad"
      });
      const auth = firebaseAuth.initializeAuth(app, {
        persistence: firebaseAuth.browserLocalPersistence,
        popupRedirectResolver: firebaseAuth.browserPopupRedirectResolver
      });
      firebaseServices = {
        auth,
        signInAnonymously: firebaseAuth.signInAnonymously,
        db: firestore.getFirestore(app),
        doc: firestore.doc,
        getDoc: firestore.getDoc,
        setDoc: firestore.setDoc,
        onSnapshot: firestore.onSnapshot,
        serverTimestamp: firestore.serverTimestamp
      };
      firebaseAuth.onAuthStateChanged(auth, user => {
        if (user) connectCloudUser(user);
      });
      if (!auth.currentUser) await firebaseAuth.signInAnonymously(auth);
    } catch (error) {
      console.error("Firebase non disponibile", error);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function shortDate(value) {
    return dateFormat.format(new Date(`${value}T12:00:00Z`)).replace(".", "");
  }

  function selectionKey(week, group, turn, person, days) {
    return [week.index, group, turn, person, days.join(",") || "base"].join("|");
  }

  function detailFor(turn) {
    return data.turnDetails[`MS${turn}`] || [];
  }

  function italianDayList(days) {
    const names = {
      LUN: "lunedì",
      MAR: "martedì",
      MER: "mercoledì",
      GIO: "giovedì",
      VEN: "venerdì",
      SAB: "sabato",
      DOM: "domenica"
    };
    const fullDays = days.map(day => names[day] || day.toLowerCase());
    if (fullDays.length === 1) return fullDays[0];
    if (fullDays.length === 2) return `${fullDays[0]} e ${fullDays[1]}`;
    return `${fullDays.slice(0, -1).join(", ")} e ${fullDays.at(-1)}`;
  }

  function dayLabel(days) {
    return `(${days.map(day => String(day).slice(0, 3).toLocaleUpperCase("it-IT")).join(", ")})`;
  }

  function prospectPersonName(person) {
    const value = String(person || "").trim().replace(/\\s+/g, " ");
    if (!value || value.toUpperCase() === "SCOPERTO") return value;
    const normalized = value.toLocaleLowerCase("it-IT");
    const exceptions = new Map([
      ["bertanelli matteo", "Matteo"],
      ["menconi simone", "Menconi S."],
      ["menconi marco", "Menconi M."],
      ["volpi paolo", "Volpi P."],
      ["volpi marco", "Volpi M."]
    ]);
    if (exceptions.has(normalized)) return exceptions.get(normalized);
    const parts = value.split(" ");
    const compoundPrefixes = new Set(["de", "del", "della", "di"]);
    return compoundPrefixes.has(parts[0].toLocaleLowerCase("it-IT")) && parts.length > 1
      ? `${parts[0]} ${parts[1]}`
      : parts[0];
  }

  function personRow(week, group, turn, person, days = [], open = false) {
    const daysHtml = days.length ? `<small class="person__days">${escapeHtml(dayLabel(days))}</small>` : "";
    return `
      <div class="person${open ? " person--open" : ""}">
        <span class="person__text">${escapeHtml(prospectPersonName(person))}${daysHtml}</span>
      </div>`;
  }

  function turnRow(week, group, item) {
    const people = [personRow(week, group, item.turn, item.base, [], item.base === "SCOPERTO")]
      .concat(item.variations.map(v => personRow(week, group, item.turn, v.person, v.days)))
      .join("");
    return `
      <div class="turn">
        <button class="turn__number" type="button" data-open-turn="${item.turn}" data-group="${group}" title="Apri il turno MS${item.turn}">MS${item.turn}</button>
        <div class="names">${people}</div>
      </div>`;
  }

  function groupColumn(week, group) {
    return `
      <section class="group">
        <h2 class="group__title">${escapeHtml(group.name)}</h2>
        <div class="turn-list">${group.turns.map(item => turnRow(week, group.name, item)).join("")}</div>
      </section>`;
  }

  function vacationControl(week) {
    const key = String(week.index);
    const selected = vacationWeeks.has(key);
    const action = selected ? "Togli ferie" : "Segna ferie";
    return `
      <div class="vacation-control">
        <span class="vacation-status"${selected ? "" : " hidden"}>FERIE</span>
        <details class="vacation-menu">
          <summary aria-label="Opzioni settimana ${week.index}" title="Opzioni settimana ${week.index}">⋯</summary>
          <div class="vacation-menu__panel">
            <button class="vacation-menu__item" type="button" data-vacation-week="${escapeHtml(key)}" aria-pressed="${selected}" aria-label="${action} per la settimana ${week.index}">${action}</button>
          </div>
        </details>
      </div>`;
  }

  function ownTurnControl(week) {
    const turnCodes = Array.isArray(week.codes) && week.codes.length ? week.codes : [week.code];
    const multipleClass = turnCodes.length > 1 ? " rotation-code-list--multiple" : "";
    const controls = turnCodes.map(code => {
      const value = String(code);
      if (/^\d+$/.test(value)) {
        return `<button class="rotation-code rotation-code--button" type="button" data-open-turn="${escapeHtml(value)}" data-group="Il mio turno" data-display-turn="${escapeHtml(value)}" title="Apri il mio turno ${escapeHtml(value)}">${escapeHtml(value)}</button>`;
      }
      return `<span class="rotation-code">${escapeHtml(value)}</span>`;
    }).join("");
    return `<div class="rotation-code-list${multipleClass}" aria-label="I miei turni: ${escapeHtml(turnCodes.join(", "))}">${controls}</div>`;
  }

  function weekActions(week) {
    const restDays = Array.isArray(week.restDays) ? week.restDays : [];
    const restCaption = restDays.length
      ? `<small class="rotation-rest">Riposo: ${escapeHtml(italianDayList(restDays))}</small>`
      : "";
    return `<div class="week__actions"><div class="week__action-row">${ownTurnControl(week)}</div>${restCaption}</div>`;
  }

  function renderWeeks() {
    weeksEl.innerHTML = data.weeks.map(week => `
      <article class="week" data-week="${week.index}">
        <header class="week__header">
          <div>
            <h1>Settimana ${week.index}</h1>
            <p class="week__dates">${shortDate(week.start)} – ${shortDate(week.end)}</p>
          </div>
          ${weekActions(week)}
        </header>
        <div class="week__groups">${week.groups.map(group => groupColumn(week, group)).join("")}</div>
      </article>`).join("");
    document.querySelector("#loadingStatus")?.remove();
  }

  function agendaTurnLabel(turn) {
    if (turn === "RIP") return "R";
    return String(turn || "").replace(/^MS/i, "") || "—";
  }

  function dayCodeForDate(date) {
    return ["DOM", "LUN", "MAR", "MER", "GIO", "VEN", "SAB"][date.getUTCDay()];
  }

  function agendaEntryForDate(dateValue) {
    const existing = agendaEntries.find(item => item.date === dateValue);
    if (existing) return existing;
    if (dateValue.startsWith("2026-09-")) {
      const date = new Date(`${dateValue}T12:00:00Z`);
      return { date: dateValue, day: dayCodeForDate(date), turn: "", week: null };
    }
    return null;
  }

  function entriesForAgendaMonth(month) {
    if (month !== "2026-09") return agendaEntries.filter(entry => entry.date.startsWith(month));
    const result = [];
    for (let day = 1; day <= 30; day += 1) {
      const dateValue = `${month}-${String(day).padStart(2, "0")}`;
      result.push(agendaEntryForDate(dateValue));
    }
    return result;
  }

  function resizeNoteField(field) {
    field.style.height = "32px";
  }

  function mondayDateKey(dateValue) {
    const date = new Date(`${dateValue}T12:00:00Z`);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysFromMonday);
    return date.toISOString().slice(0, 10);
  }

  function saveInlineNote(field) {
    const date = field.dataset.agendaNote;
    if (!date) return;
    const saved = { ...(agendaDayData[date] || {}), note: field.value, updatedAt: Date.now() };
    agendaDayData[date] = saved;
    field.classList.toggle("has-note", Boolean(field.value));
    resizeNoteField(field);
    saveAgendaDayData(date);
  }

  function agendaDay(entry) {
    const date = new Date(`${entry.date}T12:00:00Z`);
    const weekday = weekdayFormat.format(date).replace(".", "").toUpperCase();
    const dayNumber = date.getUTCDate();
    const saved = agendaDayData[entry.date] || {};
    const stateClasses = [
      entry.day === "DOM" ? "agenda-day--sunday" : ""
    ].filter(Boolean).join(" ");
    return `
      <article class="agenda-day${stateClasses ? ` ${stateClasses}` : ""}" data-agenda-date="${entry.date}" data-agenda-week="${entry.week || ""}"${entry.date === todayKey ? ' aria-current="date"' : ""}>
        <div class="agenda-date"><span>${escapeHtml(weekday)}</span><strong>${dayNumber}</strong><small class="agenda-date__month">${escapeHtml(dayMonthFormat.format(date))}</small></div>
        <div class="agenda-day__content">
          <div class="agenda-day__heading">
            <strong class="agenda-day__turn">${escapeHtml(agendaTurnLabel(entry.turn))}</strong>
            ${entry.date === todayKey ? '<span class="agenda-today">OGGI</span>' : ""}
          </div>
          <textarea class="agenda-day__note-space${saved.note ? " has-note" : ""}" rows="2" data-agenda-note="${entry.date}" aria-label="Nota del ${entry.date}" placeholder="">${escapeHtml(saved.note || "")}</textarea>
        </div>
        <div class="agenda-day__tools">
          ${entry.week ? `<span class="agenda-day__week">Sett. ${entry.week}</span>` : ""}
        </div>
      </article>`;
  }

  function renderAgenda(scrollToToday = false) {
    todayKey = currentDateKey();
    if (!agendaMonths.length) {
      agendaDaysEl.innerHTML = '<p class="loading-status loading-status--error">Dati dell’agenda non disponibili.</p>';
      return;
    }
    agendaDaysEl.innerHTML = agendaMonths.map(month => `
      <section class="agenda-month" data-agenda-month="${month}" aria-labelledby="agenda-month-${month}">
        <header class="agenda-month-header">
          <h2 id="agenda-month-${month}">${escapeHtml(monthFormat.format(new Date(`${month}-01T12:00:00Z`)))}</h2>
        </header>
        <div class="agenda-days">${entriesForAgendaMonth(month).map(agendaDay).join("")}</div>
      </section>`).join("");
    agendaDaysEl.querySelectorAll("[data-agenda-note]").forEach(resizeNoteField);
    if (scrollToToday) {
      requestAnimationFrame(() => {
        const target = agendaDaysEl.querySelector(`[data-agenda-date="${todayKey}"]`);
        target?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    }
  }

  let activeView = null;

  function closestVisibleWeek(selector, datasetKey) {
    const elements = [...document.querySelectorAll(selector)].filter(element => element.dataset[datasetKey]);
    if (!elements.length) return null;
    const viewportMiddle = window.innerHeight / 2;
    const closest = elements.reduce((best, element) => {
      const rect = element.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportMiddle);
      return !best || distance < best.distance ? { element, distance } : best;
    }, null);
    return Number(closest.element.dataset[datasetKey]) || null;
  }

  function scrollToWeek(view, week) {
    let target;
    if (view === "agenda") {
      const firstWeekDay = agendaDaysEl.querySelector(`[data-agenda-week="${week}"]`);
      const monday = firstWeekDay ? mondayDateKey(firstWeekDay.dataset.agendaDate) : "";
      target = agendaDaysEl.querySelector(`[data-agenda-date="${monday}"]`) || firstWeekDay;
    } else {
      target = weeksEl.querySelector(`[data-week="${week}"]`);
    }
    requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function setView(view, swipeDirection = 0) {
    if (view === activeView) {
      if (view === "agenda") renderAgenda(true);
      return;
    }
    let targetWeek = null;
    if (activeView === "agenda") {
      targetWeek = closestVisibleWeek(".agenda-day[data-agenda-week]", "agendaWeek");
    } else if (activeView === "prospetto") {
      targetWeek = closestVisibleWeek(".week[data-week]", "week");
    }

    const agendaIsActive = view === "agenda";
    prospettoView.hidden = agendaIsActive;
    agendaView.hidden = !agendaIsActive;
    document.querySelectorAll("[data-app-view]").forEach(button => {
      const active = button.dataset.appView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (agendaIsActive) {
      renderAgenda(true);
    } else if (targetWeek) {
      scrollToWeek("prospetto", targetWeek);
    }
    activeView = view;
    if (swipeDirection && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const incomingView = agendaIsActive ? agendaView : prospettoView;
      const startOffset = swipeDirection < 0 ? "28px" : "-28px";
      incomingView.animate(
        [{ transform: `translateX(${startOffset})`, opacity: 0.72 }, { transform: "translateX(0)", opacity: 1 }],
        { duration: 190, easing: "ease-out" }
      );
    }
  }

  function openTurn(turn, group, displayTurn = `MS${turn}`) {
    const ferialDetails = detailFor(turn).filter(item => item.source === "Feriale");
    dialogTitle.textContent = `Turno ${displayTurn}`;
    dialogGroup.textContent = group;
    if (!ferialDetails.length) {
      dialogBody.innerHTML = '<p class="no-details">Scheda dettagliata non disponibile.</p>';
    } else {
      dialogBody.innerHTML = `<div class="detail-body">${ferialDetails.map(item => renderDetail(item, ferialDetails.length > 1)).join("")}</div>`;
    }
    dialog.showModal();
    dialog.querySelectorAll(".activity-wrap").forEach(wrap => { wrap.scrollLeft = 0; });
  }

  function variantLabel(variant) {
    if (/escluso sabato/i.test(variant)) return "Da lunedì a venerdì";
    if (/^sabato$/i.test(variant)) return "Sabato";
    return "";
  }

  function minutesFromTime(value) {
    const [hours, minutes] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? (hours * 60) + minutes : null;
  }

  function pauseDuration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} ${minutes === 1 ? "minuto" : "minuti"}`;
    if (!minutes) return `${hours} ${hours === 1 ? "ora" : "ore"}`;
    return `${hours} ${hours === 1 ? "ora" : "ore"} e ${minutes} ${minutes === 1 ? "minuto" : "minuti"}`;
  }

  function edgeRow(label, start, end) {
    return `
      <tr class="edge-row">
        <td><strong>${escapeHtml(label)}</strong></td>
        <td class="activity-time">${escapeHtml(start)}–${escapeHtml(end)}</td>
      </tr>`;
  }

  function timelineRows(item) {
    const activities = item.activities || [];
    const rows = [];
    const firstLineIndex = activities.findIndex(row => row.line);
    let lastLineIndex = -1;
    activities.forEach((row, index) => { if (row.line) lastLineIndex = index; });
    if (firstLineIndex < 0) return "";

    const firstLine = activities[firstLineIndex];
    if (item.start && firstLine.start && item.start !== firstLine.start) {
      rows.push(edgeRow(
        "Pre-ripresa",
        item.start,
        firstLine.start,
        item.depot || activities[0]?.from,
        firstLine.from
      ));
    }

    activities.forEach((row, index) => {
      if (index < firstLineIndex || index > lastLineIndex) return;
      if (row.line) {
        rows.push(`
          <tr>
            <td><strong>${escapeHtml(row.line)}</strong></td>
            <td class="activity-time">${escapeHtml(row.start)}–${escapeHtml(row.end)}</td>
          </tr>`);
      }

      const next = activities[index + 1];
      if (!next || index >= lastLineIndex) return;
      const previousEnd = minutesFromTime(row.end);
      let nextStart = minutesFromTime(next.start);
      if (previousEnd === null || nextStart === null) return;
      if (nextStart < previousEnd) nextStart += 24 * 60;
      const duration = nextStart - previousEnd;
      if (duration > 30) {
        rows.push(`
          <tr class="pause-row">
            <td colspan="2"><strong>Pausa</strong> dalle ore ${escapeHtml(row.end)} alle ore ${escapeHtml(next.start)}<span class="pause-duration">Durata: ${escapeHtml(pauseDuration(duration))}</span></td>
          </tr>`);
      }
    });

    const lastLine = activities[lastLineIndex];
    if (lastLine.end && item.end && lastLine.end !== item.end) {
      rows.push(edgeRow(
        "Rientro in deposito / Fine turno",
        lastLine.end,
        item.end,
        lastLine.to,
        item.depot || activities[activities.length - 1]?.to
      ));
    }
    return rows.join("");
  }

  function renderDetail(item, showVariant) {
    const lineActivities = item.activities.filter(row => row.line);
    const title = showVariant && variantLabel(item.variant)
      ? `<h3 class="schedule-variant__title">${escapeHtml(variantLabel(item.variant))}</h3>`
      : "";
    const activities = lineActivities.length ? `
      <div class="activity-wrap">
        <table class="activity-table">
          <thead><tr><th>Linea / attività</th><th>Orario</th></tr></thead>
          <tbody>${timelineRows(item)}</tbody>
        </table>
      </div>` : '<p class="no-details">Nessuna linea di servizio indicata per questo turno.</p>';

    return `
      <section class="schedule-variant">
        ${title}
        <div class="shift-times">
          <div class="shift-time"><span>Inizio turno</span><strong>${escapeHtml(item.start || "—")}</strong></div>
          <div class="shift-time"><span>Fine turno</span><strong>${escapeHtml(item.end || "—")}</strong></div>
        </div>
        <h3 class="lines-title">Linee e orari</h3>
        ${activities}
      </section>`;
  }

  weeksEl.addEventListener("click", event => {
    const vacationButton = event.target.closest("[data-vacation-week]");
    if (vacationButton) {
      const key = vacationButton.dataset.vacationWeek;
      vacationWeeks.has(key) ? vacationWeeks.delete(key) : vacationWeeks.add(key);
      const selected = vacationWeeks.has(key);
      const action = selected ? "Togli ferie" : "Segna ferie";
      const control = vacationButton.closest(".vacation-control");
      const status = control?.querySelector(".vacation-status");
      if (status) status.hidden = !selected;
      vacationButton.setAttribute("aria-pressed", String(selected));
      vacationButton.setAttribute("aria-label", `${action} per la settimana ${key}`);
      vacationButton.textContent = action;
      vacationButton.closest("details")?.removeAttribute("open");
      saveVacationWeeks();
      renderAgenda();
      return;
    }
    const button = event.target.closest("[data-open-turn]");
    if (button) openTurn(button.dataset.openTurn, button.dataset.group, button.dataset.displayTurn || `MS${button.dataset.openTurn}`);
  });

  document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  document.querySelectorAll("[data-app-view]").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.appView));
  });
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeTracking = false;

  document.querySelector(".schedule-board").addEventListener("touchstart", event => {
    if (event.touches.length !== 1 || event.target.closest("button, input, textarea, select, a, dialog")) {
      swipeTracking = false;
      return;
    }
    swipeStartX = event.touches[0].clientX;
    swipeStartY = event.touches[0].clientY;
    swipeTracking = true;
  }, { passive: true });

  document.querySelector(".schedule-board").addEventListener("touchend", event => {
    if (!swipeTracking || event.changedTouches.length !== 1) return;
    swipeTracking = false;
    const deltaX = event.changedTouches[0].clientX - swipeStartX;
    const deltaY = event.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    if (activeView === "agenda" && deltaX < 0) setView("prospetto", -1);
    if (activeView === "prospetto" && deltaX > 0) setView("agenda", 1);
  }, { passive: true });

  agendaDaysEl.addEventListener("input", event => {
    const field = event.target.closest("[data-agenda-note]");
    if (field) saveInlineNote(field);
  });
  window.addEventListener("pageshow", () => {
    if (activeView === "agenda") renderAgenda(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) scheduleCloudSave(0);
    else if (activeView === "agenda") renderAgenda(true);
  });
  window.addEventListener("pagehide", () => scheduleCloudSave(0));
  renderWeeks();
  setView("agenda");
  initCloudSync();
})();

