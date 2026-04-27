const VAULT_FILE = "memories.json";

const DEFAULT_VAULT = {
  version: 1,
  updatedAt: null,
  memories: []
};

function cloneVault(vault) {
  return JSON.parse(JSON.stringify(vault ?? DEFAULT_VAULT));
}

function isOPFSSupported() {
  return Boolean(navigator.storage && navigator.storage.getDirectory);
}

export class MemoryStore {
  constructor() {
    this.mode = isOPFSSupported() ? "opfs" : "localStorage";
    this.root = null;
  }

  async init() {
    if (this.mode === "opfs") {
      this.root = await navigator.storage.getDirectory();
      const existing = await this.readVault();
      if (!existing.updatedAt) {
        await this.writeVault(DEFAULT_VAULT);
      }
    } else {
      const existing = localStorage.getItem(VAULT_FILE);
      if (!existing) {
        localStorage.setItem(VAULT_FILE, JSON.stringify(DEFAULT_VAULT, null, 2));
      }
    }

    return this.mode;
  }

  async readVault() {
    if (this.mode === "opfs") {
      try {
        const handle = await this.root.getFileHandle(VAULT_FILE, { create: true });
        const file = await handle.getFile();
        const text = await file.text();
        if (!text.trim()) return cloneVault(DEFAULT_VAULT);
        return normalizeVault(JSON.parse(text));
      } catch (error) {
        console.warn("Falling back to empty OPFS vault:", error);
        return cloneVault(DEFAULT_VAULT);
      }
    }

    try {
      const text = localStorage.getItem(VAULT_FILE);
      return normalizeVault(JSON.parse(text || "{}"));
    } catch {
      return cloneVault(DEFAULT_VAULT);
    }
  }

  async writeVault(vault) {
    const normalized = normalizeVault(vault);
    normalized.updatedAt = new Date().toISOString();
    const text = JSON.stringify(normalized, null, 2);

    if (this.mode === "opfs") {
      const handle = await this.root.getFileHandle(VAULT_FILE, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return normalized;
    }

    localStorage.setItem(VAULT_FILE, text);
    return normalized;
  }

  async upsertMemory(memory) {
    const vault = await this.readVault();
    const index = vault.memories.findIndex((item) => item.id === memory.id);

    if (index >= 0) {
      vault.memories[index] = { ...vault.memories[index], ...memory };
    } else {
      vault.memories.push(memory);
    }

    await this.writeVault(vault);
    return memory;
  }

  async updateMemory(id, patch) {
    const vault = await this.readVault();
    const memory = vault.memories.find((item) => item.id === id);
    if (!memory) return null;
    Object.assign(memory, patch);
    await this.writeVault(vault);
    return memory;
  }

  async applyDailyDecay() {
    const vault = await this.readVault();
    const now = Date.now();
    let changed = false;

    for (const memory of vault.memories) {
      if (memory.currentlyOccupied) continue;

      const lastDecayAt = memory.lastDecayAt ? Date.parse(memory.lastDecayAt) : Date.parse(memory.lastVisitedAt || memory.createdAt);
      if (!Number.isFinite(lastDecayAt)) continue;

      const elapsedDays = Math.floor((now - lastDecayAt) / 86_400_000);
      if (elapsedDays <= 0) continue;

      memory.strength = clamp((memory.strength ?? 0.2) - elapsedDays * 0.04, 0.08, 2.5);
      memory.decayCount = (memory.decayCount ?? 0) + elapsedDays;
      memory.lastDecayAt = new Date(lastDecayAt + elapsedDays * 86_400_000).toISOString();
      changed = true;
    }

    if (changed) await this.writeVault(vault);
    return vault;
  }
}

export function createMemory({ title, content, audioDataUrl, position }) {
  const now = new Date().toISOString();

  return {
    id: `mem_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`}`,
    title: title?.trim() || "Untitled Memory",
    type: audioDataUrl ? "mixed" : "text",
    content: content?.trim() || "",
    audioDataUrl: audioDataUrl || null,
    createdAt: now,
    updatedAt: now,
    lastVisitedAt: null,
    lastDecayAt: now,
    visitCount: 0,
    decayCount: 0,
    strength: 0.2,
    colorIndex: 0,
    currentlyOccupied: false,
    position,
    links: []
  };
}

export function strengthenMemory(memory) {
  const visits = (memory.visitCount ?? 0) + 1;
  return {
    ...memory,
    visitCount: visits,
    currentlyOccupied: false,
    lastVisitedAt: new Date().toISOString(),
    lastDecayAt: new Date().toISOString(),
    strength: clamp((memory.strength ?? 0.2) + 0.08 + Math.min(visits * 0.005, 0.08), 0.08, 2.5)
  };
}

export function cycleMemoryColor(memory, paletteLength) {
  return {
    ...memory,
    colorIndex: ((memory.colorIndex ?? 0) + 1) % paletteLength,
    updatedAt: new Date().toISOString()
  };
}

export function normalizeVault(value) {
  const vault = {
    ...cloneVault(DEFAULT_VAULT),
    ...(value || {})
  };

  if (!Array.isArray(vault.memories)) vault.memories = [];

  vault.memories = vault.memories.map((memory) => ({
    ...memory,
    strength: clamp(Number(memory.strength ?? 0.2), 0.08, 2.5),
    visitCount: Number(memory.visitCount ?? 0),
    decayCount: Number(memory.decayCount ?? 0),
    colorIndex: Number(memory.colorIndex ?? 0),
    position: memory.position || randomPosition()
  }));

  return vault;
}

function randomPosition() {
  return {
    x: (Math.random() - 0.5) * 40,
    y: (Math.random() - 0.5) * 24,
    z: -20 - Math.random() * 40
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
