(() => {
  "use strict";

  const data = window.PROSPETTO_DATA;
  const STORAGE_KEY = "prospetto-cambi-turno:selected-v1";
  const VACATION_STORAGE_KEY = "prospetto-cambi-turno:vacations-v1";
  const weeksEl = document.querySelector("#weeks");
  const dialog = document.querySelector("#turnDialog");
  const dialogBody = document.querySelector("#dialogBody");
  const dialogTitle = document.querySelector("#dialogTitle");
  const dialogGroup = document.querySelector("#dialogGroup");
  const EVENING_TURNS = new Set(["128", "154", "156", "158"]);
  const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
  let selections = loadSelections();
  let vacationWeeks = loadVacationWeeks();

  function loadSelections() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function saveSelections() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selections]));
  }

  function loadVacationWeeks() {
    try { return new Set(JSON.parse(localStorage.getItem(VACATION_STORAGE_KEY) || "[]"));
    } catch { return new Set(); }
  }

  function saveVacationWeeks() {
    localStorage.setItem(VACATION_STORAGE_KEY, JSON.stringify([...vacationWeeks]));
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
      return;
    }
    const button = event.target.closest("[data-open-turn]");
    if (button) openTurn(button.dataset.openTurn, button.dataset.group, button.dataset.displayTurn || `MS${button.dataset.openTurn}`);
  });

  document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  renderWeeks();
})();
