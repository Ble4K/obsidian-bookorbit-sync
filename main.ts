import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
} from "obsidian";

interface Annotation {
  id: number;
  bookId: number;
  text: string;
  color: string;
  style: string;
  note: string | null;
  chapterTitle: string | null;
  origin: string;
  createdAt: string;
  bookTitle: string;
  author: string;
  jumpFileId: number;
  pageno: number | null;
}

interface AnnotationsResponse {
  items: Annotation[];
  total: number;
  page: number;
  pageSize: number;
}

interface BookOrbitSettings {
  serverUrl: string;
  username: string;
  password: string;
  outputFolder: string;
  includeChapter: boolean;
  lastSyncTime: string;
  customProperties: string;
  syncOnLaunch: boolean;
}

// Defines the default settings for the plugin on install
const DEFAULT_SETTINGS: BookOrbitSettings = {
  serverUrl: "",
  username: "",
  password: "",
  outputFolder: "Books",
  includeChapter: true,
  lastSyncTime: "",
  customProperties: "",
  syncOnLaunch: true,
};

export default class BookOrbitPlugin extends Plugin {
  settings!: BookOrbitSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("book-open", "Sync BookOrbit Highlights", async () => {
      await this.runSync();
    });

    this.addCommand({
      id: "sync-bookorbit",
      name: "Sync highlights",
      callback: async () => {
        await this.runSync();
      },
    });

    this.addSettingTab(new BookOrbitSettingTab(this.app, this));

    // The highlights will auto sync if these settings are present
    this.app.workspace.onLayoutReady(async () => {
      if (
        this.settings.serverUrl &&
        this.settings.username &&
        this.settings.password &&
        this.settings.syncOnLaunch
      ) {
        await this.runSync();
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async runSync() {
    if (
      !this.settings.serverUrl ||
      !this.settings.username ||
      !this.settings.password
    ) {
      new Notice(
        "BookOrbit Sync: Please configure your server URL and credentials in settings."
      );
      return;
    }

    new Notice("BookOrbit Sync: Starting sync...");

    try {
      const token = await this.login();
      const annotations = await this.fetchNewAnnotations(token);

      if (annotations.length === 0) {
        new Notice("BookOrbit Sync: No new highlights.");
        return;
      }

      const byBook = this.groupByBook(annotations);

      let totalHighlights = 0;
      for (const bookAnnotations of Object.values(byBook)) {
        await this.writeBookNote(bookAnnotations);
        totalHighlights += bookAnnotations.length;
      }

      this.settings.lastSyncTime = new Date().toISOString();
      await this.saveSettings();

      const bookCount = Object.keys(byBook).length;
      new Notice(
        `BookOrbit Sync: Synced ${totalHighlights} highlight${totalHighlights !== 1 ? "s" : ""} across ${bookCount} book${bookCount !== 1 ? "s" : ""}.`
      );
    } catch (error) {
      console.error("BookOrbit Sync error:", error);
      new Notice(`BookOrbit Sync: Error — ${(error as Error).message}`);
    }
  }

  async login(): Promise<string> {
    const url = `${this.settings.serverUrl.replace(/\/$/, "")}/api/v1/auth/login`;

    const response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.settings.username,
        password: this.settings.password,
      }),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(
        `Login failed (${response.status}). Check your credentials in settings.`
      );
    }

    // Try JSON body first
    const data = response.json;
    if (data?.access_token) {
      return data.access_token;
    }

    // BookOrbit sends the token as a Set-Cookie header instead
    // The header may come back as a string or an array of strings
    const rawCookies = response.headers["set-cookie"] ?? "";
    const cookieString = Array.isArray(rawCookies)
      ? rawCookies.join("; ")
      : String(rawCookies);
    const match = cookieString.match(/access_token=([^;]+)/);
    if (match) {
      return match[1];
    }

    throw new Error(
      `Could not extract access token. Raw headers: ${JSON.stringify(response.headers)}`
    );
  }

  async fetchNewAnnotations(token: string): Promise<Annotation[]> {
    const allAnnotations: Annotation[] = [];
    const lastSync = this.settings.lastSyncTime
      ? new Date(this.settings.lastSyncTime)
      : null;
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");

    let page = 1;
    let keepFetching = true;

    while (keepFetching) {
      const url = `${baseUrl}/api/v1/annotations?page=${page}&pageSize=50&status=active&sortBy=createdAt&sortDir=desc`;

      const response = await requestUrl({
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        throw: false,
      });

      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch annotations (${response.status}).`
        );
      }

      const data: AnnotationsResponse = response.json;

      for (const annotation of data.items) {
        if (lastSync && new Date(annotation.createdAt) <= lastSync) {
          keepFetching = false;
          break;
        }
        allAnnotations.push(annotation);
      }

      const totalPages = Math.ceil(data.total / data.pageSize);
      if (page >= totalPages) keepFetching = false;
      page++;
    }

    return allAnnotations;
  }

  groupByBook(annotations: Annotation[]): Record<string, Annotation[]> {
    const groups: Record<string, Annotation[]> = {};

    for (const annotation of annotations) {
      const key = String(annotation.bookId);
      if (!groups[key]) groups[key] = [];
      groups[key].push(annotation);
    }

    for (const key of Object.keys(groups)) {
      groups[key].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    }

    return groups;
  }

  async writeBookNote(annotations: Annotation[]) {
    const first = annotations[0];
    const safeTitle = first.bookTitle.replace(/[\\/:*?"<>|]/g, "-");
    const folderPath = normalizePath(this.settings.outputFolder);
    const safeAuthor = first.author.replace(/[\\/:*?"<>|]/g, "-");
    const filePath = normalizePath(`${folderPath}/${safeTitle} - ${safeAuthor}.md`);
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const bookUrl = `${baseUrl}/books/${first.bookId}/highlights`;

    await this.ensureFolder(folderPath);

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (!existingFile) {
      const content = this.buildFullNote(annotations, bookUrl, first);
      await this.app.vault.create(filePath, content);
    } else {
      const file = existingFile as TFile;
      const existing = await this.app.vault.read(file);
      const toAppend = this.buildHighlightsBlock(annotations);
      await this.app.vault.modify(file, existing + toAppend);
    }
  }

// Defines what will be shown in the full exported file
  buildFullNote(
    annotations: Annotation[],
    bookUrl: string,
    first: Annotation
  ): string {
    const customProps = this.settings.customProperties
      ? this.settings.customProperties + "\n"
      : "";
    const now = new Date().toISOString();
    const header = `---
title: "${first.bookTitle}"
author: "${first.author}"
bookorbit_book_id: ${first.bookId}
bookorbit_url: ${bookUrl}
last_synced: ${now}
${customProps}---

# ${first.bookTitle}
*${first.author}*

[View in BookOrbit](${bookUrl})

`;
    return header + this.buildHighlightsBlock(annotations);
  }

  buildHighlightsBlock(annotations: Annotation[]): string {
    let block = "";

    for (const annotation of annotations) {
      const date = this.formatDate(annotation.createdAt);
      const source = this.formatSource(annotation.origin);
      const chapter = annotation.chapterTitle && this.settings.includeChapter ? annotation.chapterTitle + " · " : "";

      block += `---\n\n`;
      block += `> ${annotation.text.replace(/\n/g, "\n> ")}\n\n`;

      if (annotation.note) {
        block += `> [!NOTE] Annotation\n> ${annotation.note}\n\n`;
      }

      block += `*${source} · ${date} · ${chapter}<span style="color: ${annotation.color};">●</span>*\n\n`;
    }

    return block;
  }

  formatDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatSource(origin: string): string {
    const map: Record<string, string> = {
      koreader: "KOReader",
      kobo: "Kobo",
      web: "Web",
    };
    return map[origin] ?? origin;
  }

  async ensureFolder(path: string) {
    const exists = this.app.vault.getAbstractFileByPath(path);
    if (!exists) {
      await this.app.vault.createFolder(path);
    }
  }
}

class BookOrbitSettingTab extends PluginSettingTab {
  plugin: BookOrbitPlugin;

  constructor(app: App, plugin: BookOrbitPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("The full URL of your BookOrbit instance.")
      .addText((text) =>
        text
          .setPlaceholder("https://bookorbit.yourdomain.com")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Username")
      .addText((text) =>
        text
          .setPlaceholder("your username")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Password")
      .addText((text) => {
        text
          .setPlaceholder("your password")
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Sync chapter titles")
      .setDesc("Include the chapter title in synced highlights.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.includeChapter)
        .onChange(async (value) => {
          this.plugin.settings.includeChapter = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Folder in your vault where book notes will be saved.")
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim() || "Books";
            await this.plugin.saveSettings();
          })
      );
    
    new Setting (containerEl)
      .setName("Custom properties")
      .setDesc("Add custom properties to all synced highlights.")
      .addTextArea ((text) => {
        text 
          .setPlaceholder("Property: PropertyValue")
          .setValue(this.plugin.settings.customProperties)
          .onChange(async (value) => {
            this.plugin.settings.customProperties = value;
            await this.plugin.saveSettings();
          })
      });

    new Setting(containerEl)
      .setName("Sync on launch?")
      .setDesc("Enable or disable automatic syncing of highlights on launch of Obsidian.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.syncOnLaunch)
        .onChange(async (value) => {
          this.plugin.settings.syncOnLaunch = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Manually trigger a sync.")
      .addButton((btn) =>
        btn
          .setButtonText("Sync")
          .setCta()
          .onClick(async () => {
            await this.plugin.runSync();
          })
      );

    if (this.plugin.settings.lastSyncTime) {
      new Setting(containerEl)
        .setName("Last synced")
        .setDesc(this.plugin.formatDate(this.plugin.settings.lastSyncTime));
    }

    new Setting(containerEl)
      .setName("Reset sync")
      .setDesc("Clears the last sync time. Next sync will re-import everything.")
      .addButton((btn) =>
        btn
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.lastSyncTime = "";
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }
}
