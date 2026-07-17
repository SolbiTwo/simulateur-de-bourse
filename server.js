require("dotenv").config();

const path = require("path");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const yahooFinance = require("yahoo-finance2").default;
const alpha = require("alphavantage")({ key: process.env.ALPHA_KEY });

const ALPHA_KEY = process.env.ALPHA_KEY?.trim();

// =====================
// CONFIG
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key_change_in_production";
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const LOCAL_AUTH = process.env.LOCAL_AUTH === 'true' && !IS_VERCEL;

if (!SUPABASE_CONFIGURED) {
  console.error("SUPABASE_URL et SUPABASE_ANON_KEY sont manquants ou mal configurés dans Vercel.");
}

console.log(`LOCAL_AUTH=${LOCAL_AUTH} - ${LOCAL_AUTH ? 'Using local auth fallback' : 'Using Supabase auth'}`);
console.log(`SUPABASE_CONFIGURED=${SUPABASE_CONFIGURED}`);
console.log(`IS_VERCEL=${IS_VERCEL}`);

const app = express();
const supabase = SUPABASE_CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const fs = require('fs');
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'local_db.json');

function ensureLocalDb() {
  const dir = path.dirname(LOCAL_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}

function readLocalDb() {
  ensureLocalDb();
  return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
}

function writeLocalDb(db) {
  ensureLocalDb();
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2));
}

// =====================
// MIDDLEWARE
// =====================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (e) {
    res.status(401).json({ message: "Token invalide" });
  }
}

// =====================
// MARCHES
// =====================
const MARCHES = {
  US: { suffixe: "" },
  PARIS: { suffixe: ".PA" },
  TOKYO: { suffixe: ".T" },
  Londres: { suffixe: ".L" },
  FRANCFORT: { suffixe: ".DE" },
  TORONTO: { suffixe: ".TO" }
};

// =====================
// UTILS
// =====================
function nettoyerMarche(marche) {
  const valeur = String(marche || "US").trim().toUpperCase();
  return MARCHES[valeur] ? valeur : "US";
}

function nettoyerSymbole(symbole, marche = "US") {
  const valeur = String(symbole || "").trim().toUpperCase();
  const suffixe = MARCHES[nettoyerMarche(marche)].suffixe;

  if (!valeur || valeur.includes(".")) return valeur;

  return `${valeur}${suffixe}`;
}

function nettoyerQuantite(quantite) {
  const n = Number(quantite);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// =====================
// COURS DES ACTIONS
// =====================
async function obtenirCours(symbole) {
  if (ALPHA_KEY) {
    try {
      const data = await alpha.data.quote(symbole);
      const quote = data?.["Global Quote"] || {};
      const prix = Number(quote["05. price"]);

      if (prix && prix > 0) {
        return {
          symbole,
          prix,
          haut: Number(quote["03. high"] || 0),
          bas: Number(quote["04. low"] || 0),
          ouverture: Number(quote["02. open"] || 0),
          precedent: Number(quote["08. previous close"] || 0),
          devise: quote["08. previous close"] ? "USD" : "USD",
          nom: quote["01. symbol"] || symbole,
          fournisseur: "Alpha Vantage"
        };
      }

      throw new Error(`Prix invalide Alpha Vantage pour ${symbole}`);
    } catch (err) {
      console.error("Alpha Vantage error:", err.message);
      console.warn("Alpha Vantage failed, bascule vers Yahoo Finance.");
    }
  } else {
    console.warn("ALPHA_KEY non défini, utilisation de Yahoo Finance.");
  }

  try {
    const quote = await yahooFinance.quote(symbole);
    const prix = Number(quote?.regularMarketPrice);

    if (!prix || prix <= 0) {
      throw new Error(`Prix invalide pour ${symbole}`);
    }

    return {
      symbole,
      prix,
      haut: Number(quote?.regularMarketDayHigh || 0),
      bas: Number(quote?.regularMarketDayLow || 0),
      ouverture: Number(quote?.regularMarketOpen || 0),
      precedent: Number(quote?.regularMarketPreviousClose || 0),
      devise: quote?.currency || "USD",
      nom: quote?.shortName || quote?.longName || symbole,
      fournisseur: "Yahoo Finance"
    };
  } catch (err) {
    console.error("Yahoo error:", err.message);
    throw new Error("Erreur récupération cours Alpha Vantage et Yahoo Finance");
  }
}

// =====================
// PORTFOLIO
// =====================
async function getPortefeuille(userId) {
  if (LOCAL_AUTH) {
    const db = readLocalDb();
    const user = Object.values(db.users).find(u => u.id === userId || u.username === userId);
    if (!user) return { argent: 0, victoryPoints: 0, username: null, positions: [], transactions: [] };
    return {
      argent: Number(user.argent ?? 0),
      victoryPoints: Number(user.victoryPoints ?? 0),
      username: user.username,
      positions: (user.positions || []).map(p => ({ symbole: p.symbole, quantite: Number(p.quantite) })),
      transactions: (user.transactions || []).slice(-8).reverse().map(t => ({ type: t.type, symbole: t.symbole, quantite: t.quantite, prixUnitaire: t.prix_unitaire, total: t.total, date: t.date }))
    };
  }

  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const { data: portefeuille, error: pError } = await supabase
    .from("user_portfolios")
    .select("argent")
    .eq("user_id", userId)
    .single();

  if (pError) throw pError;

  const { data: positions, error: posError } = await supabase
    .from("user_positions")
    .select("symbole, quantite")
    .eq("user_id", userId)
    .gt("quantite", 0)
    .order("symbole", { ascending: true });

  if (posError) throw posError;

  const { data: transactions, error: transError } = await supabase
    .from("user_transactions")
    .select("type, symbole, quantite, prix_unitaire, total, date_transaction")
    .eq("user_id", userId)
    .order("date_transaction", { ascending: false })
    .limit(8);

  if (transError) throw transError;

  let victoryPoints = 0;

  try {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("victory_points")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      if (String(userError.message).includes("victory_points") || String(userError.code) === "PGRST116") {
        victoryPoints = 0;
      } else {
        throw userError;
      }
    } else {
      victoryPoints = Number(user?.victory_points || 0);
    }
  } catch (err) {
    victoryPoints = 0;
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  if (userError && userError.code !== "PGRST116") {
    throw userError;
  }

  return {
    argent: Number(portefeuille?.argent ?? 0),
    victoryPoints,
    username: user?.username || null,
    positions: (positions || []).map(p => ({
      symbole: p.symbole,
      quantite: Number(p.quantite)
    })),
    transactions: (transactions || []).map(t => ({
      type: t.type,
      symbole: t.symbole,
      quantite: Number(t.quantite),
      prixUnitaire: Number(t.prix_unitaire),
      total: Number(t.total),
      date: t.date_transaction
    }))
  };
}

async function getFriends(userId) {
  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const { data: friendRows, error: friendError } = await supabase
    .from("user_friends")
    .select("friend_id")
    .eq("user_id", userId);

  if (friendError) throw friendError;

  const friendIds = (friendRows || []).map((row) => row.friend_id);
  if (!friendIds.length) return [];

  const { data: friends, error: friendsError } = await supabase
    .from("users")
    .select("id, username, victory_points")
    .in("id", friendIds);

  if (friendsError) throw friendsError;

  return (friends || []).map((friend) => ({
    id: friend.id,
    username: friend.username,
    victoryPoints: Number(friend.victory_points || 0)
  }));
}

async function addFriend(userId, friendUsername) {
  if (!friendUsername) {
    throw new Error("Nom d'ami requis.");
  }

  const targetName = String(friendUsername).trim();
  if (!targetName) {
    throw new Error("Nom d'ami invalide.");
  }

  const { data: friendUser, error: friendUserError } = await supabase
    .from("users")
    .select("id, username")
    .eq("username", targetName)
    .maybeSingle();

  if (friendUserError) throw friendUserError;
  if (!friendUser) {
    throw new Error("Utilisateur introuvable.");
  }

  if (friendUser.id === userId) {
    throw new Error("Tu ne peux pas t'ajouter toi-même.");
  }

  const inserts = [
    { user_id: userId, friend_id: friendUser.id },
    { user_id: friendUser.id, friend_id: userId }
  ];

  const { error: insertError } = await supabase
    .from("user_friends")
    .insert(inserts);

  if (insertError) {
    if (insertError.code === "PGRST116") {
      throw new Error("Vous êtes déjà amis.");
    }
    throw insertError;
  }

  return { username: friendUser.username };
}

async function getTournaments(userId) {
  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const [{ data: tournaments, error: tournamentsError }, { data: friendRows, error: friendRowsError }, { data: inviteRows, error: inviteRowsError }, { data: userParticipation, error: participationError }] = await Promise.all([
    supabase
      .from("tournaments")
      .select("id, name, creator_id, budget, duration_days, privacy, status, created_at, end_at, winner_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("user_friends")
      .select("friend_id")
      .eq("user_id", userId),
    supabase
      .from("tournament_invites")
      .select("tournament_id")
      .eq("user_id", userId),
    supabase
      .from("tournament_participants")
      .select("tournament_id")
      .eq("user_id", userId)
  ]);

  if (tournamentsError) throw tournamentsError;
  if (friendRowsError) throw friendRowsError;
  if (inviteRowsError) throw inviteRowsError;
  if (participationError) throw participationError;

  const friendIds = new Set((friendRows || []).map((row) => row.friend_id));
  const invitedIds = new Set((inviteRows || []).map((row) => row.tournament_id));
  const joinedIds = new Set((userParticipation || []).map((row) => row.tournament_id));

  const tournamentIds = (tournaments || []).map((t) => t.id);
  const participantsQuery = tournamentIds.length
    ? await supabase
      .from("tournament_participants")
      .select("id, tournament_id, user_id, initial_budget, current_budget")
      .in("tournament_id", tournamentIds)
    : { data: [], error: null };

  if (participantsQuery.error) throw participantsQuery.error;

  const participantUserIds = Array.from(new Set((participantsQuery.data || []).map((row) => row.user_id)));
  const { data: participantUsers, error: participantUsersError } = participantUserIds.length
    ? await supabase
      .from("users")
      .select("id, username")
      .in("id", participantUserIds)
    : { data: [], error: null };

  if (participantUsersError) throw participantUsersError;

  const allUserIds = Array.from(new Set([
    ...participantUserIds,
    ...(tournaments || []).map((tournament) => tournament.creator_id),
    ...(tournaments || []).map((tournament) => tournament.winner_id)
  ].filter(Boolean)));

  const { data: allUsers, error: allUsersError } = allUserIds.length
    ? await supabase
      .from("users")
      .select("id, username")
      .in("id", allUserIds)
    : { data: [], error: null };

  if (allUsersError) throw allUsersError;

  const userMap = (allUsers || []).reduce((map, user) => {
    map[user.id] = user.username;
    return map;
  }, {});

  const { data: positionRows, error: positionRowsError } = participantUserIds.length
    ? await supabase
      .from("user_positions")
      .select("user_id, quantite")
      .in("user_id", participantUserIds)
    : { data: [], error: null };

  if (positionRowsError) throw positionRowsError;

  const positionsByUser = (positionRows || []).reduce((map, row) => {
    map[row.user_id] = (map[row.user_id] || 0) + Number(row.quantite || 0);
    return map;
  }, {});

  const participantsByTournament = (participantsQuery.data || []).reduce((map, participant) => {
    if (!map[participant.tournament_id]) map[participant.tournament_id] = [];
    map[participant.tournament_id].push({
      id: participant.id,
      userId: participant.user_id,
      username: (participantUsers || []).find((u) => u.id === participant.user_id)?.username || "Utilisateur",
      initialBudget: Number(participant.initial_budget),
      currentBudget: Number(participant.current_budget),
      actions: positionsByUser[participant.user_id] || 0
    });
    return map;
  }, {});

  const currentUserId = String(userId || "").toLowerCase();

  return (tournaments || [])
    .filter((tournament) => {
      const privacy = String(tournament.privacy || "PUBLIC").toUpperCase();
      const creatorId = String(tournament.creator_id || "").toLowerCase();
      const isCreator = creatorId === currentUserId;
      const isFriend = friendIds.has(tournament.creator_id);
      const isInvited = invitedIds.has(tournament.id);
      const isJoined = joinedIds.has(tournament.id);

      if (privacy === "PUBLIC") return true;
      if (isCreator || isJoined) return true;
      if (privacy === "FRIENDS" && isFriend) return true;
      if (privacy === "INVITE" && isInvited) return true;
      return false;
    })
    .map((tournament) => ({
      id: tournament.id,
      name: tournament.name,
      budget: Number(tournament.budget),
      durationDays: Number(tournament.duration_days),
      privacy: tournament.privacy || "PUBLIC",
      status: tournament.status,
      createdAt: tournament.created_at,
      endAt: tournament.end_at,
      creator: userMap[tournament.creator_id] || "Utilisateur",
      winner: tournament.winner_id ? userMap[tournament.winner_id] || "" : null,
      joined: joinedIds.has(tournament.id),
      canFinish: String(tournament.creator_id || "").toLowerCase() === currentUserId && tournament.status !== "FINISHED",
      participants: (participantsByTournament[tournament.id] || []).sort((a, b) => b.currentBudget - a.currentBudget)
    }));
}

async function createTournament(userId, name, durationDays, budget, privacy = "PUBLIC") {
  if (!name || !durationDays || !budget) {
    throw new Error("Nom, durée et budget sont requis.");
  }

  const allowedPrivacy = ["PUBLIC", "FRIENDS", "INVITE"];
  const privacyValue = allowedPrivacy.includes(String(privacy).toUpperCase()) ? String(privacy).toUpperCase() : "PUBLIC";
  const endAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: tournament, error: createError } = await supabase
    .from("tournaments")
    .insert([{ creator_id: userId, name, budget, duration_days: durationDays, privacy: privacyValue, status: "OPEN", end_at: endAt }])
    .select("id")
    .single();

  if (createError) throw createError;

  const { error: participantError } = await supabase
    .from("tournament_participants")
    .insert([{ tournament_id: tournament.id, user_id: userId, initial_budget: budget, current_budget: budget }]);

  if (participantError) throw participantError;

  return { id: tournament.id };
}

async function joinTournament(userId, tournamentId) {
  const { data: tournament, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id, creator_id, budget, status, privacy")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError) throw tournamentError;
  if (!tournament) throw new Error("Tournoi introuvable.");
  if (tournament.status !== "OPEN") throw new Error("Ce tournoi n'est plus ouvert.");

  const currentUserId = String(userId || "").toLowerCase();
  const creatorId = String(tournament.creator_id || "").toLowerCase();
  const privacy = String(tournament.privacy || "PUBLIC").toUpperCase();
  const isCreator = currentUserId === creatorId;

  if (!isCreator) {
    if (privacy === "FRIENDS") {
      const { data: friendship, error: friendError } = await supabase
        .from("user_friends")
        .select("friend_id")
        .eq("user_id", tournament.creator_id)
        .eq("friend_id", userId)
        .maybeSingle();

      if (friendError) throw friendError;
      if (!friendship) {
        throw new Error("Ce tournoi est réservé aux amis du créateur.");
      }
    }

    if (privacy === "INVITE") {
      const { data: invite, error: inviteError } = await supabase
        .from("tournament_invites")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("user_id", userId)
        .maybeSingle();

      if (inviteError) throw inviteError;
      if (!invite) {
        throw new Error("Vous n'êtes pas invité à ce tournoi.");
      }
    }
  }

  const { error: joinError } = await supabase
    .from("tournament_participants")
    .insert([{ tournament_id: tournamentId, user_id: userId, initial_budget: tournament.budget, current_budget: tournament.budget }]);

  if (joinError) {
    if (joinError.code === "PGRST116") {
      throw new Error("Vous participez déjà à ce tournoi.");
    }
    throw joinError;
  }

  return { message: "Inscription au tournoi réussie." };
}

async function finishTournament(userId, tournamentId) {
  const { data: tournament, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id, creator_id, status")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError) throw tournamentError;
  if (!tournament) throw new Error("Tournoi introuvable.");
  const creatorId = String(tournament.creator_id || "").toLowerCase();
  const currentUserId = String(userId || "").toLowerCase();
  if (creatorId !== currentUserId) throw new Error("Seul le créateur peut terminer ce tournoi.");
  if (tournament.status === "FINISHED") throw new Error("Ce tournoi est déjà terminé.");

  const { data: participants, error: participantsError } = await supabase
    .from("tournament_participants")
    .select("user_id, current_budget")
    .eq("tournament_id", tournamentId);

  if (participantsError) throw participantsError;
  if (!participants || participants.length === 0) {
    throw new Error("Aucun participant dans ce tournoi.");
  }

  const winner = participants.reduce((best, current) => {
    if (!best || Number(current.current_budget) > Number(best.current_budget)) return current;
    return best;
  }, null);

  const currentPoints = winner?.victory_points ?? 0;
  const { data: winnerUser, error: winnerError } = await supabase
    .from("users")
    .select("victory_points")
    .eq("id", winner.user_id)
    .single();

  if (winnerError) throw winnerError;

  const newPoints = Number(winnerUser.victory_points || 0) + 10;
  const { error: updatePointsError } = await supabase
    .from("users")
    .update({ victory_points: newPoints })
    .eq("id", winner.user_id);

  if (updatePointsError) throw updatePointsError;

  const { error: updateTournamentError } = await supabase
    .from("tournaments")
    .update({ status: "FINISHED", winner_id: winner.user_id })
    .eq("id", tournamentId);

  if (updateTournamentError) throw updateTournamentError;

  return { winnerId: winner.user_id, victoryPoints: newPoints };
}

// =====================
// ACHAT
// =====================
async function acheterAction(userId, symbole, quantite) {
  const cours = await obtenirCours(symbole);
  const total = cours.prix * quantite;

  try {
    const { data: portefeuille, error: pError } = await supabase
      .from("user_portfolios")
      .select("argent")
      .eq("user_id", userId)
      .single();

    if (pError) throw pError;

    const argent = Number(portefeuille?.argent ?? 0);

    if (argent < total) {
      return { ok: false, message: "Fonds insuffisants." };
    }

    const { error: updateError } = await supabase
      .from("user_portfolios")
      .update({ argent: argent - total })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    const { data: existingPosition, error: existingPosError } = await supabase
      .from("user_positions")
      .select("quantite")
      .eq("user_id", userId)
      .eq("symbole", symbole)
      .single();

    if (existingPosError && existingPosError.code !== "PGRST116") {
      throw existingPosError;
    }

    if (existingPosition) {
      const { error: posUpdateError } = await supabase
        .from("user_positions")
        .update({ quantite: existingPosition.quantite + quantite })
        .eq("user_id", userId)
        .eq("symbole", symbole);

      if (posUpdateError) throw posUpdateError;
    } else {
      const { error: posInsertError } = await supabase
        .from("user_positions")
        .insert([{ user_id: userId, symbole, quantite }]);

      if (posInsertError) throw posInsertError;
    }

    const { error: transError } = await supabase
      .from("user_transactions")
      .insert([{
        user_id: userId,
        type: "ACHAT",
        symbole,
        quantite,
        prix_unitaire: cours.prix,
        total
      }]);

    if (transError) throw transError;

    return {
      ok: true,
      message: "Achat effectué.",
      cours,
      total
    };
  } catch (e) {
    throw e;
  }
}

// =====================
// VENTE
// =====================
async function vendreAction(userId, symbole, quantite) {
  const cours = await obtenirCours(symbole);
  const total = cours.prix * quantite;

  try {
    const { data: position, error: posError } = await supabase
      .from("user_positions")
      .select("quantite")
      .eq("user_id", userId)
      .eq("symbole", symbole)
      .single();

    if (posError) {
      if (posError.code === "PGRST116") {
        return { ok: false, message: "Pas assez d'actions." };
      }
      throw posError;
    }

    if (!position || position.quantite < quantite) {
      return { ok: false, message: "Pas assez d'actions." };
    }

    const { data: portefeuille, error: pError } = await supabase
      .from("user_portfolios")
      .select("argent")
      .eq("user_id", userId)
      .single();

    if (pError) throw pError;

    const { error: updateError } = await supabase
      .from("user_portfolios")
      .update({ argent: Number(portefeuille.argent) + total })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    const newQuantite = position.quantite - quantite;
    if (newQuantite <= 0) {
      const { error: deleteError } = await supabase
        .from("user_positions")
        .delete()
        .eq("user_id", userId)
        .eq("symbole", symbole);

      if (deleteError) throw deleteError;
    } else {
      const { error: posUpdateError } = await supabase
        .from("user_positions")
        .update({ quantite: newQuantite })
        .eq("user_id", userId)
        .eq("symbole", symbole);

      if (posUpdateError) throw posUpdateError;
    }

    const { error: transError } = await supabase
      .from("user_transactions")
      .insert([{
        user_id: userId,
        type: "VENTE",
        symbole,
        quantite,
        prix_unitaire: cours.prix,
        total
      }]);

    if (transError) throw transError;

    return {
      ok: true,
      message: "Vente effectuée.",
      cours,
      total
    };
  } catch (e) {
    throw e;
  }
}

// =====================
// AUTHENTIFICATION
// =====================
async function registerUser(username, password) {
  const trimmedUsername = String(username || "").trim();

  if (LOCAL_AUTH) {
    // Local registration
    ensureLocalDb();
    const db = readLocalDb();
    const existing = Object.values(db.users).find(u => String(u.username || "") === trimmedUsername);
    if (existing) throw new Error('Cet utilisateur existe déjà');
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const newUser = { id, username: trimmedUsername, password: hashedPassword, argent: 10000, positions: [], transactions: [], created_at: new Date().toISOString() };
    db.users[id] = newUser;
    writeLocalDb(db);
    const token = jwt.sign({ userId: id, username: trimmedUsername }, JWT_SECRET, { expiresIn: '7d' });
    return { token, username: trimmedUsername };
  }

  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id")
    .eq("username", trimmedUsername)
    .maybeSingle();

  if (existingUserError) {
    throw existingUserError;
  }

  if (existingUser) {
    throw new Error("Cet utilisateur existe déjà");
  }

  const { data: newUser, error: insertError } = await supabase
    .from("users")
    .insert([{ username: trimmedUsername, password: hashedPassword }])
    .select("id, username")
    .single();

  if (insertError) throw insertError;

  // Créer le portefeuille de l'utilisateur
  const { error: portfolioError } = await supabase
    .from("user_portfolios")
    .insert([{
      user_id: newUser.id,
      argent: 10000
    }]);

  if (portfolioError) throw portfolioError;

  const token = jwt.sign(
    { userId: newUser.id, username: newUser.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, username: newUser.username };
}

async function loginUser(username, password) {
  const trimmedUsername = String(username || "").trim();

  if (LOCAL_AUTH) {
    ensureLocalDb();
    const db = readLocalDb();
    const user = Object.values(db.users).find(u => String(u.username || "") === trimmedUsername);
    if (!user) throw new Error("Nom d'utilisateur ou mot de passe incorrect");
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) throw new Error("Nom d'utilisateur ou mot de passe incorrect");
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return { token, username: user.username };
  }

  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, username, password")
    .eq("username", trimmedUsername)
    .single();

  if (userError) {
    if (userError.code === "PGRST116") {
      throw new Error("Nom d'utilisateur ou mot de passe incorrect");
    }
    throw userError;
  }

  if (!user) {
    throw new Error("Nom d'utilisateur ou mot de passe incorrect");
  }

  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    throw new Error("Nom d'utilisateur ou mot de passe incorrect");
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, username: user.username };
}

// =====================
// ROUTES AUTHENTIFICATION
// =====================
app.post("/api/register", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis" });
    }

    const result = await registerUser(username, password);
    res.json({ message: "Inscription réussie", ...result });
  } catch (e) {
    next(e);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis" });
    }

    const result = await loginUser(username, password);
    res.json({ message: "Connexion réussie", ...result });
  } catch (e) {
    next(e);
  }
});

// =====================
// ROUTES API
// =====================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", async (req, res) => {
  if (!SUPABASE_CONFIGURED && !LOCAL_AUTH) {
    return res.status(200).json({
      ok: false,
      message: "Supabase non configuré. Vérifie les variables d'environnement dans Vercel."
    });
  }
  res.json({ ok: true });
});

app.get("/api/portefeuille", verifyToken, async (req, res, next) => {
  try {
    res.json(await getPortefeuille(req.userId));
  } catch (e) {
    next(e);
  }
});

app.get("/api/cours/:symbole", async (req, res, next) => {
  try {
    const symbole = nettoyerSymbole(req.params.symbole, req.query.marche);
    res.json(await obtenirCours(symbole));
  } catch (e) {
    next(e);
  }
});

app.post("/api/acheter", verifyToken, async (req, res, next) => {
  try {
    const symbole = nettoyerSymbole(req.body.symbole, req.body.marche);
    const quantite = nettoyerQuantite(req.body.quantite);

    if (!symbole || !quantite) {
      return res.status(400).json({ message: "Invalid input" });
    }

    res.json(await acheterAction(req.userId, symbole, quantite));
  } catch (e) {
    next(e);
  }
});

app.post("/api/vendre", verifyToken, async (req, res, next) => {
  try {
    const symbole = nettoyerSymbole(req.body.symbole, req.body.marche);
    const quantite = nettoyerQuantite(req.body.quantite);

    if (!symbole || !quantite) {
      return res.status(400).json({ message: "Invalid input" });
    }

    res.json(await vendreAction(req.userId, symbole, quantite));
  } catch (e) {
    next(e);
  }
});

app.get("/api/friends", verifyToken, async (req, res, next) => {
  try {
    res.json(await getFriends(req.userId));
  } catch (e) {
    next(e);
  }
});

app.post("/api/friends", verifyToken, async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ message: "Nom d'ami requis." });
    }

    const result = await addFriend(req.userId, username);
    res.json({ message: `Ami ${result.username} ajouté.`, friend: result });
  } catch (e) {
    next(e);
  }
});

app.get("/api/tournaments", verifyToken, async (req, res, next) => {
  try {
    res.json(await getTournaments(req.userId));
  } catch (e) {
    next(e);
  }
});

app.post("/api/tournaments", verifyToken, async (req, res, next) => {
  try {
    const { name, durationDays, budget, privacy } = req.body;

    if (!name || !durationDays || !budget) {
      return res.status(400).json({ message: "Nom, durée et budget sont requis." });
    }

    const result = await createTournament(req.userId, String(name).trim(), Number(durationDays), Number(budget), privacy);
    res.json({ message: "Tournoi créé.", tournamentId: result.id });
  } catch (e) {
    next(e);
  }
});

app.post("/api/tournaments/:id/join", verifyToken, async (req, res, next) => {
  try {
    const tournamentId = Number(req.params.id);
    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      return res.status(400).json({ message: "ID de tournoi invalide." });
    }

    res.json(await joinTournament(req.userId, tournamentId));
  } catch (e) {
    next(e);
  }
});

app.post("/api/tournaments/:id/finish", verifyToken, async (req, res, next) => {
  try {
    const tournamentId = Number(req.params.id);
    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      return res.status(400).json({ message: "ID de tournoi invalide." });
    }

    const result = await finishTournament(req.userId, tournamentId);
    res.json({ message: "Tournoi terminé.", winnerId: result.winnerId, victoryPoints: result.victoryPoints });
  } catch (e) {
    next(e);
  }
});

// =====================
// ERROR HANDLER
// =====================
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ message: err.message || String(err) });
});

// =====================
// START SERVER
// =====================
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Serveur: http://localhost:${PORT}`);
  });

  async function fermer() {
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", fermer);
  process.on("SIGTERM", fermer);
}

module.exports = app;