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
  showStatus("Opening Server for Android. You will not be asked to connect your personal SIM or grant SMS-send permission.");
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
  const enableCallingAccountButton = document.querySelector("#enable-calling-account");
  const openPhoneDialerButton = document.querySelector("#open-phone-dialer");
  const callingAccountNote = document.querySelector("#calling-account-note");
  const updateSmsGatewayGate = () => {
    if (enableCallingAccountButton) enableCallingAccountButton.disabled = false;
    if (openPhoneDialerButton) openPhoneDialerButton.disabled = false;
    if (callingAccountNote) {
      callingAccountNote.textContent = "Server calls and guest invitations use mobile data or Wi-Fi. Enrolled browsers receive free internet notifications; first-contact links are shared through an internet messaging app. Guest invitations never use carrier SMS or deduct SIM airtime.";
    }
  };
  updateSmsGatewayGate();
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
      "Creating your Server identity. Server calling uses the internet and does not use your personal SIM to send messages.",
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
    const contactCountryNote = " Contact access is optional and can be granted later when you choose Show my contacts.";
    updateSmsGatewayGate();
    showStatus("Server identity created. Your personal SIM is never used to send Server messages." + contactCountryNote, true);
    refreshReceiverRegistry();
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
    showPhoneLinkStatus("Requesting a one-time verification code through Server-operated messaging. No code is sent until you press this button.");
    if (!window.ServerAndroid) { phoneLinkInput.disabled = false; requestPhoneCodeButton.disabled = false; showPhoneLinkStatus("Android calling integration is not connected."); return; }
    window.ServerAndroid.requestPhoneLinkOtp(number);
  });

  window.onServerPhoneOtpRequested = (result) => {
    requestPhoneCodeButton.disabled = false;
    requestPhoneCodeButton.textContent = "Send verification code again";
    if (!result || !result.ok) {
      phoneLinkInput.disabled = false;
      const message = {
        GATEWAY_OFFLINE: "Server messaging is temporarily unavailable. Your SIM is not used; try again later.",
        OTP_RATE_LIMITED: "Too many verification requests. Wait before requesting another code.",
        INVALID_PHONE_FORMAT: "Enter a valid number in international format.",
        OTP_QUEUE_FAILED: "Server could not queue the verification message. Try again later."
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

  enableCallingAccountButton && enableCallingAccountButton.addEventListener("click", () => {
    if (!window.ServerAndroid) { showStatus("Open Server from the Android calling integration first."); return; }
    window.ServerAndroid.openCallingSettings();
  });
  openPhoneDialerButton && openPhoneDialerButton.addEventListener("click", () => {
    if (!window.ServerAndroid) { showStatus("Open Server from the Android calling integration first."); return; }
    showStatus("Opening your normal phone dialer. Choose Server for internet calls; your cellular SIM remains unchanged.");
    window.ServerAndroid.openPhoneDialer();
  });

  // Contacts stay on this device. Only the selected E.164 numbers are sent to Server.
  const receiverContactsButton = document.querySelector("#load-receiver-contacts");
  const receiverRefreshButton = document.querySelector("#refresh-receiver-list");
  const receiverContactsEl = document.querySelector("#receiver-contacts");
  const receiverStatusEl = document.querySelector("#receiver-management-status");
  const receiverSelectionCount = document.querySelector("#receiver-selection-count");
  const receiverInviteSelectedButton = document.querySelector("#invite-selected-receivers");
  const receiverGeneratedEl = document.querySelector("#receiver-generated-links");
  const receiverRegistryEl = document.querySelector("#receiver-registry");
  const receiverLinksStorageKey = "server.receiver.owner.pending-links.v1";
  const receiverNamesStorageKey = "server.receiver.owner.contact-names.v1";
  let receiverContacts = [];
  let receiverContactNames = loadSavedReceiverNames();
  let receiverRegistry = [];
  let receiverPendingLinks = loadSavedReceiverLinks();
  let receiverInviteBusy = false;

  function loadSavedReceiverLinks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(receiverLinksStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) =>
        item && /^\+[1-9][0-9]{7,14}$/.test(item.phone_e164 || "") &&
        /^https:\/\/server-onboarding-ochre\.vercel\.app\/receiver\.html#token=[0-9a-f]{64}$/.test(item.invitation_url || "")
      ) : [];
    } catch { return []; }
  }
  function saveReceiverLinks() {
    try { localStorage.setItem(receiverLinksStorageKey, JSON.stringify(receiverPendingLinks)); } catch {}
  }
  function loadSavedReceiverNames() {
    try {
      const parsed = JSON.parse(localStorage.getItem(receiverNamesStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && /^\\+[1-9][0-9]{7,14}$/.test(item.phone_e164 || "") && typeof item.name === "string") : [];
    } catch { return []; }
  }
  function saveReceiverNames() {
    try { localStorage.setItem(receiverNamesStorageKey, JSON.stringify(receiverContactNames)); } catch {}
  }
  function receiverContactName(phone) {
    const found = receiverContacts.find((item) => item.phone_e164 === phone);
    const savedName = receiverContactNames.find((item) => item.phone_e164 === phone);
    const pending = receiverPendingLinks.find((item) => item.phone_e164 === phone);
    return (found && found.name) || (savedName && savedName.name) || (pending && pending.name) || ("Number ending " + String(phone || "").slice(-4));
  }
  function receiverState(phone) {
    const found = receiverRegistry.find((item) => item.phone_e164 === phone);
    return found ? found.status : "";
  }
  function receiverStatus(message, ok = false) {
    if (!receiverStatusEl) return;
    receiverStatusEl.textContent = message;
    receiverStatusEl.classList.toggle("ok", ok);
  }
  function receiverButton(label, action, disabled = false) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "receiver-row-action";
    control.textContent = label;
    control.disabled = disabled;
    control.addEventListener("click", action);
    return control;
  }
  function selectedReceiverNumbers() {
    return receiverContactsEl
      ? [...receiverContactsEl.querySelectorAll("input[data-receiver-phone]:checked")].map((control) => control.dataset.receiverPhone).filter(Boolean)
      : [];
  }
  function updateReceiverSelection() {
    const count = selectedReceiverNumbers().length;
    if (receiverSelectionCount) receiverSelectionCount.textContent = count + (count === 1 ? " person selected" : " people selected") + (count >= 20 ? " · maximum per batch reached" : "");
    if (receiverInviteSelectedButton) receiverInviteSelectedButton.disabled = receiverInviteBusy || count === 0 || count > 20;
    if (receiverInviteSelectedButton) receiverInviteSelectedButton.textContent = receiverInviteBusy ? "Generating secure links…" : "Generate links for selected people";
  }
  function renderReceiverContacts() {
    if (!receiverContactsEl) return;
    receiverContactsEl.replaceChildren();
    if (!receiverContacts.length) {
      const empty = document.createElement("p");
      empty.className = "receiver-empty";
      empty.textContent = "No contacts with a recognised phone number were found. Check that your phone contacts are available and include phone numbers.";
      receiverContactsEl.append(empty);
      updateReceiverSelection();
      return;
    }
    for (const contact of receiverContacts) {
      const state = receiverState(contact.phone_e164);
      const saved = receiverPendingLinks.find((item) => item.phone_e164 === contact.phone_e164);
      const row = document.createElement("div");
      row.className = "receiver-contact-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "receiver-contact-check";
      checkbox.dataset.receiverPhone = contact.phone_e164;
      checkbox.disabled = state === "registered" || (!!saved && state === "pending") || receiverInviteBusy;
      checkbox.addEventListener("change", updateReceiverSelection);
      const copy = document.createElement("div");
      copy.className = "receiver-contact-copy";
      const name = document.createElement("strong");
      name.textContent = contact.name || "Unnamed contact";
      const phone = document.createElement("span");
      phone.textContent = contact.phone_e164;
      copy.append(name, phone);
      row.append(checkbox, copy);
      if (state === "registered") {
        const tag = document.createElement("span");
        tag.className = "receiver-status";
        tag.textContent = "CONNECTED";
        row.append(tag);
      } else if (saved && state === "pending") {
        const tag = document.createElement("span");
        tag.className = "receiver-status pending";
        tag.textContent = "AWAITING CONNECTION";
        row.append(tag, receiverButton("Share existing link", () => shareReceiverLink(saved)));
      } else {
        const actionLabel = state === "pending" || state === "needs_attention" || state === "revoked" || state === "expired" ? "Create new link" : "Invite";
        row.append(receiverButton(actionLabel, () => createReceiverInvitations([contact.phone_e164])));
      }
      receiverContactsEl.append(row);
    }
    updateReceiverSelection();
  }
  function shareReceiverLink(item) {
    if (!(!item || !item.invitation_text) || !window.ServerAndroid || typeof window.ServerAndroid.shareReceiverInvitation !== "function") {
      receiverStatus("The saved link is unavailable on this device. Create a replacement link to continue.");
      return;
    }
    window.ServerAndroid.shareReceiverInvitation(item.invitation_text, item.name || receiverContactName(item.phone_e164));
  }
  function copyReceiverLink(item) {
    if (!(!item || !item.invitation_url) || !window.ServerAndroid || typeof window.ServerAndroid.copyReceiverInvitation !== "function") {
      receiverStatus("The secure setup link could not be copied on this device.");
      return;
    }
    window.ServerAndroid.copyReceiverInvitation(item.invitation_url);
    receiverStatus("Copied the private setup link for " + (item.name || receiverContactName(item.phone_e164)) + ". Send it only to that person.", true);
  }
  function renderGeneratedLinks(items) {
    if (!receiverGeneratedEl) return;
    receiverGeneratedEl.replaceChildren();
    const created = items.filter((item) => item.status === "invitation_created" && item.invitation_url);
    const other = items.filter((item) => item.status !== "invitation_created");
    for (const item of created) {
      const contact = receiverContacts.find((entry) => entry.phone_e164 === item.phone_e164);
      const row = document.createElement("div");
      row.className = "receiver-link-row";
      const copy = document.createElement("div");
      copy.className = "receiver-link-copy";
      const name = document.createElement("strong");
      name.textContent = ((contact && contact.name) || "Receiver") + " · setup link ready";
      const detail = document.createElement("span");
      detail.textContent = "This private link stays valid until the recipient connects or you revoke it.";
      copy.append(name, detail);
      const actions = document.createElement("div");
      actions.className = "receiver-link-actions";
      actions.append(
        receiverButton("Share link", () => shareReceiverLink(item)),
        receiverButton("Copy link", () => copyReceiverLink(item))
      );
      row.append(copy, actions);
      receiverGeneratedEl.append(row);
    }
    for (const item of other) {
      const row = document.createElement("p");
      row.className = "receiver-empty";
      const name = receiverContactName(item.phone_e164);
      const label = item.status === "registered" ? "Already connected" :
        item.status === "server_user" ? "Already has a discoverable Server identity" :
        item.message || "This invitation could not be created.";
      row.textContent = name + " — " + label;
      receiverGeneratedEl.append(row);
    }
  }
  function renderReceiverRegistry() {
    if (!receiverRegistryEl) return;
    receiverRegistryEl.replaceChildren();
    if (!receiverRegistry.length) {
      const empty = document.createElement("p");
      empty.className = "receiver-empty";
      empty.textContent = "No invited contacts yet. Choose Show my contacts and tap Invite.";
      receiverRegistryEl.append(empty);
      return;
    }
    const statusLabels = {
      registered: "CONNECTED",
      pending: "AWAITING CONNECTION",
      expired: "INVITATION EXPIRED",
      revoked: "DISCONNECTED",
      needs_attention: "DEVICE NEEDS ATTENTION"
    };
    for (const item of receiverRegistry) {
      const row = document.createElement("div");
      row.className = "receiver-registry-row";
      const copy = document.createElement("div");
      copy.className = "receiver-registry-copy";
      const name = document.createElement("strong");
      name.textContent = receiverContactName(item.phone_e164);
      const detail = document.createElement("span");
      detail.textContent = item.phone_e164 + (item.last_connected_at ? " · last connected " + new Date(item.last_connected_at).toLocaleString() : "");
      copy.append(name, detail);
      const state = document.createElement("span");
      state.className = "receiver-status" + (item.status === "pending" ? " pending" : item.status === "revoked" || item.status === "needs_attention" || item.status === "expired" ? " offline" : "");
      state.textContent = statusLabels[item.status] || String(item.status || "UNKNOWN").toUpperCase();
      row.append(copy, state);
      const saved = receiverPendingLinks.find((link) => link.phone_e164 === item.phone_e164);
      if (item.status === "pending" && saved) {
        row.append(receiverButton("Share setup link", () => shareReceiverLink(saved)));
      }
      receiverRegistryEl.append(row);
    }
  }
  function refreshReceiverRegistry() {
    if (!window.ServerAndroid || typeof window.ServerAndroid.listServerReceivers !== "function") {
      receiverStatus("Receiver management needs the installed Server Android app.");
      return;
    }
    if (receiverRefreshButton) receiverRefreshButton.disabled = true;
    receiverStatus("Checking your saved Receiver connections…");
    window.ServerAndroid.listServerReceivers();
  }
  function createReceiverInvitations(numbers) {
    const unique = [...new Set((numbers || []).filter((number) => /^\+[1-9][0-9]{7,14}$/.test(number)))];
    if (!unique.length || unique.length > 20 || receiverInviteBusy) {
      receiverStatus("Select between 1 and 20 valid phone contacts for each batch.");
      return;
    }
    if (!window.ServerAndroid || typeof window.ServerAndroid.createReceiverInvitations !== "function") {
      receiverStatus("Receiver invitations need the installed Server Android app.");
      return;
    }
    receiverInviteBusy = true;
    if (receiverInviteSelectedButton) receiverInviteSelectedButton.disabled = true;
    if (receiverContactsButton) receiverContactsButton.disabled = true;
    receiverStatus("Server is checking existing connections and generating individual setup links…");
    window.ServerAndroid.createReceiverInvitations(JSON.stringify(unique));
  }

  window.onServerReceiverContactsResult = (result) => {
    if (receiverContactsButton) receiverContactsButton.disabled = false;
    if (!result || result.ok !== true) {
      receiverStatus((result && result.error) === "CONTACTS_PERMISSION_DENIED"
        ? "Contacts permission was not granted. Allow it in Android Settings, then try again."
        : ((result && result.message) || (result && result.error) || "Server could not read contacts on this phone."));
      return;
    }
    receiverContacts = Array.isArray(result.contacts) ? result.contacts
      .filter((item) => item && typeof item.name === "string" && typeof item.phone_e164 === "string" && /^\+[1-9][0-9]{7,14}$/.test(item.phone_e164)) : [];
    const nameMap = new Map(receiverContactNames.map((item) => [item.phone_e164, item]));
    for (const item of receiverContacts) nameMap.set(item.phone_e164, {name:item.name, phone_e164:item.phone_e164});
    receiverContactNames = [...nameMap.values()];
    saveReceiverNames();
    receiverStatus(receiverContacts.length + " contacts with valid phone numbers are available. Contact names remain on this phone.", true);
    renderReceiverContacts();
    refreshReceiverRegistry();
  };
  window.onServerReceiverInvitesResult = (result) => {
    receiverInviteBusy = false;
    if (receiverContactsButton) receiverContactsButton.disabled = false;
    if (receiverRefreshButton) receiverRefreshButton.disabled = false;
    if (!result || result.ok !== true) {
      receiverStatus((result && result.message) || (result && result.error) || "Server could not create Receiver links. No link has been marked as created.");
      updateReceiverSelection();
      return;
    }
    const results = Array.isArray(result.results) ? result.results : [];
    for (const item of results) {
      if (item.status === "invitation_created" && item.invitation_url) {
        const contact = receiverContacts.find((entry) => entry.phone_e164 === item.phone_e164);
        const saved = {...item, name: (contact && contact.name) || "Receiver"};
        receiverPendingLinks = receiverPendingLinks.filter((link) => link.phone_e164 !== item.phone_e164);
        receiverPendingLinks.push(saved);
      }
      if (item.status === "registered") receiverPendingLinks = receiverPendingLinks.filter((link) => link.phone_e164 !== item.phone_e164);
    }
    saveReceiverLinks();
    renderGeneratedLinks(results);
    receiverStatus(result.invitation_count + " new link(s) created · " + result.registered_count + " already connected. Share each link privately with the matching person.", true);
    updateReceiverSelection();
    renderReceiverContacts();
    refreshReceiverRegistry();
  };
  window.onServerReceiverRegistryResult = (result) => {
    if (receiverRefreshButton) receiverRefreshButton.disabled = false;
    if (!result || result.ok !== true) {
      receiverStatus((result && result.message) || (result && result.error) || "Server could not load the saved Receiver list.");
      return;
    }
    receiverRegistry = Array.isArray(result.receivers) ? result.receivers : [];
    const connected = new Set(receiverRegistry.filter((item) => item.status === "registered").map((item) => item.phone_e164));
    receiverPendingLinks = receiverPendingLinks.filter((item) => !connected.has(item.phone_e164));
    saveReceiverLinks();
    renderReceiverContacts();
    renderReceiverRegistry();
    receiverStatus(connected.size + " connected · " + receiverRegistry.filter((item) => item.status === "pending").length + " awaiting connection.", true);
  };
  receiverContactsButton && receiverContactsButton.addEventListener("click", () => {
    if (!window.ServerAndroid || typeof window.ServerAndroid.loadReceiverContacts !== "function") {
      receiverStatus("Open this onboarding inside the installed Server Android app to access phone contacts.");
      return;
    }
    receiverContactsButton.disabled = true;
    receiverStatus("Reading contact names and phone numbers on this phone. They are not uploaded.");
    window.ServerAndroid.loadReceiverContacts();
  });
  receiverRefreshButton && receiverRefreshButton.addEventListener("click", refreshReceiverRegistry);
  receiverInviteSelectedButton && receiverInviteSelectedButton.addEventListener("click", () => {
    createReceiverInvitations(selectedReceiverNumbers());
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
