const statusEl = document.querySelector("#status");
const button = document.querySelector("#open-server-app");
const fallback = document.querySelector("#fallback");
function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "ok");
}
button?.addEventListener("click", () => {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Opening Server…";
  fallback?.classList.add("hidden");
  showStatus("Sending you to the installed native app. SIM detection only happens inside that app.");
  const started = Date.now();
  window.location.href = "server://sim-setup";
  window.setTimeout(() => {
    if (document.visibilityState === "visible" && Date.now() - started >= 1200) {
      fallback?.classList.remove("hidden");
      showStatus("The native Server app did not open. Install it before continuing.");
    }
    button.disabled = false;
    button.innerHTML = 'Open Server on this phone <span aria-hidden="true">→</span>';
  }, 1800);
});
