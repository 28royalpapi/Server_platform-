import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const invitationFile = process.env.SERVER_GUEST_INVITATION_FILE;
const artifactDir = process.env.SERVER_E2E_ARTIFACT_DIR || "artifacts/server-guest-browser-e2e";
if (!invitationFile) throw new Error("SERVER_GUEST_INVITATION_FILE is required.");
await mkdir(artifactDir, { recursive: true });
const invitationText = await readFile(invitationFile, "utf8");
const invitationMatch = invitationText.match(/https:\/\/[^\s]+\/guest\.html#token=[0-9a-f]{64}/i);
if (!invitationMatch) throw new Error("The Android caller did not save a valid guest invitation URL.");
const invitationUrl = invitationMatch[0];

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
const page = await context.newPage();
page.setDefaultTimeout(25000);
page.on("pageerror", error => process.stderr.write("Guest page error: " + error.message + "\n"));

try {
  await page.goto(invitationUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#join-call").waitFor({ state: "visible", timeout: 30000 });
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
    (document.querySelector("#guest-status")?.textContent || "").includes("Connected. Two-way audio packets are flowing."),
    null, { timeout: 90000 }
  );
  await page.screenshot({ path: join(artifactDir, "guest-call-connected.png"), fullPage: true });
  process.stdout.write("SERVER_GUEST_BROWSER_AUDIO_PASS: guest browser connected and received inbound audio RTP.\n");

  await page.locator("#leave-call").click();
  await page.waitForFunction(() =>
    (document.querySelector("#guest-status")?.textContent || "").includes("You left the call."),
    null, { timeout: 20000 }
  );
  await page.screenshot({ path: join(artifactDir, "guest-call-ended.png"), fullPage: true });
  process.stdout.write("SERVER_GUEST_BROWSER_HANGUP_PASS: guest Leave action ended the live session.\n");
} catch (error) {
  await page.screenshot({ path: join(artifactDir, "guest-call-failure.png"), fullPage: true }).catch(() => {});
  process.stderr.write("Guest browser diagnostic status: " +
    (await page.locator("#guest-status").innerText().catch(() => "unavailable")) + "\n");
  throw error;
} finally {
  await context.close();
  await browser.close();
}
