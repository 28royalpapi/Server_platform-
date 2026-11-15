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
  const callerDisplayNameInput = document.querySelector("#server-display-name");
  const grantCalls = document.querySelector("#grant-call-permissions");
  const finishStep = document.querySelector("#finish-step");
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
  const smsGatewaySimSelect = document.querySelector("#sms-gateway-sim");
  const smsGatewaySimLabel = document.querySelector("#sms-gateway-sim-label");
  const connectSmsGatewayButton = document.querySelector("#connect-sms-gateway");
  const disconnectSmsGatewayButton = document.querySelector("#disconnect-sms-gateway");
  const smsGatewayStatus = document.querySelector("#sms-gateway-status");
  let smsGatewayOptionsReady = false;
  let pendingPhoneNumber = "";
  let pendingCallerDisplayName = "";
  let phoneLinkVerified = false;
  let persistedNumberConsent = false;
  let destinationCountryContactsGranted = false;
  const normalizePhone = (raw) => {
    const value = String(raw || "").trim();
    // The Android bridge can use real SIM/network/locale country metadata. If
    // unavailable (desktop browser or missing country context), require E.164.
    if (window.ServerAndroid && typeof window.ServerAndroid.normalizePhoneNumber === "function") {
      try {
        const nativeNumber = String(window.ServerAndroid.normalizePhoneNumber(value) || "").trim();
        if (/^\+[1-9][0-9]{7,14}$/.test(nativeNumber)) return nativeNumber;
      } catch {}
    }
    const candidate = value.replace(/[()\s.-]/g, "");
    if (!candidate.startsWith("+")) return null;
    return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
  };
  const showPhoneLinkStatus = (message, ok = false) => {
    if (!phoneLinkStatus) return;
    phoneLinkStatus.textContent = message;
    phoneLinkStatus.classList.remove("hidden", "ok");
    if (ok) phoneLinkStatus.classList.add("ok");
  };
  const showSmsGatewayStatus = (message, ok = false) => {
    if (!smsGatewayStatus) return;
    smsGatewayStatus.textContent = message;
    smsGatewayStatus.classList.remove("hidden", "ok");
    if (ok) smsGatewayStatus.classList.add("ok");
  };
  showPhoneLinkButton && showPhoneLinkButton.addEventListener("click", () => {
    phoneLinkStep && phoneLinkStep.classList.remove("hidden");
    showPhoneLinkButton.classList.add("hidden");
  });
  terms && terms.addEventListener("change", () => {
    grantCalls.disabled = !terms.checked;
  });

  grantCalls && grantCalls.addEventListener("click", () => {
    const callerName = String(callerDisplayNameInput && callerDisplayNameInput.value || "").trim().replace(/\s+/g, " ");
    if ([...callerName].length < 2 || [...callerName].length > 60 || /[<>\u0000-\u001f\u007f]/.test(callerName)) {
      showStatus("Enter the name you want people to see when you call (2–60 characters).");
      callerDisplayNameInput && callerDisplayNameInput.focus();
      return;
    }
    pendingCallerDisplayName = callerName;
    if (!(terms && terms.checked)) {
      showStatus("Accept the Terms of Service and acknowledge the Privacy Notice before continuing.");
      return;
    }
    grantCalls.disabled = true;
    grantCalls.textContent = "Waiting for Android permissions…";
    showStatus("Android will request microphone and notification permissions. Optional contacts access matches caller numbers against names stored on this phone only; your address book is never uploaded. Server calls use WebRTC over the internet and do not require a SIM fallback.");
    if (!window.ServerAndroid) { showStatus("Android calling integration is not connected. Reopen Server onboarding from this phone."); grantCalls.disabled = false; return; }
    window.ServerAndroid.requestCallPermissions();
  });

  window.onServerCallPermissionResult = (microphoneGranted, notificationsGranted, phoneStateGranted, contactsGranted) => {
    destinationCountryContactsGranted = contactsGranted === true;
    grantCalls.disabled = false;
    grantCalls.textContent = "Allow permissions and continue →";
    if (!microphoneGranted) {
      showStatus("Microphone permission is required for Server internet calls. Allow it and try again.");
      return;
    }
    if (!window.ServerAndroid) {
      showStatus("Android calling integration is not connected. Reopen Server onboarding from this phone.");
      return;
    }
    callStep && callStep.classList.add("hidden");
    showStatus(
      (notificationsGranted === true
        ? "Incoming-call notifications are allowed. "
        : "Notifications are disabled; background incoming-call alerts may not appear until enabled in Android Settings. ") +
      "Creating your Server identity. Server calling uses the internet and does not require a selected SIM.",
      true
    );
    window.ServerAndroid.completeSetup(pendingCallerDisplayName, Boolean(terms && terms.checked));
  };

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
    showStatus("Server identity created. You can connect a SIM for SMS invitations now or continue with your Server ID. Enable Server under Android Calling accounts to finish setup." + contactCountryNote, true);
    if (window.ServerAndroid && typeof window.ServerAndroid.refreshSmsGatewayStatus === "function") {
      window.ServerAndroid.refreshSmsGatewayStatus();
    }
  };

  requestPhoneCodeButton && requestPhoneCodeButton.addEventListener("click", () => {
    const number = normalizePhone(phoneLinkInput && phoneLinkInput.value);
    if (!number) {
      showPhoneLinkStatus("Enter a number for your device's country, or use international format with +country code (e.g. +2348012345678 or +919876543210).");
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

  const populateSmsGatewaySims = (options) => {
    if (!smsGatewaySimSelect) return;
    smsGatewaySimSelect.innerHTML = '<option value="">Choose a SIM</option>';
    options.forEach((sim) => {
      const option = document.createElement("option");
      option.value = String(sim.subscription_id);
      option.textContent = sim.label || ("SIM " + (Number(sim.slot_index) + 1) + " · " + (sim.carrier || "Mobile network"));
      smsGatewaySimSelect.appendChild(option);
    });
    smsGatewayOptionsReady = true;
    smsGatewaySimSelect.disabled = false;
    if (options.length > 1) {
      smsGatewaySimSelect.classList.remove("hidden");
      smsGatewaySimLabel && smsGatewaySimLabel.classList.remove("hidden");
      connectSmsGatewayButton.textContent = "Connect selected SIM";
      showSmsGatewayStatus("Choose the SIM Server should use, then tap Connect.");
      return;
    }
    if (options.length === 1) {
      smsGatewaySimSelect.value = String(options[0].subscription_id);
      window.ServerAndroid.connectSmsGateway(Number(options[0].subscription_id));
      return;
    }
    smsGatewaySimSelect.disabled = true;
    smsGatewaySimLabel && smsGatewaySimLabel.classList.add("hidden");
    showSmsGatewayStatus("No active SIM with SMS capability was found on this device.");
    connectSmsGatewayButton.disabled = false;
    connectSmsGatewayButton.textContent = "Try again";
  };

  connectSmsGatewayButton && connectSmsGatewayButton.addEventListener("click", () => {
    if (!window.ServerAndroid || typeof window.ServerAndroid.requestSmsGatewaySimOptions !== "function") {
      showSmsGatewayStatus("Open Server from its Android app to connect a SIM.");
      return;
    }
    if (smsGatewayOptionsReady && smsGatewaySimSelect && smsGatewaySimSelect.options.length > 1) {
      const selected = Number(smsGatewaySimSelect.value);
      if (!Number.isInteger(selected) || selected < 0) {
        showSmsGatewayStatus("Choose the SIM you want Server to use.");
        return;
      }
      connectSmsGatewayButton.disabled = true;
      showSmsGatewayStatus("Connecting your selected SIM to Server…");
      window.ServerAndroid.connectSmsGateway(selected);
      return;
    }
    connectSmsGatewayButton.disabled = true;
    connectSmsGatewayButton.textContent = "Checking SIMs…";
    showSmsGatewayStatus("Checking the active SIMs on this phone…");
    smsGatewayOptionsReady = false;
    window.ServerAndroid.requestSmsGatewaySimOptions();
  });

  disconnectSmsGatewayButton && disconnectSmsGatewayButton.addEventListener("click", () => {
    if (!window.ServerAndroid) return;
    disconnectSmsGatewayButton.disabled = true;
    showSmsGatewayStatus("Disconnecting this SIM from Server…");
    window.ServerAndroid.disconnectSmsGateway();
  });

  window.onServerSmsGatewaySimOptions = (result) => {
    connectSmsGatewayButton.disabled = false;
    connectSmsGatewayButton.textContent = "Connect my SIM";
    if (!result || !result.ok) {
      const reason = (result && result.error) || "SIM_LOOKUP_FAILED";
      const messages = {
        SIM_PERMISSION_DENIED: "Allow SIM access so Server can show your active SIM slots.",
        SIM_PERMISSION_REQUIRED: "Allow SIM access, then try again.",
        SMS_PERMISSION_DENIED: "Allow Server to send SMS from the SIM you selected.",
        GATEWAY_NOTIFICATION_PERMISSION_DENIED: "Allow Server notifications so its SIM connection can stay visible.",
        GATEWAY_PERMISSIONS_REQUIRED: "Allow the requested Android permissions, then connect again."
      };
      showSmsGatewayStatus(messages[reason] || "Server could not read the active SIMs (" + reason + ").");
      return;
    }
    const options = Array.isArray(result.options) ? result.options : [];
    if (!options.length) {
      showSmsGatewayStatus("This phone has no active SIM that supports SMS, or it is a Wi-Fi-only device.");
      return;
    }
    populateSmsGatewaySims(options);
  };

  window.onServerSmsGatewayResult = (result) => {
    connectSmsGatewayButton.disabled = false;
    disconnectSmsGatewayButton.disabled = false;
    if (!result || !result.ok) {
      showSmsGatewayStatus("Server could not connect this SIM (" + ((result && result.error) || "unknown error") + ").");
      connectSmsGatewayButton.textContent = "Try connecting again";
      return;
    }
    if (result.connected === false) {
      disconnectSmsGatewayButton.classList.add("hidden");
      connectSmsGatewayButton.classList.remove("hidden");
      connectSmsGatewayButton.textContent = "Connect my SIM";
      if (smsGatewayOptionsReady && smsGatewaySimSelect && smsGatewaySimSelect.options.length > 2) {
        smsGatewaySimSelect.classList.remove("hidden");
        smsGatewaySimLabel && smsGatewaySimLabel.classList.remove("hidden");
      }
      showSmsGatewayStatus(result.message || "Your SIM is disconnected from Server.", true);
      return;
    }
    connectSmsGatewayButton.classList.add("hidden");
    disconnectSmsGatewayButton.classList.remove("hidden");
    smsGatewaySimSelect && smsGatewaySimSelect.classList.add("hidden");
    smsGatewaySimLabel && smsGatewaySimLabel.classList.add("hidden");
    showSmsGatewayStatus("Connected: " + (result.label || result.carrier || "selected SIM") + ". Server confirmed this SIM is registered and online.", true);
  };

  window.onServerSmsGatewayStatus = (result) => {
    if (!result || !result.connected) {
      connectSmsGatewayButton && connectSmsGatewayButton.classList.remove("hidden");
      disconnectSmsGatewayButton && disconnectSmsGatewayButton.classList.add("hidden");
      if (result && result.ok === false && result.error !== "GATEWAY_NOT_REGISTERED") {
        showSmsGatewayStatus("Server cannot confirm the SIM connection. Open Server to reconnect.");
      }
      return;
    }
    connectSmsGatewayButton && connectSmsGatewayButton.classList.add("hidden");
    disconnectSmsGatewayButton && disconnectSmsGatewayButton.classList.remove("hidden");
    smsGatewaySimSelect && smsGatewaySimSelect.classList.add("hidden");
    smsGatewaySimLabel && smsGatewaySimLabel.classList.add("hidden");
    showSmsGatewayStatus("Connected: " + (result.label || "selected SIM") + ". SMS delivery is active while this phone stays online.", true);
  };

  window.onServerPhoneOtpRequested = (result) => {
    requestPhoneCodeButton.disabled = false;
    requestPhoneCodeButton.textContent = "Send verification code again";
    if (!result || !result.ok) {
      phoneLinkInput.disabled = false;
      const message = {
        SMS_GATEWAY_OFFLINE: "Connect a SIM to Server before requesting a phone verification code.",
        OTP_RATE_LIMITED: "Too many verification requests. Wait before requesting another code.",
        INVALID_PHONE_FORMAT: "Enter a valid number in international format.",
        OTP_QUEUE_FAILED: "Server could not queue the SMS. Check that your selected SIM is connected."
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

  window.onServerCallingAccountStatus = (enabled, stateKnown = true) => {
    if (enabled) {
      showStatus("Server is enabled. Opening your normal phone dialer…", true);
    } else if (!stateKnown) {
      showStatus("Android does not expose this setting without phone-state access, which Server deliberately does not request. The normal dialer is opening; choose Server if it appears. If it does not, return to Calling accounts and enable Server.");
    } else {
      showStatus("Server is not enabled yet. Enable it under Android Calling accounts, then return here.");
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
    showStatus("Opening your normal phone dialer. Choose Server for internet calls; your SIM options remain available.");
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
