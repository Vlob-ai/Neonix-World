# Neonix-World
A collection of lore for a sprawling city

Neonix is a cyberpunk fantasy world of old magic, new machinery, and lives in the shadows. This repository holds its living lorebook: 81 linked records, searchable characters and places, species studies, and everyday faction clothing concepts.

## Explore

Explore the live archive at **https://vlob-ai.github.io/Neonix-World/**. GitHub Pages publishes from **main → /docs** whenever site updates are pushed.

The site has no build step or external dependencies. `docs/` contains the complete website, original world notes, artwork, and downloadable ComfyUI workflows. With Node.js installed, run `node serve.mjs` and open **http://127.0.0.1:4174/Neonix-World/** to preview it. Opening the HTML directly from disk will not load its JSON data.

Saved entries stay in the visitor's browser. Shared accounts and community contributions are planned for a later phase.

## World and art direction

Cyberware is common, with visible blue mana flowing between its components. The visual direction is manhwa / graphic novel cyberpunk fantasy. The Purists' opposition to modification remains a deliberate contrast.

Five species/peoples studies and nine unnamed faction-member studies form the first visual foundation. Exact anatomy, clothing, colors, and implant designs remain proposals. Mutants encompass many forms; the study represents one possibility. The Plagued are people affected by The Gloom, not an established separate biological species.

The skyline is a creator-supplied reference. Character studies were generated locally with ComfyUI; prompts, seeds, checkpoint names, and proposed design notes are available in the Art Studio and `docs/assets/manifest.json`. Load a file from `docs/workflows/` into ComfyUI to continue a study using the named checkpoint. Earlier explorations are labeled as superseded.

## Production notes (not shown on the site)

Creative toolkit for the art pipeline:

- **Foundation studies**: generated with the installed Prefect Illustrious XL checkpoint for inked, cel-shaded concepts.
- **Named characters and places**: generated through OpenRouter in the local ComfyUI workflow, with reference-guided character studies to preserve individual designs.
- **Reference and outfit workflows**: available to stabilize approved designs.
- **Expression editor**: available for future character work.
- **H3 video, extension, and upscaling**: available for a later motion pass.

The skyline is the creator-supplied city reference. Foundation studies establish the shared visual language; named-character and environment studies develop individual designs. Each study includes its generation details, and reference-guided studies link their source artwork.

## Speak at the well

The **Speak** page lets a visitor talk with the Sage, the out-of-character Archive, or any of the 42 characters. It runs on Google's Gemini, using **the visitor's own API key**:

- The site never contains a key. The visitor pastes one from [Google AI Studio](https://aistudio.google.com/apikey). It stays in that browser tab's memory, or in sessionStorage if they tick "Keep it until I close this tab". "Forget my key" clears it.
- The key is sent only to `generativelanguage.googleapis.com`, in the `x-goog-api-key` header. It never goes into a URL, the page, the repository or a log.
- **Never commit an API key to this repository.** The repo is public while it's being built, and anything committed stays in its history.

Each speaker gets a system prompt built from the lore files: the Sage from `sage.json`, a character from their expanded file, ties and plotlines. Speakers can search the city files mid-conversation (`search_city_files`, `open_file`), and the page shows what they searched and drew on. In a character conversation, text in ((double parentheses)) is an out-of-character note or a scene direction.

## Editing

- Website appearance and behavior: `docs/index.html`, `docs/style.css`, `docs/app.js`.
- Indexed lore: `docs/lore.json`; source world notes: `docs/Neonix.txt`.
- Creator additions and concept briefs: `content/`.
- Expanded lore (character bios, relationship ties, plotlines, world lore): `content/characters-expanded.json`, `content/relationships.json`, `content/plotlines.json`, `content/world-lore.json`. The site reads its copies from `docs/data/`.
- Story feed and the Weave (relationship web): `docs/story.js`, `docs/weave.js`, styles in `docs/sections.css`. The expanded character file in each dossier comes from `docs/expanded.js`.
- Artwork and generation metadata: `docs/assets/`.
- The Sage page and its living presence: `docs/sage.js`, `docs/sage-eye.js`, data in `docs/data/sage.json`.
- Speak at the well (talk with the Sage, the Archive or any character): `docs/speak.js`. The search the speakers use over every lore file is `docs/city-files.js`. It also reads `docs/data/world-lore.json`, a copy of `content/world-lore.json`; keep the two in step.

Keep stable lore IDs when editing so links continue to work. Use relative URLs so the site works under GitHub Pages' `/Neonix-World/` path. Commit updates to `main` to publish them after Pages is enabled.
