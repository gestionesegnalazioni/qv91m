(() => {
  "use strict";

  const data = window.PROSPETTO_DATA;
  const STORAGE_KEY = "prospetto-cambi-turno:selected-v1";
  const VACATION_STORAGE_KEY = "prospetto-cambi-turno:vacations-v1";
  const AGENDA_DAY_STORAGE_KEY = "prospetto-cambi-turno:agenda-days-v1";
  const weeksEl = document.querySelector("#weeks");
  const prospettoView = document.querySelector("#prospettoView");
  const agendaView = document.querySelector("#agendaView");
  const agendaDaysEl = document.querySelector("#agendaDays");
  const agendaMonthTitle = document.querySelector("#agendaMonthTitle");
  const agendaPrevious = document.querySelector("#agendaPrevious");
  const agendaNext = document.querySelector("#agendaNext");
  const agendaEditDialog = document.querySelector("#agendaEditDialog");
  const agendaEditTitle = document.querySelector("#agendaEditTitle");
  const agendaNote = document.querySelector("#agendaNote");
  const syncStatus = document.querySelector("#syncStatus");
  const syncButton = document.querySelector("#syncButton");
  const dialog = document.querySelector("#turnDialog");
  const dialogBody = document.querySelector("#dialogBody");
  const dialogTitle = document.querySelector("#dialogTitle");
  const dialogGroup = document.querySelector("#dialogGroup");
  const EVENING_TURNS = new Set(["128", "154", "156", "158"]);
  const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
  const monthFormat = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdayFormat = new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" });
  const agendaEntries = Array.isArray(data.agenda) ? data.agenda : [];
  const agendaMonths = [...new Set(agendaEntries.map(entry => entry.date.slice(0, 7)))];
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  let agendaMonthIndex = Math.max(0, agendaMonths.indexOf(currentMonthKey));
  let selections = loadSelections();
  let vacationWeeks = loadVacationWeeks();
  let agendaDayData = loadAgendaDayData();
  let editingAgendaDate = "";
  let pendingAgendaStatus = "none";
  let cloudUser = null;
  let cloudDocument = null;
  let cloudReady = false;
  let cloudSaveTimer = null;
  let loginRecoveryTimer = null;
  let stopCloudListener = null;
  let firebaseServices = null;

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

  function saveAgendaDayData() {
    localStorage.setItem(AGENDA_DAY_STORAGE_KEY, JSON.stringify(agendaDayData));
    scheduleCloudSave();
  }

  function setSyncState(message, mode = "idle", showButton = false) {
    syncStatus.textContent = message;
    syncStatus.dataset.mode = mode;
    syncButton.hidden = !showButton;
  }

  function storeCloudDataLocally(payload) {
    selections = new Set(Array.isArray(payload.selections) ? payload.selections : []);
    vacationWeeks = new Set(Array.isArray(payload.vacationWeeks) ? payload.vacationWeeks : []);
    agendaDayData = payload.agendaDayData && typeof payload.agendaDayData === "object" ? payload.agendaDayData : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selections]));
    localStorage.setItem(VACATION_STORAGE_KEY, JSON.stringify([...vacationWeeks]));
    localStorage.setItem(AGENDA_DAY_STORAGE_KEY, JSON.stringify(agendaDayData));
    renderWeeks();
    renderAgenda();
  }

  function cloudPayload() {
    return {
      selections: [...selections],
      vacationWeeks: [...vacationWeeks],
      agendaDayData,
      updatedAt: firebaseServices.serverTimestamp()
    };
  }

  async function saveToCloud() {
    if (!cloudReady || !cloudUser || !cloudDocument || !firebaseServices) return;
    setSyncState("Salvataggio…", "saving");
    try {
      await firebaseServices.setDoc(cloudDocument, cloudPayload(), { merge: true });
      setSyncState("Dati sincronizzati", "synced");
    } catch (error) {
      console.error("Salvataggio online non riuscito", error);
      setSyncState("Sincronizzazione non riuscita", "error", true);
    }
  }

  function scheduleCloudSave() {
    if (!cloudReady || !cloudUser) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(saveToCloud, 350);
  }

  async function connectCloudUser(user) {
    clearTimeout(loginRecoveryTimer);
    cloudReady = false;
    cloudUser = user;
    if (stopCloudListener) stopCloudListener();
    stopCloudListener = null;
    if (!user) {
      cloudDocument = null;
      setSyncState("Dati salvati su questo dispositivo", "local", true);
      return;
    }

    setSyncState("Caricamento dati online…", "saving");
    cloudDocument = firebaseServices.doc(firebaseServices.db, "prospettoCambiTurno", user.uid);
    try {
      const snapshot = await firebaseServices.getDoc(cloudDocument);
      if (snapshot.exists()) {
        storeCloudDataLocally(snapshot.data());
      } else {
        await firebaseServices.setDoc(cloudDocument, cloudPayload());
      }
      cloudReady = true;
      setSyncState("Dati sincronizzati", "synced");
      stopCloudListener = firebaseServices.onSnapshot(cloudDocument, remote => {
        if (!remote.exists() || !cloudReady) return;
        storeCloudDataLocally(remote.data());
        setSyncState("Dati sincronizzati", "synced");
      }, error => {
        console.error("Aggiornamento online non disponibile", error);
        setSyncState("Sincronizzazione non riuscita", "error", true);
      });
    } catch (error) {
      console.error("Collegamento al database non riuscito", error);
      setSyncState("Sincronizzazione non riuscita", "error", true);
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
        provider: new firebaseAuth.GoogleAuthProvider(),
        signInWithPopup: firebaseAuth.signInWithPopup,
        signInWithRedirect: firebaseAuth.signInWithRedirect,
        getRedirectResult: firebaseAuth.getRedirectResult,
        db: firestore.getFirestore(app),
        doc: firestore.doc,
        getDoc: firestore.getDoc,
        setDoc: firestore.setDoc,
        onSnapshot: firestore.onSnapshot,
        serverTimestamp: firestore.serverTimestamp
      };
      firebaseAuth.onAuthStateChanged(auth, connectCloudUser);
      firebaseAuth.getRedirectResult(auth).then(result => {
        sessionStorage.removeItem("prospetto-sync-login");
        if (!result && !auth.currentUser) {
          setSyncState("Dati salvati su questo dispositivo", "local", true);
        }
      }).catch(error => {
        console.error("Rientro dall’accesso Google non riuscito", error);
        sessionStorage.removeItem("prospetto-sync-login");
        setSyncState("Accedi per sincronizzare", "error", true);
      });
    } catch (error) {
      console.error("Firebase non disponibile", error);
      setSyncState("Dati salvati su questo dispositivo", "local", true);
    }
  }

  async function requestCloudLogin() {
    if (!firebaseServices) {
      setSyncState("Connessione non disponibile", "error", true);
      return;
    }
    syncButton.disabled = true;
    setSyncState("Accesso in corso…", "saving");
    clearTimeout(loginRecoveryTimer);
    loginRecoveryTimer = setTimeout(() => {
      if (!cloudUser) {
        syncButton.disabled = false;
        setSyncState("Accesso non completato: riprova", "error", true);
      }
    }, 12000);
    try {
      const isIphone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isIphone) {
        sessionStorage.setItem("prospetto-sync-login", "1");
        await firebaseServices.signInWithRedirect(firebaseServices.auth, firebaseServices.provider);
        return;
      }
      await firebaseServices.signInWithPopup(firebaseServices.auth, firebaseServices.provider);
    } catch (error) {
      console.error("Accesso Google non riuscito", error);
      clearTimeout(loginRecoveryTimer);
      setSyncState("Accedi per sincronizzare", "local", true);
    } finally {
      syncButton.disabled = false;
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
    return `Solo ${italianDayList(days)}`;
  }

  function personRow(week, group, turn, person, days = [], open = false) {
    const key = selectionKey(week, group, turn, person, days);
    const selected = selections.has(key);
    const daysHtml = days.length ? `<small class="person__days">${escapeHtml(dayLabel(days))}</small>` : "";
    return `
      <label class="person${selected ? " is-selected" : ""}${open ? " person--open" : ""}" data-selection="${escapeHtml(key)}">
        <input type="checkbox" ${selected ? "checked" : ""} aria-label="Segna cambio con ${escapeHtml(person)}">
        <span class="person__text">${escapeHtml(person)}${daysHtml}</span>
      </label>`;
  }

  function turnRow(week, group, item) {
    const people = [personRow(week, group, item.turn, item.base, [], item.base === "SCOPERTO")]
      .concat(item.variations.map(v => personRow(week, group, item.turn, v.person, v.days)))
      .join("");
    const eveningClass = EVENING_TURNS.has(String(item.turn)) ? " turn__number--evening" : "";
    return `
      <div class="turn">
        <button class="turn__number${eveningClass}" type="button" data-open-turn="${item.turn}" data-group="${group}" title="Apri il turno MS${item.turn}">MS${item.turn}</button>
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
        const eveningClass = EVENING_TURNS.has(value) ? " rotation-code--evening" : "";
        return `<button class="rotation-code rotation-code--button${eveningClass}" type="button" data-open-turn="${escapeHtml(value)}" data-group="Il mio turno" data-display-turn="${escapeHtml(value)}" title="Apri il mio turno ${escapeHtml(value)}">${escapeHtml(value)}</button>`;
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
    return `<div class="week__actions"><div class="week__action-row">${vacationControl(week)}${ownTurnControl(week)}</div>${restCaption}</div>`;
  }

  function renderWeeks() {
    weeksEl.innerHTML = data.weeks.map(week => `
      <article class="week">
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
    return turn === "RIP" ? "RIPOSO" : turn;
  }

  function selectedChangesFor(entry) {
    if (entry.day === "DOM" || entry.turn === "RIP") return [];
    return [...selections].map(key => {
      const [week, group, turn, person, selectedDays] = key.split("|");
      return { week: Number(week), group, turn, person, selectedDays };
    }).filter(change => {
      if (change.week !== entry.week) return false;
      if (change.selectedDays === "base") return true;
      return change.selectedDays.split(",").includes(entry.day);
    });
  }

  function agendaDay(entry) {
    const date = new Date(`${entry.date}T12:00:00Z`);
    const weekday = weekdayFormat.format(date).replace(".", "").toUpperCase();
    const dayNumber = date.getUTCDate();
    const saved = agendaDayData[entry.date] || {};
    const weeklyVacation = vacationWeeks.has(String(entry.week));
    const vacationStatus = saved.vacationStatus === "none"
      ? ""
      : saved.vacationStatus || (weeklyVacation ? "requested" : "");
    const changes = selectedChangesFor(entry);
    const changeTurns = [...new Set(changes.map(change => `MS${change.turn}`))].join(" · ");
    const colleagues = [...new Set(changes.map(change => change.person === "SCOPERTO" ? "turno scoperto" : change.person))].join(", ");
    const stateClasses = [
      entry.turn === "RIP" ? "agenda-day--rest" : "",
      changes.length ? "agenda-day--change" : "",
      vacationStatus ? `agenda-day--vacation-${vacationStatus}` : "",
      entry.day === "DOM" ? "agenda-day--sunday" : ""
    ].filter(Boolean).join(" ");
    const vacationBadge = vacationStatus === "approved"
      ? '<span class="agenda-status agenda-status--approved">FERIE CONCESSE</span>'
      : vacationStatus === "requested"
        ? '<span class="agenda-status agenda-status--requested">FERIE RICHIESTE</span>'
        : "";
    const note = saved.note
      ? `<p class="agenda-day__note"><strong>Nota:</strong> ${escapeHtml(saved.note)}</p>`
      : "";

    return `
      <article class="agenda-day${stateClasses ? ` ${stateClasses}` : ""}">
        <div class="agenda-date"><span>${escapeHtml(weekday)}</span><strong>${dayNumber}</strong></div>
        <div class="agenda-day__content">
          <div class="agenda-info-row">
            <span class="agenda-day__label">Turno previsto</span>
            <strong class="agenda-day__turn">${escapeHtml(agendaTurnLabel(entry.turn))}</strong>
          </div>
          <div class="agenda-info-row agenda-info-row--change">
            <span class="agenda-day__label">Cambio turno</span>
            <div>
              <strong class="agenda-day__change-turn">${escapeHtml(changeTurns || "—")}</strong>
              ${colleagues ? `<span class="agenda-day__colleague">${escapeHtml(colleagues)}</span>` : ""}
            </div>
          </div>
          ${vacationBadge}${note}
        </div>
        <div class="agenda-day__tools">
          <span class="agenda-day__week">Sett. ${entry.week}</span>
          <button class="agenda-day__menu" type="button" data-edit-agenda="${entry.date}" aria-label="Opzioni per ${entry.date}" title="Ferie e note">⋯</button>
        </div>
      </article>`;
  }

  function renderAgenda() {
    if (!agendaMonths.length) {
      agendaMonthTitle.textContent = "Agenda";
      agendaDaysEl.innerHTML = '<p class="loading-status loading-status--error">Dati dell’agenda non disponibili.</p>';
      return;
    }
    const month = agendaMonths[agendaMonthIndex];
    agendaMonthTitle.textContent = monthFormat.format(new Date(`${month}-01T12:00:00Z`));
    agendaPrevious.disabled = agendaMonthIndex === 0;
    agendaNext.disabled = agendaMonthIndex === agendaMonths.length - 1;
    agendaDaysEl.innerHTML = agendaEntries.filter(entry => entry.date.startsWith(month)).map(agendaDay).join("");
  }

  function setPendingAgendaStatus(status) {
    pendingAgendaStatus = status;
    agendaEditDialog.querySelectorAll("[data-agenda-status]").forEach(button => {
      const selected = button.dataset.agendaStatus === status;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function openAgendaEditor(date) {
    const entry = agendaEntries.find(item => item.date === date);
    if (!entry) return;
    editingAgendaDate = date;
    const saved = agendaDayData[date] || {};
    const weeklyVacation = vacationWeeks.has(String(entry.week));
    const status = saved.vacationStatus || (weeklyVacation ? "requested" : "none");
    agendaEditTitle.textContent = new Intl.DateTimeFormat("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(`${date}T12:00:00Z`));
    agendaNote.value = saved.note || "";
    setPendingAgendaStatus(status);
    agendaEditDialog.showModal();
  }

  function closeAgendaEditor() {
    editingAgendaDate = "";
    agendaEditDialog.close();
  }

  function saveAgendaEditor() {
    if (!editingAgendaDate) return;
    const entry = agendaEntries.find(item => item.date === editingAgendaDate);
    const note = agendaNote.value.trim();
    const needsWeeklyOverride = entry && vacationWeeks.has(String(entry.week)) && pendingAgendaStatus === "none";
    if (!note && pendingAgendaStatus === "none" && !needsWeeklyOverride) {
      delete agendaDayData[editingAgendaDate];
    } else {
      agendaDayData[editingAgendaDate] = {
        vacationStatus: pendingAgendaStatus,
        note
      };
    }
    saveAgendaDayData();
    closeAgendaEditor();
    renderAgenda();
  }

  function clearAgendaEditor() {
    if (!editingAgendaDate) return;
    delete agendaDayData[editingAgendaDate];
    saveAgendaDayData();
    closeAgendaEditor();
    renderAgenda();
  }

  function setView(view) {
    const agendaIsActive = view === "agenda";
    prospettoView.hidden = agendaIsActive;
    agendaView.hidden = !agendaIsActive;
    document.querySelectorAll("[data-app-view]").forEach(button => {
      const active = button.dataset.appView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (agendaIsActive) renderAgenda();
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

  weeksEl.addEventListener("change", event => {
    const checkbox = event.target.closest('.person input[type="checkbox"]');
    if (!checkbox) return;
    const label = checkbox.closest(".person");
    const key = label.dataset.selection;
    checkbox.checked ? selections.add(key) : selections.delete(key);
    label.classList.toggle("is-selected", checkbox.checked);
    saveSelections();
    renderAgenda();
  });

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
  agendaPrevious.addEventListener("click", () => {
    if (agendaMonthIndex > 0) {
      agendaMonthIndex -= 1;
      renderAgenda();
    }
  });
  agendaNext.addEventListener("click", () => {
    if (agendaMonthIndex < agendaMonths.length - 1) {
      agendaMonthIndex += 1;
      renderAgenda();
    }
  });
  agendaDaysEl.addEventListener("click", event => {
    const button = event.target.closest("[data-edit-agenda]");
    if (button) openAgendaEditor(button.dataset.editAgenda);
  });
  agendaEditDialog.querySelectorAll("[data-agenda-status]").forEach(button => {
    button.addEventListener("click", () => setPendingAgendaStatus(button.dataset.agendaStatus));
  });
  document.querySelector("#saveAgendaEdit").addEventListener("click", saveAgendaEditor);
  document.querySelector("#clearAgendaEdit").addEventListener("click", clearAgendaEditor);
  document.querySelector("#closeAgendaEdit").addEventListener("click", closeAgendaEditor);
  agendaEditDialog.addEventListener("click", event => {
    if (event.target === agendaEditDialog) closeAgendaEditor();
  });
  syncButton.addEventListener("click", requestCloudLogin);
  renderWeeks();
  renderAgenda();
  setView("agenda");
  initCloudSync();
})();
