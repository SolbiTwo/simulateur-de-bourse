const authForm = document.querySelector("#authForm");
const authUsername = document.querySelector("#authUsername");
const authPassword = document.querySelector("#authPassword");
const authPasswordConfirm = document.querySelector("#authPasswordConfirm");
const passwordConfirmLabel = document.querySelector("#passwordConfirmLabel");
const authButton = document.querySelector("#authButton");
const authTitle = document.querySelector("#authTitle");
const authMessage = document.querySelector("#authMessage");
const toggleButton = document.querySelector("#toggleButton");
const toggleText = document.querySelector("#toggleText");

let isRegister = false;

function setMessage(message, type = "muted") {
  authMessage.className = type;
  authMessage.textContent = message;
}

function setMode(mode) {
  isRegister = mode === "register";
  
  if (isRegister) {
    authTitle.textContent = "Inscription";
    authButton.textContent = "S'inscrire";
    toggleText.textContent = "Déjà inscrit ?";
    toggleButton.textContent = "Connexion";
    passwordConfirmLabel.style.display = "block";
  } else {
    authTitle.textContent = "Connexion";
    authButton.textContent = "Connexion";
    toggleText.textContent = "Pas encore de compte ?";
    toggleButton.textContent = "Inscription";
    passwordConfirmLabel.style.display = "none";
  }
  
  setMessage("");
}

async function submitAuth(event) {
  event.preventDefault();

  const username = authUsername.value.trim();
  const password = authPassword.value;
  const passwordConfirm = authPasswordConfirm.value;

  if (!username || !password) {
    setMessage("Tous les champs sont requis.", "error");
    return;
  }

  if (isRegister && password !== passwordConfirm) {
    setMessage("Les mots de passe ne correspondent pas.", "error");
    return;
  }

  if (isRegister && password.length < 6) {
    setMessage("Le mot de passe doit faire au moins 6 caractères.", "error");
    return;
  }

  authButton.disabled = true;
  setMessage("En cours...", "muted");

  try {
    const endpoint = isRegister ? "/api/register" : "/api/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Une erreur est survenue.");
    }

    setMessage(data.message, "success");
    localStorage.setItem("token", data.token);
    
    setTimeout(() => {
      window.location.href = "/";
    }, 1000);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    authButton.disabled = false;
  }
}


toggleButton.addEventListener("click", () => {
  setMode(isRegister ? "login" : "register");
});

authForm.addEventListener("submit", submitAuth);

// Mode initial
setMode("login");
