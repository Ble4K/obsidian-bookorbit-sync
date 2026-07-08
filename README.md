![License](https://img.shields.io/github/license/Ble4K/obsidian-bookorbit-sync)
![Latest Release](https://img.shields.io/github/v/release/Ble4K/obsidian-bookorbit-sync)
![Desktop Only](https://img.shields.io/badge/platform-desktop%20only-orange)

An Obsidian plugin that utilises the fantastic highlight handling of [BookOrbit](https://github.com/bookorbit/bookorbit) and syncs them to Obsidian. I have taken inspiration from the official Readwise plugin on most functionality, but tweaked for self-hosted BookOrbit users. 
## Features
- One-way highlight and annotation sync from BookOrbit to Obsidian.
- One note per book.
- Incremental sync for new highlights. 
- Manual and optional automatic sync. 
- Option to add custom frontmatter to all synced notes. 
- Option to pull extra metadata (Highlight time, highlight colour, chapter, etc.).
___
## Requirements
- The plugin requires the user to have a self-hosted BookOrbit instance. 
___
## Installation
### Manual Installation
1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/Ble4K/obsidian-bookorbit-sync/releases/latest).
2. Create a new folder called `bookorbit-sync` inside your vault's `.obsidian/plugins/` directory. 
3. Copy the downloaded `main.js` and `manifest.json` into that new folder 
4. In Obsidian, go to **Settings → Community plugins** and click **Reload plugins**.
5. Find **BookOrbit Sync** in the list and toggle it on.
6. Click the settings (cog) icon next to it to configure your BookOrbit server URL and credentials.

Once approved, you will be able to install the plugin from the [Obsidian Community Plugin Store](https://community.obsidian.md). 
___
## Known Limitations
The plugin is currently desktop only as there are bugs on Android that need fixing. This fix will likely be in the next release. 
___
## Next Features
1. Allow the plugin to work on mobile. 
2. Exclude chosen books from syncing. 
___
## License
This project is licensed under the GNU General Public License v3.0.
___
