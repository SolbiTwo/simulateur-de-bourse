const balance = document.querySelector("#balance");
const positions = document.querySelector("#positions");
const transactions = document.querySelector("#transactions");
const quoteMarket = document.querySelector("#quoteMarket");
const quoteSymbol = document.querySelector("#quoteSymbol");
const quoteButton = document.querySelector("#quoteButton");
const quoteResult = document.querySelector("#quoteResult");
const tradeForm = document.querySelector("#tradeForm");
const tradeMarket = document.querySelector("#tradeMarket");
const tradeSymbol = document.querySelector("#tradeSymbol");
const tradeQuantity = document.querySelector("#tradeQuantity");
const tradeButton = document.querySelector("#tradeButton");
const tradeMessage = document.querySelector("#tradeMessage");
const refreshButton = document.querySelector("#refreshButton");
const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const victoryPointsEl = document.querySelector("#victoryPoints");
const friendForm = document.querySelector("#friendForm");
const friendUsername = document.querySelector("#friendUsername");
const friendMessage = document.querySelector("#friendMessage");
const friendsList = document.querySelector("#friendsList");
const tournamentForm = document.querySelector("#tournamentForm");
const tournamentName = document.querySelector("#tournamentName");
const tournamentDuration = document.querySelector("#tournamentDuration");
const tournamentBudget = document.querySelector("#tournamentBudget");
const tournamentPrivacy = document.querySelector("#tournamentPrivacy");
const tournamentMessage = document.querySelector("#tournamentMessage");
const tournamentsList = document.querySelector("#tournamentsList");
const segments = document.querySelectorAll(".segment");

let currentAction = "acheter";

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function formatPrice(value, currency = "USD") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

async function api(url, options = {}) {
  const token = localStorage.getItem("token");

  if (!token) {
    window.location.href = "/login.html";
    return Promise.reject(new Error("Token manquant"));
  }

  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return Promise.reject(new Error("Token invalide"));
    }

    throw new Error(data.message || "Une erreur est survenue.");
  }

  return data;
}

function updateAuthButtons() {
  const token = localStorage.getItem("token");

  if (token) {
    loginButton.style.display = "none";
    logoutButton.style.display = "inline-block";
  } else {
    loginButton.style.display = "inline-block";
    logoutButton.style.display = "none";
  }
}

function setMessage(element, message, type = "muted") {
  element.className = type;
  element.textContent = message;
}

function renderPositions(items) {
  if (!items.length) {
    positions.innerHTML = '<div class="empty">Aucune action pour le moment.</div>';
    return;
  }

  positions.innerHTML = items
    .map((item) => `
      <div class="position-row">
        <div>
          <div class="symbol">${item.symbole}</div>
          <div class="muted">Position ouverte</div>
        </div>
        <div class="quantity">${item.quantite}</div>
      </div>
    `)
    .join("");
}

function renderTransactions(items) {
  if (!items.length) {
    transactions.innerHTML = '<div class="empty">Aucune operation enregistree.</div>';
    return;
  }

  transactions.innerHTML = items
    .map((item) => `
      <div class="history-row">
        <span class="badge ${item.type === "ACHAT" ? "buy" : "sell"}">${item.type}</span>
        <div>
          <div class="symbol">${item.symbole} x ${item.quantite}</div>
          <div class="muted">${formatDate(item.date)}</div>
        </div>
        <div class="money">${formatMoney(item.total)}</div>
      </div>
    `)
    .join("");
}

async function renderFriends(items) {
  if (!items || !items.length) {
    friendsList.innerHTML = '<div class="empty">Aucun ami enregistré.</div>';
    return;
  }

  friendsList.innerHTML = items
    .map((item) => `
      <div class="mini-item">
        <div>
          <strong>${item.username}</strong>
          <div class="muted">Points : ${item.victoryPoints}</div>
        </div>
      </div>
    `)
    .join("");
}

async function renderTournaments(items) {
  if (!items || !items.length) {
    tournamentsList.innerHTML = '<div class="empty">Aucun tournoi disponible.</div>';
    return;
  }

  tournamentsList.innerHTML = items
    .map((item) => `
      <div class="tournament-item">
        <div>
          <strong>${item.name}</strong>
          <div class="tournament-meta">
            <span>Créateur : ${item.creator}</span>
            <span>Budget : ${formatMoney(item.budget)}</span>
            <span>${item.durationDays} jour(s)</span>
            <span>Confidentialité : ${item.privacy}</span>
            <span>Status : ${item.status}</span>
            ${item.winner ? `<span>Vainqueur : ${item.winner}</span>` : ""}
          </div>
        </div>
        <div class="tournament-actions">
          ${item.status === "OPEN" && !item.joined ? `<button type="button" data-action="join" data-id="${item.id}">Rejoindre</button>` : ""}
          ${item.canFinish ? `<button type="button" data-action="finish" data-id="${item.id}">Terminer</button>` : ""}
        </div>
      </div>
    `)
    .join("");
}

async function loadPortfolio() {
  const portefeuille = await api("/api/portefeuille");
  balance.textContent = formatMoney(portefeuille.argent);
  victoryPointsEl.textContent = portefeuille.victoryPoints || 0;
  document.querySelector("#userDisplay").textContent = portefeuille.username ? `Bonjour ${portefeuille.username}` : "Invité";
  renderPositions(portefeuille.positions);
  renderTransactions(portefeuille.transactions);
  await loadFriends();
  await loadTournaments();
}

async function loadFriends() {
  try {
    const friends = await api("/api/friends");
    renderFriends(friends);
  } catch (error) {
    setMessage(friendMessage, error.message, "error");
  }
}

async function loadTournaments() {
  try {
    const tournaments = await api("/api/tournaments");
    renderTournaments(tournaments);
  } catch (error) {
    setMessage(tournamentMessage, error.message, "error");
  }
}

async function addFriendHandler(event) {
  event.preventDefault();

  const username = friendUsername.value.trim();
  if (!username) {
    setMessage(friendMessage, "Entre un nom d'utilisateur.", "error");
    return;
  }

  friendForm.querySelector("button").disabled = true;
  setMessage(friendMessage, "Ajout en cours...", "muted");

  try {
    const result = await api("/api/friends", {
      method: "POST",
      body: JSON.stringify({ username })
    });

    friendUsername.value = "";
    setMessage(friendMessage, result.message, "success");
    await loadFriends();
  } catch (error) {
    setMessage(friendMessage, error.message, "error");
  } finally {
    friendForm.querySelector("button").disabled = false;
  }
}

async function createTournamentHandler(event) {
  event.preventDefault();

  const name = tournamentName.value.trim();
  const durationDays = Number(tournamentDuration.value);
  const budget = Number(tournamentBudget.value);

  if (!name || !durationDays || !budget) {
    setMessage(tournamentMessage, "Nom, durée et budget requis.", "error");
    return;
  }

  tournamentForm.querySelector("button").disabled = true;
  setMessage(tournamentMessage, "Création en cours...", "muted");

  try {
    const result = await api("/api/tournaments", {
      method: "POST",
      body: JSON.stringify({ name, durationDays, budget, privacy: tournamentPrivacy.value })
    });

    tournamentName.value = "";
    tournamentPrivacy.value = "PUBLIC";
    setMessage(tournamentMessage, `Tournoi créé (#${result.tournamentId}).`, "success");
    await loadTournaments();
  } catch (error) {
    setMessage(tournamentMessage, error.message, "error");
  } finally {
    tournamentForm.querySelector("button").disabled = false;
  }
}

async function tournamentActionHandler(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!id) return;

  button.disabled = true;

  try {
    if (action === "join") {
      const result = await api(`/api/tournaments/${id}/join`, { method: "POST" });
      setMessage(tournamentMessage, result.message, "success");
    } else if (action === "finish") {
      const result = await api(`/api/tournaments/${id}/finish`, { method: "POST" });
      setMessage(tournamentMessage, `Tournoi terminé. Vainqueur : ${result.winnerId}.`, "success");
    }
    await loadTournaments();
    await loadPortfolio();
  } catch (error) {
    setMessage(tournamentMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function searchQuote() {
  const symbole = quoteSymbol.value.trim().toUpperCase();
  const marche = quoteMarket.value;

  if (!symbole) {
    setMessage(quoteResult, "Entre un symbole.", "error");
    return;
  }

  quoteButton.disabled = true;
  setMessage(quoteResult, "Recherche du cours...", "muted");

  try {
    const cours = await api(`/api/cours/${encodeURIComponent(symbole)}?marche=${encodeURIComponent(marche)}`);
    quoteSymbol.value = cours.symbole;
    const marketLabel = quoteMarket.options[quoteMarket.selectedIndex].textContent;

    quoteResult.className = "quote-result";
    quoteResult.innerHTML = `
      <div class="quote-title">${cours.symbole} • ${marketLabel}</div>
      <div class="quote-price">Prix actuel : ${formatPrice(cours.prix, cours.devise)}</div>
      <div class="quote-range">
        <span>Haut : ${formatPrice(cours.haut, cours.devise)}</span>
        <span>Bas : ${formatPrice(cours.bas, cours.devise)}</span>
      </div>
    `;
  } catch (error) {
    quoteResult.className = "quote-result muted";
    setMessage(quoteResult, error.message, "error");
  } finally {
    quoteButton.disabled = false;
  }
}

function updateAction(action) {
  currentAction = action;
  tradeButton.textContent = action === "acheter" ? "Acheter" : "Vendre";

  segments.forEach((segment) => {
    segment.classList.toggle("active", segment.dataset.action === action);
  });
}

async function submitTrade(event) {
  event.preventDefault();

  const symbole = tradeSymbol.value.trim().toUpperCase();
  const quantite = Number(tradeQuantity.value);
  const marche = tradeMarket.value;

  if (!symbole || !Number.isInteger(quantite) || quantite <= 0) {
    setMessage(tradeMessage, "Symbole ou quantite invalide.", "error");
    return;
  }

  tradeButton.disabled = true;
  setMessage(tradeMessage, "Ordre en cours...", "muted");

  try {
    const result = await api(`/api/${currentAction}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ symbole, quantite, marche })
    });

    tradeSymbol.value = symbole;
    setMessage(
      tradeMessage,
      `${result.message} Total: ${formatMoney(result.total)}.`,
      "success"
    );
    await loadPortfolio();
  } catch (error) {
    setMessage(tradeMessage, error.message, "error");
  } finally {
    tradeButton.disabled = false;
  }
}

segments.forEach((segment) => {
  segment.addEventListener("click", () => updateAction(segment.dataset.action));
});

loginButton.addEventListener("click", () => {
  window.location.href = "/login.html";
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});

quoteButton.addEventListener("click", searchQuote);
quoteSymbol.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchQuote();
  }
});
tradeForm.addEventListener("submit", submitTrade);
friendForm.addEventListener("submit", addFriendHandler);
tournamentForm.addEventListener("submit", createTournamentHandler);
tournamentsList.addEventListener("click", tournamentActionHandler);
refreshButton.addEventListener("click", loadPortfolio);

updateAuthButtons();

loadPortfolio().catch((error) => {
  balance.textContent = "Erreur";
  renderPositions([]);
  renderTransactions([]);
  setMessage(tradeMessage, error.message, "error");
});
