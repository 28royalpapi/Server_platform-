const statusEl = document.querySelector("#status");
const button = document.querySelector("#open-server-app");
const fallback = document.querySelector("#fallback");
const androidInstall = document.querySelector("#android-install");
const androidDownload = document.querySelector("#download-android-connector");
const iosInstallNote = document.querySelector("#ios-install-note");
const isAndroid = /Android/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const stepForm = document.querySelector(".step-form");
const nativeSetup = document.querySelector("#native-setup");
const isAndroidWebView = isAndroid && navigator.userAgent.toLowerCase().includes("; wv");
const isNativeSetup = !!window.ServerAndroid || isAndroidWebView || (document.querySelector('meta[name="server-native-bridge"]') && document.querySelector('meta[name="server-native-bridge"]').content === "true");
if (!isAndroid) {
  androidInstall && androidInstall.classList.add("hidden");
  if (isIOS && iosInstallNote) iosInstallNote.textContent = "iPhone uses a separate native Server app and Apple's calling-app permissions. The Android connector is not for iPhone; iOS setup will follow after Android validation.";
  else if (iosInstallNote) iosInstallNote.textContent = "Open this website on an Android phone to install the Server calling connector. The iPhone app is a separate iOS release.";
}
androidDownload && androidDownload.addEventListener("click", () => {
  showStatus("Opening the 64-bit ARM Server connector download. Keep this website tab open; return here after Android finishes installing Server.");
});
const androidDownloadArmv7 = document.querySelector("#download-android-connector-armv7");
androidDownloadArmv7 && androidDownloadArmv7.addEventListener("click", () => {
  showStatus("Opening the 32-bit ARMv7 Server connector download. Keep this website tab open; return here after Android finishes installing Server.");
});

function showStatus(message, ok = false) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "ok");
  if (ok) statusEl.classList.add("ok");
}
if (isNativeSetup && nativeSetup && stepForm) {
  stepForm.classList.add("hidden");
  nativeSetup.classList.remove("hidden");
  const callStep = document.querySelector("#call-permission-step");
  callStep && callStep.classList.remove("hidden");
  const terms = document.querySelector("#native-terms");
  const grantCalls = document.querySelector("#grant-call-permissions");
  const finishStep = document.querySelector("#finish-step");
  const fallbackSimStep = document.querySelector("#fallback-sim-step");
  const fallbackSimOptionsEl = document.querySelector("#fallback-sim-options");
  const fallbackSimNote = document.querySelector("#fallback-sim-note");
  const saveFallbackSimButton = document.querySelector("#save-fallback-sim");
  const automaticCarrierFallback = document.querySelector("#automatic-carrier-fallback");
  const serverId = document.querySelector("#server-id");
  const phoneLinkInput = document.querySelector("#link-phone-number");
  const phoneCodeInput = document.querySelector("#link-phone-code");
  const phoneCodeStep = document.querySelector("#phone-link-code-step");
  const requestPhoneCodeButton = document.querySelector("#request-phone-link-code");
  const verifyPhoneButton = document.querySelector("#verify-link-phone");
  const phoneLinkStatus = document.querySelector("#phone-link-status");
  const phoneLinkStep = document.querySelector("#phone-link-step");
  const showPhoneLinkButton = document.querySelector("#show-phone-link");
  const skipPhoneLinkButton = document.querySelector("#skip-phone-link");
  const allowNumberCalls = document.querySelector("#allow-number-calls");
  const createGatewayPairingButton = document.querySelector("#create-sms-gateway-pairing-code");
  const gatewayPairingResult = document.querySelector("#sms-gateway-pairing-result");
  const gatewayPairingCode = document.querySelector("#sms-gateway-pairing-code");
  const gatewayPairingExpiry = document.querySelector("#sms-gateway-pairing-expiry");
  let pendingPhoneNumber = "";
  let phoneLinkVerified = false;
  let persistedNumberConsent = false;
  let destinationCountryContactsGranted = false;
  let selectedFallbackSimKey = "ask";
  let fallbackSimOptionPayload = null;
  let automaticCarrierFallbackEnabled = false;
  const renderFallbackSimOptions = (payload, selectedKeyOverride = null) => {
    fallbackSimOptionPayload = payload;
    const options = Array.isArray(payload && payload.options) ? payload.options : [];
    selectedFallbackSimKey = selectedKeyOverride !== null
      ? String(selectedKeyOverride)
      : String(payload && payload.selected_key || "ask");
    const choices = [{
      key: "ask",
      label: "Ask me every time",
      description: "Android will show the available SIM lines each time you choose a carrier call."
    }, ...options.map((option) => ({
      key: String(option.key),
      label: String(option.label || ("SIM " + (Number(option.slot_index) + 1))),
      description: "Your mobile operator will apply its normal voice-call charges."
    }))];
    if (fallbackSimOptionsEl) fallbackSimOptionsEl.textContent = "";
    choices.forEach((choice) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "sim-choice" + (choice.key === selectedFallbackSimKey ? " selected" : "");
      item.setAttribute("aria-pressed", choice.key === selectedFallbackSimKey ? "true" : "false");
      const heading = document.createElement("strong");
      heading.textContent = choice.label;
      const detail = document.createElement("span");
      detail.textContent = choice.description;
      item.appendChild(heading);
      item.appendChild(detail);
      item.addEventListener("click", () => {
        const previousKey = selectedFallbackSimKey;
        selectedFallbackSimKey = choice.key;
        renderFallbackSimOptions(fallbackSimOptionPayload, choice.key);
        try {
          if (window.ServerAndroid && window.ServerAndroid.setFallbackSimSelection) {
            const saved = JSON.parse(window.ServerAndroid.setFallbackSimSelection(choice.key));
            if (!saved || saved.ok !== true) throw new Error((saved && saved.error) || "SIM selection could not be saved.");
          }
        } catch (error) {
          if (fallbackSimNote) fallbackSimNote.textContent = error.message || "SIM selection could not be saved.";
        }
        if (previousKey !== choice.key && automaticCarrierFallbackEnabled) {
          automaticCarrierFallbackEnabled = false;
          if (automaticCarrierFallback) automaticCarrierFallback.checked = false;
          if (window.ServerAndroid && window.ServerAndroid.setAutomaticCarrierFallback) {
            window.ServerAndroid.setAutomaticCarrierFallback(false);
          }
        }
        if (fallbackSimNote) fallbackSimNote.textContent = choice.description;
      });
      fallbackSimOptionsEl && fallbackSimOptionsEl.appendChild(item);
    });
    const hasSelectedSim = selectedFallbackSimKey !== "ask" && options.some((option) => String(option.key) === selectedFallbackSimKey);
    if (automaticCarrierFallback) {
      automaticCarrierFallback.disabled = !hasSelectedSim;
      automaticCarrierFallback.checked = payload && payload.automatic_fallback_enabled === true && hasSelectedSim;
      automaticCarrierFallbackEnabled = automaticCarrierFallback.checked;
    }
    if (fallbackSimNote) {
      if (payload && payload.selected_sim_unavailable) {
        fallbackSimNote.textContent = "Your previously selected SIM is no longer active. Choose another line or ask Android every time.";
      } else if (!options.length) {
        fallbackSimNote.textContent = "Android did not expose an active SIM calling account. Server internet calls still work; select a SIM when one is available.";
      } else {
        fallbackSimNote.textContent = automaticCarrierFallbackEnabled
          ? "Automatic fallback is enabled for this selected SIM. Your operator applies normal charges."
          : "The selected SIM is saved on this device. Automatic carrier calling is off until you explicitly enable it.";
      }
    }
  };
  const loadFallbackSimOptions = () => {
    if (!window.ServerAndroid || typeof window.ServerAndroid.getFallbackSimOptions !== "function") {
      renderFallbackSimOptions({ok:true,options:[],selected_key:"ask"});
      return;
    }
    try {
      const payload = JSON.parse(window.ServerAndroid.getFallbackSimOptions());
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || "SIM choices unavailable");
      renderFallbackSimOptions(payload);
    } catch {
      renderFallbackSimOptions({ok:true,options:[],selected_key:"ask"});
      if (fallbackSimNote) fallbackSimNote.textContent = "SIM choices could not be read. Server will keep Ask me every time; your normal phone dialler remains available.";
    }
  };
  const normalizePhone = (raw) => {
    // The browser has no trustworthy SIM/country context. Require explicit E.164
    // input here rather than silently treating every national number as Nigerian.
    const candidate = String(raw || "").trim().replace(/[()\s.-]/g, "");
    if (!candidate.startsWith("+")) return null;
    return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
  };
  const showPhoneLinkStatus = (message, ok = false) => {
    if (!phoneLinkStatus) return;
    phoneLinkStatus.textContent = message;
    phoneLinkStatus.classList.remove("hidden", "ok");
    if (ok) phoneLinkStatus.classList.add("ok");
  };
  showPhoneLinkButton && showPhoneLinkButton.addEventListener("click", () => {
    phoneLinkStep && phoneLinkStep.classList.remove("hidden");
    showPhoneLinkButton.classList.add("hidden");
  });
  terms && terms.addEventListener("change", () => {
    grantCalls.disabled = !terms.checked;
  });

  grantCalls && grantCalls.addEventListener("click", () => {
    if (!(terms && terms.checked)) {
      showStatus("Accept the Terms of Service and acknowledge the Privacy Notice before continuing.");
      return;
    }
    grantCalls.disabled = true;
    grantCalls.textContent = "Waiting for Android permissions…";
    showStatus("Android will request microphone, Phone-state and notification permissions. Contacts access matches incoming caller numbers to names stored on this phone only; your address book is never uploaded. CALL_PHONE is requested separately only after you enable automatic SIM fallback.");
    if (!window.ServerAndroid) { showStatus("Android calling integration is not connected. Reopen Server onboarding from this phone."); grantCalls.disabled = false; return; }
    window.ServerAndroid.requestCallPermissions();
  });

  window.onServerCallPermissionResult = (microphoneGranted, notificationsGranted, phoneStateGranted, contactsGranted) => {
    destinationCountryContactsGranted = contactsGranted === true;
    grantCalls.disabled = false;
    grantCalls.textContent = "Allow permissions and continue →";
    if (!microphoneGranted) {
      showStatus("Microphone permission is required for Server calls. Allow it and try again.");
      return;
    }
    if (!phoneStateGranted) {
      showStatus("Android Phone-state permission is required to list active SIM carrier names and slots for your fallback choice and to check Server calling-account settings. Server does not read SIM phone numbers, ICCIDs or IMSIs.");
      return;
    }
    if (!window.ServerAndroid) {
      showStatus("Android calling integration is not connected. Reopen Server onboarding from this phone.");
      return;
    }
    callStep && callStep.classList.add("hidden");
    fallbackSimStep && fallbackSimStep.classList.remove("hidden");
    const permissionStatus = notificationsGranted === true
      ? "Incoming-call notifications are allowed. "
      : "Notifications are disabled. Server internet calls can still work while the receiver is active, but background incoming-call alerts may not appear until you enable Server notifications in Android Settings. "
    showStatus(permissionStatus + "Choose the SIM Server should preselect if you make a normal carrier fallback.", true);
    loadFallbackSimOptions();
  };

  window.onServerAutoCarrierFallbackPermissionResult = (enabled, reason) => {
    automaticCarrierFallbackEnabled = enabled === true;
    if (automaticCarrierFallback) automaticCarrierFallback.checked = automaticCarrierFallbackEnabled;
    if (fallbackSimNote) fallbackSimNote.textContent = automaticCarrierFallbackEnabled
      ? "Automatic fallback is enabled for this selected SIM. Your operator applies normal charges."
      : reason === "CALL_PHONE_PERMISSION_DENIED"
        ? "Automatic fallback is off because Android call permission was not granted. Manual SIM fallback remains available."
        : reason === "SELECTED_SIM_REQUIRED"
          ? "Choose one active SIM before enabling automatic carrier fallback."
          : "Automatic carrier fallback is off. Manual SIM fallback remains available.";
  };

  automaticCarrierFallback && automaticCarrierFallback.addEventListener("change", () => {
    if (!window.ServerAndroid || typeof window.ServerAndroid.setAutomaticCarrierFallback !== "function") {
      automaticCarrierFallback.checked = false;
      showStatus("Automatic selected-SIM calls are available only from the installed Android connector.");
      return;
    }
    if (automaticCarrierFallback.checked) {
      if (selectedFallbackSimKey === "ask") {
        automaticCarrierFallback.checked = false;
        showStatus("Choose one active SIM before enabling automatic carrier fallback.");
        return;
      }
      try {
        const saved = JSON.parse(window.ServerAndroid.setFallbackSimSelection(selectedFallbackSimKey));
        if (!saved || saved.ok !== true) throw new Error((saved && saved.error) || "SIM selection could not be saved.");
      } catch (error) {
        automaticCarrierFallback.checked = false;
        showStatus(error.message || "SIM selection could not be saved.");
        return;
      }
    }
    window.ServerAndroid.setAutomaticCarrierFallback(Boolean(automaticCarrierFallback.checked));
  });

  saveFallbackSimButton && saveFallbackSimButton.addEventListener("click", () => {
    if (!window.ServerAndroid || typeof window.ServerAndroid.setFallbackSimSelection !== "function") {
      showStatus("Android could not save the fallback SIM preference. Reopen Server onboarding from the installed connector.");
      return;
    }
    saveFallbackSimButton.disabled = true;
    try {
      if (automaticCarrierFallback && automaticCarrierFallback.checked && !automaticCarrierFallbackEnabled) {
        throw new Error("Wait for Android to confirm permission for automatic carrier calling before completing setup.");
      }
      const saved = JSON.parse(window.ServerAndroid.setFallbackSimSelection(selectedFallbackSimKey));
      if (!saved || saved.ok !== true) throw new Error((saved && saved.error) || "Fallback SIM preference could not be saved.");
      fallbackSimStep && fallbackSimStep.classList.add("hidden");
      showStatus("Fallback choice saved. Creating your Server identity…", true);
      window.ServerAndroid.completeSetup(Boolean(terms && terms.checked));
    } catch (error) {
      showStatus(error.message || "Fallback SIM preference could not be saved.");
      saveFallbackSimButton.disabled = false;
    }
  });

  window.onServerSetupResult = (result) => {
    grantCalls.disabled = false;
    if (!result || !result.ok) {
      showStatus((result && result.error) || "Server setup failed. Please try again.");
      return;
    }
    callStep.classList.add("hidden");
    finishStep.classList.remove("hidden");
    serverId.textContent = `Your Server ID: ${result.serverId}`;
    pendingPhoneNumber = "";
    phoneCodeStep && phoneCodeStep.classList.add("hidden");
    if (phoneCodeInput) phoneCodeInput.value = "";
    try {
      const savedNumberPreferences = JSON.parse(window.ServerAndroid.getNumberCallPreferences());
      if (savedNumberPreferences.phoneLinked && savedNumberPreferences.phone) {
        phoneLinkStep && phoneLinkStep.classList.remove("hidden");
        showPhoneLinkButton && showPhoneLinkButton.classList.add("hidden");
        phoneLinkVerified = true;
        persistedNumberConsent = savedNumberPreferences.allowNumberCalls === true;
        if (phoneLinkInput) { phoneLinkInput.value = savedNumberPreferences.phone; phoneLinkInput.disabled = true; }
        if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
        if (requestPhoneCodeButton) { requestPhoneCodeButton.disabled = true; requestPhoneCodeButton.textContent = "Number already verified"; }
        phoneCodeStep && phoneCodeStep.classList.add("hidden"); skipPhoneLinkButton && skipPhoneLinkButton.classList.add("hidden");
        showPhoneLinkStatus(persistedNumberConsent ? "This verified number is linked and permitted to receive Server internet calls." : "This verified number is linked, but Server calls by number are currently off.");
      }
    } catch { /* First-time number linking remains available. */ }
    const contactCountryNote = destinationCountryContactsGranted ? "" : " Contacts access was not granted. For safety, use an international number beginning with +; Server will not guess a country for a national-format number.";
    showStatus("Server identity created. Phone-number linking is optional; enable Server under Android Calling accounts to finish setup." + contactCountryNote, true);
  };

  requestPhoneCodeButton && requestPhoneCodeButton.addEventListener("click", () => {
    const number = normalizePhone(phoneLinkInput && phoneLinkInput.value);
    if (!number) {
      showPhoneLinkStatus("Enter an international number beginning with + and its country code, e.g. +2348012345678 or +919876543210.");
      phoneLinkInput && phoneLinkInput.focus();
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

  createGatewayPairingButton && createGatewayPairingButton.addEventListener("click", () => {
    if (!(window.ServerAndroid && window.ServerAndroid.createSmsGatewayPairingCode)) {
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
    if (!result || !result.ok || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(String((result && result.pairing_code) || ""))) {
      const reason = (result && result.error) || "GATEWAY_PAIRING_UNAVAILABLE";
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
    if (!result || !result.ok) {
      phoneLinkInput.disabled = false;
      const message = {
        SMS_GATEWAY_OFFLINE: "The Server SMS gateway is offline. You can pair the Android SMS gateway later and try again, or skip number linking for now.",
        OTP_RATE_LIMITED: "Too many verification requests. Wait before requesting another code.",
        INVALID_PHONE_FORMAT: "Enter a valid number in international format.",
        OTP_QUEUE_FAILED: "Server could not queue the SMS. Try again after checking the paired gateway."
      }[(result && result.error)] || "Server could not send a verification code (" + ((result && result.error) || "unknown error") + ").";
      showPhoneLinkStatus(message);
      return;
    }
    phoneCodeStep && phoneCodeStep.classList.remove("hidden");
    if (phoneCodeInput) {
      phoneCodeInput.value = "";
      phoneCodeInput.focus();
    }
    showPhoneLinkStatus("Verification code requested for " + pendingPhoneNumber + ". Check that phone for an SMS. Carrier SMS charges may apply.", true);
  };

  verifyPhoneButton && verifyPhoneButton.addEventListener("click", () => {
    const code = String(phoneCodeInput && phoneCodeInput.value || "").trim();
    if (!pendingPhoneNumber) {
      showPhoneLinkStatus("Request a verification code first.");
      return;
    }
    if (!/^[0-9]{6}$/.test(code)) {
      showPhoneLinkStatus("Enter the six digits from the SMS.");
      phoneCodeInput && phoneCodeInput.focus();
      return;
    }
    verifyPhoneButton.disabled = true;
    verifyPhoneButton.textContent = "Verifying number…";
    showPhoneLinkStatus("Verifying the code and attaching this number to your existing Server ID…");
    window.ServerAndroid.verifyAndLinkPhone(pendingPhoneNumber, code, Boolean(allowNumberCalls && allowNumberCalls.checked));
  });

  window.onServerPhoneLinkResult = (result) => {
    verifyPhoneButton.disabled = false;
    verifyPhoneButton.textContent = "Verify and link number";
    if (!result || !result.ok) {
      const message = {
        INVALID_OR_EXPIRED_CODE: "That code is invalid or expired. Request a new code and try again.",
        OTP_VERIFY_RATE_LIMITED: "Too many attempts. Wait before requesting another code.",
        PHONE_ALREADY_LINKED: "This number is already linked to another Server identity. Try a number that belongs to this account, or continue with the existing Server ID.",
        SESSION_REQUIRED: "The Server session expired. Restart website setup and try again."
      }[(result && result.error)] || "Server could not link this number (" + ((result && result.error) || "unknown error") + ").";
      showPhoneLinkStatus(message);
      if (result && result.error === "PHONE_ALREADY_LINKED") {
        phoneLinkInput.disabled = false;
        phoneCodeStep && phoneCodeStep.classList.add("hidden");
        if (phoneCodeInput) phoneCodeInput.value = "";
        pendingPhoneNumber = "";
        phoneLinkInput.focus();
      } else if (result && result.error === "INVALID_OR_EXPIRED_CODE" || result && result.error === "OTP_VERIFY_RATE_LIMITED") {
        phoneCodeInput && phoneCodeInput.focus();
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

  allowNumberCalls && allowNumberCalls.addEventListener("change", () => {
    if (!phoneLinkVerified) return;
    if (!window.ServerAndroid) { showPhoneLinkStatus("Android bridge is unavailable; reopen Server onboarding."); return; }
    window.ServerAndroid.setNumberCallConsent(Boolean(allowNumberCalls.checked));
  });

  window.onServerNumberCallConsentResult = (result) => {
    if (!result || !result.ok) {
      if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
      const reason = (result && result.error) || "NUMBER_CALL_CONSENT_SAVE_FAILED";
      showPhoneLinkStatus(reason === "VERIFIED_PHONE_REQUIRED" ? "Verify and link this number before enabling number-based Server calls." : "Could not save the calling permission (" + reason + "). The previous setting remains in effect.");
      return;
    }
    persistedNumberConsent = result.allow_number_based_server_calls === true;
    if (allowNumberCalls) allowNumberCalls.checked = persistedNumberConsent;
    showPhoneLinkStatus(persistedNumberConsent ? "Permission saved. Server users can ring you through Server internet calling at this verified number." : "Permission revoked. Calls by Server ID still work, but this number will not route to your Server identity.", true);
  };
  skipPhoneLinkButton && skipPhoneLinkButton.addEventListener("click", () => {
    showStatus("Continuing with your Server ID. You can link a phone number later if you want.", true);
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

  document.querySelector("#enable-calling-account") && document.querySelector("#enable-calling-account").addEventListener("click", () => {
    window.ServerAndroid.openCallingSettings();
  });
  document.querySelector("#open-phone-dialer") && document.querySelector("#open-phone-dialer").addEventListener("click", () => {
    if (!window.ServerAndroid) { showStatus("Open Server from the Android calling integration first."); return; }
    if (!window.ServerAndroid.isCallingAccountEnabled()) {
      showStatus("Server is not enabled yet. Open phone settings, enable Server under calling accounts, then return here.");
      return;
    }
    window.ServerAndroid.openPhoneDialer();
  });


}

button && button.addEventListener("click", () => {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Opening Server…";
  fallback && fallback.classList.add("hidden");
  if (!isAndroid) {
    fallback && fallback.classList.add("hidden");
    if (isIOS) {
      showStatus("Opening Server’s iPhone calling integration. The app will continue setup on this phone.");
      const started = Date.now();
      window.location.href = "server://device-setup";
      window.setTimeout(() => {
        if (document.visibilityState === "visible" && Date.now() - started >= 1200) {
          fallback && fallback.classList.remove("hidden");
          fallback.textContent = "Server could not open. Install the Server iPhone integration first. iOS 18.2+ supports a default calling app when Apple authorizes the required entitlement; iPhone does not expose SIM slots to Server.";
          showStatus("The Server iPhone integration did not open. The website alone cannot register an iOS calling app.");
        }
        button.disabled = false;
        button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
      }, 1800);
    } else {
      fallback && fallback.classList.remove("hidden");
      button.disabled = false;
      button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
      fallback.textContent = "Install the Server Android calling component on your phone to connect Server with Android's system calling interface.";
      showStatus("Server calling integration is available through the native phone component.");
    }
    return;
  }
  showStatus("Opening the phone integration to complete the system-calling setup. It will display this web onboarding, not a separate number-entry app.");
  const started = Date.now();
  window.location.href = "server://device-setup";
  window.setTimeout(() => {
    if (document.visibilityState === "visible" && Date.now() - started >= 1200) {
      fallback && fallback.classList.remove("hidden");
      fallback.textContent = "The Server phone-integration component did not open. Browser security prevents a website from registering an account with Android’s system dialer. The component is required only to bridge those operating-system APIs; the onboarding UI remains this website.";
      showStatus("Android did not open the system integration component. Android system calling cannot be registered by a browser alone.");
    }
    button.disabled = false;
    button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
  }, 1800);
});
