import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const invitationFile = process.env.SERVER_GUEST_INVITATION_FILE;
const artifactDir = process.env.SERVER_E2E_ARTIFACT_DIR || "artifacts/server-guest-browser-e2e";
if (!invitationFile) throw new Error("SERVER_GUEST_INVITATION_FILE is required.");
await mkdir(artifactDir, { recursive: true });
const invitationText = await readFile(invitationFile, "utf8");
const invitationCandidate = invitationText.match(/https:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, "");
if (!invitationCandidate) throw new Error("The Android caller did not save a guest invitation URL.");
const parsedInvitation = new URL(invitationCandidate);
const directGuestToken = parsedInvitation.pathname.endsWith("/guest.html")
  ? parsedInvitation.hash.match(/^#token=([0-9a-f]{64})$/i)?.[1]
  : null;
const previewToken = parsedInvitation.pathname.endsWith("/server-guest-preview")
  ? parsedInvitation.searchParams.get("token")
  : null;
if (!(directGuestToken || (previewToken && /^[0-9a-f]{64}$/i.test(previewToken)))) {
  throw new Error("The Android caller's invitation is neither a valid guest page URL nor a secure caller-preview URL.");
}
// The caller shares the Open Graph preview URL. Playwright opens that exact
// URL; its recipient-facing page redirects into guest.html after showing the
// caller-identifying preview metadata to link unfurlers.
const invitationUrl = parsedInvitation.toString();

function makeToneWav(seconds = 20) {
  const sampleRate = 48000;
  const sampleCount = sampleRate * seconds;
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i++) {
    const envelope = Math.min(1, i / 2400, (sampleCount - i) / 2400);
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 5200 * envelope;
    wav.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }
  return wav;
}
const toneFile = join(artifactDir, "server-guest-e2e-tone.wav");
await writeFile(toneFile, makeToneWav());

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-audio-capture=" + toneFile,
    "--autoplay-policy=no-user-gesture-required"
  ]
});
const context = await browser.newContext({
  permissions: ["microphone"],
  viewport: { width: 1365, height: 900 },
  recordVideo: { dir: artifactDir }
});

const previewResponse = await context.request.get(invitationUrl, { maxRedirects: 0 });
if (!previewResponse.ok()) throw new Error("Caller-identifying Open Graph page returned HTTP " + previewResponse.status());
const previewHtml = await previewResponse.text();
const titleMatch = previewHtml.match(/<meta property="og:title" content="([^"]+)"/);
const imageMatch = previewHtml.match(/<meta property="og:image" content="([^"]+)"/);
if (!titleMatch || !imageMatch) throw new Error("Guest preview is missing its caller title or Open Graph image.");
const callerIdentity = titleMatch[1].replace(/ is calling you through Server$/, "");
if (!callerIdentity || !previewHtml.includes("og:image:alt")) {
  throw new Error("The Open Graph card did not identify the caller.");
}
// Open Graph HTML attributes escape query-string separators as &amp;.
const imageHref = imageMatch[1].replace(/&amp;/g, "&");
const imageUrl = new URL(imageHref, invitationUrl).toString();
let ogCardError = null;
try {
  let imageResponse = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    imageResponse = await context.request.get(imageUrl);
    if (imageResponse.ok()) break;
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 750));
  }
  if (!imageResponse?.ok()) {
    const detail = await imageResponse?.text().catch(() => "");
    throw new Error("Caller-specific preview image returned HTTP " +
      imageResponse?.status() + (detail ? ": " + detail.slice(0, 180) : ""));
  }
  if (!String(imageResponse.headers()["content-type"] || "").toLowerCase().includes("image/png")) {
    throw new Error("Caller preview image is not served as image/png.");
  }
  const imageBytes = await imageResponse.body();
  const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (imageBytes.length < 256 || !imageBytes.subarray(0,8).equals(pngSignature)) {
    throw new Error("Caller preview image is not a valid PNG.");
  }
  if (!imageBytes.includes(Buffer.from("Caller="+callerIdentity))) {
    throw new Error("Open Graph PNG does not contain the same caller identity shown in og:title.");
  }
  process.stdout.write("SERVER_GUEST_OG_CARD_PASS: caller identity is visible in metadata and embedded in the per-invitation PNG.\\n");
} catch (error) {
  ogCardError = error.message || String(error);
  await writeFile(join(artifactDir, "guest-og-preview-failure.json"), JSON.stringify({
    invitationHost: parsedInvitation.host,
    imageHost: new URL(imageUrl).host,
    error: ogCardError
  }, null, 2));
  process.stderr.write("SERVER_GUEST_OG_CARD_FAIL: " + ogCardError + "\\n");
}
const page = await context.newPage();
page.setDefaultTimeout(25000);
page.on("pageerror", error => process.stderr.write("Guest page error: " + error.message + "\n"));
page.on("console", message => { if (message.type() === "error") process.stderr.write("Guest console error: " + message.text() + "\\n"); });
page.on("requestfailed", request => process.stderr.write("Guest request failed: " + request.url() + " :: " + (request.failure()?.errorText || "unknown") + "\\n"));
page.on("response", response => { if (response.status() >= 400) process.stderr.write("Guest HTTP " + response.status() + ": " + response.url() + "\\n"); });

try {
  await page.goto(invitationUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The Open Graph preview is a real recipient-facing interstitial with a
  // visible Open incoming call link. Normally its inline redirect opens the
  // guest screen automatically; explicitly follow that same link if a browser
  // or test harness suppresses the script-driven redirect.
  if (/\\/server-guest-preview$/i.test(new URL(page.url()).pathname)) {
    const openCall = page.locator('a[href*="/guest.html"]');
    await openCall.waitFor({ state: "visible", timeout: 10000 });
    await openCall.click();
    await page.waitForURL(url => url.pathname.endsWith("/guest.html"), { timeout: 15000 });
  }
  try {
    await page.locator("#join-call").waitFor({ state: "visible", timeout: 30000 });
  } catch (error) {
    await page.screenshot({ path: join(artifactDir, "guest-page-load-failure.png"), fullPage: true }).catch(() => {});
    const diagnostic = {
      url: page.url(),
      title: await page.title().catch(() => ""),
      status: await page.locator("#guest-status").innerText().catch(() => "missing #guest-status"),
      body: (await page.locator("body").innerText().catch(() => "missing body")).slice(0, 3000),
      html: (await page.content().catch(() => "")).slice(0, 12000)
    };
    await writeFile(join(artifactDir, "guest-page-load-failure.json"), JSON.stringify(diagnostic, null, 2));
    throw new Error("Guest answer button did not become visible: " + JSON.stringify({url:diagnostic.url,title:diagnostic.title,status:diagnostic.status,body:diagnostic.body}) + "; " + error.message);
  }
  await page.waitForFunction(() => {
    const button = document.querySelector("#join-call");
    const status = document.querySelector("#guest-status")?.textContent || "";
    return Boolean(button && !button.disabled) || /could not be verified|missing its secure token|no longer available/i.test(status);
  }, null, { timeout: 30000 });
  const readyStatus = await page.locator("#guest-status").innerText();
  if (!(await page.locator("#join-call").isEnabled())) {
    throw new Error("Guest invitation did not become answerable: " + readyStatus);
  }
  await page.screenshot({ path: join(artifactDir, "guest-invitation-ready.png"), fullPage: true });
  await page.locator("#join-call").click();
  await page.waitForFunction(() =>
    (document.querySelector("#guest-status")?.textContent || "").includes("Connected. Audio is flowing in both directions."),
    null, { timeout: 90000 }
  );
  const guestAudioStats = await page.evaluate(async () => {
    const peer = window.__serverGuestPeerConnection;
    if (!peer) return null;
    const report = await peer.getStats();
    const result = { inboundPackets: 0, outboundPackets: 0, inboundEnergy: 0, outboundEnergy: 0 };
    report.forEach(stat => {
      if (stat.kind !== "audio" && stat.mediaType !== "audio") return;
      if (stat.type === "inbound-rtp") {
        result.inboundPackets += Number(stat.packetsReceived) || 0;
        result.inboundEnergy += Number(stat.totalAudioEnergy) || 0;
      } else if (stat.type === "outbound-rtp") {
        result.outboundPackets += Number(stat.packetsSent) || 0;
      } else if (stat.type === "media-source") {
        result.outboundEnergy += Number(stat.totalAudioEnergy) || 0;
      }
    });
    return result;
  });
  if (!guestAudioStats || guestAudioStats.inboundPackets < 1 || guestAudioStats.outboundPackets < 1 ||
      guestAudioStats.inboundEnergy <= 0 || guestAudioStats.outboundEnergy <= 0) {
    throw new Error("Guest audio did not prove bidirectional RTP and non-zero audio energy: " + JSON.stringify(guestAudioStats));
  }
  await page.screenshot({ path: join(artifactDir, "guest-call-connected.png"), fullPage: true });
  await writeFile(join(artifactDir, "guest-audio-stats.json"), JSON.stringify(guestAudioStats, null, 2));
  process.stdout.write("SERVER_GUEST_BROWSER_AUDIO_PASS: inbound/outbound RTP and audio energy verified: " + JSON.stringify(guestAudioStats) + "\\n");

  await page.locator("#leave-call").click();
  await page.waitForFunction(() =>
    (document.querySelector("#guest-status")?.textContent || "").includes("You left the call."),
    null, { timeout: 20000 }
  );
  await page.screenshot({ path: join(artifactDir, "guest-call-ended.png"), fullPage: true });
  process.stdout.write("SERVER_GUEST_BROWSER_HANGUP_PASS: guest Leave action ended the live session.\n");
  if (ogCardError) {
    throw new Error("The live guest call completed, but Open Graph image acceptance failed: " + ogCardError);
  }
} catch (error) {
  await page.screenshot({ path: join(artifactDir, "guest-call-failure.png"), fullPage: true }).catch(() => {});
  process.stderr.write("Guest browser diagnostic status: " +
    (await page.locator("#guest-status").innerText().catch(() => "unavailable")) + "\n");
  throw error;
} finally {
  await context.close();
  await browser.close();
}
