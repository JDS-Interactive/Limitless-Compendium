import { MemoryStore, createMemory, strengthenMemory, cycleMemoryColor, normalizeVault } from "./memory-store.js";
import { NeuralScene, ORB_COLORS } from "./three-scene.js";

const $ = (id) => document.getElementById(id);

const store = new MemoryStore();
let neuralScene;
let vault = null;
let pendingPosition = null;
let activeMemoryId = null;
let recordedAudioDataUrl = null;
let mediaRecorder = null;
let recordedChunks = [];

const ENCRYPTED_VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 250_000;

const ui = {
  splashScreen: $("splashScreen"),
  splashVideo: $("splashVideo"),
  enterAppBtn: $("enterAppBtn"),
  playSplashAudioBtn: $("playSplashAudioBtn"),
  splashStatus: $("splashStatus"),
  canvas: $("scene"),
  storageStatus: $("storageStatus"),
  memoryEditor: $("memoryEditor"),
  memoryTitle: $("memoryTitle"),
  memoryText: $("memoryText"),
  closeEditorBtn: $("closeEditorBtn"),
  cancelMemoryBtn: $("cancelMemoryBtn"),
  saveMemoryBtn: $("saveMemoryBtn"),
  recordBtn: $("recordBtn"),
  stopRecordBtn: $("stopRecordBtn"),
  recordStatus: $("recordStatus"),
  recordPreview: $("recordPreview"),
  memoryViewer: $("memoryViewer"),
  viewerTitle: $("viewerTitle"),
  viewerMeta: $("viewerMeta"),
  viewerText: $("viewerText"),
  viewerAudio: $("viewerAudio"),
  linkedMemoriesList: $("linkedMemoriesList"),
  toggleLinkEditorBtn: $("toggleLinkEditorBtn"),
  linkEditor: $("linkEditor"),
  linkMemorySelect: $("linkMemorySelect"),
  addLinkBtn: $("addLinkBtn"),
  closeLinkEditorBtn: $("closeLinkEditorBtn"),
  exitOrbBtn: $("exitOrbBtn"),
  helpBtn: $("helpBtn"),
  helpPanel: $("helpPanel"),
  closeHelpBtn: $("closeHelpBtn"),
  vaultBtn: $("vaultBtn"),
  vaultPanel: $("vaultPanel"),
  closeVaultBtn: $("closeVaultBtn"),
  exportVaultBtn: $("exportVaultBtn"),
  importVaultBtn: $("importVaultBtn"),
  importFileInput: $("importFileInput"),
  exportEncryptedVaultBtn: $("exportEncryptedVaultBtn"),
  importEncryptedVaultBtn: $("importEncryptedVaultBtn"),
  importEncryptedFileInput: $("importEncryptedFileInput"),
  viewVaultBtn: $("viewVaultBtn"),
  vaultPassword: $("vaultPassword"),
  replaceVaultCheckbox: $("replaceVaultCheckbox"),
  vaultStatus: $("vaultStatus"),
  vaultContent: $("vaultContent"),
  mobilePlaceBtn: $("mobilePlaceBtn"),
  moveStickZone: $("moveStickZone"),
  lookStickZone: $("lookStickZone"),
  moveKnob: $("moveKnob"),
  lookKnob: $("lookKnob"),
  deleteTextBtn: $("deleteTextBtn"),
  deleteAudioBtn: $("deleteAudioBtn"),
  deleteMemoryBtn: $("deleteMemoryBtn"),
};

boot();

async function boot() {
  await registerServiceWorker();

  const mode = await store.init();
  vault = await store.applyDailyDecay();

  ui.storageStatus.textContent = mode === "opfs"
    ? `OPFS vault • ${vault.memories.length} memories`
    : `Fallback vault • ${vault.memories.length} memories`;

  neuralScene = new NeuralScene(ui.canvas, {
    onPlaceOrb: openMemoryEditor,
    onCycleOrbColor: handleCycleOrbColor,
    onSelectOrb: handleSelectOrb,
    onTravelStart: handleTravelStart,
    onTravelComplete: handleEnterOrb
  });

  neuralScene.renderMemories(vault.memories);
  neuralScene.start();

  bindUI();
  setupMobileSticks();
  updateRecordingAvailabilityMessage();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

function bindUI() {
  ui.splashVideo?.play?.().catch(() => {
    ui.splashStatus.textContent = "Tap Enter or Play Audio to begin.";
  });

  ui.enterAppBtn?.addEventListener("click", enterApplication);
  ui.playSplashAudioBtn?.addEventListener("click", playSplashAudio);

  ui.closeEditorBtn.addEventListener("click", closeMemoryEditor);
  ui.cancelMemoryBtn.addEventListener("click", closeMemoryEditor);
  ui.saveMemoryBtn.addEventListener("click", savePendingMemory);

  ui.recordBtn.addEventListener("click", startRecording);
  ui.stopRecordBtn.addEventListener("click", stopRecording);

  ui.exitOrbBtn.addEventListener("click", exitOrb);

  ui.toggleLinkEditorBtn.addEventListener("click", openLinkEditor);
  ui.closeLinkEditorBtn.addEventListener("click", () => ui.linkEditor.classList.add("hidden"));
  ui.addLinkBtn.addEventListener("click", addSelectedMemoryLink);

  ui.helpBtn.addEventListener("click", () => ui.helpPanel.classList.remove("hidden"));
  ui.closeHelpBtn.addEventListener("click", () => ui.helpPanel.classList.add("hidden"));

  ui.vaultBtn.addEventListener("click", openVaultPanel);
  ui.closeVaultBtn.addEventListener("click", () => ui.vaultPanel.classList.add("hidden"));
  ui.exportVaultBtn.addEventListener("click", exportVaultJson);
  ui.importVaultBtn.addEventListener("click", () => ui.importFileInput.click());
  ui.importFileInput.addEventListener("change", handleJsonImport);
  ui.exportEncryptedVaultBtn.addEventListener("click", exportEncryptedVault);
  ui.importEncryptedVaultBtn.addEventListener("click", () => ui.importEncryptedFileInput.click());
  ui.importEncryptedFileInput.addEventListener("change", handleEncryptedImport);
  ui.viewVaultBtn.addEventListener("click", viewRawVault);

  ui.mobilePlaceBtn.addEventListener("click", () => {
    openMemoryEditor(neuralScene.getPlacementPosition());
  });

  ui.deleteTextBtn.addEventListener("click", deleteCurrentMemoryText);
  ui.deleteAudioBtn.addEventListener("click", deleteCurrentMemoryAudio);
  ui.deleteMemoryBtn.addEventListener("click", deleteCurrentMemory);
}

function enterApplication() {
  if (!ui.splashScreen) return;
  ui.splashScreen.classList.add("hidden");
  if (ui.splashVideo) {
    ui.splashVideo.pause();
  }
}

async function playSplashAudio() {
  if (!ui.splashVideo) return;

  try {
    ui.splashVideo.muted = false;
    ui.splashVideo.volume = 1;
    await ui.splashVideo.play();
    ui.splashStatus.textContent = "Audio enabled. Tap Enter when ready.";
    ui.playSplashAudioBtn.textContent = "Audio Playing";
  } catch (error) {
    console.warn(error);
    ui.splashStatus.textContent = "Audio could not start. Tap Enter, then try from a secure hosted page.";
  }
}

function updateRecordingAvailabilityMessage() {
  if (!isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    ui.recordStatus.textContent = "Voice recording needs HTTPS on mobile. Text memories still work.";
    ui.recordBtn.disabled = true;
    return;
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    ui.recordStatus.textContent = "Voice recording is not supported in this browser.";
    ui.recordBtn.disabled = true;
  }
}

function openMemoryEditor(position) {
  pendingPosition = position;
  recordedAudioDataUrl = null;
  ui.memoryTitle.value = "";
  ui.memoryText.value = "";
  ui.recordPreview.src = "";
  ui.recordPreview.classList.add("hidden");
  ui.memoryEditor.classList.remove("hidden");

  if (ui.recordBtn.disabled) {
    updateRecordingAvailabilityMessage();
  } else {
    ui.recordStatus.textContent = "No recording";
  }

  ui.memoryTitle.focus({ preventScroll: true });
}

function closeMemoryEditor() {
  pendingPosition = null;
  recordedAudioDataUrl = null;
  ui.memoryEditor.classList.add("hidden");
}

async function savePendingMemory() {
  if (!pendingPosition) return;

  const memory = createMemory({
    title: ui.memoryTitle.value,
    content: ui.memoryText.value,
    audioDataUrl: recordedAudioDataUrl,
    position: pendingPosition
  });

  await store.upsertMemory(memory);
  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  closeMemoryEditor();
  updateStorageStatus();
}

async function startRecording() {
  if (!isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    ui.recordStatus.textContent = "Microphone recording requires HTTPS on mobile browsers.";
    ui.recordBtn.disabled = true;
    return;
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    ui.recordStatus.textContent = "Voice recording is not supported in this browser.";
    ui.recordBtn.disabled = true;
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", async () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      recordedAudioDataUrl = await blobToDataUrl(blob);
      ui.recordPreview.src = recordedAudioDataUrl;
      ui.recordPreview.classList.remove("hidden");
      ui.recordStatus.textContent = "Recording ready";
      stream.getTracks().forEach((track) => track.stop());
    });

    mediaRecorder.start();
    ui.recordBtn.disabled = true;
    ui.stopRecordBtn.disabled = false;
    ui.recordStatus.textContent = "Recording…";
  } catch (error) {
    console.warn(error);
    ui.recordStatus.textContent = "Microphone permission was not granted.";
  }
}

function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  ui.recordBtn.disabled = false;
  ui.stopRecordBtn.disabled = true;
}

function handleSelectOrb(id) {
  const memory = vault.memories.find((item) => item.id === id);
  if (!memory) return;
  ui.storageStatus.textContent = `Selected: ${memory.title || "Untitled"} • tap again to enter`;
}

function handleTravelStart(id) {
  const memory = vault.memories.find((item) => item.id === id);
  ui.memoryViewer.classList.add("hidden");
  ui.storageStatus.textContent = `Moving through link to ${memory?.title || "memory"}…`;
}

async function handleCycleOrbColor(id) {
  const memory = vault.memories.find((item) => item.id === id);
  if (!memory) return;

  const updated = cycleMemoryColor(memory, ORB_COLORS.length);
  await store.upsertMemory(updated);
  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
}

async function handleEnterOrb(id) {
  const memory = vault.memories.find((item) => item.id === id);
  if (!memory) return;

  activeMemoryId = id;
  await store.updateMemory(id, { currentlyOccupied: true });
  vault = await store.readVault();

  renderMemoryViewer(id);
  ui.memoryViewer.classList.remove("hidden");
  updateStorageStatus();
}

function renderMemoryViewer(id) {
  const memory = vault.memories.find((item) => item.id === id);
  if (!memory) return;

  ui.viewerTitle.textContent = memory.title || "Untitled Memory";
  ui.viewerMeta.textContent = `Visit count: ${memory.visitCount ?? 0} • Strength: ${Number(memory.strength ?? 0).toFixed(2)}`;
  ui.viewerText.textContent = memory.content || "No written memory was added.";

  if (memory.audioDataUrl) {
    ui.viewerAudio.src = memory.audioDataUrl;
    ui.viewerAudio.classList.remove("hidden");
  } else {
    ui.viewerAudio.pause();
    ui.viewerAudio.removeAttribute("src");
    ui.viewerAudio.classList.add("hidden");
  }

  ui.linkEditor.classList.add("hidden");
  renderLinkedMemories(memory);
  populateLinkSelect(memory);
}

function renderLinkedMemories(memory) {
  const linkedIds = memory.links || [];
  const linkedMemories = linkedIds
    .map((id) => vault.memories.find((item) => item.id === id))
    .filter(Boolean);

  ui.linkedMemoriesList.innerHTML = "";

  if (!linkedMemories.length) {
    const empty = document.createElement("p");
    empty.className = "small-note";
    empty.textContent = "No linked memories yet.";
    ui.linkedMemoriesList.appendChild(empty);
    return;
  }

  for (const linked of linkedMemories) {
    const card = document.createElement("div");
    card.className = "link-card";

    const title = document.createElement("div");
    title.className = "link-card-title";
    title.innerHTML = `<strong></strong><span></span>`;
    title.querySelector("strong").textContent = linked.title || "Untitled Memory";
    title.querySelector("span").textContent = `Visits: ${linked.visitCount ?? 0} • Strength: ${Number(linked.strength ?? 0).toFixed(2)}`;

    const travelBtn = document.createElement("button");
    travelBtn.type = "button";
    travelBtn.textContent = "Travel";
    travelBtn.addEventListener("click", () => travelToLinkedMemory(linked.id));

    const unlinkBtn = document.createElement("button");
    unlinkBtn.type = "button";
    unlinkBtn.className = "ghost-button";
    unlinkBtn.textContent = "Unlink";
    unlinkBtn.addEventListener("click", () => removeMemoryLink(memory.id, linked.id));

    card.append(title, travelBtn, unlinkBtn);
    ui.linkedMemoriesList.appendChild(card);
  }
}

function populateLinkSelect(memory) {
  ui.linkMemorySelect.innerHTML = "";

  const linked = new Set(memory.links || []);
  const candidates = vault.memories
    .filter((item) => item.id !== memory.id && !linked.has(item.id))
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  if (!candidates.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No available memories to link";
    ui.linkMemorySelect.appendChild(option);
    ui.addLinkBtn.disabled = true;
    return;
  }

  ui.addLinkBtn.disabled = false;

  for (const candidate of candidates) {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = candidate.title || "Untitled Memory";
    ui.linkMemorySelect.appendChild(option);
  }
}

function openLinkEditor() {
  if (!activeMemoryId) return;
  const memory = vault.memories.find((item) => item.id === activeMemoryId);
  if (!memory) return;
  populateLinkSelect(memory);
  ui.linkEditor.classList.remove("hidden");
}

async function addSelectedMemoryLink() {
  if (!activeMemoryId) return;

  const targetId = ui.linkMemorySelect.value;
  if (!targetId || targetId === activeMemoryId) return;

  await addMemoryLink(activeMemoryId, targetId);
}

async function addMemoryLink(sourceId, targetId) {
  vault = await store.readVault();
  const source = vault.memories.find((item) => item.id === sourceId);
  const target = vault.memories.find((item) => item.id === targetId);
  if (!source || !target) return;

  const sourceLinks = new Set(source.links || []);
  sourceLinks.add(targetId);

  const targetLinks = new Set(target.links || []);
  targetLinks.add(sourceId);

  source.links = Array.from(sourceLinks);
  target.links = Array.from(targetLinks);
  source.updatedAt = new Date().toISOString();
  target.updatedAt = new Date().toISOString();

  await store.writeVault(vault);
  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  renderMemoryViewer(sourceId);
  ui.vaultStatus.textContent = "Memory link added.";
}

async function removeMemoryLink(sourceId, targetId) {
  vault = await store.readVault();
  const source = vault.memories.find((item) => item.id === sourceId);
  const target = vault.memories.find((item) => item.id === targetId);
  if (!source || !target) return;

  source.links = (source.links || []).filter((id) => id !== targetId);
  target.links = (target.links || []).filter((id) => id !== sourceId);
  source.updatedAt = new Date().toISOString();
  target.updatedAt = new Date().toISOString();

  await store.writeVault(vault);
  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  renderMemoryViewer(sourceId);
}

async function deleteCurrentMemoryText() {
  if (!activeMemoryId) return;

  const confirmed = confirm("Delete the text from this memory?");
  if (!confirmed) return;

  const memory = vault.memories.find((item) => item.id === activeMemoryId);
  if (!memory) return;

  await store.updateMemory(activeMemoryId, {
    content: "",
    type: memory.audioDataUrl ? "audio" : "empty",
    updatedAt: new Date().toISOString()
  });

  vault = await store.readVault();
  renderMemoryViewer(activeMemoryId);
  neuralScene.renderMemories(vault.memories);
}

async function deleteCurrentMemoryAudio() {
  if (!activeMemoryId) return;

  const confirmed = confirm("Delete the audio recording from this memory?");
  if (!confirmed) return;

  const memory = vault.memories.find((item) => item.id === activeMemoryId);
  if (!memory) return;

  await store.updateMemory(activeMemoryId, {
    audioDataUrl: null,
    type: memory.content ? "text" : "empty",
    updatedAt: new Date().toISOString()
  });

  vault = await store.readVault();
  renderMemoryViewer(activeMemoryId);
  neuralScene.renderMemories(vault.memories);
}

async function deleteCurrentMemory() {
  if (!activeMemoryId) return;

  const memory = vault.memories.find((item) => item.id === activeMemoryId);
  const title = memory?.title || "this memory";

  const confirmed = confirm(`Delete "${title}" permanently? This removes its text, audio, links, and orb.`);
  if (!confirmed) return;

  await store.deleteMemory(activeMemoryId);

  activeMemoryId = null;
  ui.memoryViewer.classList.add("hidden");

  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  updateStorageStatus();
}

async function travelToLinkedMemory(targetId) {
  if (!activeMemoryId) return;

  await markCurrentOrbExitedWithoutClosing();
  ui.memoryViewer.classList.add("hidden");
  activeMemoryId = null;
  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  neuralScene.travelToMemory(targetId);
}

async function markCurrentOrbExitedWithoutClosing() {
  if (!activeMemoryId) return;
  vault = await store.readVault();
  const memory = vault.memories.find((item) => item.id === activeMemoryId);
  if (memory) {
    await store.upsertMemory(strengthenMemory(memory));
  }
}

async function exitOrb() {
  if (!activeMemoryId) {
    ui.memoryViewer.classList.add("hidden");
    return;
  }

  await markCurrentOrbExitedWithoutClosing();

  activeMemoryId = null;
  ui.memoryViewer.classList.add("hidden");

  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  updateStorageStatus();
}

function openVaultPanel() {
  ui.vaultPanel.classList.remove("hidden");
  ui.vaultStatus.textContent = "Ready.";
}

async function exportVaultJson() {
  try {
    const currentVault = await store.readVault();
    downloadTextFile(
      `limitless-compendium-vault-${timestampForFile()}.json`,
      JSON.stringify(currentVault, null, 2),
      "application/json"
    );
    ui.vaultStatus.textContent = "Plain JSON vault exported.";
  } catch (error) {
    console.error(error);
    ui.vaultStatus.textContent = "Export failed.";
  }
}

async function handleJsonImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const imported = normalizeVault(JSON.parse(await file.text()));
    await replaceOrMergeVault(imported);
    ui.vaultStatus.textContent = ui.replaceVaultCheckbox.checked
      ? "Plain JSON vault imported and replaced current vault."
      : "Plain JSON vault imported and merged.";
  } catch (error) {
    console.error(error);
    ui.vaultStatus.textContent = "Import failed. Check that the file is valid vault JSON.";
  }
}

async function exportEncryptedVault() {
  const password = ui.vaultPassword.value;
  if (!password) {
    ui.vaultStatus.textContent = "Enter a password before encrypted export.";
    return;
  }

  if (!crypto?.subtle) {
    ui.vaultStatus.textContent = "Encrypted export requires Web Crypto support.";
    return;
  }

  try {
    ui.vaultStatus.textContent = "Encrypting vault…";
    const currentVault = await store.readVault();
    const encryptedPackage = await encryptJson(currentVault, password);

    downloadTextFile(
      `limitless-compendium-vault-encrypted-${timestampForFile()}.json`,
      JSON.stringify(encryptedPackage, null, 2),
      "application/json"
    );

    ui.vaultStatus.textContent = "Encrypted vault exported.";
  } catch (error) {
    console.error(error);
    ui.vaultStatus.textContent = "Encrypted export failed.";
  }
}

async function handleEncryptedImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const password = ui.vaultPassword.value;
  if (!password) {
    ui.vaultStatus.textContent = "Enter the vault password before encrypted import.";
    return;
  }

  try {
    ui.vaultStatus.textContent = "Decrypting vault…";
    const encryptedPackage = JSON.parse(await file.text());
    const decrypted = await decryptJson(encryptedPackage, password);
    const imported = normalizeVault(decrypted);
    await replaceOrMergeVault(imported);

    ui.vaultStatus.textContent = ui.replaceVaultCheckbox.checked
      ? "Encrypted vault imported and replaced current vault."
      : "Encrypted vault imported and merged.";
  } catch (error) {
    console.error(error);
    ui.vaultStatus.textContent = "Encrypted import failed. Password or file may be incorrect.";
  }
}

async function replaceOrMergeVault(importedVault) {
  if (ui.replaceVaultCheckbox.checked) {
    await store.writeVault(importedVault);
  } else {
    const current = await store.readVault();
    const merged = mergeVaults(current, importedVault);
    await store.writeVault(merged);
  }

  vault = await store.readVault();
  neuralScene.renderMemories(vault.memories);
  updateStorageStatus();

  if (!ui.vaultContent.classList.contains("hidden")) {
    ui.vaultContent.textContent = JSON.stringify(vault, null, 2);
  }
}

function mergeVaults(currentVault, importedVault) {
  const current = normalizeVault(currentVault);
  const imported = normalizeVault(importedVault);
  const memoryMap = new Map();

  for (const memory of current.memories) {
    memoryMap.set(memory.id, memory);
  }

  for (const memory of imported.memories) {
    const existing = memoryMap.get(memory.id);
    if (!existing) {
      memoryMap.set(memory.id, memory);
      continue;
    }

    const existingUpdated = Date.parse(existing.updatedAt || existing.lastVisitedAt || existing.createdAt || 0);
    const importedUpdated = Date.parse(memory.updatedAt || memory.lastVisitedAt || memory.createdAt || 0);

    if (importedUpdated >= existingUpdated) {
      memoryMap.set(memory.id, {
        ...existing,
        ...memory,
        visitCount: Math.max(existing.visitCount ?? 0, memory.visitCount ?? 0),
        strength: Math.max(existing.strength ?? 0.08, memory.strength ?? 0.08),
        links: Array.from(new Set([...(existing.links || []), ...(memory.links || [])]))
      });
    }
  }

  return normalizeVault({
    version: Math.max(current.version || 1, imported.version || 1),
    updatedAt: new Date().toISOString(),
    memories: Array.from(memoryMap.values())
  });
}

async function viewRawVault() {
  const currentVault = await store.readVault();
  ui.vaultContent.textContent = JSON.stringify(currentVault, null, 2);
  ui.vaultContent.classList.toggle("hidden");
  ui.vaultStatus.textContent = ui.vaultContent.classList.contains("hidden")
    ? "Raw JSON hidden."
    : "Showing current raw vault JSON.";
}

async function encryptJson(value, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    app: "Limitless Compendium",
    kind: "encrypted-vault",
    version: ENCRYPTED_VAULT_VERSION,
    algorithm: "AES-GCM",
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    createdAt: new Date().toISOString()
  };
}

async function decryptJson(packageJson, password) {
  if (packageJson?.kind !== "encrypted-vault") {
    throw new Error("Not an encrypted Limitless Compendium vault.");
  }

  const salt = base64ToBytes(packageJson.salt);
  const iv = base64ToBytes(packageJson.iv);
  const ciphertext = base64ToBytes(packageJson.ciphertext);
  const iterations = Number(packageJson.iterations || PBKDF2_ITERATIONS);
  const key = await deriveAesKey(password, salt, iterations);

  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plainBuffer));
}

async function deriveAesKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function downloadTextFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function updateStorageStatus() {
  ui.storageStatus.textContent = `${store.mode === "opfs" ? "OPFS" : "Fallback"} vault • ${vault.memories.length} memories`;
}

function setupMobileSticks() {
  setupStick(ui.moveStickZone, ui.moveKnob, (x, y) => {
    neuralScene?.setMobileMove(x, y);
  });

  setupStick(ui.lookStickZone, ui.lookKnob, (x, y) => {
    neuralScene?.setMobileLook(x, y);
  });
}

function setupStick(zone, knob, onMove) {
  let activePointerId = null;

  const reset = () => {
    activePointerId = null;
    knob.style.transform = "translate(0px, 0px)";
    onMove(0, 0);
  };

  zone.addEventListener("pointerdown", (event) => {
    activePointerId = event.pointerId;
    zone.setPointerCapture(event.pointerId);
    handle(event);
  });

  zone.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    handle(event);
  });

  zone.addEventListener("pointerup", reset);
  zone.addEventListener("pointercancel", reset);

  function handle(event) {
    const rect = zone.getBoundingClientRect();
    const radius = rect.width / 2;
    const centerX = rect.left + radius;
    const centerY = rect.top + radius;

    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const max = radius * 0.52;

    if (distance > max) {
      dx = (dx / distance) * max;
      dy = (dy / distance) * max;
    }

    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / max, dy / max);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
