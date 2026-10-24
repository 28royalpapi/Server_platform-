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
  let selectedSubscriptionId = null;

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
    showStatus("Server ID created. Android needs one final approval to enable Server as a calling account; after you enable it and return, the normal dialer will open automatically.", true);
    // Keep the user's journey short: ask Android to enable the account now.
    // The native bridge opens the dialer when the user returns from system settings.
    window.ServerAndroid.openCallingSettings();
  };

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
