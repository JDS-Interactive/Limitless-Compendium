# Limitless Compendium V2.2

Limitless Compendium is an installable, offline-capable spatial memory PWA. It uses a Three.js neural/atomic 3D space where each memory becomes a glowing orb. Revisiting an orb strengthens the memory by increasing its visit count and visual size.

## V2.2 Features

- Desktop and mobile controls
- Three.js neural/synaptic 3D space
- Text memory orbs
- Browser voice recording when supported
- Local vault storage using OPFS when available
- localStorage fallback when OPFS is unavailable
- Daily decay: every full 24 hours that an orb is unoccupied, its strength decreases one increment
- Offline PWA shell after initial caching
- First tap/click orb: select orb
- Second tap/click same orb: tween into orb with subtle walking/bobbing motion
- Modal opens after camera reaches/collides with the orb
- Exit orb: records a visit and strengthens the orb
- Vault tools panel
- Export plain JSON vault
- Import plain JSON vault
- Merge imported vaults without wiping current memories
- Optional replace-import mode
- View raw vault JSON in-app
- Export password-protected encrypted vault
- Import password-protected encrypted vault
- Internal memory-to-memory links
- Visible Three.js neural strands between linked memory orbs
- Link editor inside the memory viewer
- Travel button for linked memories
- Linked-memory travel exits/strengthens the current orb, then tweens directly to the linked orb

## Controls

### Desktop

- Hold left or right mouse and move around: look around
- Mouse wheel up/down: move forward/backward
- Space or middle click: place memory orb
- First click orb: select
- Second click same orb: enter orb

### Mobile

- Left thumbstick: forward/backward and strafe
- Right thumbstick: look around
- Place Orb button: create memory orb
- First tap orb: select
- Second tap same orb: enter orb

## Internal Memory Links

Inside a memory orb:

1. Tap **Edit Links**
2. Choose another memory from the dropdown
3. Tap **Add Link**

Links are internal only. They reference other memory IDs inside the same vault.

When two memories are linked:

- A glowing neural strand appears between the two orbs.
- Each linked memory appears as a card inside the memory viewer.
- Tap **Travel** to move/tween directly to that linked orb.
- Leaving by linked travel counts as exiting the current orb, so the current memory is strengthened.

Links are stored in each memory entry:

```json
"links": ["mem_abc123", "mem_xyz789"]
```

V2.2 stores links bidirectionally: linking A to B also links B to A.

## Vault Tools

Open **Vault** from the top-right HUD.

### Export JSON

Exports the current vault as readable JSON.

### Import / Merge JSON

Imports a vault JSON file. By default, imported memories are merged into the current vault.

If a memory ID already exists in both vaults, the newer updated memory is preferred, while keeping the higher visit count, higher strength, and combined links.

### Replace Existing Vault

Check **Replace existing vault instead of merging** before import if you want the imported file to overwrite the current vault.

### View Raw JSON

Shows the current local vault directly inside the app. This is especially useful on iPhone, where OPFS and localStorage cannot be browsed directly.

### Encrypted Export

Enter a password and tap **Export Encrypted**. The app creates an encrypted JSON package using:

- AES-GCM
- 256-bit key
- PBKDF2 key derivation
- SHA-256
- 250,000 iterations

The password is not stored. If the password is lost, the encrypted vault cannot be recovered.

### Encrypted Import

Enter the same password, tap **Import Encrypted**, and select the encrypted vault file.

Encrypted imports follow the same merge/replace setting as plain JSON imports.

## Mobile Audio Note

On phones and tablets, microphone capture usually requires a secure browser context. `localhost` is treated as secure on the same machine, but a phone visiting a desktop LAN URL such as `http://192.168.x.x:5500` is not secure.

Good options:

- Use a secure tunnel such as Cloudflare Tunnel for testing.
- Use a local HTTPS dev server with a trusted certificate.
- Test text memories over LAN and test voice on HTTPS.

## Running Locally

Use VS Code Live Server or any static server.

Example:

```bash
npx serve .
```

Then open the local URL in Chrome, Edge, Safari, or a mobile browser on the same LAN.

## Offline Note

This V2.2 build imports Three.js from a CDN through an import map. The app shell and fetched resources are cached by the service worker after first load. For a fully self-contained/offline-first package before first launch, download `three.module.js` and change the import map in `index.html` to point to a local `vendor/three.module.js` file.

## Vault Storage

The app writes a `memories.json` vault through OPFS where supported. Browsers that do not support OPFS use localStorage as a fallback.

Current memory structure:

```json
{
  "id": "mem_uuid",
  "title": "Memory title",
  "type": "text",
  "content": "Memory text",
  "audioDataUrl": null,
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "lastVisitedAt": null,
  "lastDecayAt": "ISO date",
  "visitCount": 0,
  "decayCount": 0,
  "strength": 0.2,
  "colorIndex": 0,
  "currentlyOccupied": false,
  "position": { "x": 0, "y": 0, "z": -7 },
  "links": []
}
```

## Suggested Next Phase

- Fully bundled local Three.js dependency
- Memory search
- Orb labels
- Manual memory editing
- Multiple memories inside one orb
- Local encrypted-at-rest OPFS vault
- Selective export of memory clusters
- QR transfer between devices
- AI-assisted clustering and recall prompts


## V2.2 Local Three.js + Splash Video

This build uses a local Three.js module:

```html
<script type="importmap">
  {
    "imports": {
      "three": "./vendor/three.module.js"
    }
  }
</script>
```

For the current app, `vendor/three.module.js` is the only Three.js file required. No loaders, controls, postprocessing modules, or examples modules are used by the present code.

The splash screen uses:

```txt
./videos/splash.mp4
```

The splash video starts muted so browsers allow playback. The **Play Audio** button is a user gesture that unmutes and plays the video audio. The **Enter** button hides the splash screen and pauses the video.
