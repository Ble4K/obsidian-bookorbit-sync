![License](https://img.shields.io/github/license/Ble4K/obsidian-bookorbit-sync)
![Latest Release](https://img.shields.io/github/v/release/Ble4K/obsidian-bookorbit-sync)

An Obsidian plugin that utilises the fantastic highlight handling of [BookOrbit](https://github.com/bookorbit/bookorbit) and syncs them to Obsidian. I have taken inspiration from the official Readwise plugin on most functionality, but tweaked for self-hosted BookOrbit users. 
## Features
- One-way highlight and annotation sync from BookOrbit to Obsidian.
- One note per book.
- Incremental sync for new highlights. 
- Manual and optional automatic sync. 
- Option to add custom frontmatter to all synced notes. 
- Option to pull extra metadata (Highlight time, highlight colour, chapter, etc.).
- Reader deep links
- Download covers option
- Colour-to-tag mapping
- Sync BookOrbit personal reviews
- Sync finished books with no highlights
- Highlight ordering by page number
___
## Requirements
- The plugin requires the user to have a self-hosted BookOrbit instance.
- The plugin requires the user to have an account for that server. 
___
## Installation
### Manual Installation
1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/Ble4K/obsidian-bookorbit-sync/releases/latest).
2. Create a new folder called `bookorbit-sync` inside your vault's `.obsidian/plugins/` directory. 
3. Copy the downloaded `main.js` and `manifest.json` into that new folder 
4. In Obsidian, go to **Settings → Community plugins** and click **Reload plugins**.
5. Find **BookOrbit Sync** in the list and toggle it on.
6. Click the settings (cog) icon next to it to configure your BookOrbit server URL and credentials.

The plugin is also available to install from Obsidian Community Plugins [here](https://community.obsidian.md/plugins/bookorbit-sync). 
___
## Known Limitations
I don't want to edit notes that have already been synced, so a lot of settings changes only apply to a fresh sync. 
___
## Next Features
1. Per-book exclude list
2. Format and styling templates
___
## Privacy & Network Use
This plugin connects to the BookOrbit server URL you provide in settings, using the credentials you enter, to fetch your own highlights, annotations, perosonal reviews, and book covers. No data is sent to any third party or any server other than the one you configure.
___
## License
This project is licensed under the GNU General Public License v3.0.
___
