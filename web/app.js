const statusEl = document.querySelector("#status");
const button = document.querySelector("#open-server-app");
const fallback = document.querySelector("#fallback");
const isAndroid = /Android/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const stepForm = document.querySelector(".step-form");
const nativeSetup = document.querySelector("#native-setup");

function showStatus(message, ok = false) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "ok");
  if (ok) statusEl.classList.add("ok");
}

if (window.ServerAndroid && nativeSetup && stepForm) {
  stepForm.classList.add("hidden");
  nativeSetup.classList.remove("hidden");

  const detectButton = document.querySelector("#detect-sims");
  const simOptions = document.querySelector("#sim-options");
  const continuePermissions = document.querySelector("#continue-permissions");
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
  let selectedSubscriptionId = null;
  let pendingPhoneNumber = "";

  const normalizePhone = (raw) => {
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

  const showSims = (data) => {
    simOptions.replaceChildren();
    continuePermissions.classList.add("hidden");
    continuePermissions.disabled = true;
    selectedSubscriptionId = null;
    if (data?.permissionNeeded) {
      showStatus("Android permission is needed before Server can read the SIM list.");
      return;
    }
    const sims = Array.isArray(data?.sims) ? data.sims : [];
    if (!sims.length) {
      showStatus("Android did not expose any active SIM cards. Server cannot select a SIM on this device.", false);
      return;
    }
    sims.forEach((sim) => {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "sim-choice" + (sim.selected ? " selected" : "");
      const title = document.createElement("strong");
      title.textContent = `SIM ${sim.slot} · ${sim.carrier || "Unknown carrier"}`;
      const number = document.createElement("span");
      number.textContent = sim.numberAvailable && sim.number
        ? sim.number
        : "Phone number not exposed by Android / carrier";
      choice.append(title, number);
      choice.addEventListener("click", () => {
        try {
          if (!window.ServerAndroid.selectSim(Number(sim.id))) {
            showStatus("The selected SIM is no longer active. Detect SIMs again.");
            return;
          }
          selectedSubscriptionId = Number(sim.id);
          simOptions.querySelectorAll(".sim-choice").forEach((item) => item.classList.remove("selected"));
          choice.classList.add("selected");
          continuePermissions.classList.remove("hidden");
          continuePermissions.disabled = false;
          showStatus(`Selected SIM ${sim.slot} · ${sim.carrier || "Unknown carrier"}.`, true);
        } catch {
          showStatus("Server could not save this SIM selection. Please try again.");
        }
      });
      simOptions.append(choice);
      if (sim.selected) {
        selectedSubscriptionId = Number(sim.id);
        continuePermissions.classList.remove("hidden");
        continuePermissions.disabled = false;
      }
    });
    showStatus("Choose the SIM you want Server to use.", true);
  };

  window.onServerSimPermissionResult = (granted, data) => {
    detectButton.disabled = false;
    detectButton.textContent = "Allow SIM access and detect SIMs →";
    if (!granted) {
      showStatus("SIM access was not granted. Allow Phone State and Phone Number permissions to continue.");
      return;
    }
    try {
      const choices = data || JSON.parse(window.ServerAndroid.getSimChoices());
      showSims(choices);
    } catch {
      showStatus("Server could not read the SIM list. Try detecting SIMs again.");
    }
  };

  detectButton?.addEventListener("click", () => {
    detectButton.disabled = true;
    detectButton.textContent = "Waiting for Android permission…";
    showStatus("Android will ask permission to read the SIM slots and any number the carrier exposes.");
    window.ServerAndroid.requestSimPermissions();
  });

  continuePermissions?.addEventListener("click", () => {
    if (selectedSubscriptionId === null) {
      showStatus("Choose a SIM before continuing.");
      return;
    }
    callStep.classList.remove("hidden");
    continuePermissions.classList.add("hidden");
    showStatus("SIM selected. Next, grant microphone permission for calling and accept the legal terms.", true);
  });

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
    showStatus("Server identity created. You can optionally verify your mobile number to link it to this Server ID, then enable Server under Android Calling accounts.", true);
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
    window.ServerAndroid.requestPhoneLinkOtp(number);
  });

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
    window.ServerAndroid.verifyAndLinkPhone(pendingPhoneNumber, code);
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
    showPhoneLinkStatus("Number verified and linked to " + (result.server_id || result.phone || pendingPhoneNumber) + ". Your existing Server ID is unchanged.", true);
    showStatus("Phone number linked. Enable Server in Android Calling accounts to continue to your normal dialer.", true);
  };

  skipPhoneLinkButton?.addEventListener("click", () => {
    showStatus("Continuing without a verified mobile number. Server-to-Server calling by Server ID remains available; saved mobile contacts cannot resolve to your Server identity until you link a number.", true);
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
    window.ServerAndroid.openPhoneDialer();
  });

  // If permission has already been granted on this phone, prefill the SIM choices.
  try {
    const existing = JSON.parse(window.ServerAndroid.getSimChoices());
    if (!existing.permissionNeeded && existing.sims?.length) showSims(existing);
  } catch {
    // The explicit Detect SIMs button remains available.
  }
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
      fallback.textContent = "Open this website on your Android phone to run the SIM-selection flow. Desktop browsers cannot access phone SIMs or register calling accounts.";
      showStatus("Phone SIM selection is supported only through the operating system's mobile integration.");
    }
    return;
  }
  showStatus("Opening the phone integration to complete the SIM and system-dialer steps. It will display this web onboarding, not a separate number-entry app.");
  const started = Date.now();
  window.location.href = "server://sim-setup";
  window.setTimeout(() => {
    if (document.visibilityState === "visible" && Date.now() - started >= 1200) {
      fallback?.classList.remove("hidden");
      fallback.textContent = "The Server phone-integration component did not open. Browser security prevents a website from reading SIM subscriptions or adding a calling account to Android’s dialer. The component is required only to bridge those operating-system APIs; the onboarding UI remains this website.";
      showStatus("Android did not open the system integration component. SIM selection cannot be completed in the browser alone.");
    }
    button.disabled = false;
    button.innerHTML = 'Continue setup on this phone <span aria-hidden="true">→</span>';
  }, 1800);
});
