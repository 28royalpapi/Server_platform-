const config = window.SERVER_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") &&
  typeof config.publishableKey === "string" && config.publishableKey.length > 20 && !config.publishableKey.includes("YOUR_");
const statusEl = document.querySelector("#status");
const forms = { phone: document.querySelector("#phone-form"), verify: document.querySelector("#verify-form"), consent: document.querySelector("#consent-form"), preferences: document.querySelector("#preferences-form"), done: document.querySelector("#done-step") };
let sessionToken = sessionStorage.getItem("server_session_token") || "";
let pendingPhone = "";
function normalizePhone(value) {
 const clean = value.trim().replace(/[\s().-]/g, "");
 if (/^\+2340[0-9]{10}$/.test(clean)) {
  const normalized = "+234" + clean.slice(5);
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : "";
 }
 const digits = clean.replace(/\D/g, "");
 if (/^0[0-9]{10}$/.test(digits)) {
  const normalized = "+234" + digits.slice(1);
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : "";
 }
 if (/^234[0-9]{10}$/.test(digits)) return "+" + digits;
 if (/^[789][0-9]{9}$/.test(digits)) return "+234" + digits;
 return /^\+[1-9][0-9]{7,14}$/.test(clean) ? clean : "";
}
function showStatus(message, ok = false) { statusEl.textContent = message; statusEl.classList.remove("hidden", "ok"); if (ok) statusEl.classList.add("ok"); }
function clearStatus() { statusEl.classList.add("hidden"); statusEl.textContent = ""; }
function setStep(name) { Object.entries(forms).forEach(([key, el]) => el.classList.toggle("hidden", key !== name)); document.querySelectorAll("[data-step-label]").forEach((el) => { el.classList.toggle("active", ["phone","verify","consent","preferences"].indexOf(el.dataset.stepLabel) <= ["phone","verify","consent","preferences"].indexOf(name)); }); clearStatus(); }
function setBusy(button, busy) { if (busy) { button.dataset.originalLabel = button.dataset.originalLabel || button.textContent; button.disabled = true; button.textContent = "Please wait…"; } else { button.disabled = false; if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel; } }
async function postFunction(name, body, token = "") {
 if (!configured) throw new Error("Server has not been configured with its Supabase project.");
 const headers = { "content-type": "application/json", apikey: config.publishableKey };
 if (token) headers.authorization = "Bearer " + token;
 const response = await fetch(config.supabaseUrl + "/functions/v1/" + name, { method: "POST", headers, body: JSON.stringify(body) });
 const result = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(result.error || ("Request failed (" + response.status + ")"));
 return result;
}
forms.phone.addEventListener("submit", async (event) => {
 event.preventDefault(); clearStatus();
 const phone = normalizePhone(document.querySelector("#phone").value);
 if (!configured) return showStatus("Server is not configured with its Supabase project.");
 if (!phone) return showStatus("Enter a valid number, e.g. 08012345678 or +2348012345678.");
 document.querySelector("#phone").value = phone;
 const button = document.querySelector("#send-otp"); setBusy(button, true);
 try {
  const result = await postFunction("server-auth", { action: "request_otp", phone });
  pendingPhone = phone; document.querySelector("#masked-phone").textContent = phone.slice(0,4) + "••••" + phone.slice(-3); setStep("verify");
  showStatus("A real SMS OTP was queued for the paired Android SIM gateway. Delivery requires the gateway to remain online and the carrier to accept the SMS.", true);
  if (result.expires_at) sessionStorage.setItem("server_otp_expires_at", result.expires_at);
 } catch (error) {
  const message = String(error?.message || "OTP request failed");
  if (/SMS_GATEWAY_OFFLINE/i.test(message)) showStatus("No paired, recently online SIM gateway is available. Pair the Android Server SIM Gateway before requesting a real OTP.");
  else showStatus(message.slice(0,300));
 } finally { setBusy(button, false); }
});
forms.verify.addEventListener("submit", async (event) => {
 event.preventDefault(); clearStatus(); const code = document.querySelector("#otp").value.trim();
 if (!configured || !pendingPhone) return showStatus("Start again with your phone number.");
 if (!/^\d{6}$/.test(code)) return showStatus("Enter the six digits from the SMS.");
 const button = document.querySelector("#verify-otp"); setBusy(button, true);
 try {
  const data = await postFunction("server-auth", { action: "verify_otp", phone: pendingPhone, code });
  sessionToken = data.access_token;
  if (!sessionToken) throw new Error("The server verified the code but did not create a session.");
  sessionStorage.setItem("server_session_token", sessionToken);
  document.querySelector("#otp").value = "";
  setStep("consent");
  showStatus("Phone number verified and a private Server session created.", true);
 } catch (error) { showStatus(String(error?.message || "That code could not be verified.").slice(0,250)); }
 finally { setBusy(button, false); }
});
document.querySelector("#back-phone").addEventListener("click", () => setStep("phone"));
forms.consent.addEventListener("submit", (event) => { event.preventDefault(); clearStatus(); if (!document.querySelector("#accept-terms").checked) return showStatus("Please accept the Terms of Service and acknowledge the Privacy Notice."); setStep("preferences"); });
forms.preferences.addEventListener("submit", async (event) => {
 event.preventDefault(); clearStatus(); const button = document.querySelector("#finish-setup"); setBusy(button,true);
 try {
  if (!sessionToken) throw new Error("Your setup session is missing. Verify your phone again.");
  await postFunction("server-calls", { action:"save_preferences", accepted:true, terms_version:"server-terms-1.0", privacy_version:"server-privacy-1.0", notifications_enabled:document.querySelector("#notifications").checked, contacts_access_requested:document.querySelector("#contacts").checked }, sessionToken);
  setStep("done");
 } catch (error) { showStatus(String(error?.message || "Could not save setup.").slice(0,250)); } finally { setBusy(button,false); }
});
document.querySelector("#open-server-app").addEventListener("click", async () => {
 const button = document.querySelector("#open-server-app");
 const help = document.querySelector("#app-handoff-help");
 button.disabled = true;
 const original = "Open Server calling app";
 button.textContent = "Preparing secure handoff…";
 try {
  if (!sessionToken) throw new Error("Your setup session has expired. Verify your phone again.");
  const result = await postFunction("server-handoff", { action: "create" }, sessionToken);
  const appLink = result.app_link || ("server://setup?handoff=" + encodeURIComponent(result.handoff_code || ""));
  if (!/^server:\/\/setup\?handoff=[0-9a-f]{64}$/.test(appLink)) throw new Error("The backend did not return a valid one-time app link.");
  help.textContent = "Opening the installed Server app. The one-time link expires in two minutes.";
  showStatus("Opening Server with your verified setup.", true);
  window.location.assign(appLink);
  window.setTimeout(() => {
   if (document.visibilityState === "visible") {
    showStatus("If Server did not open, install the Server app first, then return here and retry. This link expires in two minutes.");
   }
   button.disabled = false;
   button.textContent = original;
  }, 1800);
 } catch (error) {
  showStatus(String(error?.message || "Could not open the Server app.").slice(0,250));
  button.disabled = false;
  button.textContent = original;
 }
});

document.querySelector("#create-gateway-pairing").addEventListener("click", async () => {
 const button=document.querySelector("#create-gateway-pairing"),result=document.querySelector("#pairing-result"); button.disabled=true; button.textContent="Generating…"; result.classList.add("hidden");
 try {
  if (!sessionToken) throw new Error("Verify your phone first to generate a pairing code.");
  const data=await postFunction("server-gateway",{action:"create_pairing_code"},sessionToken);
  result.textContent="ONE-TIME PAIRING CODE: "+data.pairing_code+"\nExpires: "+data.expires_at+"\nEnter this code in the Android SIM Gateway app now. Treat it like a temporary password."; result.classList.remove("hidden");
 } catch(error) { showStatus(String(error?.message||"Could not generate a pairing code.").slice(0,250)); }
 finally {button.disabled=false;button.textContent="Generate SIM gateway pairing code";}
});
document.querySelector("#sign-out").addEventListener("click", async () => {
 try { if (sessionToken) await postFunction("server-auth",{action:"logout"},sessionToken); } catch { /* clear local token even when network is unavailable */ }
 sessionToken="";pendingPhone="";sessionStorage.removeItem("server_session_token");sessionStorage.removeItem("server_otp_expires_at");
 document.querySelector("#phone").value="+234";document.querySelector("#otp").value="";document.querySelector("#pairing-result").classList.add("hidden");setStep("phone");showStatus("Signed out of this browser.",true);
});
if(!configured) showStatus("Server is not configured with its Supabase project.");
