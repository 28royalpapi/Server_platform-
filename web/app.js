import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm";

const config = window.SERVER_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") &&
  typeof config.publishableKey === "string" && config.publishableKey.length > 20 && !config.publishableKey.includes("YOUR_");
const statusEl = document.querySelector("#status");
const forms = { phone: document.querySelector("#phone-form"), verify: document.querySelector("#verify-form"), consent: document.querySelector("#consent-form"), preferences: document.querySelector("#preferences-form"), done: document.querySelector("#done-step") };
let supabase = null, pendingPhone = "";
if (configured) supabase = createClient(config.supabaseUrl, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
else showStatus("Server is not configured yet. The public project URL and publishable key must be set in config.js.");

function showStatus(message, ok = false) { statusEl.textContent = message; statusEl.classList.remove("hidden", "ok"); if (ok) statusEl.classList.add("ok"); }
function clearStatus() { statusEl.classList.add("hidden"); statusEl.textContent = ""; }
function setStep(name) { Object.entries(forms).forEach(([key, el]) => el.classList.toggle("hidden", key !== name)); document.querySelectorAll("[data-step-label]").forEach((el) => { el.classList.toggle("active", ["phone","verify","consent","preferences"].indexOf(el.dataset.stepLabel) <= ["phone","verify","consent","preferences"].indexOf(name)); }); clearStatus(); }
function setBusy(button, busy) { if (busy) { button.dataset.originalLabel = button.dataset.originalLabel || button.textContent; button.disabled = true; button.textContent = "Please wait…"; } else { button.disabled = false; if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel; } }
async function postFunction(name, body, session) {
 const headers = { "content-type": "application/json", apikey: config.publishableKey };
 if (session) headers.authorization = "Bearer " + session.access_token;
 const response = await fetch(config.supabaseUrl + "/functions/v1/" + name, { method: "POST", headers, body: JSON.stringify(body) });
 const result = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(result.error || ("Request failed (" + response.status + ")"));
 return result;
}
forms.phone.addEventListener("submit", async (event) => {
 event.preventDefault(); clearStatus();
 const phone = document.querySelector("#phone").value.trim().replace(/[\s().-]/g, "");
 if (!supabase) return showStatus("Server is not configured with its Supabase project.");
 if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return showStatus("Enter the full number with country code, for example +2348012345678.");
 const button = document.querySelector("#send-otp"); setBusy(button, true);
 try {
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
  if (error) throw error;
  pendingPhone = phone; document.querySelector("#masked-phone").textContent = phone.slice(0,4) + "••••" + phone.slice(-3); setStep("verify");
  showStatus("Supabase Auth accepted the OTP request. Check the handset that owns this number. Only a real SMS counts as delivery.", true);
 } catch (error) {
  const message = String(error?.message || "OTP request failed");
  if (/SMS_GATEWAY_OFFLINE|SMS_QUEUE_UNAVAILABLE|SMS_HOOK_NOT_CONFIGURED|hook/i.test(message)) showStatus("Server could not queue a real SMS. Check the signed SMS hook and ensure the SIM gateway is paired and online. No code has been faked.");
  else showStatus(message.slice(0,300));
 } finally { setBusy(button, false); }
});
forms.verify.addEventListener("submit", async (event) => {
 event.preventDefault(); clearStatus(); const code = document.querySelector("#otp").value.trim();
 if (!supabase || !pendingPhone) return showStatus("Start again with your phone number.");
 if (!/^\d{4,8}$/.test(code)) return showStatus("Enter the digits from the SMS.");
 const button = document.querySelector("#verify-otp"); setBusy(button, true);
 try { const { error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token: code, type: "sms" }); if (error) throw error; setStep("consent"); showStatus("Phone ownership verified by Supabase Auth.", true); }
 catch (error) { showStatus(String(error?.message || "That code could not be verified.").slice(0,250)); }
 finally { setBusy(button, false); }
});
document.querySelector("#back-phone").addEventListener("click", () => setStep("phone"));
forms.consent.addEventListener("submit", (event) => { event.preventDefault(); clearStatus(); if (!document.querySelector("#accept-terms").checked) return showStatus("Please accept the Terms of Service and acknowledge the Privacy Notice."); setStep("preferences"); });
forms.preferences.addEventListener("submit", async (event) => {
 event.preventDefault(); clearStatus(); const button = document.querySelector("#finish-setup"); setBusy(button,true);
 try {
  const { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error("Your session expired. Verify your phone again.");
  await postFunction("server-calls", { action:"save_preferences", accepted:true, terms_version:"server-terms-1.0", privacy_version:"server-privacy-1.0", notifications_enabled:document.querySelector("#notifications").checked, contacts_access_requested:document.querySelector("#contacts").checked }, session);
  setStep("done");
 } catch (error) { showStatus(String(error?.message || "Could not save setup.").slice(0,250)); } finally { setBusy(button,false); }
});
document.querySelector("#create-gateway-pairing").addEventListener("click", async () => {
 const button=document.querySelector("#create-gateway-pairing"),result=document.querySelector("#pairing-result"); button.disabled=true; button.textContent="Generating…"; result.classList.add("hidden");
 try {
  const {data:{session}}=await supabase.auth.getSession(); if(!session) throw new Error("Sign in again to create a pairing code.");
  const data=await postFunction("server-gateway",{action:"create_pairing_code"},session);
  result.textContent="ONE-TIME PAIRING CODE: "+data.pairing_code+"\nExpires: "+data.expires_at+"\nEnter this code in the Android SIM Gateway app now. Treat it like a temporary password."; result.classList.remove("hidden");
 } catch(error) { showStatus(String(error?.message||"Could not generate a pairing code.").slice(0,250)); }
 finally {button.disabled=false;button.textContent="Generate SIM gateway pairing code";}
});
document.querySelector("#sign-out").addEventListener("click", async () => { if(supabase) await supabase.auth.signOut(); pendingPhone=""; document.querySelector("#phone").value="+234"; document.querySelector("#otp").value=""; document.querySelector("#pairing-result").classList.add("hidden"); setStep("phone"); showStatus("Signed out of this browser.",true); });
