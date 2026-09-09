(() => {
  "use strict";

  const data = window.PROSPETTO_DATA;
  const STORAGE_KEY = "prospetto-cambi-turno:selected-v1";
  const weeksEl = document.querySelector("#weeks");
  const dialog = document.querySelector("#turnDialog");
  const dialogBody = document.querySelector("#dialogBody");
  const dialogTitle = document.querySelector("#dialogTitle");
  const dialogGroup = document.querySelector("#dialogGroup");
  const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
  let selections = loadSelections();

  function loadSelections() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function saveSelections() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selections]));
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

  function dayLabel(days) {
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
    if (fullDays.length === 1) return `Solo ${fullDays[0]}`;
    if (fullDays.length === 2) return `Solo ${fullDays[0]} e ${fullDays[1]}`;
    return `Solo ${fullDays.slice(0, -1).join(", ")} e ${fullDays.at(-1)}`;
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

  function ownTurnControl(week) {
    if (/^\d+$/.test(week.code)) {
      const displayTurn = week.code;
      return `<button class="rotation-code rotation-code--button" type="button" data-open-turn="${week.code}" data-group="Il mio turno" data-display-turn="${displayTurn}" title="Apri il mio turno ${displayTurn}">${displayTurn}</button>`;
    }
    return `<span class="rotation-code">${escapeHtml(week.code)}</span>`;
  }

  function renderWeeks() {
    weeksEl.innerHTML = data.weeks.map(week => `
      <article class="week">
        <header class="week__header">
          <div>
            <h1>Settimana ${week.index}</h1>
            <p class="week__dates">${shortDate(week.start)} – ${shortDate(week.end)}</p>
          </div>
          ${ownTurnControl(week)}
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

  function formatDuration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} min`;
    if (!minutes) return `${hours} ${hours === 1 ? "ora" : "ore"}`;
    return `${hours} ${hours === 1 ? "ora" : "ore"} ${minutes} min`;
  }

  function findBreaks(activities) {
    return activities.slice(1).map((row, index) => {
      const previous = activities[index];
      const previousEnd = minutesFromTime(previous.end);
      let nextStart = minutesFromTime(row.start);
      if (previousEnd === null || nextStart === null) return null;
      if (nextStart < previousEnd) nextStart += 24 * 60;
      const duration = nextStart - previousEnd;
      return duration >= 30 ? { start: previous.end, end: row.start, duration } : null;
    }).filter(Boolean);
  }

  function renderDetail(item, showVariant) {
    const lineActivities = item.activities.filter(row => row.line);
    const breaks = findBreaks(item.activities);
    const title = showVariant && variantLabel(item.variant)
      ? `<h3 class="schedule-variant__title">${escapeHtml(variantLabel(item.variant))}</h3>`
      : "";
    const activities = lineActivities.length ? `
      <div class="activity-wrap">
        <table class="activity-table">
          <thead><tr><th>Linea</th><th>Orario</th><th>Da</th><th>A</th></tr></thead>
          <tbody>${lineActivities.map(row => `
            <tr>
              <td><strong>${escapeHtml(row.line)}</strong></td>
              <td class="activity-time">${escapeHtml(row.start)}–${escapeHtml(row.end)}</td>
              <td>${escapeHtml(row.from)}</td><td>${escapeHtml(row.to)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>` : '<p class="no-details">Nessuna linea di servizio indicata per questo turno.</p>';

    const breakDetails = breaks.length
      ? breaks.map((pause, index) => `
          <div class="break-entry">
            ${breaks.length > 1 ? `<small>Stacco ${index + 1}</small>` : ""}
            <strong>${escapeHtml(pause.start)}–${escapeHtml(pause.end)}</strong>
            <span>${escapeHtml(formatDuration(pause.duration))}</span>
          </div>`).join("")
      : '<strong class="no-break">Nessuno stacco</strong>';

    return `
      <section class="schedule-variant">
        ${title}
        <div class="shift-times">
          <div class="shift-time"><span>Inizio turno</span><strong>${escapeHtml(item.start || "—")}</strong></div>
          <div class="shift-time"><span>Fine turno</span><strong>${escapeHtml(item.end || "—")}</strong></div>
          <div class="shift-time shift-time--break"><span>Sosta / stacco</span>${breakDetails}</div>
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
    const button = event.target.closest("[data-open-turn]");
    if (button) openTurn(button.dataset.openTurn, button.dataset.group, button.dataset.displayTurn || `MS${button.dataset.openTurn}`);
  });

  document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  renderWeeks();
})();
