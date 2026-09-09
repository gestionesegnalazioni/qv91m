(() => {
  "use strict";

  const data = window.PROSPETTO_DATA;
  const STORAGE_KEY = "prospetto-cambi-turno:selected-v1";
  const itDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const shortDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" });
  const weeksEl = document.querySelector("#weeks");
  const emptyEl = document.querySelector("#emptyState");
  const searchInput = document.querySelector("#searchInput");
  const groupFilter = document.querySelector("#groupFilter");
  const dialog = document.querySelector("#turnDialog");
  const dialogBody = document.querySelector("#dialogBody");
  const dialogTitle = document.querySelector("#dialogTitle");
  const dialogGroup = document.querySelector("#dialogGroup");
  const variantTabs = document.querySelector("#variantTabs");
  let selections = loadSelections();
  let activeDetails = [];

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

  function dateFromIso(value) { return new Date(`${value}T12:00:00Z`); }

  function weekDateLabel(week) {
    const start = dateFromIso(week.start);
    const end = dateFromIso(week.end);
    return start.getUTCFullYear() === end.getUTCFullYear()
      ? `${shortDate.format(start)} – ${itDate.format(end)}`
      : `${itDate.format(start)} – ${itDate.format(end)}`;
  }

  function normalize(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function selectionKey(week, group, turn, person, days) {
    return [week.index, group, turn, person, days.join(",") || "base"].join("|");
  }

  function findDetails(turn) { return data.turnDetails[`MS${turn}`] || []; }

  function primaryPreview(turn) {
    const details = findDetails(turn);
    const primary = details.find(item => item.source === "Feriale") || details[0];
    if (!primary) return "Dettaglio non disponibile";
    const times = primary.start && primary.end ? `${primary.start}–${primary.end}` : "orari da consultare";
    return `${primary.variant}: ${times}${primary.span ? ` · nastro ${primary.span}` : ""}`;
  }

  function personRow(week, group, turn, person, days = [], open = false) {
    const key = selectionKey(week, group, turn, person, days);
    const selected = selections.has(key);
    const dayLabel = days.length ? `<span class="person__days">${escapeHtml(days.join(", "))}</span>` : "";
    return `
      <label class="person${selected ? " is-selected" : ""}${open ? " person--open" : ""}" data-selection="${escapeHtml(key)}">
        <input type="checkbox" ${selected ? "checked" : ""} aria-label="Segna cambio con ${escapeHtml(person)}">
        <span class="person__text">${escapeHtml(person)} ${dayLabel}</span>
      </label>`;
  }

  function turnCard(week, group, item) {
    const details = findDetails(item.turn);
    const rows = [personRow(week, group, item.turn, item.base, [], item.base === "SCOPERTO")]
      .concat(item.variations.map(v => personRow(week, group, item.turn, v.person, v.days)))
      .join("");
    return `
      <article class="turn-card" data-turn="${item.turn}" data-group="${group}">
        <div class="turn-preview" role="tooltip">${escapeHtml(primaryPreview(item.turn))}</div>
        <div class="turn-card__top">
          <button class="turn-open" type="button" data-open-turn="${item.turn}" data-group="${group}" ${details.length ? "" : "aria-disabled=\"true\""}>MS${item.turn}</button>
          <span class="group-badge">${group}</span>
        </div>
        <div class="names">${rows}</div>
      </article>`;
  }

  function render() {
    const query = normalize(searchInput.value.trim());
    const wantedGroup = groupFilter.value;
    let visibleCards = 0;
    weeksEl.innerHTML = data.weeks.map(week => {
      const cards = week.groups.flatMap(group => group.turns.map(item => ({ group: group.name, item })))
        .filter(({ group }) => wantedGroup === "all" || group === wantedGroup)
        .filter(({ item }) => {
          if (!query) return true;
          const haystack = [item.turn, `ms${item.turn}`, item.base, ...item.variations.map(v => v.person)].join(" ");
          return normalize(haystack).includes(query);
        });
      if (!cards.length) return "";
      visibleCards += cards.length;
      return `
        <section class="week" id="settimana-${week.index}">
          <header class="week__header">
            <div><h2>Settimana ${week.index}</h2><p class="week__dates">${weekDateLabel(week)}</p></div>
            <span class="rotation-code" title="Codice rotazione della settimana">${escapeHtml(week.code)}</span>
          </header>
          <div class="turn-grid">${cards.map(({ group, item }) => turnCard(week, group, item)).join("")}</div>
        </section>`;
    }).join("");
    emptyEl.hidden = visibleCards > 0;
  }

  function openTurn(turn, group) {
    activeDetails = findDetails(turn);
    dialogTitle.textContent = `Turno MS${turn}`;
    dialogGroup.textContent = `${group} · scheda operativa`;
    if (!activeDetails.length) {
      variantTabs.innerHTML = "";
      dialogBody.innerHTML = '<p class="no-details">La scheda dettagliata di questo turno non è presente nei file caricati.</p>';
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
      </div>` : '<p class="no-details">Nessuna attività elencata nella scheda.</p>';

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
        <p class="detail-note"><strong>${escapeHtml(item.variant)}</strong> · dati estratti dalla scheda ${escapeHtml(item.source.toLowerCase())} 2026–2027.</p>
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
  searchInput.addEventListener("input", render);
  groupFilter.addEventListener("change", render);
  document.querySelector("#clearSelections").addEventListener("click", () => {
    if (!selections.size || confirm("Vuoi cancellare tutte le spunte salvate?")) {
      selections.clear(); saveSelections(); render();
    }
  });
  document.querySelector("#helpButton").addEventListener("click", event => {
    const panel = document.querySelector("#helpPanel");
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
  });

  render();
})();
