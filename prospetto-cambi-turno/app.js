(() => {
  "use strict";

  const data = window.PROSPETTO_DATA;
  const STORAGE_KEY = "prospetto-cambi-turno:selected-v1";
  const weeksEl = document.querySelector("#weeks");
  const dialog = document.querySelector("#turnDialog");
  const dialogBody = document.querySelector("#dialogBody");
  const dialogTitle = document.querySelector("#dialogTitle");
  const dialogGroup = document.querySelector("#dialogGroup");
  const variantTabs = document.querySelector("#variantTabs");
  const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
  let activeDetails = [];
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

  function personRow(week, group, turn, person, days = [], open = false) {
    const key = selectionKey(week, group, turn, person, days);
    const selected = selections.has(key);
    const daysHtml = days.length ? `<small class="person__days">${escapeHtml(days.join(", "))}</small>` : "";
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

  function renderWeeks() {
    weeksEl.innerHTML = data.weeks.map(week => `
      <article class="week">
        <header class="week__header">
          <div>
            <h1>Settimana ${week.index}</h1>
            <p class="week__dates">${shortDate(week.start)} – ${shortDate(week.end)}</p>
          </div>
          <span class="rotation-code">${escapeHtml(week.code)}</span>
        </header>
        <div class="week__groups">${week.groups.map(group => groupColumn(week, group)).join("")}</div>
      </article>`).join("");
    document.querySelector("#loadingStatus")?.remove();
  }

  function openTurn(turn, group) {
    activeDetails = detailFor(turn);
    dialogTitle.textContent = `Turno MS${turn}`;
    dialogGroup.textContent = group;
    if (!activeDetails.length) {
      variantTabs.innerHTML = "";
      dialogBody.innerHTML = '<p class="no-details">Scheda dettagliata non disponibile.</p>';
    } else {
      variantTabs.innerHTML = activeDetails.map((item, index) => `
        <button class="variant-tab" type="button" role="tab" data-variant-index="${index}" aria-selected="${index === 0}">${escapeHtml(item.variant)}</button>`).join("");
      renderDetail(0);
    }
    dialog.showModal();
  }

  function summaryItem(label, value) {
    return `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
  }

  function renderDetail(index) {
    const item = activeDetails[index];
    variantTabs.querySelectorAll(".variant-tab").forEach((tab, i) => tab.setAttribute("aria-selected", String(i === index)));
    const activities = item.activities.length ? `
      <div class="activity-wrap">
        <table class="activity-table">
          <thead><tr><th>N.</th><th>TM</th><th>Linea</th><th>Attività</th><th>Da</th><th>Orario</th><th>A</th></tr></thead>
          <tbody>${item.activities.map(row => `
            <tr>
              <td>${escapeHtml(row.n)}</td><td>${escapeHtml(row.tm)}</td><td>${escapeHtml(row.line || "—")}</td>
              <td>${escapeHtml(row.activity)}</td><td>${escapeHtml(row.from)}</td>
              <td class="activity-time">${escapeHtml(row.start)}–${escapeHtml(row.end)}</td><td>${escapeHtml(row.to)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>` : '<p class="no-details">Nessuna attività elencata.</p>';

    dialogBody.innerHTML = `
      <div class="detail-body">
        <div class="detail-summary">
          ${summaryItem("Inizio – fine", item.start && item.end ? `${item.start} – ${item.end}` : "—")}
          ${summaryItem("Nastro", item.span)}
          ${summaryItem("Lavoro", item.work)}
          ${summaryItem("Guida", item.drive)}
          ${summaryItem("Deposito", item.depot)}
          ${summaryItem("Tipologia", item.type)}
          ${summaryItem("Valido dal", item.validFrom)}
          ${summaryItem("Restrizione", item.restriction)}
        </div>
        <p class="detail-note"><strong>${escapeHtml(item.variant)}</strong></p>
        ${activities}
      </div>`;
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
    if (button) openTurn(button.dataset.openTurn, button.dataset.group);
  });

  variantTabs.addEventListener("click", event => {
    const tab = event.target.closest("[data-variant-index]");
    if (tab) renderDetail(Number(tab.dataset.variantIndex));
  });

  document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  renderWeeks();
})();
