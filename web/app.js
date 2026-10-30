const statusEl = document.querySelector("#status");
const button = document.querySelector("#open-server-app");
const fallback = document.querySelector("#fallback");
const isAndroid = /Android/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const stepForm = document.querySelector(".step-form");
const nativeSetup = document.querySelector("#native-setup");
const isAndroidWebView = isAndroid && navigator.userAgent.toLowerCase().includes("; wv");
const isNativeSetup = !!window.ServerAndroid || isAndroidWebView || document.querySelector('meta[name="server-native-bridge"]')?.content === "true";

function showStatus(message, ok = false) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "ok");
  if (ok) statusEl.classList.add("ok");
}

if (isNativeSetup && nativeSetup && stepForm) {
  stepForm.classList.add("hidden");
  nativeSetup.classList.remove("hidden");

  const callStep = document.querySelector("#call-permission-step");
  const terms = document.querySelector("#native-terms");
  const grantCalls = document.querySelector("#grant-call-permissions");
  const finishStep = document.querySelector("#finish-step");
  const serverId = document.querySelector("#server-id");
  const phoneLinkInput = document.querySelector("#link-phone-number");
  const phoneCodeInput = document.querySelector("#link-phone-code");
  const phoneCodeStep = document.querySelector("#phone-link-code-step");
  const requestPhoneCodeButton = document.querySelector("#request-phone-link-code");
  const verifyPhoneButton = document.querySelector("#verify-link-phone");
  const phoneLinkStatus = document.querySelector("#phone-link-status");
  const skipPhoneLinkButton = document.querySelector("#skip-phone-link");
  const allowNumberCalls = document.querySelector("#allow-number-calls");
  const createGatewayPairingButton = document.querySelector("#create-sms-gateway-pairing-code");
  const gatewayPairingResult = document.querySelector("#sms-gateway-pairing-result");
  const gatewayPairingCode = document.querySelector("#sms-gateway-pairing-code");
  const gatewayPairingExpiry = document.querySelector("#sms-gateway-pairing-expiry");
  let pendingPhoneNumber = "";
  let phoneLinkVerified = false;
  let persistedNumberConsent = false;

  const normalizePhone =  const normalizePhone = (raw) => {
    const value = String(raw || "").trim().replace(/[()\s.-]/g, "");
    let candidate = value;
    if (candidate.startsWith("00")) candidate = "+" + candidate.slice(2);
    else if (!candidate.startsWith("+")) {
      const digits = candidate.replace(/\D/g, "");
      if (digits.startsWith("234") && digits.length === 13) candidate = "+" + digits;
      else if (digits.length === 11 && digits.startsWith("0")) candidate = "+234" + digits.slice(1);
      else if (digits.length === 10 && /^[789]/.test(digits)) candidate = "+234" + digits;
      else return null;
    }
    return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
  };

  const showPhoneLinkStatus = (message, ok = false) => {
    if (!phoneLinkStatus) return;
    phoneLinkStatus.textContent = message;
    phoneLinkStatus.classList.remove("hidden", "ok");
    if (ok) phoneLinkStatus.classList.add("ok");
  };

  terms?.addEventListener("change", () => {
    grantCalls.disabled = !terms.checked;
  });

  grantCalls?.addEventListener("click", () => {
    if (!terms?.checked) {
      showStatus("Accept the Terms of Service and acknowledge the Privacy Notice before continuing.");
      return;
    }
    grantCalls.disabled = true;
    grantCalls.textContent = "Waiting for Android permissions…";
    showStatus("Android will request microphone permission and, where available, notification permission.");
    if (!window.ServerAndroid) { showStatus("Android calling integration is not connected. Reopen Server onboarding from this phone."); grantCalls.disabled = false; return; }
    window.ServerAndroid.requestCallPermissions();
  });

  window.onServerCallPermissionResult = (microphoneGranted, notificationsGranted) => {
    grantCalls.disabled = false;
    grantCalls.textContent = "Create Server identity and grant permissions →";
    if (!microphoneGranted) {
      showStatus("Microphone permission is required for Server calls. Allow it and try again.");
      return;
    }
    showStatus("Permissions granted. Creating your Server identity without SMS OTP…");
    grantCalls.disabled = true;
    if (!window.ServerAndroid) { showStatus("Android calling integration is not connected. Reopen Server onboarding from this phone."); grantCalls.disabled = false; return; }
    window.ServerAndroid.completeSetup(Boolean(terms?.checked));
  };

  window.onServerSetupResult = (result) => {
    grantCalls.disabled = false;
    if (!result?.ok) {
      showStatus(result?.error || "Server setup failed. Please try again.");
      return;
    }
    callStep.classList.add("hidden");
    finishStep.classList.remove("hidden");
    serverId.textContent = `Your Server ID: ${result.serverId}`;
    pendingPhoneNumber = "";
    phoneCodeStep?.classList.add("hidden");
    if (phoneCodeInput) phoneCodeInput.value = "";
    if (phoneLinkInput && result.selectedSimNumber && !phoneLinkInput.value) {
      phoneLinkInput.value = result.selectedSimNumber;
    }
    try {
      const savedNumberPreferences = JSON.parse(window.ServerAndroid.getNumberCallPreferences());
      if (savedNumberPreferences.phoneLinked && savedNumberPreferences.phone) {
        phoneLinkVerified = true;
        persistedNumberConsent = savedNumberPreferences.allowNumberCalls === true;
        if (phoneLinkInput) { phoneLinkInput.value = savedNumberPreferences.phone; phoneLinkInput.disabled = true; }
        if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
        if (requestPhoneCodeButton) { requestPhoneCodeButton.disabled = true; requestPhoneCodeButton.textContent = "Number already verified"; }
        phoneCodeStep?.classList.add("hidden"); skipPhoneLinkButton?.classList.add("hidden");
        showPhoneLinkStatus(persistedNumberConsent ? "This verified number is linked and permitted to receive Server internet calls." : "This verified number is linked, but Server calls by number are currently off.");
      }
    } catch { /* First-time number linking remains available. */ }
    showStatus("Server identity created. You can now enable Server under Android Calling accounts. Mobile-number linking is optional.", true);
  };

  requestPhoneCodeButton?.addEventListener("click", () => {
    const number = normalizePhone(phoneLinkInput?.value);
    if (!number) {
      showPhoneLinkStatus("Enter a valid number such as +2348012345678 or 08012345678.");
      phoneLinkInput?.focus();
      return;
    }
    pendingPhoneNumber = number;
    phoneLinkInput.value = number;
    phoneLinkInput.disabled = true;
    requestPhoneCodeButton.disabled = true;
    requestPhoneCodeButton.textContent = "Sending SMS…";
    showPhoneLinkStatus("Requesting a one-time verification code through Server's paired SMS gateway. No code is sent until you press this button.");
    if (!window.ServerAndroid) { phoneLinkInput.disabled = false; requestPhoneCodeButton.disabled = false; showPhoneLinkStatus("Android calling integration is not connected."); return; }
    window.ServerAndroid.requestPhoneLinkOtp(number);
  });

  createGatewayPairingButton?.addEventListener("click", () => {
    if (!window.ServerAndroid?.createSmsGatewayPairingCode) {
      showPhoneLinkStatus("Open Server onboarding from the Android integration before pairing an SMS gateway.");
      return;
    }
    createGatewayPairingButton.disabled = true;
    createGatewayPairingButton.textContent = "Generating one-time code…";
    showPhoneLinkStatus("Generating a secure pairing code. It is valid for 10 minutes.");
    window.ServerAndroid.createSmsGatewayPairingCode();
  });

  window.onServerGatewayPairingCode = (result) => {
    createGatewayPairingButton.disabled = false;
    createGatewayPairingButton.textContent = "Generate a new SMS gateway pairing code";
    if (!result?.ok || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(String(result?.pairing_code || ""))) {
      const reason = result?.error || "GATEWAY_PAIRING_UNAVAILABLE";
      const message = {
        SESSION_REQUIRED: "Create your Server identity again to establish a fresh authenticated session.",
        PAIRING_RATE_LIMITED: "Too many pairing codes were requested. Wait before trying again."
      }[reason] || "Could not create a gateway pairing code (" + reason + ").";
      showPhoneLinkStatus(message);
      return;
    }
    gatewayPairingCode.textContent = result.pairing_code;
    const expiry = Date.parse(result.expires_at || "");
    gatewayPairingExpiry.textContent = Number.isFinite(expiry)
      ? "Expires at " + new Date(expiry).toLocaleTimeString() + ". Open the Server SIM Gateway app now and claim this code."
      : "This code expires in 10 minutes. Open the Server SIM Gateway app now and claim it.";
    gatewayPairingResult.classList.remove("hidden");
    showPhoneLinkStatus("Pairing code created. Claim it in the Server SIM Gateway app, then grant SMS permission and start the gateway.", true);
  };

  window.onServerPhoneOtpRequested = (result) => {
    requestPhoneCodeButton.disabled = false;
    requestPhoneCodeButton.textContent = "Send verification code again";
    if (!result?.ok) {
      phoneLinkInput.disabled = false;
      const message = {
        SMS_GATEWAY_OFFLINE: "The Server SMS gateway is offline. You can pair the Android SMS gateway later and try again, or skip number linking for now.",
        OTP_RATE_LIMITED: "Too many verification requests. Wait before requesting another code.",
        INVALID_PHONE_FORMAT: "Enter a valid number in international format.",
        OTP_QUEUE_FAILED: "Server could not queue the SMS. Try again after checking the paired gateway."
      }[result?.error] || "Server could not send a verification code (" + (result?.error || "unknown error") + ").";
      showPhoneLinkStatus(message);
      return;
    }
    phoneCodeStep?.classList.remove("hidden");
    if (phoneCodeInput) {
      phoneCodeInput.value = "";
      phoneCodeInput.focus();
    }
    showPhoneLinkStatus("Verification code requested for " + pendingPhoneNumber + ". Check that phone for an SMS. Carrier SMS charges may apply.", true);
  };

  verifyPhoneButton?.addEventListener("click", () => {
    const code = String(phoneCodeInput?.value || "").trim();
    if (!pendingPhoneNumber) {
      showPhoneLinkStatus("Request a verification code first.");
      return;
    }
    if (!/^[0-9]{6}$/.test(code)) {
      showPhoneLinkStatus("Enter the six digits from the SMS.");
      phoneCodeInput?.focus();
      return;
    }
    verifyPhoneButton.disabled = true;
    verifyPhoneButton.textContent = "Verifying number…";
    showPhoneLinkStatus("Verifying the code and attaching this number to your existing Server ID…");
    window.ServerAndroid.verifyAndLinkPhone(pendingPhoneNumber, code, Boolean(allowNumberCalls?.checked));
  });

  window.onServerPhoneLinkResult = (result) => {
    verifyPhoneButton.disabled = false;
    verifyPhoneButton.textContent = "Verify and link number";
    if (!result?.ok) {
      const message = {
        INVALID_OR_EXPIRED_CODE: "That code is invalid or expired. Request a new code and try again.",
        OTP_VERIFY_RATE_LIMITED: "Too many attempts. Wait before requesting another code.",
        PHONE_ALREADY_LINKED: "This number is already linked to another Server identity. Try a number that belongs to this account, or continue with the existing Server ID.",
        SESSION_REQUIRED: "The Server session expired. Restart website setup and try again."
      }[result?.error] || "Server could not link this number (" + (result?.error || "unknown error") + ").";
      showPhoneLinkStatus(message);
      if (result?.error === "PHONE_ALREADY_LINKED") {
        phoneLinkInput.disabled = false;
        phoneCodeStep?.classList.add("hidden");
        if (phoneCodeInput) phoneCodeInput.value = "";
        pendingPhoneNumber = "";
        phoneLinkInput.focus();
      } else if (result?.error === "INVALID_OR_EXPIRED_CODE" || result?.error === "OTP_VERIFY_RATE_LIMITED") {
        phoneCodeInput?.focus();
      }
      return;
    }
    phoneLinkInput.disabled = true;
    phoneCodeInput.disabled = true;
    requestPhoneCodeButton.disabled = true;
    verifyPhoneButton.disabled = true;
    phoneLinkVerified = true;
    persistedNumberConsent = result.allow_number_based_server_calls === true;
    if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
    showPhoneLinkStatus(persistedNumberConsent
      ? "Number verified. Other Server users may now call you through Server internet calling on this number."
      : "Number verified and linked, but number-based incoming Server calls are off. You can still be reached by Server ID.", true);
    showStatus("Phone number linked to your existing Server ID. Enable Server in Android Calling accounts to continue to your normal dialer.", true);
  };

  allowNumberCalls?.addEventListener("change", () => {
    if (!phoneLinkVerified) return;
    if (!window.ServerAndroid) { showPhoneLinkStatus("Android bridge is unavailable; reopen Server onboarding."); return; }
    window.ServerAndroid.setNumberCallConsent(Boolean(allowNumberCalls.checked));
  });

  window.onServerNumberCallConsentResult = (result) => {
    if (!result?.ok) {
      if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
      const reason = result?.error || "NUMBER_CALL_CONSENT_SAVE_FAILED";
      showPhoneLinkStatus(reason === "VERIFIED_PHONE_REQUIRED" ? "Verify and link this number before enabling number-based Server calls." : "Could not save the calling permission (" + reason + "). The previous setting remains in effect.");
      return;
    }
    persistedNumberConsent = result.allow_number_based_server_calls === true;
    if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
    showPhoneLinkStatus(persistedNumberConsent ? "Permission saved. Server users can ring you through Server internet calling at this verified number." : "Permission revoked. Calls by Server ID still work, but this number will not route to your Server identity.", true);
  };
  skipPhoneLinkButton?.addEventListener("click", () => {
    showStatus("Continuing without a verified number. Calls by Server ID remain available; the normal phone number will not route to Server until you verify it and explicitly allow number-based Server calls.", true);
    if (!window.ServerAndroid) { showStatus("Open Server from the Android calling integration first."); return; }
    window.ServerAndroid.openCallingSettings();
  });

  window.onServerCallingAccountStatus = (enabled) => {
    if (enabled) {
      showStatus("Server is enabled. Opening your normal phone dialer…", true);
    } else {
      showStatus("In Android Calling accounts, enable Server and return here. Your normal phone dialer will open automatically.");
    }
  };

  window.onServerSettingsError = () => {
    showStatus("Android could not open Calling accounts automatically. Open Phone Settings, enable Server under Calling accounts, then return here and tap Open my normal phone dialer.");
  };

  document.querySelector("#enable-calling-account")?.addEventListener("click", () => {
    window.ServerAndroid.openCallingSettings();
  });
  document.querySelector("#open-phone-dialer")?.addEventListener("click", () => {
    if (!window.ServerAndroid.isCallingAccountEnabled()) {
      showStatus("Server is not enabled yet. Open phone settings, enable Server under calling accounts, then return here.");
      return;
    }
    if (!window.ServerAndroid) { showStatus("Open Server from the Android calling integration first."); return; }
    window.ServerAndroid.openPhoneDialer();
  });


}

button?.addEventListener("click", () => {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Opening Server…";
  fallback?.classList.add("hidden");
  if (!isAndroid) {
    fallback?.classList.add("hidden");
    if (isIOS) {
      showStatus("Opening Server’s iPhone calling integration. The app will continue setup on this phone.");
      const started = Date.now();
      window.location.href = "server://sim-setup";
      window.setTimeout(() => {
        if (document.visibilityState === "visible" && Date.now() - started >= 1200) {
          fallback?.classList.remove("hidden");
          fallback.textContent = "Server could not open. Install the Server iPhone integration first. iOS 18.2+ supports a default calling app when Apple authorizes the required entitlement; iPhone does not expose SIM slots to Server.";
          showStatus("The Server iPhone integration did not open. The website alone cannot register an iOS calling app.");
        }
        button.disabled = false;
        button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
      }, 1800);
    } else {
      fallback?.classList.remove("hidden");
      button.disabled = false;
      button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
      fallback.textContent = "Open this website on your Android phone to install and configure Server Calling Connector. Desktop browsers cannot register calling accounts.";
      showStatus("Android calling setup must be completed through the installed system-calling connector.");
    }
    return;
  }
  showStatus("Opening Server Calling Connector to register the internet-calling account with Android. No SIM selection is required.");
  const started = Date.now();
  window.location.href = "server://sim-setup";
  window.setTimeout(() => {
    if (document.visibilityState === "visible" && Date.now() - started >= 1200) {
      fallback?.classList.remove("hidden");
      fallback.textContent = "The Server calling connector did not open. Android requires an installed native component to register an internet-calling account with its system dialer.";
      showStatus("Android did not open Server Calling Connector. Complete the installation, then return to this website.");
    }
    button.disabled = false;
    button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
  }, 1800);
});
